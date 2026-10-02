const express = require("express");
const cors = require("cors");
const path = require("path");

const { config } = require("./config/config");
const { routerApi } = require("./routers/index_router");
const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");
const { protegerApi } = require("./services/auth/middleware");

const app = express();

app.set("query parser", "extended");

app.use(cors());
// Límite subido a 15mb para el cargador por lotes de estadísticas
// (el default de express.json es 100kb; nginx en prod permite 20M).
app.use(express.json({ limit: "15mb" }));

app.use(express.static(path.join(__dirname, "dist")));

// Ruta principal
app.get("/", (req, res) => {
  res.json({ message: "Servidor funcionando correctamente" });
});

// Toda la API exige cookie de sesión válida (las rutas públicas de /api/auth
// las decide el propio middleware). Los estáticos quedan abiertos para que la
// página de login cargue; los datos reales sólo salen autenticados.
app.use("/api", protegerApi);

routerApi(app);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// Manejo de rutas no encontradas y errores
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log("empezando el server puerto " + config.port);
});
