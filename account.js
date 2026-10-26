const crypto = require("node:crypto");
const express = require("express");
const mongoose = require("mongoose");
const {
  connectDatabase,
  MarketState,
  STOCKS,
  updateMarketPrices,
} = require("./market");

const DAILY_STOCK_LIMIT = 10;
const SESSION_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "larponomics_session";
const OAUTH_STATE_COOKIE = "larponomics_oauth_state";
const stockSymbols = new Set(STOCKS.map((stock) => stock.symbol));

const accountSchema = new mongoose.Schema(
  {
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatar: { type: String, default: null },
    holdings: { type: mongoose.Schema.Types.Mixed, default: {} },
    dailyPurchaseDate: { type: String, default: "" },
    dailyPurchased: { type: Number, default: 0 },
  },
  { collection: "accounts", timestamps: true },
);
const Account = mongoose.models.LarponomicsAccount ||
  mongoose.model("LarponomicsAccount", accountSchema);

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "LarponomicsAccount" },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { collection: "account_sessions", versionKey: false },
);
const AccountSession = mongoose.models.LarponomicsAccountSession ||
  mongoose.model("LarponomicsAccountSession", sessionSchema);

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function dailyPurchaseCount(account, today) {
  if (
    account.dailyPurchaseDate !== today ||
    !Number.isInteger(account.dailyPurchased) ||
    account.dailyPurchased < 0
  ) {
    return 0;
  }
  return Math.min(account.dailyPurchased, DAILY_STOCK_LIMIT);
}

