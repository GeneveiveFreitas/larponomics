require("dotenv").config();

const mongoose = require("mongoose");

const HISTORY_LIMIT = 120;
const STOCKS = [
  { symbol: "A", name: "A Corp", initial: 1800 },
  { symbol: "B", name: "B Corp", initial: 1200 },
  { symbol: "C", name: "C Corp", initial: 1000 },
  { symbol: "D", name: "D Corp", initial: 500 },
  { symbol: "E", name: "E Corp", initial: 500 },
  { symbol: "F", name: "F Corp", initial: 500 },
  { symbol: "G", name: "G Corp", initial: 500 },
  { symbol: "H", name: "H Corp", initial: 500 },
  { symbol: "I", name: "I Corp", initial: 500 },
  { symbol: "J", name: "J Corp", initial: 500 },
  { symbol: "K", name: "K Corp", initial: 500 },
  { symbol: "L", name: "L Corp", initial: 500 },
  { symbol: "M", name: "M Corp", initial: 500 },
  { symbol: "N", name: "N Corp", initial: 500 },
  { symbol: "O", name: "O Corp", initial: 500 },
  { symbol: "P", name: "P Corp", initial: 500 },
  { symbol: "Q", name: "Q Corp", initial: 500 },
  { symbol: "R", name: "R Corp", initial: 500 },
  { symbol: "S", name: "S Corp", initial: 500 },
  { symbol: "T", name: "T Corp", initial: 500 },
  { symbol: "U", name: "U Corp", initial: 500 },
  { symbol: "V", name: "V Corp", initial: 500 },
  { symbol: "W", name: "W Corp", initial: 500 },
  { symbol: "X", name: "X Corp", initial: 500 },
  { symbol: "Y", name: "Y Corp", initial: 500 },
  { symbol: "HANA", name: "Hana Association", initial: 100 },
  { symbol: "ZWEI", name: "Zwei Association", initial: 100 },
  { symbol: "TRES", name: "Tres Association", initial: 100 },
  { symbol: "SHI", name: "Shi Association", initial: 100 },
  { symbol: "CINQ", name: "Cinq Association", initial: 100 },
  { symbol: "LIU", name: "Liu Association", initial: 100 },
  { symbol: "SEVEN", name: "Seven Association", initial: 100 },
  { symbol: "EIGHT", name: "Eight Association", initial: 100 },
  { symbol: "DEVYAT", name: "Devyat Association", initial: 100 },
  { symbol: "DIECI", name: "Dieci Association", initial: 100 },
  { symbol: "OUFI", name: "Oufi Association", initial: 100 },
  { symbol: "GILDED", name: "Gilded City", initial: 100 },
  { symbol: "DODEKA", name: "Dodeka Association", initial: 100 },
  { symbol: "LATERANO", name: "Laterano", initial: 100 },
];

const marketStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    prices: { type: mongoose.Schema.Types.Mixed, required: true },
    history: { type: mongoose.Schema.Types.Mixed, required: true },
    dailyChanges: { type: mongoose.Schema.Types.Mixed, default: {} },
    dailyChangeMin: { type: Number, default: -5 },
    dailyChangeMax: { type: Number, default: 5 },
    marketDate: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "market_state", versionKey: false },
);
const MarketState = mongoose.models.MarketState ||
  mongoose.model("MarketState", marketStateSchema);
const MARKET_STATE_KEY = "global";

let connectionPromise;

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

async function connectDatabase() {
  const { MONGODB_URI, MONGODB_DB } = process.env;
  if (!MONGODB_URI) {
    throw new Error("Set MONGODB_URI in the environment variables");
  }

  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState !== 2 || !connectionPromise) {
    const options = { dbName: MONGODB_DB || "larponomics" };
    connectionPromise = mongoose.connect(MONGODB_URI, options).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  }
  await connectionPromise;
}

function initialMarketValues() {
  return {
    prices: Object.fromEntries(STOCKS.map((stock) => [stock.symbol, stock.initial])),
    history: Object.fromEntries(STOCKS.map((stock) => [stock.symbol, [stock.initial]])),
  };
}

async function getMarketData(marketState = MarketState, today = utcDateString(new Date())) {
  const state = await marketState.findOne({ key: MARKET_STATE_KEY }).lean();
  const initial = initialMarketValues();
  return {
    date: today,
    stocks: STOCKS.map((stock) => {
      const history = state?.history?.[stock.symbol] || initial.history[stock.symbol];
      const price = state?.prices?.[stock.symbol] || initial.prices[stock.symbol];
      const previousPrice = history.length > 1
        ? history[history.length - 2]
        : price;
      const dailyChange = state?.dailyChanges?.[stock.symbol] ??
        (price / previousPrice - 1) * 100;

      return {
        symbol: stock.symbol,
        name: stock.name,
        initial: stock.initial,
        price,
        dailyChange,
        history: history.slice(-HISTORY_LIMIT),
      };
    }),
  };
}

function randomDailyChange(random = Math.random, min = -5, max = 5) {
  const sample = Math.max(0, Math.min(1, random()));
  return Math.round((min + sample * (max - min)) * 100) / 100;
}

async function advanceMarketDay(marketState, today, { random = Math.random, now = new Date() } = {}) {
  const initial = initialMarketValues();
  const existing = await marketState.findOne({ key: MARKET_STATE_KEY }).lean();
  if (existing?.marketDate === today) return existing;
  const min = existing?.dailyChangeMin ?? -5;
  const max = existing?.dailyChangeMax ?? 5;

  if (!existing) {
    try {
      await marketState.findOneAndUpdate(
        { key: MARKET_STATE_KEY },
        {
          $setOnInsert: {
            key: MARKET_STATE_KEY,
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

  const dailyChanges = {};
  const priceUpdates = {};
  const historyUpdates = {};
  for (const stock of STOCKS) {
    const change = randomDailyChange(random, min, max);
    const nextPrice = {
      $max: [
        1,
        {
          $round: [{
            $multiply: [
              { $ifNull: [`$prices.${stock.symbol}`, stock.initial] },
              1 + change / 100,
            ],
          }, 2],
        },
      ],
    };
    dailyChanges[stock.symbol] = change;
    priceUpdates[stock.symbol] = nextPrice;
    historyUpdates[stock.symbol] = {
      $slice: [
        {
          $concatArrays: [
            { $ifNull: [`$history.${stock.symbol}`, [stock.initial]] },
            [nextPrice],
          ],
        },
        -HISTORY_LIMIT,
      ],
    };
  }

  await marketState.findOneAndUpdate(
    { key: MARKET_STATE_KEY, marketDate: { $ne: today } },
    [{
      $set: {
        prices: priceUpdates,
        history: historyUpdates,
        dailyChanges,
        marketDate: today,
        updatedAt: now,
      },
    }],
    { new: true, updatePipeline: true },
  ).lean();
}

function createMarketHandler({
  marketState = MarketState,
  clock = () => new Date(),
  connect = connectDatabase,
  random = Math.random,
} = {}) {
  return async function marketHandler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    try {
      const today = utcDateString(clock());
      await connect();
      await advanceMarketDay(marketState, today, { random, now: clock() });
      const data = await getMarketData(marketState, today);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 200;
      res.end(JSON.stringify(data));
    } catch (error) {
      console.error("Unable to load market data:", error);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Unable to load market data" }));
    }
  };
}

module.exports = {
  createMarketHandler,
  connectDatabase,
  getMarketData,
  initialMarketValues,
  advanceMarketDay,
  randomDailyChange,
  MarketState,
  STOCKS,
  utcDateString,
};
