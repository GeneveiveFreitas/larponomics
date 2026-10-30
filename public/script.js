const HISTORY_LIMIT = 120;
const MARKET_REQUEST_TIMEOUT = 15000;
let items = [];
let selectedIndex = 0;
let priceSort = "asc";
let account = null;
let accountLoading = true;

const $ = (id) => document.getElementById(id);
const formatPrice = (price) => price.toFixed(price < 10 ? 2 : 1);

function renderAccount() {
  const login = $("discord-login");
  const accountUser = $("account-user");
  const adminLink = document.querySelector(".admin-nav-link");
  login.hidden = accountLoading || Boolean(account);
  accountUser.hidden = !account;
  if (adminLink) adminLink.hidden = !account?.user?.isAdmin;
  if (account) {
    $("account-username").textContent = account.user.username;
    const avatar = $("account-avatar");
    avatar.hidden = !account.user.avatarUrl;
    if (account.user.avatarUrl) avatar.src = account.user.avatarUrl;
  }
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
  } catch (error) {
    console.error("Unable to load account:", error);
    account = null;
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
}

function renderMarketEvents(events) {
  const list = $("market-events-list");
  const message = $("events-message");
  const recentEvents = Array.isArray(events) ? events : [];
  message.textContent = recentEvents.length ? "" : "No market events yet.";
  const signature = JSON.stringify(recentEvents);
  if (list.dataset.eventSignature === signature) return;
  list.dataset.eventSignature = signature;
  list.replaceChildren();
  if (!recentEvents.length) return;

  const track = document.createElement("div");
  track.className = "market-event-track";
  const group = document.createElement("div");
  group.className = "market-event-group";
  for (const event of recentEvents) {
    const item = document.createElement("article");
    item.className = "market-event-card";
    const header = document.createElement("div");
    header.className = "market-event-header";
    const title = document.createElement("h3");
    title.textContent = event.title;
    const time = document.createElement("time");
    time.className = "market-event-time";
    const createdAt = new Date(event.createdAt);
    if (!Number.isNaN(createdAt.getTime())) {
      time.dateTime = createdAt.toISOString();
      time.textContent = createdAt.toLocaleString();
    }
    header.append(title);

    const stockList = document.createElement("div");
    stockList.className = "market-event-stock-list";
    const changes = Array.isArray(event.changes)
      ? event.changes
      : [{
        stockSymbol: event.stockSymbol,
        stockName: event.stockName,
        direction: event.direction,
        amount: event.amount,
      }];
    for (const change of changes) {
      const stock = document.createElement("span");
      stock.textContent =
        `${change.stockSymbol} ${change.direction === "increase" ? "+" : "-"}${Number(change.amount).toFixed(2)}%`;
      stockList.appendChild(stock);
    }
    const description = document.createElement("p");
    description.textContent = event.description;
    item.append(header, stockList, description);
    if (time.textContent) item.appendChild(time);
    group.appendChild(item);
  }

  const duplicateGroup = group.cloneNode(true);
  duplicateGroup.setAttribute("aria-hidden", "true");
  track.append(group, duplicateGroup);
  list.appendChild(track);
}

async function loadMarket() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MARKET_REQUEST_TIMEOUT);

  try {
    const response = await fetch("/api/market", {
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
    renderMarketEvents(result.events);

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
    $("market-message").classList.remove("error");
    $("market-message").textContent = "";
  } catch (error) {
    console.error("Unable to load market prices:", error);
    $("market-message").classList.add("error");
    $("market-message").textContent = error.name === "AbortError"
      ? "Market request timed out. Check the server connection and try again."
      : "Unable to load market prices. Check the server connection and try again.";
  } finally {
    clearTimeout(timeoutId);
  }
}

function scheduleNextUpdate() {
  setInterval(loadMarket, 60000);
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

$("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Unable to sign out");
    }
    account = null;
    $("market-message").classList.remove("error");
    $("market-message").textContent = "Signed out.";
    renderAccount();
  } catch (error) {
    console.error("Unable to sign out:", error);
    $("market-message").classList.add("error");
    $("market-message").textContent = error.message;
  }
});

loadAccount();
loadMarket();
scheduleNextUpdate();
