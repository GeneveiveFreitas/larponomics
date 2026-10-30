const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { createApp } = require("./server");
const { ADMIN_DISCORD_ID } = require("./account");
const { STOCKS } = require("./market");
const initialPrices = Object.fromEntries(STOCKS.map(({ symbol, initial }) => [symbol, initial]));

let activeAccount = null;
let hasSession = false;
let storedMarketState = null;
let server;
let baseUrl;

const accountOptions = {
  AccountModel: {
    findById: () => ({ lean: async () => activeAccount }),
  },
  SessionModel: {
    findOne: () => ({ lean: async () => hasSession ? { accountId: "test-account" } : null }),
    deleteOne: async () => {},
  },
  connect: async () => {},
};

const marketState = {
  findOne: () => ({ lean: async () => storedMarketState }),
  findOneAndUpdate: (filter, update) => {
    if (!Array.isArray(update)) {
      storedMarketState ||= structuredClone(update.$setOnInsert || {});
      if (update.$set) Object.assign(storedMarketState, update.$set);
    } else {
      const set = update[0].$set;
      if (set.events) {
        const event = set.events.$slice[0].$concatArrays[1][0];
        const symbol = event.stockSymbol;
        const basePrice = storedMarketState.prices[symbol] ?? initialPrices[symbol];
        const change = event.direction === "increase" ? event.amount : -event.amount;
        const nextPrice = Math.max(1, Math.round(basePrice * (1 + change / 100) * 100) / 100);
        const previousDailyChange = storedMarketState.dailyChanges?.[symbol] ?? 0;
        storedMarketState.prices[symbol] = nextPrice;
        storedMarketState.history[symbol] = [
          ...(storedMarketState.history[symbol] || [basePrice]),
          nextPrice,
        ].slice(-120);
        storedMarketState.dailyChanges[symbol] =
          Math.round(((previousDailyChange + 100) * (1 + change / 100) - 100) * 100) / 100;
        storedMarketState.events = [...(storedMarketState.events || []), event].slice(-50);
      } else {
        storedMarketState.prices = { ...initialPrices };
        storedMarketState.history = Object.fromEntries(
          STOCKS.map(({ symbol, initial }) => [symbol, [initial]]),
        );
        storedMarketState.dailyChanges = Object.fromEntries(
          STOCKS.map(({ symbol }) => [symbol, 0]),
        );
      }
      storedMarketState.marketDate = set.marketDate;
      storedMarketState.updatedAt = set.updatedAt;
    }
    return { lean: async () => storedMarketState };
  },
};

async function startServer() {
  storedMarketState = null;
  const app = createApp({
    accountOptions,
    marketState,
    connect: async () => {},
    random: () => 0.5,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  server = null;
}

after(stopServer);

test("admin page and APIs require the configured Discord account", async () => {
  await startServer();

  const unauthenticatedPage = await fetch(`${baseUrl}/admin`);
  assert.equal(unauthenticatedPage.status, 401);
  const exposedPageFile = await fetch(`${baseUrl}/admin.html`);
  assert.equal(exposedPageFile.status, 401);
  const unauthenticatedApi = await fetch(`${baseUrl}/api/admin/market`);
  assert.equal(unauthenticatedApi.status, 401);

  hasSession = true;
  activeAccount = {
    _id: "test-account",
    discordId: "987654321098765432",
    username: "NotAdmin",
  };
  const forbiddenPage = await fetch(`${baseUrl}/admin`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const forbiddenApi = await fetch(`${baseUrl}/api/admin/organizations`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  assert.equal(forbiddenPage.status, 403);
  assert.equal(forbiddenApi.status, 403);

  activeAccount.discordId = ADMIN_DISCORD_ID;
  const authorizedPage = await fetch(`${baseUrl}/admin`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  assert.equal(authorizedPage.status, 200);
  const adminPage = await authorizedPage.text();
  assert.match(adminPage, /Admin Settings/);
  assert.match(adminPage, /id="event-form"/);
  assert.match(adminPage, /id="event-amount"/);

  const accountResponse = await fetch(`${baseUrl}/api/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  assert.equal((await accountResponse.json()).user.isAdmin, true);

  const invalidRange = await fetch(`${baseUrl}/api/admin/market/range`, {
    method: "PATCH",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ min: 6, max: -6 }),
  });
  assert.equal(invalidRange.status, 400);

  const savedRange = await fetch(`${baseUrl}/api/admin/market/range`, {
    method: "PATCH",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ min: -2.5, max: 3 }),
  });
  assert.equal(savedRange.status, 200);
  assert.deepEqual((await savedRange.json()).range, { min: -2.5, max: 3 });
  const savedSettings = await fetch(`${baseUrl}/api/admin/market`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  assert.deepEqual((await savedSettings.json()).range, { min: -2.5, max: 3 });

  const invalidEvent = await fetch(`${baseUrl}/api/admin/events`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Bad event",
      description: "Invalid adjustment",
      stockSymbol: "NOPE",
      direction: "increase",
      amount: 10,
    }),
  });
  assert.equal(invalidEvent.status, 400);

  const createdEvent = await fetch(`${baseUrl}/api/admin/events`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Festival boom",
      description: "Demand rose across the market.",
      stockSymbol: "A",
      direction: "increase",
      amount: 10,
    }),
  });
  assert.equal(createdEvent.status, 201);
  const { event } = await createdEvent.json();
  assert.equal(event.title, "Festival boom");
  assert.equal(event.amount, 10);
  assert.equal(storedMarketState.prices.A, 1980);

  const publicMarketResponse = await fetch(`${baseUrl}/api/market`);
  const publicMarket = await publicMarketResponse.json();
  assert.equal(publicMarket.stocks.find(({ symbol }) => symbol === "A").price, 1980);
  assert.equal(publicMarket.events[0].title, "Festival boom");
});

test("admin deployment uses one serverless function for all settings routes", () => {
  assert.equal(typeof require("./api/admin"), "function");
});

test("the shared admin function dispatches rewritten route queries", async () => {
  const app = require("./admin-app");
  const sharedServer = app.listen(0);
  await new Promise((resolve) => sharedServer.once("listening", resolve));
  try {
    const sharedUrl = `http://127.0.0.1:${sharedServer.address().port}/api/admin`;
    for (const route of [
      "page",
      "market",
      "market/range",
      "market/prices",
      "market/reset",
      "events",
      "organizations",
    ]) {
      const response = await fetch(`${sharedUrl}?route=${route}`);
      assert.equal(response.status, 401, `${route} should reach protected admin routing`);
    }
  } finally {
    await new Promise((resolve, reject) => {
      sharedServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
