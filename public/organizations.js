const organizationList = document.getElementById("organization-list");
const organizationsMessage = document.getElementById("organizations-message");
const categoryFilter = document.getElementById("organization-category");
let organizations = [];

function renderOrganizations() {
  const category = categoryFilter.value;
  const filteredOrganizations = organizations.filter((organization) =>
    category === "all" || organization.category === category
  );
  organizationList.replaceChildren();

  for (const organization of filteredOrganizations) {
    const item = document.createElement("li");
    item.className = "organization-card";
    const name = document.createElement("h2");
    name.textContent = organization.name;
    const type = document.createElement("span");
    type.className = "organization-category";
    type.textContent = organization.category;
    const directors = document.createElement("p");
    directors.textContent = organization.directors.length
      ? organization.directors.map(({ name, role }) => `${role}: ${name}`).join(" · ")
      : "Directors not listed";
    item.append(name, type, directors);

    const profiles = document.createElement("div");
    profiles.className = "organization-profiles";
    for (const { role, profile } of organization.directors) {
      if (!profile) continue;
      const profileElement = document.createElement("div");
      profileElement.className = "organization-profile";
      const avatar = document.createElement("img");
      avatar.src = profile.avatarUrl;
      avatar.alt = "";
      avatar.loading = "lazy";
      const profileName = document.createElement("span");
      profileName.textContent = `${role}: ${profile.username}`;
      profileElement.append(avatar, profileName);
      profiles.appendChild(profileElement);
    }
    if (profiles.childElementCount) item.appendChild(profiles);
    organizationList.appendChild(item);
  }

  organizationsMessage.textContent = filteredOrganizations.length
    ? ""
    : "No organizations in this category yet.";
}

async function loadOrganizations() {
  organizationsMessage.textContent = "Loading organizations...";
  try {
    const response = await fetch("/larpnomics/organizations", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Organizations request failed (${response.status})`);
    }
    if (!Array.isArray(result.organizations)) {
      throw new Error("Organizations response is invalid");
    }
    organizations = result.organizations;
    renderOrganizations();
  } catch (error) {
    console.error("Unable to load organizations:", error);
    organizationList.replaceChildren();
    organizationsMessage.classList.add("error");
    organizationsMessage.textContent = "Unable to load organizations. Please try again later.";
  }
}

categoryFilter.addEventListener("change", renderOrganizations);
loadOrganizations();
