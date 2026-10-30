const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");

const storedMarketState = {
  prices: { A: 1854.36, B: 1200 },
  history: {
    A: [1800, 1836, 1854.36],
    B: [1200, 1200, 1200],
  },
  events: [{ id: "event-1", title: "City festival", impacts: [] }],
};
const marketState = {
  findOne() {
    return { lean: async () => storedMarketState };
  },
};
const storedOrganizations = [
  {
    _id: "organization-1",
    name: "Example Corp",
    directors: [
      { name: "Director", role: "Director" },
      { name: "Co-director", role: "Co-director" },
      { name: "Third director", role: "Director" },
    ],
    category: "corporations",
  },
  {
    _id: "organization-2",
    name: "Legacy Corp",
    director: "Legacy director",
    coDirector: "Legacy co-director",
    category: "corporations",
  },
];
const storedAccounts = [
  {
    discordId: "123456",
    username: "director",
    avatar: "avatar-hash",
  },
  {
    discordId: "987654",
    username: "Co-director",
    avatar: null,
  },
  {
    discordId: "555555",
    username: "Third director",
    avatar: "third-avatar",
  },
];
const organizationModel = {
  find() {
    return {
      sort() {
        return this;
      },
      lean: async () => storedOrganizations,
    };
  },
};
const accountModel = {
  find() {
    return { lean: async () => storedAccounts };
  },
};
let server;
let baseUrl;

