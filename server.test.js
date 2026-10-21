const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const storedSchedules = [{ date: "2026-01-02", moves: { A: 2 } }];
const dailyMoves = {
  find() {
    return { lean: async () => storedSchedules };
  },
};
let server;
let baseUrl;

before(async () => {
  const app = createApp({
    dailyMoves,
    clock: () => new Date("2026-01-03T00:00:00.000Z"),
    connect: async () => {},
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test("market endpoint returns scheduled prices and history", async () => {
  const response = await fetch(`${baseUrl}/api/market`);
  const result = await response.json();
  const stockA = result.stocks.find((stock) => stock.symbol === "A");
  const stockB = result.stocks.find((stock) => stock.symbol === "B");

  assert.equal(response.status, 200);
  assert.equal(result.date, "2026-01-03");
  assert.equal(stockA.price, 1836);
  assert.equal(stockB.price, 1200);
  assert.equal(stockA.history.length, 3);
  assert.equal(stockA.history[1], 1836);
});

test("app serves the market page and static assets", async () => {
  const page = await fetch(baseUrl);
  const script = await fetch(`${baseUrl}/script.js`);

  assert.equal(page.status, 200);
  assert.match(await page.text(), /Kethercraft Stock Market/);
  assert.equal(script.status, 200);
});

test("Vercel market function exports a request handler", () => {
  assert.equal(typeof require("./api/market"), "function");
});
