const HISTORY_LIMIT = 120;
const DAY_LENGTH = 24 * 60 * 60 * 1000;
const MARKET_REQUEST_TIMEOUT = 15000;
let items = [];
let selectedIndex = 0;

const $ = (id) => document.getElementById(id);
const formatPrice = (price) => price.toFixed(price < 10 ? 2 : 1);

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

    items = result.stocks.map((stock) => ({
      symbol: stock.symbol,
      name: stock.name,
      price: stock.price,
      initial: stock.initial,
      dailyChange: stock.dailyChange,
      history: stock.history.slice(-HISTORY_LIMIT),
    }));
    selectedIndex = Math.min(selectedIndex, items.length - 1);
    buildList();
    render();
    status.textContent = `Market prices for ${result.date}`;
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
    await loadMarket();
    scheduleNextUpdate();
  }, delay);
}

window.addEventListener("resize", () => {
  if (items.length) drawChart();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadMarket();
});

loadMarket();
scheduleNextUpdate();