function cookieValue(req, name) {
  const cookies = req.headers.cookie || "";
  const cookie = cookies.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

function cookieOptions(maxAge, secure) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function setCookie(res, name, value, maxAge, secure) {
  res.append("Set-Cookie", `${name}=${value}; ${cookieOptions(maxAge, secure)}`);
}

function clearCookie(res, name, secure) {
  setCookie(res, name, "", 0, secure);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function runTransaction(callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function accountPayload(account, today, unlimitedPurchases = false) {
  const purchased = dailyPurchaseCount(account, today);
  const holdings = Object.entries(account.holdings || {})
    .filter(([, shares]) => Number.isInteger(shares) && shares > 0)
    .map(([symbol, shares]) => ({ symbol, shares }));

  return {
    user: {
      id: account.discordId,
      username: account.username,
      avatarUrl: account.avatar
        ? `https://cdn.discordapp.com/avatars/${account.discordId}/${encodeURIComponent(account.avatar)}.png?size=96`
        : null,
    },
    daily: {
      date: today,
      purchased,
      unlimited: unlimitedPurchases,
      remaining: unlimitedPurchases ? null : DAILY_STOCK_LIMIT - purchased,
    },
    holdings,
  };
}

function createAccountRouter({
  AccountModel = Account,
  SessionModel = AccountSession,
  MarketStateModel = MarketState,
  connect = connectDatabase,
  clock = () => new Date(),
  fetchImpl = globalThis.fetch,
  environment = process.env,
  transaction = runTransaction,
  marketRandom = Math.random,
} = {}) {
  const router = express.Router();
  const secureCookies = environment.NODE_ENV === "production";
  const unlimitedPurchaseDiscordId = environment.UNLIMITED_PURCHASE_DISCORD_ID;

  function hasUnlimitedPurchases(account) {
    return Boolean(
      unlimitedPurchaseDiscordId &&
      account.discordId === unlimitedPurchaseDiscordId.trim()
    );
  }

  function discordConfig() {
    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = environment;
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) return null;
    try {
      const redirectUrl = new URL(DISCORD_REDIRECT_URI);
      if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") return null;
      return { clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, redirectUri: redirectUrl.href };
    } catch {
      return null;
    }
  }

  async function findAccount(req) {
    const token = cookieValue(req, SESSION_COOKIE);
    if (!token) return null;

    await connect();
    const session = await SessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: clock() },
    }).lean();
    if (!session) return null;
    return AccountModel.findById(session.accountId).lean();
  }

  function sendUnavailable(res) {
    res.status(503).json({ error: "Discord sign-in is not configured" });
  }

  router.get("/api/auth/discord", (req, res) => {
    const config = discordConfig();
    if (!config) return sendUnavailable(res);

    const state = crypto.randomBytes(32).toString("hex");
    setCookie(res, OAUTH_STATE_COOKIE, state, 600, secureCookies);
    const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
    authorizeUrl.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "identify",
      state,
    }).toString();
    res.redirect(authorizeUrl.toString());
  });

  router.get("/api/auth/discord/callback", async (req, res) => {
    const config = discordConfig();
    clearCookie(res, OAUTH_STATE_COOKIE, secureCookies);
    if (!config) return sendUnavailable(res);
    if (req.query.error || typeof req.query.code !== "string") {
      return res.redirect("/?account=cancelled");
    }

    const expectedState = cookieValue(req, OAUTH_STATE_COOKIE);
    const actualState = typeof req.query.state === "string" ? req.query.state : "";
    if (
      !expectedState ||
      expectedState.length !== actualState.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(actualState))
    ) {
      return res.status(400).send("Invalid sign-in state. Please try again.");
    }

    try {
      const tokenResponse = await fetchImpl("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code: req.query.code,
          redirect_uri: config.redirectUri,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
      const tokenData = await tokenResponse.json();
      if (typeof tokenData.access_token !== "string") {
        throw new Error("Discord returned an invalid access token");
      }

      const discordResponse = await fetchImpl("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!discordResponse.ok) throw new Error("Unable to load Discord profile");
      const discordUser = await discordResponse.json();
      if (
        typeof discordUser.id !== "string" ||
        !/^\d{17,20}$/.test(discordUser.id) ||
        typeof discordUser.username !== "string"
      ) {
        throw new Error("Discord returned an invalid profile");
      }

      await connect();
      const account = await AccountModel.findOneAndUpdate(
        { discordId: discordUser.id },
        {
          $set: { username: discordUser.username, avatar: discordUser.avatar || null },
          $setOnInsert: { holdings: {}, dailyPurchaseDate: "", dailyPurchased: 0 },
        },
        { new: true, upsert: true, runValidators: true },
      );

      const sessionToken = crypto.randomBytes(32).toString("hex");
      await SessionModel.create({
        tokenHash: hashToken(sessionToken),
        accountId: account._id,
        expiresAt: new Date(clock().getTime() + SESSION_LENGTH_MS),
      });
      setCookie(res, SESSION_COOKIE, sessionToken, SESSION_LENGTH_MS / 1000, secureCookies);
      res.redirect("/");
    } catch (error) {
      console.error("Discord sign-in failed:", error);
      res.status(502).send("Discord sign-in failed. Please try again.");
    }
  });

  router.get("/api/account", async (req, res) => {
    try {
      const account = await findAccount(req);
      if (!account) return res.status(401).json({ error: "Sign in to access your account" });
      res.set("Cache-Control", "no-store");
      res.json(accountPayload(account, utcDateString(clock()), hasUnlimitedPurchases(account)));
    } catch (error) {
      console.error("Unable to load account:", error);
      res.status(500).json({ error: "Unable to load account" });
    }
  });

  router.post("/api/account/purchases", async (req, res) => {
    try {
      const account = await findAccount(req);
      if (!account) return res.status(401).json({ error: "Sign in to invest" });

      const { symbol, quantity } = req.body || {};
      if (
        typeof symbol !== "string" ||
        !stockSymbols.has(symbol) ||
        ![1, 5, "max"].includes(quantity)
      ) {
        return res.status(400).json({ error: "Choose a valid stock and quantity" });
      }

      const today = utcDateString(clock());
      const unlimitedPurchases = hasUnlimitedPurchases(account);
      const previousCount = dailyPurchaseCount(account, today);
      let sharesToBuy = quantity;
      if (quantity === "max") {
        sharesToBuy = unlimitedPurchases
          ? DAILY_STOCK_LIMIT
          : DAILY_STOCK_LIMIT - previousCount;
      }
      if (sharesToBuy < 1) {
        return res.status(409).json({ error: "Daily limit reached" });
      }

      const dailyCountExpression = {
        $cond: [
          { $eq: ["$dailyPurchaseDate", today] },
          { $ifNull: ["$dailyPurchased", 0] },
          0,
        ],
      };
      const purchase = await transaction(async (session) => {
        const updatedAccount = await AccountModel.findOneAndUpdate(
          {
            _id: account._id,
            ...(!unlimitedPurchases
              ? {
                  $expr: {
                    $lte: [
                      dailyCountExpression,
                      DAILY_STOCK_LIMIT - sharesToBuy,
                    ],
                  },
                }
              : {}),
          },
          [
            {
              $set: {
                dailyPurchaseDate: today,
                dailyPurchased: { $add: [dailyCountExpression, sharesToBuy] },
                holdings: {
                  $mergeObjects: [
                    { $ifNull: ["$holdings", {}] },
                    {
                      [symbol]: {
                        $add: [{ $ifNull: [`$holdings.${symbol}`, 0] }, sharesToBuy],
                      },
                    },
                  ],
                },
              },
            },
          ],
          { new: true, updatePipeline: true, session },
        ).lean();

        if (!updatedAccount) return null;
        const market = await updateMarketPrices(
          MarketStateModel,
          symbol,
          sharesToBuy,
          { random: marketRandom, session },
        );
        return { updatedAccount, market };
      });

      if (!purchase) {
        return res.status(409).json({ error: "Daily limit changed. Refresh and try again." });
      }

      res.set("Cache-Control", "no-store");
      res.json({
        ...accountPayload(purchase.updatedAccount, today, unlimitedPurchases),
        purchased: { symbol, shares: sharesToBuy },
        marketUpdated: true,
      });
    } catch (error) {
      console.error("Unable to save stock purchase:", error);
      res.status(500).json({ error: "Unable to save purchase" });
    }
  });

  router.post("/api/auth/logout", async (req, res) => {
    try {
      const token = cookieValue(req, SESSION_COOKIE);
      if (token) {
        await connect();
        await SessionModel.deleteOne({ tokenHash: hashToken(token) });
      }
      clearCookie(res, SESSION_COOKIE, secureCookies);
      res.status(204).end();
    } catch (error) {
      console.error("Unable to sign out:", error);
      res.status(500).json({ error: "Unable to sign out" });
    }
  });

  return router;
}

module.exports = { accountPayload, createAccountRouter, dailyPurchaseCount, DAILY_STOCK_LIMIT };
