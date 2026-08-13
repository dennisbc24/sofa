require("dotenv").config();

const config = {
  port: process.env.PORT || 3050,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT || 5432,
  dbSsl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
};

module.exports = { config };
