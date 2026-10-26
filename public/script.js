const HISTORY_LIMIT = 120;
const DAY_LENGTH = 24 * 60 * 60 * 1000;
const MARKET_REQUEST_TIMEOUT = 15000;
let items = [];
let selectedIndex = 0;
let priceSort = "asc";
let account = null;
let accountLoading = true;

const $ = (id) => document.getElementById(id);
const formatPrice = (price) => price.toFixed(price < 10 ? 2 : 1);

function renderInvestMenu() {
  const item = items[selectedIndex];
  const remaining = account?.daily.remaining ?? 0;
  $("invest-selection").textContent = item
    ? `${item.symbol} · ${item.name} · ${formatPrice(item.price)} per share`
    : "Select a stock to get started.";
  $("daily-limit").textContent = accountLoading
    ? "Loading account…"
    : account
      ? `${remaining} of 10 stocks available today`
      : "Sign in with Discord to invest.";
  const selectedHolding = account?.holdings.find((holding) => holding.symbol === item?.symbol);
  $("daily-owned").textContent = item
    ? `Owned: ${selectedHolding?.shares || 0} ${item.symbol} shares`
    : "";
  document.querySelectorAll("[data-buy-quantity]").forEach((button) => {
    const quantity = button.dataset.buyQuantity;
    button.disabled = !account || !item || remaining === 0 ||
      (quantity !== "max" && Number(quantity) > remaining);
  });

  const holdings = $("account-holdings");
  holdings.replaceChildren();
  if (!account) return;
  const owned = account.holdings.filter((holding) => holding.shares > 0);
  if (!owned.length) {
    holdings.textContent = "No stocks owned yet.";
    return;
  }

  for (const holding of owned) {
    const row = document.createElement("p");
    const stock = items.find((candidate) => candidate.symbol === holding.symbol);
    row.textContent = `${holding.symbol}: ${holding.shares} shares`;
    if (stock) row.textContent += ` · ${formatPrice(stock.price * holding.shares)} current value`;
    holdings.appendChild(row);
  }
}

function renderAccount() {
  const login = $("discord-login");
  const accountUser = $("account-user");
  login.hidden = accountLoading || Boolean(account);
  accountUser.hidden = !account;
  if (account) {
    $("account-username").textContent = account.user.username;
    const avatar = $("account-avatar");
    avatar.hidden = !account.user.avatarUrl;
    if (account.user.avatarUrl) avatar.src = account.user.avatarUrl;
  }
  renderInvestMenu();
}

async function loadAccount() {
  accountLoading = true;
  renderAccount();
  try {
    const response = await fetch("/api/account", { cache: "no-store" });
    if (response.status === 401) {
      account = null;
    } else {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Account request failed (${response.status})`);
      account = result;
    }
    $("invest-message").classList.remove("error");
    $("invest-message").textContent = "";
  } catch (error) {
    console.error("Unable to load account:", error);
    account = null;
    $("invest-message").classList.add("error");
    $("invest-message").textContent = "Unable to load your account. Please refresh and try again.";
  } finally {
    accountLoading = false;
    renderAccount();
  }
}

function sortItems() {
  const selectedSymbol = items[selectedIndex]?.symbol;
  items.sort((a, b) => priceSort === "asc" ? a.price - b.price : b.price - a.price);
  selectedIndex = Math.max(0, items.findIndex((item) => item.symbol === selectedSymbol));
}

function buildList() {
  const list = $("list");
  list.replaceChildren();

  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = "row";
    button.id = "stock-" + index;

    const metadata = document.createElement("div");
    metadata.innerHTML = `<div class="sym">${item.symbol}</div><div class="nm">${item.name}</div>`;

    const price = document.createElement("div");
    price.className = "px";
    price.innerHTML = `<div id="price-${index}"></div><div class="chg" id="change-${index}"></div>`;

    button.append(metadata, price);
    button.addEventListener("click", () => {
      selectedIndex = index;
      render();
    });
    list.appendChild(button);
  });
}

function updateList() {
  items.forEach((item, index) => {
    $(`price-${index}`).textContent = formatPrice(item.price);

    const change = item.dailyChange;
    const changeElement = $(`change-${index}`);
    changeElement.textContent = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
    changeElement.className = "chg " + (change >= 0 ? "up" : "down");
    $(`stock-${index}`).classList.toggle("sel", index === selectedIndex);
  });
}

function drawChart() {
  const item = items[selectedIndex];
  const canvas = $("chart");
  const context = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * devicePixelRatio;
  const height = canvas.height = canvas.clientHeight * devicePixelRatio;
  const data = item.history;
  let min = Math.min(...data);
  let max = Math.max(...data);
  const padding = (max - min || max * 0.04 || 1) * 0.08;
  min = Math.max(0, min - padding);
  max += padding;

  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#e2e8f0";
  context.lineWidth = 2;
  context.fillStyle = "#64748b";
  context.font = 14 * devicePixelRatio + "px system-ui, sans-serif";

  for (let gridline = 0; gridline <= 4; gridline++) {
    const y = height * gridline / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.fillText(
      formatPrice(max - (max - min) * gridline / 4),
      6,
      Math.min(height - 4, y + 16 * devicePixelRatio),
    );
  }

  const color = data[data.length - 1] >= data[0] ? "#15803d" : "#dc2626";
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const barWidth = Math.max(2, step - 1);

  data.forEach((value, index) => {
    const y = height - (value - min) / (max - min) * height;
    const x = index * step;
    context.fillStyle = color;
    context.globalAlpha = 0.16;
    context.fillRect(x - barWidth / 2, y, barWidth, height - y);
    context.globalAlpha = 1;
    context.fillRect(x - barWidth / 2, y, barWidth, 3 * devicePixelRatio);
  });
}

function render() {
  if (!items.length) return;

  const item = items[selectedIndex];
  $("dSym").textContent = item.symbol;
  $("dName").textContent = item.name;

  const change = item.dailyChange;
  $("dPrice").innerHTML =
    formatPrice(item.price) +
    ' <span class="price-change ' + (change >= 0 ? "up" : "down") + '">' +
    (change >= 0 ? "+" : "") + change.toFixed(2) + "%</span>";

  $("stats").innerHTML = [
    ["High", Math.max(...item.history)],
    ["Low", Math.min(...item.history)],
    ["Avg", item.history.reduce((sum, value) => sum + value, 0) / item.history.length],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span>${formatPrice(value)}</div>`)
    .join("");

  updateList();
  drawChart();
  renderInvestMenu();
}

async function purchaseStock(quantity) {
  const item = items[selectedIndex];
  if (!account || !item) return;

  const buttons = [...document.querySelectorAll("[data-buy-quantity]")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    const response = await fetch("/api/account/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: item.symbol, quantity }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        account = null;
        renderAccount();
      } else if (response.status === 409) {
        await loadAccount();
      }
      throw new Error(result.error || `Purchase failed (${response.status})`);
    }

    account = result;
    $("invest-message").classList.remove("error");
    $("invest-message").textContent =
      `Bought ${result.purchased.shares} ${item.symbol} share${result.purchased.shares === 1 ? "" : "s"}.`;
  } catch (error) {
    console.error("Unable to complete stock purchase:", error);
    $("invest-message").classList.add("error");
    $("invest-message").textContent = error.message;
  } finally {
    renderAccount();
  }
}

