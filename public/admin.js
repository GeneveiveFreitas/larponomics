const adminMessage = document.getElementById("admin-message");
const rangeForm = document.getElementById("range-form");
const priceForm = document.getElementById("price-form");
const eventForm = document.getElementById("event-form");
const priceSymbol = document.getElementById("price-symbol");
const eventChanges = document.getElementById("event-changes");
const addEventChangeButton = document.getElementById("add-event-change");
const organizationSelect = document.getElementById("organization-select");
const organizationForm = document.getElementById("organization-form");
const deleteOrganizationButton = document.getElementById("delete-organization");
let organizations = [];
let stocks = [];
let nextEventChangeId = 0;

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle("error", isError);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function currentOrganization() {
  return organizations.find(({ _id }) => _id === organizationSelect.value);
}

function fillOrganization(organization) {
  document.getElementById("organization-name").value = organization?.name || "";
  document.getElementById("organization-category").value = organization?.category || "corporations";
  document.getElementById("organization-directors").value = (organization?.directors || [])
    .map(({ role, name }) => `${role} | ${name}`)
    .join("\n");
  deleteOrganizationButton.disabled = !organization;
}

function renderOrganizationOptions(selectedId = "") {
  organizationSelect.replaceChildren(new Option("New organization", ""));
  for (const organization of organizations) {
    organizationSelect.add(new Option(organization.name, organization._id));
  }
  organizationSelect.value = selectedId;
  fillOrganization(currentOrganization());
}

async function loadOrganizations(selectedId = "") {
  const result = await requestJson("/api/admin/organizations");
  organizations = result.organizations;
  renderOrganizationOptions(selectedId);
}

function parseDirectors(value) {
  return value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator < 0) return { role: "Director", name: line };
      return {
        role: line.slice(0, separator).trim(),
        name: line.slice(separator + 1).trim(),
      };
    });
}

async function loadMarketSettings() {
  const result = await requestJson("/api/admin/market");
  document.getElementById("range-min").value = result.range.min;
  document.getElementById("range-max").value = result.range.max;
  const selectedSymbol = priceSymbol.value;
  stocks = result.stocks;
  priceSymbol.replaceChildren(...stocks.map((stock) =>
    new Option(`${stock.symbol} — ${stock.name}`, stock.symbol)
  ));
  if (!eventChanges.children.length && stocks.length) addEventChangeRow();
  updateEventStockOptions();
  if (stocks.length) {
    const selectedStock = stocks.find(({ symbol }) => symbol === selectedSymbol) || stocks[0];
    priceSymbol.value = selectedStock.symbol;
    document.getElementById("price-value").value = selectedStock.price;
  }
}

function updateEventStockOptions() {
  const rows = [...eventChanges.querySelectorAll(".event-change-row")];
  const selectedSymbols = rows.map((row) => row.querySelector(".event-stock-symbol").value);
  rows.forEach((row, rowIndex) => {
    const select = row.querySelector(".event-stock-symbol");
    const currentSymbol = selectedSymbols[rowIndex];
    select.replaceChildren(...stocks.map((stock) => {
      const option = new Option(`${stock.symbol} — ${stock.name}`, stock.symbol);
      option.disabled = selectedSymbols.includes(stock.symbol) && stock.symbol !== currentSymbol;
      return option;
    }));
    select.value = currentSymbol || stocks.find(({ symbol }) => !selectedSymbols.includes(symbol))?.symbol || "";
    row.querySelector("button").disabled = rows.length === 1;
  });
  addEventChangeButton.disabled = rows.length >= stocks.length;
}

