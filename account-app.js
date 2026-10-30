const express = require("express");
const { createAccountRouter } = require("./account");

const app = express();
app.use(express.json({ limit: "4kb" }));
app.use((req, res, next) => {
  if (req.url !== "/api/auth/discord") {
    req.url = req.url.replace(/^\/api(?=\/)/, "/larponomics");
  }
  next();
});
app.use(createAccountRouter());

module.exports = app;
