const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createApp } = require("./server");
const { randomDailyChange, STOCKS } = require("./market");

const storedMarketState = {
  prices: { A: 1854.36, B: 1200 },
  history: {
    A: [1800, 1836, 1854.36],
    B: [1200, 1200, 1200],
  },
  dailyChanges: { A: 1, B: 0 },
  events: [{
    title: "Festival boom",
    description: "Demand increased.",
    stockSymbol: "A",
    stockName: "A Corp",
    direction: "increase",
    amount: 10,
    createdAt: "2026-10-21T00:00:00.000Z",
  }],
  marketDate: "2026-10-21",
};
const initialPrices = Object.fromEntries(STOCKS.map(({ symbol, initial }) => [symbol, initial]));

function createMarketState(initialState = null) {
  let state = initialState ? structuredClone(initialState) : null;
  return {
    findOne() {
      return { lean: async () => state };
    },
    findOneAndUpdate(filter, update) {
      if (!Array.isArray(update)) {
        state ||= structuredClone(update.$setOnInsert);
      } else if (state.marketDate !== filter.marketDate.$ne) {
        const { dailyChanges, marketDate, updatedAt } = update[0].$set;
        for (const [symbol, change] of Object.entries(dailyChanges)) {
          const basePrice = state.prices[symbol] ?? initialPrices[symbol];
          const nextPrice = Math.max(1, Math.round(basePrice * (1 + change / 100) * 100) / 100);
          state.prices[symbol] = nextPrice;
          state.history[symbol] = [...(state.history[symbol] || [basePrice]), nextPrice].slice(-120);
        }
        state.dailyChanges = dailyChanges;
        state.marketDate = marketDate;
        state.updatedAt = updatedAt;
      }
      return { lean: async () => state };
    },
  };
}
const marketState = createMarketState(storedMarketState);
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
  const response = await fetch(`${baseUrl}/api/market`);
  const result = await response.json();
  const stockA = result.stocks.find((stock) => stock.symbol === "A");
  const stockB = result.stocks.find((stock) => stock.symbol === "B");

  assert.equal(response.status, 200);
  assert.equal(result.date, "2026-10-21");
  assert.ok(Math.abs(stockA.price - 1854.36) < 1e-9);
  assert.equal(stockB.price, 1200);
  assert.equal(result.events[0].title, "Festival boom");
  assert.equal(stockA.history.length, 3);
  assert.equal(stockA.history.at(-2), 1836);
  assert.ok(Math.abs(stockA.dailyChange - 1) < 1e-9);
  assert.equal(stockB.dailyChange, 0);
});

test("daily stock changes include both limits of the five-percent range", () => {
  assert.equal(randomDailyChange(() => 0), -5);
  assert.equal(randomDailyChange(() => 1), 5);
  assert.equal(randomDailyChange(() => 0.5, -2, 4), 1);
  assert.equal(randomDailyChange(() => -1), -5);
  assert.equal(randomDailyChange(() => 2), 5);
});

