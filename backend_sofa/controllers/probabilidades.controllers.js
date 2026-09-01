const { ProbabilidadesService } = require("../services/probabilidades");

const probabilidadesService = new ProbabilidadesService();

const parseParams = (req) => {
  const ligas = Array.isArray(req.query.ligas)
    ? req.query.ligas
    : req.query.ligas
      ? [req.query.ligas]
      : [];
  const jornada = Number(req.query.jornada) || 0;
  const corners = req.query.corners === undefined ? "" : String(req.query.corners);
  const goles = req.query.goles === undefined ? "" : String(req.query.goles);
  const conDiferencia = req.query.diferenciaGoles !== undefined && req.query.diferenciaGoles !== "";
  const diferenciaGoles = Number(req.query.diferenciaGoles) || 0;
  const equipo = req.query.equipo || "";
  const goles1T = req.query.goles1T !== undefined ? req.query.goles1T : "";
  const golesEquipo1T = req.query.golesEquipo1T !== undefined ? req.query.golesEquipo1T : req.query.golesEquipo !== undefined ? req.query.golesEquipo : "";
  return { ligas, jornada, corners, goles, conDiferencia, diferenciaGoles, equipo, goles1T, golesEquipo1T };
};

const getProbabilidades = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getProbabilidades(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getProbabilidadesCorners = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getProbabilidadesCorners(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getProbabilidadesRemates = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getProbabilidades(ligas, jornada, corners, goles, "Total shots", "remates");
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getProbabilidadesRematesOver = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getProbabilidadesRemates(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getRoja1t = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getRoja1t(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getRoja1tCorners = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getRoja1tCorners(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getRoja1tRemates = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getRoja1tRemates(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getRoja1tGoles = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getRoja1tGoles(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getProbabilidadesGoles = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, goles } = parseParams(req);
    const resultados = await probabilidadesService.getProbabilidadesGoles(ligas, jornada, corners, goles);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisis2 = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, conDiferencia, diferenciaGoles } = parseParams(req);
    const resultados = await probabilidadesService.getAnalisis2(ligas, jornada, corners, diferenciaGoles, conDiferencia);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisis2Corners = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, conDiferencia, diferenciaGoles } = parseParams(req);
    const resultados = await probabilidadesService.getAnalisis2Corners(ligas, jornada, corners, diferenciaGoles, conDiferencia);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisis2Goles = async (req, res, next) => {
  try {
    const { ligas, jornada, corners, conDiferencia, diferenciaGoles } = parseParams(req);
    const resultados = await probabilidadesService.getAnalisis2Goles(ligas, jornada, corners, diferenciaGoles, conDiferencia);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisis3 = async (req, res, next) => {
  try {
    const { ligas, jornada } = parseParams(req);
    const resultados = await probabilidadesService.getAnalisis3(ligas, jornada, req.query.local1T, req.query.visitante1T);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisis3Goles = async (req, res, next) => {
  try {
    const { ligas, jornada } = parseParams(req);
    const resultados = await probabilidadesService.getAnalisis3Goles(ligas, jornada, req.query.local1T, req.query.visitante1T);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getGolesEquipo = async (req, res, next) => {
  try {
    const { ligas, jornada, equipo, goles1T } = parseParams(req);
    const resultados = await probabilidadesService.getGolesEquipo(equipo, goles1T, ligas, jornada);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getGolesEquipoDistribucion = async (req, res, next) => {
  try {
    const { ligas, jornada, equipo, goles1T } = parseParams(req);
    const resultados = await probabilidadesService.getGolesEquipoDistribucion(equipo, goles1T, ligas, jornada);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

const getAnalisisEquipo1T = async (req, res, next) => {
  try {
    const { ligas, jornada, equipo, golesEquipo1T } = parseParams(req);
    if (!equipo) return res.status(400).json({ message: "Parámetro equipo es requerido" });
    const resultados = await probabilidadesService.getAnalisisEquipo1T(equipo, golesEquipo1T, ligas, jornada);
    res.json(resultados);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProbabilidades,
  getProbabilidadesCorners,
  getProbabilidadesRemates,
  getProbabilidadesRematesOver,
  getProbabilidadesGoles,
  getRoja1t,
  getRoja1tCorners,
  getRoja1tRemates,
  getRoja1tGoles,
  getAnalisis2,
  getAnalisis2Corners,
  getAnalisis2Goles,
  getAnalisis3,
  getAnalisis3Goles,
  getGolesEquipo,
  getGolesEquipoDistribucion,
  getAnalisisEquipo1T,
};