before(async () => {
  const app = createApp({
    marketState,
    organizationOptions: { organizationModel, accountModel, connect: async () => {} },
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
  const response = await fetch(`${baseUrl}/larponomics/market`);
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
  assert.deepEqual(result.events, storedMarketState.events);
});

test("app serves the home, market, and admin settings pages without voting", async () => {
  const page = await fetch(baseUrl);
  const homePage = await fetch(`${baseUrl}/index.html`);
  const marketPage = await fetch(`${baseUrl}/market.html`);
  const script = await fetch(`${baseUrl}/script.js`);
  const homeScript = await fetch(`${baseUrl}/home.js`);
  const settingsPage = await fetch(`${baseUrl}/admin-market.html`);
  const settingsScript = await fetch(`${baseUrl}/admin-market.js`);
  const removedVotingPage = await fetch(`${baseUrl}/votes.html`);
  const removedVotingScript = await fetch(`${baseUrl}/votes.js`);
  const removedVotingApi = await fetch(`${baseUrl}/larponomics/account/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const legacyMarketApi = await fetch(`${baseUrl}/api/market`);
  const organizationsPage = await fetch(`${baseUrl}/organizations.html`);
  const organizationsScript = await fetch(`${baseUrl}/organizations.js`);
  const organizationsApi = await fetch(`${baseUrl}/larponomics/organizations`);
  const oldOrganizationsApi = await fetch(`${baseUrl}/api/organizations`);

  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Welcome to Kethercraft/);
  assert.equal(homePage.status, 200);
  const homePageHtml = await homePage.text();
  assert.match(homePageHtml, /href="\/market\.html"/);
  assert.match(homePageHtml, /id="discord-login"/);
  assert.match(homePageHtml, /id="logout-button"/);
  assert.equal(homeScript.status, 200);
  assert.match(await homeScript.text(), /larponomics\/account/);
  assert.doesNotMatch(homePageHtml, /votes\.html|Voting/);
  assert.equal(marketPage.status, 200);
  const marketPageHtml = await marketPage.text();
  assert.match(marketPageHtml, /id="list"/);
  assert.match(marketPageHtml, /class="market-event-banner"/);
  assert.match(marketPageHtml, /id="market-event-title"/);
  assert.match(marketPageHtml, /market-event-group-copy/);
  assert.match(marketPageHtml, /id="discord-login"/);
  assert.match(marketPageHtml, /id="logout-button"/);
  assert.doesNotMatch(marketPageHtml, /votes\.html|Voting/);
  assert.equal(script.status, 200);
  assert.equal(settingsPage.status, 200);
  const settingsPageHtml = await settingsPage.text();
  assert.match(settingsPageHtml, /Market settings/);
  assert.match(settingsPageHtml, /id="settings-list"/);
  assert.match(settingsPageHtml, /id="event-form"/);
  assert.match(settingsPageHtml, /id="active-events"/);
  assert.match(settingsPageHtml, /id="reset-market"/);
  assert.equal(settingsScript.status, 200);
  assert.match(await settingsScript.text(), /larponomics\/admin\/events/);
  assert.equal(removedVotingPage.status, 404);
  assert.equal(removedVotingScript.status, 404);
  assert.equal(removedVotingApi.status, 404);
  assert.equal(legacyMarketApi.status, 404);
  assert.equal(organizationsPage.status, 200);
  const organizationsPageHtml = await organizationsPage.text();
  assert.match(organizationsPageHtml, /Organizations and their leaders/);
  assert.match(organizationsPageHtml, /organization-category/);
  assert.match(organizationsPageHtml, /<option value="corporations" selected>Corporations<\/option>/);
  assert.doesNotMatch(organizationsPageHtml, /All categories/);
  assert.equal(organizationsScript.status, 200);
  assert.doesNotMatch(organizationsPageHtml, /votes\.html|Voting/);
  assert.equal(organizationsApi.status, 200);
  assert.equal(oldOrganizationsApi.status, 404);
  const organizationsResult = await organizationsApi.json();
  assert.deepEqual(organizationsResult.organizations[0].directors.map(({ name, role, profile }) => ({
    name,
    role,
    profile,
  })), [
    {
      name: "Director",
      role: "Director",
      profile: {
        username: "director",
        avatarUrl: "https://cdn.discordapp.com/avatars/123456/avatar-hash.png?size=96",
      },
    },
    {
      name: "Co-director",
      role: "Co-director",
      profile: {
        username: "Co-director",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
      },
    },
    {
      name: "Third director",
      role: "Director",
      profile: {
        username: "Third director",
        avatarUrl: "https://cdn.discordapp.com/avatars/555555/third-avatar.png?size=96",
      },
    },
  ]);
  assert.deepEqual(organizationsResult.organizations[1].directors, [
    { name: "Legacy director", role: "Director", profile: null },
    { name: "Legacy co-director", role: "Co-director", profile: null },
  ]);
  const organizationsScriptText = await organizationsScript.text();
  assert.match(organizationsScriptText, /fetch\("\/larponomics\/organizations"/);
  assert.match(organizationsScriptText, /organization\.category === category/);
  assert.match(organizationsScriptText, /organization\.directors/);
  assert.match(organizationsScriptText, /for \(const \{ name: directorName, role, profile \} of organization\.directors\)/);
  assert.match(organizationsScriptText, /profileName\.textContent = profile\?\.username \|\| directorName/);
  assert.match(organizationsScriptText, /organization-avatar-placeholder/);
  assert.doesNotMatch(organizationsScriptText, /organization\.directors\.map\(\(\{ name, role \}\)/);
});

test("Vercel market function exports a request handler", () => {
  assert.equal(typeof require("./api/market"), "function");
  assert.equal(typeof require("./api/larponomics/organizations"), "function");
  const { rewrites } = require("./vercel.json");
  assert.ok(rewrites.some(({ source }) => source === "/larponomics/market"));
  assert.ok(rewrites.some(({ source }) => source === "/larponomics/admin/events/:eventId"));
});

test("organizations model reads from larponomics.organizations", () => {
  const { Organization } = require("./organizations");

  assert.equal(Organization.db.name, "larponomics");
  assert.equal(Organization.collection.collectionName, "organizations");
});

test("Vercel account endpoints export request handlers", () => {
  for (const endpoint of [
    "./api/account",
    "./api/admin/market",
    "./api/admin/events",
    "./api/admin/events/[eventId]",
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

test("market endpoint returns initial prices when no market changes have been made", async () => {
  const emptyMarket = { findOne: () => ({ lean: async () => null }) };
  const app = createApp({
    marketState: emptyMarket,
    clock: () => new Date("2026-10-21T00:00:00.000Z"),
    connect: async () => {},
  });
  const emptyServer = app.listen(0);
  await new Promise((resolve) => emptyServer.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${emptyServer.address().port}/larponomics/market`);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.stocks.find((stock) => stock.symbol === "A").price, 1800);
    assert.equal(result.stocks.find((stock) => stock.symbol === "A").dailyChange, 0);
    assert.deepEqual(result.events, []);
  } finally {
    await new Promise((resolve, reject) => {
      emptyServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("market endpoint reports the latest price change from market history", async () => {
  const state = {
    prices: { A: 1836, B: 1176 },
    history: { A: [1800, 1836], B: [1200, 1176] },
  };
  const app = createApp({
    marketState: { findOne: () => ({ lean: async () => state }) },
    clock: () => new Date(currentDate),
    connect: async () => {},
  });
  let currentDate = "2026-10-21T12:00:00.000Z";
  const dailyServer = app.listen(0);
  await new Promise((resolve) => dailyServer.once("listening", resolve));

  try {
    const url = `http://127.0.0.1:${dailyServer.address().port}/larponomics/market`;
    const sameDay = await fetch(url);
    const sameDayMarket = await sameDay.json();
    assert.equal(sameDayMarket.stocks.find((stock) => stock.symbol === "A").dailyChange, 2);
    assert.equal(sameDayMarket.stocks.find((stock) => stock.symbol === "B").dailyChange, -2);

    currentDate = "2026-10-22T12:00:00.000Z";
    const nextDay = await fetch(url);
    const nextDayMarket = await nextDay.json();
    assert.equal(nextDayMarket.stocks.find((stock) => stock.symbol === "A").dailyChange, 2);
    assert.equal(nextDayMarket.stocks.find((stock) => stock.symbol === "B").dailyChange, -2);
  } finally {
    await new Promise((resolve, reject) => {
      dailyServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
