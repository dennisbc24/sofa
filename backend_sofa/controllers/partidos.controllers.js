const { PartidosService } = require("../services/partidos");

const partidosService = new PartidosService();

const getPartidosByLiga = async (req, res, next) => {
  try {
    const { liga } = req.params;
    const partidos = await partidosService.getPartidosByLiga(liga);
    res.json(partidos);
  } catch (error) {
    next(error);
  }
};

const getUltimosPartidosByLiga = async (req, res, next) => {
  try {
    const raw = req.params.liga;
    const liga = raw.includes("%") ? decodeURIComponent(raw) : raw;
    const partidos = await partidosService.getUltimosAgregados(liga);
    res.json(partidos);
  } catch (error) {
    next(error);
  }
};

const getPartidoDetalle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partido = await partidosService.getPartidoById(id);
    if (!partido) {
      return res.status(404).json({ message: "Partido no encontrado" });
    }
    const estadisticas = await partidosService.getEstadisticasByPartido(id);
    res.json({ partido, estadisticas });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPartidosByLiga, getUltimosPartidosByLiga, getPartidoDetalle };
