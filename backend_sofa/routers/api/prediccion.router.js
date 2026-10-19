const express = require('express');
const router = express.Router();
const {
  getPrediction, getModelInfo, postProyeccion2T, getModelo2TInfo,
  getHistorial, getHistorialDetalle, putHistorialPartido, getBuscarPartidos,
  getAlineacion, postMatchConAlineacion,
} = require('../../controllers/prediccion.controllers');

// Predicci��n pre-partido (modelo ya entrenado; nunca entrena en el request)
// GET /api/predictions/match?localTeam=X&awayTeam=Y&date=YYYY-MM-DD&league=Liga
router.get('/match', getPrediction);

// Predicci��n pre-partido CON alineaci��n declarada (XI).
// POST /api/predictions/match  body: { localTeam, awayTeam, date, league, alineacion }
router.post('/match', postMatchConAlineacion);

// Squad de un equipo (dorsal, nombre, posici��n y tasas hist��ricas).
// GET /api/predictions/alineacion/:equipo
router.get('/alineacion/:equipo', getAlineacion);

// Historial de predicciones del usuario (dedup + evaluación vs datos reales)
router.get('/historial', getHistorial);
router.get('/historial/:id', getHistorialDetalle);
// Vínculo manual con el partido real (visible/cambiable en el historial)
router.put('/historial/:id/partido', putHistorialPartido);
router.get('/partidos-buscar', getBuscarPartidos);

// Estado del modelo entrenado + métricas del backtest
router.get('/model', getModelInfo);

// Proyección del 2T desde JSON(s) de partido al descanso (sólo lectura)
// POST /api/predictions/2t  body: { files: [{ nombre, contenido }] }
router.post('/2t', postProyeccion2T);

// Estado del modelo 2T + métricas vs Proyección 2T
router.get('/model/2t', getModelo2TInfo);

module.exports = router;
