const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { createApp } = require("./server");
const { ADMIN_DISCORD_ID } = require("./account");

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
  assert.match(await authorizedPage.text(), /Admin Settings/);

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
});

test("admin API entry points are exported for deployment functions", () => {
  for (const endpoint of [
    "./api/admin/page",
    "./api/admin/market",
    "./api/admin/market/range",
    "./api/admin/market/prices",
    "./api/admin/market/reset",
    "./api/admin/organizations",
    "./api/admin/organizations/[id]",
  ]) {
    assert.equal(typeof require(endpoint), "function");
  }
});
