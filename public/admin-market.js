const $ = (id) => document.getElementById(id);
let stocks = [];
let events = [];

function showMessage(message, isError = false) {
  const element = $("settings-message");
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function renderAccount(account) {
  $("discord-login").hidden = Boolean(account);
  $("account-user").hidden = !account;
  document.querySelector(".admin-market-link").hidden = !account?.isAdmin;
  if (!account) return;
  $("account-username").textContent = account.user.username;
  $("account-avatar").src = account.user.avatarUrl || "";
  $("account-avatar").hidden = !account.user.avatarUrl;
}

function renderStocks() {
  const list = $("settings-list");
  list.replaceChildren();

  for (const stock of stocks) {
    const row = document.createElement("form");
    row.className = "market-setting-row";
    const details = document.createElement("div");
    details.className = "market-setting-details";
    const symbol = document.createElement("strong");
    symbol.textContent = stock.symbol;
    const name = document.createElement("span");
    name.textContent = stock.name;
    details.append(symbol, name);

    const currentPrice = document.createElement("span");
    currentPrice.className = "market-setting-current";
    currentPrice.textContent = `Current: ${stock.price.toFixed(2)}`;

    const label = document.createElement("label");
    label.textContent = "New price";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.step = "0.01";
    input.required = true;
    input.value = stock.price.toFixed(2);
    label.appendChild(input);

    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save price";
    row.append(details, currentPrice, label, save);
    row.addEventListener("submit", (event) => {
      event.preventDefault();
      savePrice(stock.symbol, input, save);
    });
    list.appendChild(row);
  }
}

function renderEventStocks() {
  const list = $("event-stock-list");
  list.replaceChildren();

  for (const stock of stocks) {
    const row = document.createElement("div");
    row.className = "event-stock-row";
    const stockLabel = document.createElement("label");
    stockLabel.className = "event-stock-name";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.dataset.symbol = stock.symbol;
    stockLabel.append(enabled, document.createTextNode(`${stock.symbol} · ${stock.name}`));

    const directionLabel = document.createElement("label");
    directionLabel.textContent = "Direction";
    const direction = document.createElement("select");
    direction.dataset.direction = stock.symbol;
    direction.innerHTML = '<option value="increase">Increase</option><option value="decrease">Decrease</option>';
    directionLabel.appendChild(direction);

    const percentageLabel = document.createElement("label");
    percentageLabel.textContent = "Change (%)";
    const percentage = document.createElement("input");
    percentage.type = "number";
    percentage.min = "0.01";
    percentage.max = "100";
    percentage.step = "0.01";
    percentage.value = "1";
    percentage.dataset.percentage = stock.symbol;
    percentageLabel.appendChild(percentage);

    row.append(stockLabel, directionLabel, percentageLabel);
    list.appendChild(row);
  }
}

function renderEvents() {
  const list = $("active-events");
  list.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.textContent = "There are no active market events.";
    list.appendChild(empty);
    return;
  }

  for (const event of events) {
    const item = document.createElement("article");
    item.className = "active-event";
    const heading = document.createElement("h3");
    heading.textContent = event.title;
    const impacts = document.createElement("p");
    impacts.textContent = event.impacts.map((impact) => {
      const direction = impact.direction === "increase" ? "increased" : "decreased";
      return `${impact.symbol} ${direction} ${impact.percentage}%`;
    }).join(" · ");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "End event";
    remove.addEventListener("click", () => endEvent(event.id, remove));
    item.append(heading, impacts, remove);
    list.appendChild(item);
  }
}

async function requestMarket(method, body) {
  const response = await fetch("/larponomics/admin/market", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Market settings request failed (${response.status})`);
  return result;
}

async function requestEvents(method, body, eventId = "") {
  const response = await fetch(
    eventId
      ? `/larponomics/admin/events/${encodeURIComponent(eventId)}`
      : "/larponomics/admin/events",
    {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Market event request failed (${response.status})`);
  return result;
}

function updateMarket(result) {
  stocks = result.stocks;
  events = result.events || [];
  renderStocks();
  renderEventStocks();
  renderEvents();
}

async function savePrice(symbol, input, button) {
  const price = Number(input.value);
  if (!Number.isFinite(price) || price < 1) {
    showMessage("Enter a valid price of at least 1.", true);
    return;
  }
  button.disabled = true;
  showMessage(`Saving ${symbol}...`);
  try {
    const result = await requestMarket("PUT", { symbol, price });
    updateMarket(result);
    showMessage(`${symbol} price updated.`);
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
  }
}

async function loadPage() {
  const accountResponse = await fetch("/larponomics/account", { cache: "no-store" });
  if (accountResponse.status === 401) {
    renderAccount(null);
    showMessage("Sign in with an authorized Discord account to manage the market.");
    $("discord-login").hidden = false;
    return;
  }
  const account = await accountResponse.json();
  if (!accountResponse.ok) throw new Error(account.error || "Unable to load account");
  renderAccount(account);

  if (!account.isAdmin) {
    showMessage("You do not have permission to change market settings.", true);
    return;
  }

  const market = await requestMarket("GET");
  updateMarket(market);
  $("settings-content").hidden = false;
  showMessage("Market settings loaded.");
}

$("event-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const impacts = [...$("event-stock-list").querySelectorAll("[data-symbol]")]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => ({
      symbol: checkbox.dataset.symbol,
      direction: $(`[data-direction="${checkbox.dataset.symbol}"]`).value,
      percentage: Number($(`[data-percentage="${checkbox.dataset.symbol}"]`).value),
    }));
  if (!impacts.length) {
    showMessage("Choose at least one stock for the event.", true);
    return;
  }

  const button = $("create-event");
  button.disabled = true;
  showMessage("Creating event and updating prices...");
  try {
    const result = await requestEvents("POST", {
      title: $("event-title").value,
      impacts,
    });
    updateMarket(result);
    $("event-form").reset();
    $("event-form").closest("details").open = false;
    showMessage("Event created and market prices updated.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function endEvent(eventId, button) {
  if (!window.confirm("End this event and remove it from the market banner? The price changes will remain.")) return;
  button.disabled = true;
  try {
    const result = await requestEvents("DELETE", null, eventId);
    updateMarket(result);
    showMessage("Event ended. Existing price changes remain.");
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
  }
}

$("reset-market").addEventListener("click", async () => {
  if (!window.confirm("Reset every stock to its initial price, clear all price history, and end all events?")) return;
  const button = $("reset-market");
  button.disabled = true;
  showMessage("Resetting market...");
  try {
    const result = await requestMarket("POST");
    updateMarket(result);
    showMessage("Market prices, history, and events reset.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/larponomics/auth/logout", { method: "POST" });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Unable to sign out");
    }
    window.location.href = "/market.html";
  } catch (error) {
    showMessage(error.message, true);
  }
});

loadPage().catch((error) => {
  console.error("Unable to load market settings:", error);
  showMessage(error.message, true);
});
