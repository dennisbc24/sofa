const express = require("express");
const cors = require("cors");
const path = require("path");

const { config } = require("./config/config");
const { routerApi } = require("./routers/index_router");
const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.set("query parser", "extended");

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "dist")));

// Ruta principal
app.get("/", (req, res) => {
  res.json({ message: "Servidor funcionando correctamente" });
});

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
