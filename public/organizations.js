const organizationList = document.getElementById("organization-list");
const organizationsMessage = document.getElementById("organizations-message");
const categoryFilter = document.getElementById("organization-category");
let organizations = [];

function renderOrganizations() {
  const category = categoryFilter.value;
  const filteredOrganizations = organizations.filter((organization) =>
    organization.category === category
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
    item.append(name, type);

    const profiles = document.createElement("div");
    profiles.className = "organization-profiles";
    for (const { name: directorName, role, profile } of organization.directors) {
      const profileElement = document.createElement("div");
      profileElement.className = "organization-profile";
      if (profile?.avatarUrl) {
        const avatar = document.createElement("img");
        avatar.src = profile.avatarUrl;
        avatar.alt = "";
        avatar.loading = "lazy";
        profileElement.appendChild(avatar);
      } else {
        const avatarPlaceholder = document.createElement("span");
        avatarPlaceholder.className = "organization-avatar-placeholder";
        avatarPlaceholder.setAttribute("aria-hidden", "true");
        avatarPlaceholder.textContent = directorName.slice(0, 1).toUpperCase();
        profileElement.appendChild(avatarPlaceholder);
      }
      const profileDetails = document.createElement("span");
      profileDetails.className = "organization-profile-details";
      const profileRole = document.createElement("strong");
      profileRole.textContent = role;
      const profileName = document.createElement("span");
      profileName.textContent = profile?.username || directorName;
      profileDetails.append(profileRole, profileName);
      profileElement.appendChild(profileDetails);
      profiles.appendChild(profileElement);
    }
    if (organization.directors.length) item.appendChild(profiles);
    else {
      const noDirectors = document.createElement("p");
      noDirectors.textContent = "Directors not listed";
      item.appendChild(noDirectors);
    }
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
