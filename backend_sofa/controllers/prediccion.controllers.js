const { analizarPartido } = require("../services/prediccion/prediccion");
const { cargarModelo, rutaModelo } = require("../services/prediccion/modelo");
const { CURRENT_PREDICTION_MODEL, modeloActivo } = require("../services/prediccion/modelo_config");
const { predecirLote2T, cargarModelo2T, rutaModelo2T } = require("../services/prediccion/modelo_2t");

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

// POST /api/predictions/2t — proyección del 2T desde JSON(s) al descanso.
// Body: { files: [{ nombre, contenido }] }  (misma forma que /api/estadisticas/lote)
// Sólo lectura: NUNCA escribe en la DB.
const postProyeccion2T = async (req, res, next) => {
  try {
    const files = req.body && req.body.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        message: "Body invalido: se espera { files: [{ nombre, contenido }] } con al menos 1 archivo.",
      });
    }
    const malo = files.find(
      (f) => !f || typeof f.nombre !== "string" || typeof f.contenido !== "string"
    );
    if (malo) {
      return res.status(400).json({
        message: "Cada elemento debe ser { nombre: string, contenido: string (JSON crudo) }.",
      });
    }
    if (files.length > 20) {
      return res.status(400).json({ message: "Máximo 20 archivos por petición." });
    }
    if (!cargarModelo2T()) {
      return res.status(503).json({
        message: "Modelo 2T no entrenado. Ejecuta: node scripts/entrenar_modelo_2t.js",
        ruta: rutaModelo2T(),
      });
    }
    const { resultados, resumen } = await predecirLote2T(files);
    res.json({ resultados, resumen });
  } catch (error) {
    next(error);
  }
};

// GET /api/predictions/model/2t — estado del modelo 2T + métricas del backtest
const getModelo2TInfo = async (req, res) => {
  const modelo = cargarModelo2T();
  if (!modelo) {
    return res.status(503).json({
      message: "Modelo 2T no entrenado. Ejecuta: node scripts/entrenar_modelo_2t.js",
      ruta: rutaModelo2T(),
    });
  }
  const principales = {};
  for (const s of ["Goles", "Total shots", "Corner kicks", "Yellow cards"]) {
    const info = modelo.stats[s];
    if (info && info.backtest && info.backtest.TEST) {
      principales[info.etiqueta] = {
        elegido: info.elegido,
        mae_modelo_TEST: info.backtest.TEST.M ? info.backtest.TEST.M.mae : null,
        mae_proyeccion2T_TEST: info.backtest.TEST.H ? info.backtest.TEST.H.mae : null,
        n_TEST: info.backtest.TEST.M ? info.backtest.TEST.M.n : null,
      };
    }
  }
  res.json({
    name: "Modelo análisis 2T",
    version: modelo.version,
    entrenadoEn: modelo.entrenadoEn,
    muestra: modelo.fuente && modelo.fuente.partidos,
    principales,
    ruta: rutaModelo2T(),
  });
};

module.exports = { getPrediction, getModelInfo, postProyeccion2T, getModelo2TInfo };
