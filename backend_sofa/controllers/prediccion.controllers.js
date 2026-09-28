const { analizarPartido } = require("../services/prediccion/prediccion");
const { cargarModelo, rutaModelo } = require("../services/prediccion/modelo");
const { CURRENT_PREDICTION_MODEL, modeloActivo } = require("../services/prediccion/modelo_config");

// GET /api/predictions/match?localTeam=&awayTeam=&date=&league=
const getPrediction = async (req, res, next) => {
  try {
    const { localTeam, awayTeam, date, league } = req.query;
    const resultado = await analizarPartido({ localTeam, awayTeam, date, league });
    res.json(resultado);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

// GET /api/predictions/model → estado del modelo y métricas del backtest
const getModelInfo = async (req, res) => {
  const modelo = cargarModelo();
  if (!modelo) {
    return res.status(503).json({
      message: "Modelo no entrenado. Ejecuta: npm run entrenar-prediccion",
      ruta: rutaModelo(),
    });
  }
  res.json({
    activeModel: CURRENT_PREDICTION_MODEL,
    modeloOperativo: modeloActivo(),
    name: modelo.nombre,
    version: modelo.version,
    entrenadoEn: modelo.entrenado_en,
    muestra: modelo.muestra,
    backtest: modelo.backtest || null,
    ruta: rutaModelo(),
  });
};

module.exports = { getPrediction, getModelInfo };
