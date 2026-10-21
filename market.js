require("dotenv").config();

const mongoose = require("mongoose");

const MARKET_START_DATE = "2026-01-01";
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
];

const dailyMoveSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true },
    moves: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: "daily_moves", versionKey: false },
);
const DailyMove = mongoose.model("DailyMove", dailyMoveSchema);

let connectionPromise;

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

function isValidMarketDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || utcDateString(date) !== value) return false;
  if (value < MARKET_START_DATE) return false;

  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return value <= utcDateString(tomorrow);
}

async function connectDatabase() {
  const { MONGODB_URI, MONGODB_DB } = process.env;
  if (!MONGODB_URI) {
    throw new Error("Set MONGODB_URI in the environment variables");
  }

  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState !== 2 || !connectionPromise) {
    const options = MONGODB_DB ? { dbName: MONGODB_DB } : {};
    connectionPromise = mongoose.connect(MONGODB_URI, options).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  }
  await connectionPromise;
}

async function getMarketData(dailyMoves, today) {
  const schedules = await dailyMoves.find({
    date: { $gt: MARKET_START_DATE, $lte: today },
  }).lean();
  const movesByDate = new Map(schedules.map((schedule) => [schedule.date, schedule.moves]));
  const historyBySymbol = new Map(STOCKS.map((stock) => [stock.symbol, [stock.initial]]));
  const prices = new Map(STOCKS.map((stock) => [stock.symbol, stock.initial]));
  const date = new Date(`${MARKET_START_DATE}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);

  while (utcDateString(date) <= today) {
    const moves = movesByDate.get(utcDateString(date)) || {};

    for (const stock of STOCKS) {
      const percent = moves[stock.symbol] || 0;
      const price = Math.max(1, prices.get(stock.symbol) * (1 + percent / 100));
      if (!Number.isFinite(price)) {
        throw new Error(`Invalid calculated price for stock ${stock.symbol}`);
      }

      prices.set(stock.symbol, price);
      historyBySymbol.get(stock.symbol).push(price);
    }

    date.setUTCDate(date.getUTCDate() + 1);
  }

  return {
    date: today,
    scheduleAvailable: movesByDate.has(today),
    stocks: STOCKS.map((stock) => {
      const history = historyBySymbol.get(stock.symbol);
      const previousPrice = history.length > 1
        ? history[history.length - 2]
        : prices.get(stock.symbol);

      return {
        symbol: stock.symbol,
        name: stock.name,
        initial: stock.initial,
        price: prices.get(stock.symbol),
        dailyChange: (prices.get(stock.symbol) / previousPrice - 1) * 100,
        history: history.slice(-HISTORY_LIMIT),
      };
    }),
  };
}

function createMarketHandler({
  dailyMoves = DailyMove,
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
      const requestedDate = new URL(req.url, "http://localhost").searchParams.get("date");
      if (requestedDate && !isValidMarketDate(requestedDate, today)) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Date must be valid and no later than tomorrow (UTC)" }));
        return;
      }

      await connect();
      const data = await getMarketData(dailyMoves, requestedDate || today);
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

module.exports = { createMarketHandler, getMarketData, isValidMarketDate, utcDateString };
