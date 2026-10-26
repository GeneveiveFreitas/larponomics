const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const storedSchedules = [
  { date: "2026-10-20", moves: { A: 2 } },
  { date: "2026-10-21", moves: { A: 1 } },
];
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
    clock: () => new Date("2026-10-21T00:00:00.000Z"),
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
  assert.equal(result.date, "2026-10-21");
  assert.equal(result.scheduleAvailable, true);
  assert.ok(Math.abs(stockA.price - 1854.36) < 1e-9);
  assert.equal(stockB.price, 1200);
  assert.equal(stockA.history.length, 120);
  assert.equal(stockA.history.at(-2), 1836);
  assert.ok(Math.abs(stockA.dailyChange - 1) < 1e-9);
  assert.equal(stockB.dailyChange, 0);
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

test("Vercel account endpoints export request handlers", () => {
  for (const endpoint of [
    "./api/account",
    "./api/account/purchases",
    "./api/auth/discord",
    "./api/auth/discord/callback",
    "./api/auth/logout",
  ]) {
    assert.equal(typeof require(endpoint), "function");
  }
});

test("Vercel Discord sign-in endpoint routes to the account handler", async () => {
  const configurationKeys = [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_REDIRECT_URI",
  ];
  const previousConfiguration = new Map(
    configurationKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of configurationKeys) delete process.env[key];

  try {
    const app = require("./api/auth/discord");
    const authServer = app.listen(0);
    await new Promise((resolve) => authServer.once("listening", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${authServer.address().port}/api/auth/discord`);
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /not configured/);
    } finally {
      await new Promise((resolve, reject) => {
        authServer.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    for (const [key, value] of previousConfiguration) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("market endpoint can preview tomorrow's scheduled prices", async () => {
  const response = await fetch(`${baseUrl}/api/market?date=2026-10-22`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.date, "2026-10-22");
  assert.equal(result.scheduleAvailable, false);
  assert.equal(result.stocks.find((stock) => stock.symbol === "A").dailyChange, 0);
});

test("market endpoint rejects previews beyond tomorrow", async () => {
  const response = await fetch(`${baseUrl}/api/market?date=2026-10-23`);
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /no later than tomorrow/);
});
