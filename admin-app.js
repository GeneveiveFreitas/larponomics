const express = require("express");
const { createAdminMiddleware } = require("./account");
const { createAdminRouter } = require("./admin");
const path = require("node:path");

const app = express();
app.use(express.json({ limit: "4kb" }));
app.use((req, res, next) => {
  const route = req.query.route;
  if (typeof route === "string") {
    if (
      route === "page" ||
      route === "market" ||
      route === "market/range" ||
      route === "market/prices" ||
      route === "market/reset" ||
      route === "organizations" ||
      /^organizations\/[a-f\d]{24}$/i.test(route)
    ) {
      req.url = `/api/admin/${route}`;
    } else {
      return res.status(404).json({ error: "Not found" });
    }
  }
  next();
});
app.use(createAdminRouter());
app.get("/api/admin/page", createAdminMiddleware(), (req, res, next) => {
  res.sendFile(path.join(__dirname, "admin.html"), (error) => {
    if (error) next(error);
  });
});

module.exports = app;
