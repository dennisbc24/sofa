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

module.exports = { getPartidosByLiga, getUltimosPartidosByLiga };
