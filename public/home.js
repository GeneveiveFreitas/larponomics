const login = document.getElementById("discord-login");
const accountUser = document.getElementById("account-user");
const avatar = document.getElementById("account-avatar");
const username = document.getElementById("account-username");
const message = document.getElementById("account-message");
const adminLink = document.querySelector(".admin-nav-link");
login.hidden = true;

function renderAccount(account) {
  login.hidden = Boolean(account);
  accountUser.hidden = !account;
  if (adminLink) adminLink.hidden = !account?.user?.isAdmin;
  if (!account) return;

  username.textContent = account.user.username;
  avatar.hidden = !account.user.avatarUrl;
  avatar.src = account.user.avatarUrl || "";
}

async function loadAccount() {
  try {
    const response = await fetch("/api/account", { cache: "no-store" });
    if (response.status === 401) {
      renderAccount(null);
      return;
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Account request failed (${response.status})`);
    }
    renderAccount(result);
  } catch (error) {
    console.error("Unable to load account:", error);
    renderAccount(null);
  }
}

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Unable to sign out");
    }

    renderAccount(null);
    message.classList.remove("error");
    message.textContent = "Signed out.";
  } catch (error) {
    console.error("Unable to sign out:", error);
    message.classList.add("error");
    message.textContent = error.message;
  }
});

loadAccount();