test("daily market updates use the configured fluctuation range", async () => {
  const history = Object.fromEntries(STOCKS.map(({ symbol, initial }) => [symbol, [initial]]));
  const rangedMarketState = createMarketState({
    prices: initialPrices,
    history,
    dailyChanges: {},
    dailyChangeMin: 1,
    dailyChangeMax: 2,
    marketDate: "2026-10-20",
  });
  const app = createApp({
    marketState: rangedMarketState,
    clock: () => new Date("2026-10-21T00:00:00.000Z"),
    random: () => 0,
    connect: async () => {},
  });
  const rangedServer = app.listen(0);
  await new Promise((resolve) => rangedServer.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${rangedServer.address().port}/api/market`);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.ok(result.stocks.every((stock) => stock.dailyChange === 1));
  } finally {
    await new Promise((resolve, reject) => {
      rangedServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("app serves the home, market, and organizations pages without voting", async () => {
  const page = await fetch(baseUrl);
  const homePage = await fetch(`${baseUrl}/index.html`);
  const marketPage = await fetch(`${baseUrl}/market.html`);
  const script = await fetch(`${baseUrl}/script.js`);
  const homeScript = await fetch(`${baseUrl}/home.js`);
  const votingPage = await fetch(`${baseUrl}/votes.html`);
  const organizationsPage = await fetch(`${baseUrl}/organizations.html`);
  const organizationsScript = await fetch(`${baseUrl}/organizations.js`);
  const adminScript = await fetch(`${baseUrl}/admin.js`);
  const organizationsApi = await fetch(`${baseUrl}/larpnomics/organizations`);
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
  assert.match(await homeScript.text(), /api\/account/);
  assert.equal(marketPage.status, 200);
  const marketPageHtml = await marketPage.text();
  assert.match(marketPageHtml, /id="list"/);
  assert.match(marketPageHtml, /id="discord-login"/);
  assert.match(marketPageHtml, /id="logout-button"/);
  assert.ok(marketPageHtml.indexOf('id="market-events-heading"') < marketPageHtml.indexOf('class="layout"'));
  assert.equal(script.status, 200);
  assert.equal(adminScript.status, 200);
  const marketScript = await script.text();
  assert.match(marketScript, /renderMarketEvents\(result\.events\)/);
  assert.match(marketPageHtml, /id="market-events-list"/);
  assert.equal(votingPage.status, 404);
  assert.doesNotMatch(homePageHtml, /Voting/);
  assert.equal(organizationsPage.status, 200);
  const organizationsPageHtml = await organizationsPage.text();
  assert.match(organizationsPageHtml, /Organizations and their leaders/);
  assert.match(organizationsPageHtml, /organization-category/);
  assert.match(organizationsPageHtml, /<option value="corporations" selected>Corporations<\/option>/);
  assert.doesNotMatch(organizationsPageHtml, /All categories/);
  assert.equal(organizationsScript.status, 200);
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
  assert.match(organizationsScriptText, /fetch\("\/larpnomics\/organizations"/);
  assert.match(organizationsScriptText, /organization\.category === category/);
  assert.match(organizationsScriptText, /organization\.directors/);
  assert.match(organizationsScriptText, /for \(const \{ name: directorName, role, profile \} of organization\.directors\)/);
  assert.match(organizationsScriptText, /profileName\.textContent = profile\?\.username \|\| directorName/);
  assert.match(organizationsScriptText, /organization-avatar-placeholder/);
  assert.doesNotMatch(organizationsScriptText, /organization\.directors\.map\(\(\{ name, role \}\)/);
});

test("Vercel market function exports a request handler", () => {
  assert.equal(typeof require("./api/market"), "function");
});

test("organizations model reads from larponomics.organizations", () => {
  const { Organization } = require("./organizations");

  assert.equal(Organization.db.name, "larponomics");
  assert.equal(Organization.collection.collectionName, "organizations");
});

test("Vercel account endpoints export request handlers", () => {
  for (const endpoint of [
    "./api/account",
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

test("market prices randomly fluctuate within five percent once each UTC day", async () => {
  let currentDate = "2026-10-21T12:00:00.000Z";
  let randomCalls = 0;
  const dailyMarketState = createMarketState();
  const app = createApp({
    marketState: dailyMarketState,
    clock: () => new Date(currentDate),
    random: () => {
      const call = randomCalls++;
      if (call === 0) return 0;
      if (call === 1) return 0.999;
      return 0.5;
    },
    connect: async () => {},
  });
  const dailyServer = app.listen(0);
  await new Promise((resolve) => dailyServer.once("listening", resolve));

  try {
    const url = `http://127.0.0.1:${dailyServer.address().port}/api/market`;
    const firstDay = await fetch(url);
    const firstDayMarket = await firstDay.json();
    const stockA = firstDayMarket.stocks.find((stock) => stock.symbol === "A");
    const stockB = firstDayMarket.stocks.find((stock) => stock.symbol === "B");
    assert.equal(firstDay.status, 200);
    assert.equal(stockA.price, 1710);
    assert.equal(stockA.dailyChange, -5);
    assert.equal(stockB.price, 1259.88);
    assert.equal(stockB.dailyChange, 4.99);
    assert.ok(firstDayMarket.stocks.every((stock) =>
      stock.dailyChange >= -5 && stock.dailyChange <= 5
    ));
    assert.equal(randomCalls, STOCKS.length);

    const sameDay = await fetch(url);
    const sameDayMarket = await sameDay.json();
    assert.equal(sameDayMarket.stocks.find((stock) => stock.symbol === "A").price, 1710);
    assert.equal(sameDayMarket.stocks.find((stock) => stock.symbol === "A").history.length, 2);
    assert.equal(randomCalls, STOCKS.length);

    currentDate = "2026-10-22T12:00:00.000Z";
    const nextDay = await fetch(url);
    const nextDayMarket = await nextDay.json();
    assert.equal(nextDayMarket.stocks.find((stock) => stock.symbol === "A").dailyChange, 0);
    assert.equal(nextDayMarket.stocks.find((stock) => stock.symbol === "A").history.length, 3);
    assert.equal(randomCalls, STOCKS.length * 2);
  } finally {
    await new Promise((resolve, reject) => {
      dailyServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
