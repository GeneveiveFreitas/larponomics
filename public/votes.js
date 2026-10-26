const VOTES_PER_DIRECTION = 3;
let stocks = [];
let account = null;
let accountLoading = true;
let submitting = false;
let allocations = { up: {}, down: {} };

const $ = (id) => document.getElementById(id);
const formatPrice = (price) => price.toFixed(price < 10 ? 2 : 1);

function voteTotal(direction) {
  return Object.values(allocations[direction]).reduce((sum, count) => sum + count, 0);
}

function renderAccount() {
  $("discord-login").hidden = accountLoading || Boolean(account);
  $("account-user").hidden = !account;
  if (account) {
    $("account-username").textContent = account.user.username;
    $("account-avatar").src = account.user.avatarUrl || "";
    $("account-avatar").hidden = !account.user.avatarUrl;
  }

  $("up-remaining").textContent = String(VOTES_PER_DIRECTION - voteTotal("up"));
  $("down-remaining").textContent = String(VOTES_PER_DIRECTION - voteTotal("down"));
  $("submit-votes").disabled = !account || account.daily.submitted || submitting ||
    voteTotal("up") !== VOTES_PER_DIRECTION ||
    voteTotal("down") !== VOTES_PER_DIRECTION;
}

function changeVote(direction, symbol, amount) {
  const current = allocations[direction][symbol] || 0;
  const next = current + amount;
  if (next < 0 || (amount > 0 && voteTotal(direction) >= VOTES_PER_DIRECTION)) return;
  if (next === 0) delete allocations[direction][symbol];
  else allocations[direction][symbol] = next;
  renderList();
}

function voteControl(direction, symbol, label) {
  const container = document.createElement("div");
  container.className = `vote-control ${direction}`;
  const title = document.createElement("span");
  title.className = "vote-control-label";
  title.textContent = label;
  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.textContent = "−";
  decrease.setAttribute("aria-label", `Remove ${label.toLowerCase()} for ${symbol}`);
  decrease.dataset.symbol = symbol;
  decrease.dataset.direction = direction;
  decrease.addEventListener("click", () => changeVote(direction, symbol, -1));
  const count = document.createElement("strong");
  count.textContent = String(allocations[direction][symbol] || 0);
  const increase = document.createElement("button");
  increase.type = "button";
  increase.textContent = "+";
  increase.setAttribute("aria-label", `Add ${label.toLowerCase()} for ${symbol}`);
  increase.dataset.symbol = symbol;
  increase.dataset.direction = direction;
  increase.addEventListener("click", () => changeVote(direction, symbol, 1));
  container.append(title, decrease, count, increase);
  return container;
}

function renderList() {
  const list = $("vote-list");
  list.replaceChildren();
  for (const stock of stocks) {
    const row = document.createElement("article");
    row.className = "vote-stock";
    const info = document.createElement("div");
    info.className = "vote-stock-info";
    const symbol = document.createElement("strong");
    symbol.className = "sym";
    symbol.textContent = stock.symbol;
    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = stock.name;
    const price = document.createElement("span");
    price.className = "px";
    price.textContent = formatPrice(stock.price);
    info.append(symbol, name, price);

    const controls = document.createElement("div");
    controls.className = "vote-stock-controls";
    controls.append(
      voteControl("up", stock.symbol, "Raise"),
      voteControl("down", stock.symbol, "Lower"),
    );
    row.append(info, controls);
    list.appendChild(row);
  }

  const locked = !account || account.daily.submitted || submitting;
  document.querySelectorAll(".vote-control button").forEach((button) => {
    const { direction, symbol } = button.dataset;
    const count = allocations[direction][symbol] || 0;
    const isDecrease = button.textContent === "−";
    button.disabled = locked || (isDecrease ? count === 0 : voteTotal(direction) >= VOTES_PER_DIRECTION);
  });
  renderAccount();
}

async function loadPage() {
  const [accountResponse, marketResponse] = await Promise.all([
    fetch("/api/account", { cache: "no-store" }),
    fetch("/api/market", { cache: "no-store" }),
  ]);
  const market = await marketResponse.json();
  if (!marketResponse.ok) throw new Error(market.error || "Could not load stock prices");
  stocks = market.stocks;

  if (accountResponse.status === 401) {
    account = null;
  } else {
    const result = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(result.error || "Could not load account");
    account = result;
  }
  accountLoading = false;
  $("status").textContent = `Prices from ${market.date}. Up-votes raise prices; down-votes lower them.`;
  $("vote-message").textContent = account?.daily.submitted
    ? "You have already submitted today’s votes. Come back after midnight UTC."
    : account
      ? "Allocate all six votes, then submit to update prices."
      : "Sign in with Discord to cast your daily votes.";
  renderList();
}

async function submitVotes() {
  if ($("submit-votes").disabled) return;
  submitting = true;
  $("vote-message").classList.remove("error");
  $("vote-message").textContent = "Submitting votes…";
  renderList();
  try {
    const response = await fetch("/api/account/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(allocations),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not submit votes");
    account = result;
    stocks = result.market.stocks;
    allocations = { up: {}, down: {} };
    $("vote-message").textContent = "Votes submitted. Stock prices have been updated.";
    $("status").textContent = `Prices updated in the database (${result.market.date}).`;
  } catch (error) {
    $("vote-message").classList.add("error");
    $("vote-message").textContent = error.message;
  } finally {
    submitting = false;
    renderList();
  }
}

$("submit-votes").addEventListener("click", submitVotes);
$("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Unable to sign out");
    account = null;
    $("vote-message").textContent = "Signed out.";
    renderList();
  } catch (error) {
    $("vote-message").classList.add("error");
    $("vote-message").textContent = error.message;
  }
});

loadPage().catch((error) => {
  accountLoading = false;
  $("status").classList.add("error");
  $("status").textContent = error.message;
  renderAccount();
});

const now = new Date();
const nextUtcMidnight = Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate() + 1,
);
setTimeout(() => location.reload(), nextUtcMidnight - now.getTime() + 250);
