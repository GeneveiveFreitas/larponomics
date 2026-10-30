const express = require("express");
const mongoose = require("mongoose");
const {
  connectDatabase,
  getMarketData,
  initialMarketValues,
  MarketState,
  STOCKS,
  utcDateString,
} = require("./market");
const { createAdminMiddleware } = require("./account");
const { Organization, ORGANIZATION_CATEGORIES } = require("./organizations");

const HISTORY_LIMIT = 120;
const INITIAL_PRICES = Object.fromEntries(STOCKS.map(({ symbol, initial }) => [symbol, initial]));

function isMoney(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 1_000_000_000_000 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function parseOrganization(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category;
  const directors = body.directors;
  if (
    !name ||
    name.length > 100 ||
    !ORGANIZATION_CATEGORIES.includes(category) ||
    !Array.isArray(directors) ||
    directors.length > 20
  ) return null;

  const cleanedDirectors = [];
  for (const director of directors) {
    if (!director || typeof director.name !== "string" || typeof director.role !== "string") {
      return null;
    }
    const directorName = director.name.trim();
    const role = director.role.trim();
    if (!directorName || directorName.length > 100 || !role || role.length > 60) return null;
    cleanedDirectors.push({ name: directorName, role });
  }
  return { name, category, directors: cleanedDirectors, director: "", coDirector: "" };
}

async function ensureMarketState(marketState) {
  const initial = initialMarketValues();
  try {
    await marketState.findOneAndUpdate(
      { key: "global" },
      {
        $setOnInsert: {
          key: "global",
          prices: initial.prices,
          history: initial.history,
          dailyChanges: {},
          dailyChangeMin: -5,
          dailyChangeMax: 5,
          marketDate: "",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

function historyExpression(symbol, appendPrice) {
  const initial = INITIAL_PRICES[symbol];
  const history = { $ifNull: [`$history.${symbol}`, [initial]] };
  return {
    $slice: [
      appendPrice === undefined
        ? history
        : { $concatArrays: [history, [appendPrice]] },
      -HISTORY_LIMIT,
    ],
  };
}

function createAdminRouter({
  accountOptions,
  marketState = MarketState,
  organizationModel = Organization,
  connect = connectDatabase,
  clock = () => new Date(),
} = {}) {
  const router = express.Router();
  router.use("/api/admin", createAdminMiddleware(accountOptions));

  router.get("/api/admin/market", async (req, res) => {
    try {
      await connect();
      const state = await marketState.findOne({ key: "global" }).lean();
      const data = await getMarketData(marketState, utcDateString(clock()));
      res.set("Cache-Control", "no-store");
      res.json({
        ...data,
        range: {
          min: state?.dailyChangeMin ?? -5,
          max: state?.dailyChangeMax ?? 5,
        },
      });
    } catch (error) {
      console.error("Unable to load admin market settings:", error);
      res.status(500).json({ error: "Unable to load market settings" });
    }
  });

  router.patch("/api/admin/market/range", async (req, res) => {
    const { min, max } = req.body || {};
    if (
      typeof min !== "number" || !Number.isFinite(min) ||
      typeof max !== "number" || !Number.isFinite(max) ||
      min < -100 || max > 100 || min > max ||
      Math.abs(min * 100 - Math.round(min * 100)) > 1e-8 ||
      Math.abs(max * 100 - Math.round(max * 100)) > 1e-8
    ) {
      return res.status(400).json({ error: "Enter a valid range from -100% to 100%, with up to two decimals" });
    }

    try {
      await connect();
      await ensureMarketState(marketState);
      const now = clock();
      await marketState.findOneAndUpdate(
        { key: "global" },
        { $set: { dailyChangeMin: min, dailyChangeMax: max, updatedAt: now } },
        { new: true },
      ).lean();
      res.set("Cache-Control", "no-store");
      res.json({ range: { min, max } });
    } catch (error) {
      console.error("Unable to update daily fluctuation range:", error);
      res.status(500).json({ error: "Unable to update daily fluctuation range" });
    }
  });

  router.patch("/api/admin/market/prices", async (req, res) => {
    const prices = req.body?.prices;
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
      return res.status(400).json({ error: "Provide stock prices to update" });
    }
    const entries = Object.entries(prices);
    if (
      !entries.length ||
      entries.some(([symbol, price]) => !Object.hasOwn(INITIAL_PRICES, symbol) || !isMoney(price))
    ) {
      return res.status(400).json({ error: "Use valid stock symbols and prices of at least 1 with up to two decimals" });
    }

    try {
      await connect();
      await ensureMarketState(marketState);
      const now = clock();
      const requestedPrices = Object.fromEntries(entries);
      const nextPrices = {};
      const nextHistory = {};
      const nextChanges = {};
      for (const stock of STOCKS) {
        const { symbol, initial } = stock;
        const requestedPrice = requestedPrices[symbol];
        nextPrices[symbol] = requestedPrice ?? { $ifNull: [`$prices.${symbol}`, initial] };
        nextHistory[symbol] = historyExpression(symbol, requestedPrice);
        nextChanges[symbol] = requestedPrice === undefined
          ? 0
          : {
            $round: [{
              $multiply: [{
                $subtract: [
                  { $divide: [requestedPrice, { $ifNull: [`$prices.${symbol}`, initial] }] },
                  1,
                ],
              }, 100],
            }, 2],
          };
      }
      await marketState.findOneAndUpdate(
        { key: "global" },
        [{
          $set: {
            prices: nextPrices,
            history: nextHistory,
            dailyChanges: nextChanges,
            marketDate: utcDateString(now),
            updatedAt: now,
          },
        }],
        { new: true, updatePipeline: true },
      ).lean();
      res.set("Cache-Control", "no-store");
      res.json({ message: "Stock prices updated" });
    } catch (error) {
      console.error("Unable to update stock prices:", error);
      res.status(500).json({ error: "Unable to update stock prices" });
    }
  });

  router.post("/api/admin/market/reset", async (req, res) => {
    try {
      await connect();
      await ensureMarketState(marketState);
      const now = clock();
      const history = Object.fromEntries(STOCKS.map(({ symbol }) => [
        symbol,
        historyExpression(symbol, INITIAL_PRICES[symbol]),
      ]));
      const dailyChanges = Object.fromEntries(STOCKS.map(({ symbol }) => [symbol, 0]));
      await marketState.findOneAndUpdate(
        { key: "global" },
        [{
          $set: {
            prices: INITIAL_PRICES,
            history,
            dailyChanges,
            marketDate: utcDateString(now),
            updatedAt: now,
          },
        }],
        { new: true, updatePipeline: true },
      ).lean();
      res.set("Cache-Control", "no-store");
      res.json({ message: "Stock prices reset to their initial values" });
    } catch (error) {
      console.error("Unable to reset stock prices:", error);
      res.status(500).json({ error: "Unable to reset stock prices" });
    }
  });

  router.get("/api/admin/organizations", async (req, res) => {
    try {
      await connect();
      const savedOrganizations = await organizationModel.find({})
        .sort({ name: 1 })
        .lean();
      const organizations = savedOrganizations.map((organization) => {
        const directors = Array.isArray(organization.directors) && organization.directors.length
          ? organization.directors
            .filter((director) => typeof director?.name === "string" && director.name.trim())
            .map((director) => ({
              name: director.name.trim(),
              role: typeof director.role === "string" && director.role.trim()
                ? director.role.trim()
                : "Director",
            }))
          : [
            typeof organization.director === "string" && organization.director.trim() && {
              name: organization.director.trim(),
              role: "Director",
            },
            typeof organization.coDirector === "string" && organization.coDirector.trim() && {
              name: organization.coDirector.trim(),
              role: "Co-director",
            },
          ].filter((director) => director?.name);
        return {
          _id: organization._id,
          name: organization.name,
          category: organization.category,
          directors,
        };
      });
      res.set("Cache-Control", "no-store");
      res.json({ organizations });
    } catch (error) {
      console.error("Unable to load admin organizations:", error);
      res.status(500).json({ error: "Unable to load organizations" });
    }
  });

  router.post("/api/admin/organizations", async (req, res) => {
    const organization = parseOrganization(req.body);
    if (!organization) return res.status(400).json({ error: "Enter a valid organization" });
    try {
      await connect();
      const created = await organizationModel.create(organization);
      res.status(201).json({ organization: created });
    } catch (error) {
      console.error("Unable to create organization:", error);
      res.status(500).json({ error: "Unable to create organization" });
    }
  });

  router.put("/api/admin/organizations/:id", async (req, res) => {
    const organization = parseOrganization(req.body);
    if (!organization) return res.status(400).json({ error: "Enter a valid organization" });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }
    try {
      await connect();
      const updated = await organizationModel.findByIdAndUpdate(
        req.params.id,
        { $set: organization },
        { new: true, runValidators: true },
      ).lean();
      if (!updated) return res.status(404).json({ error: "Organization not found" });
      res.json({ organization: updated });
    } catch (error) {
      console.error("Unable to update organization:", error);
      res.status(500).json({ error: "Unable to update organization" });
    }
  });

  router.delete("/api/admin/organizations/:id", async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }
    try {
      await connect();
      const deleted = await organizationModel.findByIdAndDelete(req.params.id).lean();
      if (!deleted) return res.status(404).json({ error: "Organization not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Unable to delete organization:", error);
      res.status(500).json({ error: "Unable to delete organization" });
    }
  });

  return router;
}

module.exports = { createAdminRouter, parseOrganization };
