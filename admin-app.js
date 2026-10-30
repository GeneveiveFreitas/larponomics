const express = require("express");
const { createAdminMiddleware } = require("./account");
const { createAdminRouter } = require("./admin");
const path = require("node:path");

const app = express();
app.use(express.json({ limit: "4kb" }));
app.use(createAdminRouter());
app.get("/api/admin/page", createAdminMiddleware(), (req, res, next) => {
  res.sendFile(path.join(__dirname, "admin.html"), (error) => {
    if (error) next(error);
  });
});

module.exports = app;
