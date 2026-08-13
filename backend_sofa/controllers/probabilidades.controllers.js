const { ProbabilidadesService } = require("../services/probabilidades");

const probabilidadesService = new ProbabilidadesService();

const parseParams = (req) => {
  const ligas = Array.isArray(req.query.ligas)
    ? req.query.ligas
    : req.query.ligas
      ? [req.query.ligas]
      : [];
  const jornada = Number(req.query.jornada) || 0;
  const corners = Number(req.query.corners) || 0;
  const goles = Number(req.query.goles) || 0;
  const conDiferencia = req.query.diferenciaGoles !== undefined && req.query.diferenciaGoles !== "";
  const diferenciaGoles = Number(req.query.diferenciaGoles) || 0;
  return { ligas, jornada, corners, goles, conDiferencia, diferenciaGoles };
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

module.exports = {
  getProbabilidades,
  getProbabilidadesCorners,
  getProbabilidadesGoles,
  getAnalisis2,
  getAnalisis2Corners,
  getAnalisis2Goles,
  getAnalisis3,
  getAnalisis3Goles,
};