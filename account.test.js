const assert = require("node:assert/strict");
const express = require("express");
const { after, test } = require("node:test");
const { createAccountRouter } = require("./account");

const now = new Date("2026-10-26T12:00:00.000Z");
const adminAccount = {
  _id: "account-id",
  discordId: "166644936047853568",
  username: "MarketAdmin",
  avatar: "avatar-hash",
};
let server;
let baseUrl;
let marketUpdate;
let marketState = {
  prices: { A: 1800 },
  history: { A: [1800] },
};

async function startServer({
  accountData = adminAccount,
  environment = {},
  marketData = {
    prices: { A: 1800 },
    history: { A: [1800] },
  },
} = {}) {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  marketUpdate = null;
  marketState = marketData;

  const app = express();
  app.use(express.json());
  app.use(createAccountRouter({
    AccountModel: {
      findById: () => ({ lean: async () => accountData }),
    },
    MarketStateModel: {
      findOne: () => ({ lean: async () => marketState }),
      findOneAndUpdate: (filter, update, options) => {
        marketUpdate = { filter, update, options };
        return { lean: async () => ({}) };
      },
    },
    SessionModel: {
      findOne: () => ({ lean: async () => ({ accountId: accountData._id }) }),
      deleteOne: async () => {},
    },
    connect: async () => {},
    clock: () => now,
    environment,
  }));
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("account endpoint exposes market admin status", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/larponomics/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.user.username, "MarketAdmin");
  assert.equal(result.isAdmin, true);
  assert.equal("daily" in result, false);
});

test("hardcoded admins are recognized independently of environment variables", async () => {
  await startServer({
    accountData: { ...adminAccount, discordId: "294557281863860224" },
    environment: { ADMIN_DISCORD_IDS: "98765432109876543" },
  });
  const response = await fetch(`${baseUrl}/larponomics/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).isAdmin, true);
});

test("market settings require a signed-in admin", async () => {
  await startServer({
    accountData: { ...adminAccount, discordId: "98765432109876543" },
  });
  const anonymousResponse = await fetch(`${baseUrl}/larponomics/admin/market`);
  const nonAdminResponse = await fetch(`${baseUrl}/larponomics/admin/market`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(anonymousResponse.status, 401);
  assert.equal(nonAdminResponse.status, 403);
});

test("market admin can read market settings", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/larponomics/admin/market`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.stocks.length, 39);
  assert.equal(result.stocks.find((stock) => stock.symbol === "A").price, 1800);
});

test("market settings include every active event", async () => {
  const activeEvent = {
    id: "event-id",
    title: "City festival",
    impacts: [{ symbol: "A", direction: "increase", percentage: 10 }],
  };
  await startServer({
    marketData: {
      prices: { A: 1980 },
      history: { A: [1800, 1980] },
      events: [activeEvent],
    },
  });
  const response = await fetch(`${baseUrl}/larponomics/admin/market`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).events, [activeEvent]);
});

test("market admin can set a price and append price history", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/larponomics/admin/market`, {
    method: "PUT",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol: "A", price: 1900.129 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(marketUpdate.filter, { key: "global" });
  assert.equal(marketUpdate.options.updatePipeline, true);
  assert.equal(marketUpdate.update[1].$set.prices.$mergeObjects[1].A, 1900.13);
  assert.deepEqual(
    marketUpdate.update[1].$set.history.$mergeObjects[1].A.$slice[0].$concatArrays[1],
    [1900.13],
  );
});

test("market price updates reject unknown symbols and invalid prices", async () => {
  await startServer();
  for (const body of [
    { symbol: "UNKNOWN", price: 100 },
    { symbol: "A", price: 0 },
    { symbol: "A", price: "1900" },
  ]) {
    const response = await fetch(`${baseUrl}/larponomics/admin/market`, {
      method: "PUT",
      headers: {
        Cookie: "larponomics_session=test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(marketUpdate, null);
});

test("market admin can reset prices and history to their initial values", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/larponomics/admin/market`, {
    method: "POST",
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(response.status, 200);
  assert.equal(marketUpdate.options.updatePipeline, undefined);
  assert.equal(marketUpdate.update.$set.prices.A, 1800);
  assert.deepEqual(marketUpdate.update.$set.history.A, [1800]);
  assert.deepEqual(marketUpdate.update.$set.events, []);
});

test("market admin can create an event with stock impacts and update prices", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/larponomics/admin/events`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "City festival",
      impacts: [
        { symbol: "A", direction: "increase", percentage: 10 },
        { symbol: "B", direction: "decrease", percentage: 2.5 },
      ],
    }),
  });
  const result = await response.json();
  const update = marketUpdate.update[1].$set;
  const increase = update.prices.$mergeObjects[1].A.$max[1].$round[0].$multiply;
  const decrease = update.prices.$mergeObjects[1].B.$max[1].$round[0].$multiply;
  const createdEvent = update.events.$concatArrays[1][0].$literal;

  assert.equal(response.status, 201);
  assert.deepEqual(increase, [{ $ifNull: ["$prices.A", 1800] }, 1.1]);
  assert.deepEqual(decrease, [{ $ifNull: ["$prices.B", 1200] }, 0.975]);
  assert.equal(createdEvent.title, "City festival");
  assert.equal(createdEvent.impacts.length, 2);
  assert.match(createdEvent.id, /^[\da-f-]{36}$/);
  assert.ok(result.stocks.length > 0);
});

test("market event creation rejects invalid and duplicate stock impacts", async () => {
  await startServer();
  const invalidEvents = [
    { title: "   ", impacts: [{ symbol: "A", direction: "increase", percentage: 10 }] },
    { title: "Event", impacts: [] },
    { title: "Event", impacts: [{ symbol: "UNKNOWN", direction: "increase", percentage: 10 }] },
    { title: "Event", impacts: [{ symbol: "A", direction: "sideways", percentage: 10 }] },
    { title: "Event", impacts: [{ symbol: "A", direction: "increase", percentage: 0 }] },
    {
      title: "Event",
      impacts: [
        { symbol: "A", direction: "increase", percentage: 10 },
        { symbol: "A", direction: "decrease", percentage: 10 },
      ],
    },
  ];

  for (const body of invalidEvents) {
    const response = await fetch(`${baseUrl}/larponomics/admin/events`, {
      method: "POST",
      headers: {
        Cookie: "larponomics_session=test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(marketUpdate, null);
});

test("market admins can remove an active event without reverting prices", async () => {
  await startServer({
    marketData: {
      prices: { A: 1980 },
      history: { A: [1800, 1980] },
      events: [{ id: "event-id", title: "Festival", impacts: [] }],
    },
  });
  const response = await fetch(`${baseUrl}/larponomics/admin/events/event-id`, {
    method: "DELETE",
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(marketUpdate.update[0].$set.events.$filter.cond, {
    $ne: ["$$event.id", "event-id"],
  });
});

test("Discord sign-in reports missing OAuth configuration", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/auth/discord`);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
});
