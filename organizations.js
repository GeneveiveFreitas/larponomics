const mongoose = require("mongoose");
const { connectDatabase } = require("./market");

const ORGANIZATION_CATEGORIES = [
  "corporations",
  "fingers",
  "offices",
  "associations",
];

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
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
        .find({}, { name: 1, director: 1, coDirector: 1, category: 1 })
        .sort({ name: 1 })
        .lean();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 200;
      res.end(JSON.stringify({ organizations }));
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
