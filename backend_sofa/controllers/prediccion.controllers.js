const { analizarPartido } = require("../services/prediccion/prediccion");
const { cargarModelo, rutaModelo } = require("../services/prediccion/modelo");
const { CURRENT_PREDICTION_MODEL, modeloActivo } = require("../services/prediccion/modelo_config");
const { predecirLote2T, cargarModelo2T, rutaModelo2T } = require("../services/prediccion/modelo_2t");
const { modeloActivo2T } = require("../services/prediccion/modelo_2t_config");
const historial = require("../services/prediccion/historial_usuario");

// GET /api/predictions/match?localTeam=&awayTeam=&date=&league=
// Guarda la predicción en el historial del usuario (dedup: misma predicción
// repetida sólo sube el contador `veces`).
const getPrediction = async (req, res, next) => {
  try {
    const { localTeam, awayTeam, date, league } = req.query;
    const resultado = await analizarPartido({ localTeam, awayTeam, date, league });
    if (req.usuario && req.usuario.uid) {
      await historial.guardarPre(req.usuario.uid, resultado);
    }
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
    // Guarda cada proyección en el historial del usuario (dedup por hash).
    if (req.usuario && req.usuario.uid) {
      for (const r of resultados) {
        if (r.accion === "ok") await historial.guardar2T(req.usuario.uid, r);
      }
    }
    res.json({ resultados, resumen });
  } catch (error) {
    next(error);
  }
};

// GET /api/predictions/model/2t — estado del beta 2T + métricas del backtest
const getModelo2TInfo = async (req, res) => {
  const modelo = cargarModelo2T();
  if (!modelo) {
    return res.status(503).json({
      message: "Modelo 2T no entrenado. Ejecuta: node scripts/entrenar_modelo_2t.js",
      ruta: rutaModelo2T(),
    });
  }
  const activo = modeloActivo2T();
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
    activeModel: activo.id,
    estado: activo.estado,
    name: "Modelo análisis 2T",
    version: activo.version,
    descripcion: activo.descripcion,
    archivo: activo.archivo,
    entrenadoEn: modelo.entrenadoEn,
    seleccionadoEn: activo.seleccionadoEn,
    confirmacion: activo.confirmacion,
    muestra: modelo.fuente && modelo.fuente.partidos,
    principales,
    ruta: rutaModelo2T(),
  });
};

// GET /api/predictions/historial?tipo=pre|2t — predicciones del usuario.
const getHistorial = async (req, res, next) => {
  try {
    const tipo = req.query.tipo === "pre" || req.query.tipo === "2t" ? req.query.tipo : null;
    res.json({ predicciones: await historial.listar(req.usuario.uid, tipo) });
  } catch (error) {
    next(error);
  }
};

// GET /api/predictions/historial/:id — detalle + evaluación vs datos reales.
const getHistorialDetalle = async (req, res, next) => {
  try {
    const d = await historial.detalle(Number(req.params.id), req.usuario.uid);
    if (!d) return res.status(404).json({ message: "Predicción no encontrada." });
    res.json(d);
  } catch (error) {
    next(error);
  }
};

// PUT /api/predictions/historial/:id/partido — vínculo manual con un partido
// real. body: { partidoId: "15534028" } o { partidoId: null } (quitar).
const putHistorialPartido = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { partidoId } = req.body || {};
    if (partidoId !== null && (typeof partidoId !== "string" || !/^\d{1,20}$/.test(partidoId))) {
      return res.status(400).json({ message: "partidoId debe ser el id de un partido o null." });
    }
    const d = await historial.vincular(req.usuario.uid, id, partidoId);
    if (!d) return res.status(404).json({ message: "Predicción no encontrada." });
    res.json(d);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

// GET /api/predictions/partidos-buscar?q=&fecha= — partidos reales para vincular.
const getBuscarPartidos = async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 60) : null;
    const fecha = typeof req.query.fecha === "string" && req.query.fecha ? req.query.fecha : null;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ message: "fecha debe tener formato YYYY-MM-DD." });
    }
    res.json({ partidos: await historial.buscarPartidos(q, fecha) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPrediction, getModelInfo, postProyeccion2T, getModelo2TInfo,
  getHistorial, getHistorialDetalle, putHistorialPartido, getBuscarPartidos,
};
