require("dotenv").config();

const path = require("node:path");
const express = require("express");
const { createMarketHandler } = require("./market");
const { createOrganizationsHandler } = require("./organizations");
const { createAccountRouter, createAdminMiddleware } = require("./account");
const { createAdminRouter } = require("./admin");

const PORT = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, "public");

function createApp(options) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));
  app.use(createAccountRouter(options?.accountOptions));
  app.use(createAdminRouter({
    ...options?.adminOptions,
    accountOptions: options?.accountOptions,
    marketState: options?.marketState,
    connect: options?.connect,
    clock: options?.clock,
  }));
  app.get(["/admin", "/admin/", "/admin.html"], createAdminMiddleware(options?.accountOptions), (req, res, next) => {
    res.sendFile(path.join(__dirname, "admin.html"), (error) => {
      if (error) next(error);
    });
  });
  app.get("/api/market", createMarketHandler(options));
  app.get("/larpnomics/organizations", createOrganizationsHandler(options?.organizationOptions));
  app.use(express.static(publicDirectory));
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Market server listening on port ${PORT}`);
  });
}

module.exports = app;
module.exports.createApp = createApp;
