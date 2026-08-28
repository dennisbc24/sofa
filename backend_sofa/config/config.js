const path = require("path");
// Carga .env desde backend_sofa/.env siempre, independiente del cwd
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const env = process.env.NODE_ENV || "development";
// Carga .env.development / .env.production si existe (override para permitir separar dev/prod)
require("dotenv").config({
  path: path.resolve(__dirname, `../.env.${env}`),
  override: true,
});

const isProd = env === "production";

const config = {
  env,
  isProd,
  port: process.env.PORT || 3050,
  // Soporta variables específicas por entorno (DB_HOST_DEV/DB_HOST_PROD) con fallback a DB_HOST
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbHost:
    (isProd ? process.env.DB_HOST_PROD || process.env.DB_HOST : process.env.DB_HOST_DEV || process.env.DB_HOST) ||
    "localhost",
  // En desarrollo el túnel SSM usa 5433 (ver README), en producción 5432. Permite DB_PORT_DEV/DB_PORT_PROD.
  dbPort: Number(
    isProd
      ? process.env.DB_PORT_PROD || process.env.DB_PORT || 5432
      : process.env.DB_PORT_DEV || process.env.DB_PORT || 5433
  ),
  dbSsl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
};

module.exports = { config };
