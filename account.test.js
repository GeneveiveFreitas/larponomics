const assert = require("node:assert/strict");
const express = require("express");
const { after, test } = require("node:test");
const { createAccountRouter } = require("./account");

const today = "2026-10-26";
const now = new Date(`${today}T12:00:00.000Z`);
const account = {
  _id: "account-id",
  discordId: "12345678901234567",
  username: "MarketFan",
  avatar: "avatar-hash",
  dailyVoteDate: "",
  dailyVotes: { up: {}, down: {} },
};
let server;
let baseUrl;
let updatedFilter;
let updatedDocument;
let updatedOptions;
let marketPipeline;

async function startServer({
  accountData = account,
  updatedAccount = { ...account, dailyVoteDate: today },
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
      findOneAndUpdate: (filter, update, options) => {
        updatedFilter = filter;
        updatedDocument = update;
        updatedOptions = options;
        return { lean: async () => updatedAccount };
      },
    },
    MarketStateModel: {
      findOne: () => ({ lean: async () => null }),
      findOneAndUpdate: (filter, pipeline, options) => {
        marketPipeline = pipeline;
        assert.equal(options.session, undefined);
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

test("account endpoint reports whether today's votes were submitted", async () => {
  await startServer({ accountData: { ...account, dailyVoteDate: today } });
  const response = await fetch(`${baseUrl}/api/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.user.username, "MarketFan");
  assert.deepEqual(result.daily, { date: today, submitted: true });
});

test("vote submission persists a 3-up/3-down ballot and updates prices", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/votes`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ up: { A: 2, B: 1 }, down: { A: 1, C: 2 } }),
  });
  const result = await response.json();
  const priceA = marketPipeline[1].$set.prices.A.$max[1].$round[0].$multiply[1];
  const priceB = marketPipeline[1].$set.prices.B.$max[1].$round[0].$multiply[1];

  assert.equal(response.status, 200);
  assert.deepEqual(result.daily, { date: today, submitted: true });
  assert.deepEqual(updatedFilter, { _id: account._id, dailyVoteDate: { $ne: today } });
  assert.deepEqual(updatedDocument.$set.dailyVotes, {
    up: { A: 2, B: 1 },
    down: { A: 1, C: 2 },
  });
  assert.equal(updatedOptions.session, undefined);
  assert.ok(Math.abs(priceA - Math.pow(1.01, 2) * 0.99) < 1e-12);
  assert.equal(priceB, 1.01);
  assert.equal(marketPipeline[1].$set.history.A.$slice[1], -120);
  assert.equal(result.market.stocks.length, 39);
});

test("vote submission rejects allocations other than three votes per direction", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/votes`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ up: { A: 2 }, down: { B: 3 } }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /exactly 3/);
});

test("vote submission rejects unknown symbols", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/votes`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ up: { INVALID: 3 }, down: { A: 3 } }),
  });

  assert.equal(response.status, 400);
});

test("an account can only submit one ballot per UTC day", async () => {
  await startServer({ updatedAccount: null });
  const response = await fetch(`${baseUrl}/api/account/votes`, {
    method: "POST",
    headers: {
      Cookie: "larponomics_session=test-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ up: { A: 3 }, down: { B: 3 } }),
  });

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already voted today/);
});

test("vote endpoint rejects unauthenticated submissions", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ up: { A: 3 }, down: { B: 3 } }),
  });

  assert.equal(response.status, 401);
});

test("Discord sign-in reports missing OAuth configuration", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/auth/discord`);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
});