function addEventChangeRow() {
  if (eventChanges.children.length >= stocks.length) return;
  const row = document.createElement("div");
  row.className = "event-change-row";
  row.dataset.changeId = String(nextEventChangeId++);

  const stockLabel = document.createElement("label");
  stockLabel.textContent = "Stock";
  const stock = document.createElement("select");
  stock.className = "event-stock-symbol";
  stock.required = true;
  stockLabel.appendChild(stock);

  const directionLabel = document.createElement("label");
  directionLabel.textContent = "Direction";
  const direction = document.createElement("select");
  direction.className = "event-stock-direction";
  direction.required = true;
  direction.add(new Option("Increase", "increase"));
  direction.add(new Option("Decrease", "decrease"));
  directionLabel.appendChild(direction);

  const amountLabel = document.createElement("label");
  amountLabel.textContent = "Change (%)";
  const amount = document.createElement("input");
  amount.className = "event-stock-amount";
  amount.type = "number";
  amount.min = "0.01";
  amount.max = "100";
  amount.step = "0.01";
  amount.required = true;
  amountLabel.appendChild(amount);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", "Remove this stock change");
  remove.addEventListener("click", () => {
    row.remove();
    updateEventStockOptions();
  });
  stock.addEventListener("change", updateEventStockOptions);
  row.append(stockLabel, directionLabel, amountLabel, remove);
  eventChanges.appendChild(row);
  updateEventStockOptions();
}

addEventChangeButton.addEventListener("click", addEventChangeRow);

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requestJson("/api/admin/events", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("event-title").value,
        description: document.getElementById("event-description").value,
        changes: [...eventChanges.querySelectorAll(".event-change-row")].map((row) => ({
          stockSymbol: row.querySelector(".event-stock-symbol").value,
          direction: row.querySelector(".event-stock-direction").value,
          amount: Number(row.querySelector(".event-stock-amount").value),
        })),
      }),
    });
    eventForm.reset();
    eventChanges.replaceChildren();
    addEventChangeRow();
    showMessage("Event created, stock price adjusted, and event published on the market page.");
    await loadMarketSettings();
  } catch (error) {
    showMessage(error.message, true);
  }
});

priceSymbol.addEventListener("change", () => {
  const stock = stocks.find(({ symbol }) => symbol === priceSymbol.value);
  if (stock) document.getElementById("price-value").value = stock.price;
});

rangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const range = {
      min: Number(document.getElementById("range-min").value),
      max: Number(document.getElementById("range-max").value),
    };
    await requestJson("/api/admin/market/range", {
      method: "PATCH",
      body: JSON.stringify(range),
    });
    showMessage("Daily fluctuation range saved.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

priceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requestJson("/api/admin/market/prices", {
      method: "PATCH",
      body: JSON.stringify({
        prices: { [priceSymbol.value]: Number(document.getElementById("price-value").value) },
      }),
    });
    await loadMarketSettings();
    showMessage("Stock price updated. The current day's automatic update is skipped.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("reset-prices").addEventListener("click", async () => {
  if (!window.confirm("Reset every stock to its initial price? Chart history will be kept.")) return;
  try {
    await requestJson("/api/admin/market/reset", { method: "POST" });
    await loadMarketSettings();
    showMessage("All stock prices were reset to their initial values.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

organizationSelect.addEventListener("change", () => {
  fillOrganization(currentOrganization());
});

document.getElementById("new-organization").addEventListener("click", () => {
  organizationSelect.value = "";
  fillOrganization(null);
});

organizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = organizationSelect.value;
  const organization = {
    name: document.getElementById("organization-name").value,
    category: document.getElementById("organization-category").value,
    directors: parseDirectors(document.getElementById("organization-directors").value),
  };
  try {
    const result = await requestJson(
      id ? `/api/admin/organizations/${encodeURIComponent(id)}` : "/api/admin/organizations",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(organization),
      },
    );
    const savedId = result.organization._id;
    await loadOrganizations(savedId);
    showMessage(id ? "Organization updated." : "Organization added.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

deleteOrganizationButton.addEventListener("click", async () => {
  const id = organizationSelect.value;
  if (!id || !window.confirm("Delete this organization?")) return;
  try {
    await requestJson(`/api/admin/organizations/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadOrganizations();
    showMessage("Organization deleted.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

Promise.all([loadMarketSettings(), loadOrganizations()])
  .then(() => showMessage(""))
  .catch((error) => showMessage(error.message, true));
