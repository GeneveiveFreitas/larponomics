const assert = require("node:assert/strict");
const express = require("express");
const { after, test } = require("node:test");
const { createAccountRouter, dailyPurchaseCount } = require("./account");

const today = "2026-10-26";
const now = new Date(`${today}T12:00:00.000Z`);
const account = {
  _id: "account-id",
  discordId: "12345678901234567",
  username: "MarketFan",
  avatar: "avatar-hash",
  holdings: { A: 3, B: 2 },
  dailyPurchaseDate: today,
  dailyPurchased: 4,
};
let server;
let baseUrl;
let updatedFilter;
let updatedPipeline;
let updatedOptions;
let marketPipeline;
let marketOptions;

async function startServer({
  accountData = account,
  updatedAccount = account,
  environment = {},
} = {}) {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const app = express();
  app.use(express.json());
  app.use(createAccountRouter({
    AccountModel: {
      findById: () => ({ lean: async () => accountData }),
      findOneAndUpdate: (filter, pipeline, options) => {
        updatedFilter = filter;
        updatedPipeline = pipeline;
        updatedOptions = options;
        return { lean: async () => updatedAccount };
      },
    },
    MarketStateModel: {
      findOneAndUpdate: (filter, pipeline, options) => {
        marketPipeline = pipeline;
        marketOptions = options;
        return { lean: async () => ({}) };
      },
    },
    SessionModel: {
      findOne: () => ({ lean: async () => ({ accountId: account._id }) }),
      deleteOne: async () => {},
    },
    connect: async () => {},
    clock: () => now,
    environment,
    transaction: async (callback) => callback(undefined),
    marketRandom: () => 0.5,
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

test("daily purchase count resets according to the UTC date", () => {
  assert.equal(dailyPurchaseCount(account, today), 4);
  assert.equal(dailyPurchaseCount(account, "2026-10-27"), 0);
});

test("account endpoint returns profile, daily quota, and owned shares", async () => {
  await startServer({ accountData: { ...account, dailyPurchaseDate: "2026-10-25" } });
  const response = await fetch(`${baseUrl}/api/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.user.username, "MarketFan");
  assert.equal(result.daily.purchased, 0);
  assert.equal(result.daily.remaining, 10);
  assert.deepEqual(result.holdings, [
    { symbol: "A", shares: 3 },
    { symbol: "B", shares: 2 },
  ]);
});

test("max purchase uses the remaining daily quota and updates holdings atomically", async () => {
  await startServer({
    updatedAccount: {
      ...account,
      holdings: { A: 9, B: 2 },
      dailyPurchased: 10,
    },
  });
  const response = await fetch(`${baseUrl}/api/account/purchases`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol: "A", quantity: "max" }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.purchased, { symbol: "A", shares: 6 });
  assert.equal(updatedFilter.$expr.$lte[1], 4);
  assert.equal(updatedPipeline[0].$set.dailyPurchased.$add[1], 6);
  assert.deepEqual(updatedPipeline[0].$set.holdings.$mergeObjects[1].A.$add[1], 6);
  assert.equal(updatedOptions.updatePipeline, true);
  assert.equal(updatedOptions.session, undefined);
  assert.equal(marketOptions.updatePipeline, true);
  assert.equal(marketPipeline[1].$set.prices.A.$max[1].$multiply[1], 1.006);
  assert.equal(Object.keys(marketPipeline[1].$set.prices).length, 39);
  assert.deepEqual(marketPipeline[1].$set.history.A.$slice[1], -120);
});

test("purchase endpoint rejects symbols that are not in the market", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/purchases`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol: "NOT-A-STOCK", quantity: 1 }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid stock/);
});

test("Discord sign-in reports missing OAuth configuration", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/auth/discord`);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
});
