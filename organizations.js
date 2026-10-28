const mongoose = require("mongoose");
const { Account } = require("./account");
const { connectDatabase } = require("./market");

const ORGANIZATION_CATEGORIES = [
  "corporations",
  "fingers",
  "offices",
  "associations",
];

const directorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "Director", trim: true },
  },
  { _id: false },
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    directors: { type: [directorSchema], default: [] },
    director: { type: String, default: "", trim: true },
    coDirector: { type: String, default: "", trim: true },
    category: { type: String, required: true, enum: ORGANIZATION_CATEGORIES },
  },
  { collection: "organizations", timestamps: true },
);
const organizationsDatabase = mongoose.connection.useDb("larponomics", { useCache: true });
const Organization = organizationsDatabase.models.LarponomicsOrganization ||
  organizationsDatabase.model("LarponomicsOrganization", organizationSchema);

function createOrganizationsHandler({
  organizationModel = Organization,
  accountModel = Account,
  connect = connectDatabase,
} = {}) {
  return async function organizationsHandler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.statusCode = 405;
      res.end("Method not allowed");
      return;
    }

    try {
      await connect();
      const organizations = await organizationModel
        .find({}, { name: 1, directors: 1, director: 1, coDirector: 1, category: 1 })
        .sort({ name: 1 })
        .lean();
      const getDirectors = (organization) => {
        if (Array.isArray(organization.directors) && organization.directors.length) {
          return organization.directors
            .filter((director) => typeof director.name === "string" && director.name.trim())
            .map((director) => ({
              name: director.name.trim(),
              role: director.role?.trim() || "Director",
            }));
        }
        return [
          organization.director && { name: organization.director.trim(), role: "Director" },
          organization.coDirector && { name: organization.coDirector.trim(), role: "Co-director" },
        ].filter((director) => director?.name);
      };
      const usernames = [...new Set(organizations
        .flatMap(getDirectors)
        .map(({ name }) => name))];
      const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const accounts = usernames.length
        ? await accountModel.find(
          { username: { $in: usernames.map((username) =>
            new RegExp(`^${escapeRegex(username)}$`, "i")
          ) } },
          { discordId: 1, username: 1, avatar: 1 },
        ).lean()
        : [];
      const accountsByUsername = new Map(accounts.map((account) => [
        account.username.toLocaleLowerCase(),
        {
          username: account.username,
          avatarUrl: account.avatar
            ? `https://cdn.discordapp.com/avatars/${account.discordId}/${encodeURIComponent(account.avatar)}.png?size=96`
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(account.discordId) >> 22n) % 6n}.png`,
        },
      ]));
      const organizationsWithDirectors = organizations.map((organization) => ({
        _id: organization._id,
        name: organization.name,
        category: organization.category,
        directors: getDirectors(organization).map((director) => ({
          ...director,
          profile: accountsByUsername.get(director.name.toLocaleLowerCase()) || null,
        })),
      }));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 200;
      res.end(JSON.stringify({ organizations: organizationsWithDirectors }));
    } catch (error) {
      console.error("Unable to load organizations:", error);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Unable to load organizations" }));
    }
  };
}

module.exports = {
  createOrganizationsHandler,
  Organization,
  ORGANIZATION_CATEGORIES,
};
