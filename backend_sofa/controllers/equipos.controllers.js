const { EquiposService } = require("../services/equipos");

const equiposService = new EquiposService();

const getAllEquipos = async (req, res, next) => {
  try {
    const equipos = await equiposService.getEquipos();
    res.json(equipos);
  } catch (error) {
    next(error);
  }
};

const getEquipo = async (req, res, next) => {
  try {
    const { equipo } = req.params;
    const ligas = await equiposService.getLigas(equipo);
    const promediosGoles = await equiposService.getPromediosGoles(equipo, null);
    const estadisticas = await equiposService.getPromediosEstadisticas(equipo, null);
    res.json({ equipo, ligas, ...promediosGoles, estadisticas });
  } catch (error) {
    next(error);
  }
};

const getPromediosEquipo = async (req, res, next) => {
  try {
    const { equipo } = req.params;
    const liga = req.query.liga || null;
    const ligas = await equiposService.getLigas(equipo);
    const promediosGoles = await equiposService.getPromediosGoles(equipo, liga);
    const estadisticas = await equiposService.getPromediosEstadisticas(equipo, liga);
    res.json({ equipo, ligas, liga, ...promediosGoles, estadisticas });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAllEquipos, getEquipo, getPromediosEquipo };