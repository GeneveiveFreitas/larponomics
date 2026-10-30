const assert = require("node:assert/strict");
const express = require("express");
const { after, test } = require("node:test");
const { createAccountRouter } = require("./account");

const account = {
  _id: "account-id",
  discordId: "12345678901234567",
  username: "MarketFan",
  avatar: "avatar-hash",
};
let server;
let baseUrl;

async function startServer({ authenticated = true, environment = {} } = {}) {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const app = express();
  app.use(express.json());
  app.use(createAccountRouter({
    AccountModel: {
      findById: () => ({ lean: async () => account }),
    },
    SessionModel: {
      findOne: () => ({ lean: async () => authenticated ? { accountId: account._id } : null }),
      deleteOne: async () => {},
    },
    connect: async () => {},
    clock: () => new Date("2026-10-26T12:00:00.000Z"),
    environment,
  }));
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
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

test("account endpoint returns the signed-in Discord profile", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.user, {
    id: account.discordId,
    username: "MarketFan",
    avatarUrl: `https://cdn.discordapp.com/avatars/${account.discordId}/avatar-hash.png?size=96`,
  });
  assert.equal("daily" in result, false);
});

test("account endpoint rejects unauthenticated requests", async () => {
  await startServer({ authenticated: false });
  const response = await fetch(`${baseUrl}/api/account`, {
    headers: { Cookie: "larponomics_session=test-session" },
  });

  assert.equal(response.status, 401);
});

test("stock vote submission endpoint has been removed", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/account/votes`, { method: "POST" });

  assert.equal(response.status, 404);
});

test("Discord sign-in reports missing OAuth configuration", async () => {
  await startServer();
  const response = await fetch(`${baseUrl}/api/auth/discord`);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
});
