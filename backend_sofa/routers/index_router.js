const express = require("express");

const apiPartidos = require("./api/partidos.router");
const apiLeagues = require("./api/leagues.router");
const apiProbabilidades = require("./api/probabilidades.router");
const apiEquipos = require("./api/equipos.router");

function routerApi(app) {
  const router = express.Router();
  app.use("/api/partidos", apiPartidos);
  app.use("/api/leagues", apiLeagues);
  app.use("/api/probabilidades", apiProbabilidades);
  app.use("/api/equipos", apiEquipos);
}

module.exports = { routerApi };
