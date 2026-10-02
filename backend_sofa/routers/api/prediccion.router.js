const express = require('express');
const router = express.Router();
const {
  getPrediction, getModelInfo, postProyeccion2T, getModelo2TInfo,
  getHistorial, getHistorialDetalle,
} = require('../../controllers/prediccion.controllers');

// Predicción pre-partido (modelo ya entrenado; nunca entrena en el request)
// GET /api/predictions/match?localTeam=X&awayTeam=Y&date=YYYY-MM-DD&league=Liga
router.get('/match', getPrediction);

// Historial de predicciones del usuario (dedup + evaluación vs datos reales)
router.get('/historial', getHistorial);
router.get('/historial/:id', getHistorialDetalle);

// Estado del modelo entrenado + métricas del backtest
router.get('/model', getModelInfo);

// Proyección del 2T desde JSON(s) de partido al descanso (sólo lectura)
// POST /api/predictions/2t  body: { files: [{ nombre, contenido }] }
router.post('/2t', postProyeccion2T);

// Estado del modelo 2T + métricas vs Proyección 2T
router.get('/model/2t', getModelo2TInfo);

module.exports = router;
