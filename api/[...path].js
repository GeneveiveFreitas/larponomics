const express = require("express");
const { createAccountRouter } = require("../account");

const app = express();
app.use(express.json({ limit: "4kb" }));
app.use(createAccountRouter());

module.exports = app;
