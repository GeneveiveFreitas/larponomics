require("dotenv").config();

const mongoose = require("mongoose");

const HISTORY_LIMIT = 120;
const STOCKS = [
  { symbol: "A", name: "A Corp", initial: 1800 },
  { symbol: "B", name: "B Corp", initial: 1200 },
  { symbol: "C", name: "C Corp", initial: 1000 },
  { symbol: "D", name: "D Corp", initial: 500 },
  { symbol: "E", name: "E Corp", initial: 600 },
  { symbol: "F", name: "F Corp", initial: 600 },
  { symbol: "G", name: "G Corp", initial: 300 },
  { symbol: "H", name: "H Corp", initial: 300 },
  { symbol: "I", name: "I Corp", initial: 500 },
  { symbol: "J", name: "J Corp", initial: 100 },
  { symbol: "K", name: "K Corp", initial: 300 },
  { symbol: "L", name: "L Corp", initial: 100 },
  { symbol: "M", name: "M Corp", initial: 300 },
  { symbol: "N", name: "N Corp", initial: 500 },
  { symbol: "O", name: "O Corp", initial: 300 },
  { symbol: "P", name: "P Corp", initial: 200 },
  { symbol: "Q", name: "Q Corp", initial: 200 },
  { symbol: "R", name: "R Corp", initial: 600 },
  { symbol: "S", name: "S Corp", initial: 200 },
  { symbol: "T", name: "T Corp", initial: 600 },
  { symbol: "U", name: "U Corp", initial: 300 },
  { symbol: "V", name: "V Corp", initial: 400 },
  { symbol: "W", name: "W Corp", initial: 100 },
  { symbol: "X", name: "X Corp", initial: 100 },
  { symbol: "Y", name: "Y Corp", initial: 300 },
  { symbol: "HANA", name: "Hana Association", initial: 300 },
  { symbol: "ZWEI", name: "Zwei Association", initial: 300 },
  { symbol: "TRES", name: "Tres Association", initial: 300 },
  { symbol: "SHI", name: "Shi Association", initial: 300 },
  { symbol: "CINQ", name: "Cinq Association", initial: 300 },
  { symbol: "LIU", name: "Liu Association", initial: 300 },
  { symbol: "SEVEN", name: "Seven Association", initial: 300 },
  { symbol: "EIGHT", name: "Eight Association", initial: 300 },
  { symbol: "DEVYAT", name: "Devyat Association", initial: 300 },
  { symbol: "DIECI", name: "Dieci Association", initial: 300 },
  { symbol: "OUFI", name: "Oufi Association", initial: 300 },
  { symbol: "GILDED", name: "Gilded City", initial: 200 },
  { symbol: "DODEKA", name: "Dodeka Association", initial: 300 },
  { symbol: "LATERANO", name: "Laterano", initial: 200 },
];

const marketStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    prices: { type: mongoose.Schema.Types.Mixed, required: true },
    history: { type: mongoose.Schema.Types.Mixed, required: true },
    cumulativeChanges: { type: mongoose.Schema.Types.Mixed, default: {} },
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
      const dailyChange = state?.cumulativeChanges?.[stock.symbol] ??
        state?.dailyChanges?.[stock.symbol] ??
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

async function updateMarketPrices(
  marketState,
  upVotes,
  downVotes,
  { session } = {},
) {
  const initial = initialMarketValues();
  const priceUpdates = {};
  const historyUpdates = {};
  const cumulativeChangeUpdates = {};

  for (const stock of STOCKS) {
    const multiplier =
      Math.pow(1.01, upVotes[stock.symbol] || 0) *
      Math.pow(0.99, downVotes[stock.symbol] || 0);
    const nextPrice = {
      $max: [
        1,
        {
          $round: [{
            $multiply: [
              { $ifNull: [`$prices.${stock.symbol}`, stock.initial] },
              multiplier,
            ],
          }, 2],
        },
      ],
    };
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
    cumulativeChangeUpdates[stock.symbol] = {
      $add: [
        {
          $ifNull: [
            `$cumulativeChanges.${stock.symbol}`,
            { $ifNull: [`$dailyChanges.${stock.symbol}`, 0] },
          ],
        },
        (upVotes[stock.symbol] || 0) - (downVotes[stock.symbol] || 0),
      ],
    };
  }

  const initializedValues = initialMarketValues();
  return marketState.findOneAndUpdate(
    { key: MARKET_STATE_KEY },
    [
      {
        $set: {
          key: { $ifNull: ["$key", MARKET_STATE_KEY] },
          prices: {
            $mergeObjects: [initializedValues.prices, { $ifNull: ["$prices", {}] }],
          },
          history: {
            $mergeObjects: [initializedValues.history, { $ifNull: ["$history", {}] }],
          },
        },
      },
      {
        $set: {
          prices: priceUpdates,
          history: historyUpdates,
          cumulativeChanges: cumulativeChangeUpdates,
          updatedAt: new Date(),
        },
      },
    ],
    { new: true, upsert: true, updatePipeline: true, ...(session ? { session } : {}) },
  ).lean();
}

function createMarketHandler({
  marketState = MarketState,
  clock = () => new Date(),
  connect = connectDatabase,
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
  updateMarketPrices,
  MarketState,
  STOCKS,
  utcDateString,
};