async function loadMarket() {
  const status = $("status");
  status.className = "status";
  status.textContent = "Loading market prices…";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MARKET_REQUEST_TIMEOUT);

  try {
    const previewDate = new URLSearchParams(window.location.search).get("date");
    const endpoint = previewDate
      ? `/api/market?date=${encodeURIComponent(previewDate)}`
      : "/api/market";
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Market API returned ${response.status}`);
    }
    if (!Array.isArray(result.stocks) || result.stocks.length === 0) {
      throw new Error("Market API returned no stock data");
    }

    const selectedSymbol = items[selectedIndex]?.symbol;
    items = result.stocks.map((stock) => ({
      symbol: stock.symbol,
      name: stock.name,
      price: stock.price,
      initial: stock.initial,
      dailyChange: stock.dailyChange,
      history: stock.history.slice(-HISTORY_LIMIT),
    }));
    selectedIndex = items.findIndex((item) => item.symbol === selectedSymbol);
    if (selectedIndex === -1) selectedIndex = 0;
    sortItems();
    buildList();
    render();
    if (result.scheduleAvailable) {
      status.textContent = `Market prices for ${result.date}`;
    } else {
      status.className = "status error";
      status.textContent = `No price schedule found for ${result.date}; prices are unchanged. Add a daily_moves record for this date in MongoDB.`;
    }
  } catch (error) {
    console.error("Unable to load market prices:", error);
    status.className = "status error";
    status.textContent = error.name === "AbortError"
      ? "Market request timed out. Check the server connection and try again."
      : "Unable to load market prices. Check the server connection and try again.";
  } finally {
    clearTimeout(timeoutId);
  }
}

function scheduleNextUpdate() {
  const delay = DAY_LENGTH - (Date.now() % DAY_LENGTH);
  setTimeout(async () => {
    await Promise.all([loadMarket(), loadAccount()]);
    scheduleNextUpdate();
  }, delay);
}

window.addEventListener("resize", () => {
  if (items.length) drawChart();
});

$("price-sort").addEventListener("change", (event) => {
  priceSort = event.target.value;
  sortItems();
  buildList();
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadAccount();
    loadMarket();
  }
});

document.querySelectorAll("[data-buy-quantity]").forEach((button) => {
  button.addEventListener("click", () => {
    const requested = button.dataset.buyQuantity === "max"
      ? "max"
      : Number(button.dataset.buyQuantity);
    purchaseStock(requested);
  });
});

$("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Unable to sign out");
    }
    account = null;
    $("invest-message").classList.remove("error");
    $("invest-message").textContent = "Signed out.";
    renderAccount();
  } catch (error) {
    console.error("Unable to sign out:", error);
    $("invest-message").classList.add("error");
    $("invest-message").textContent = error.message;
  }
});

loadAccount();
loadMarket();
scheduleNextUpdate();
