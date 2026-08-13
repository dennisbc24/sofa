const { Pool } = require("pg");
const { config } = require("./config/config");

const pool = new Pool({
  user: config.dbUser,
  host: config.dbHost,
  database: config.dbName,
  password: config.dbPassword,
  port: config.dbPort,
  ssl: config.dbSsl,
});

module.exports = pool;
