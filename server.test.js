const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const storedMarketState = {
  prices: { A: 1854.36, B: 1200 },
  history: {
    A: [1800, 1836, 1854.36],
    B: [1200, 1200, 1200],
  },
};
const marketState = {
  findOne() {
    return { lean: async () => storedMarketState };
  },
};
let server;
let baseUrl;

before(async () => {
  const app = createApp({
    marketState,
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

test("market endpoint returns saved prices and price history", async () => {
  const response = await fetch(`${baseUrl}/api/market`);
  const result = await response.json();
  const stockA = result.stocks.find((stock) => stock.symbol === "A");
  const stockB = result.stocks.find((stock) => stock.symbol === "B");

  assert.equal(response.status, 200);
  assert.equal(result.date, "2026-10-21");
  assert.ok(Math.abs(stockA.price - 1854.36) < 1e-9);
  assert.equal(stockB.price, 1200);
  assert.equal(stockA.history.length, 3);
  assert.equal(stockA.history.at(-2), 1836);
  assert.ok(Math.abs(stockA.dailyChange - 1) < 1e-9);
  assert.equal(stockB.dailyChange, 0);
});

test("app serves the market and voting pages with their scripts", async () => {
  const page = await fetch(baseUrl);
  const script = await fetch(`${baseUrl}/script.js`);
  const votingPage = await fetch(`${baseUrl}/votes.html`);
  const votingScript = await fetch(`${baseUrl}/votes.js`);

  assert.equal(page.status, 200);
  assert.match(await page.text(), /Kethercraft Stock Market/);
  assert.equal(script.status, 200);
  assert.equal(votingPage.status, 200);
  assert.match(await votingPage.text(), /Voting/);
  assert.equal(votingScript.status, 200);
});

test("Vercel market function exports a request handler", () => {
  assert.equal(typeof require("./api/market"), "function");
});

test("Vercel account endpoints export request handlers", () => {
  for (const endpoint of [
    "./api/account",
    "./api/account/votes",
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

test("market endpoint returns initial prices when no votes have updated them", async () => {
  const emptyMarket = { findOne: () => ({ lean: async () => null }) };
  const app = createApp({
    marketState: emptyMarket,
    clock: () => new Date("2026-10-21T00:00:00.000Z"),
    connect: async () => {},
  });
  const emptyServer = app.listen(0);
  await new Promise((resolve) => emptyServer.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${emptyServer.address().port}/api/market`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.stocks.find((stock) => stock.symbol === "A").price, 1800);
    assert.equal(result.stocks.find((stock) => stock.symbol === "A").dailyChange, 0);
  } finally {
    await new Promise((resolve, reject) => {
      emptyServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
