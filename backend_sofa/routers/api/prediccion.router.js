const express = require('express');
const router = express.Router();
const { getPrediction, getModelInfo } = require('../../controllers/prediccion.controllers');

// Predicción pre-partido (modelo ya entrenado; nunca entrena en el request)
// GET /api/predictions/match?localTeam=X&awayTeam=Y&date=YYYY-MM-DD&league=Liga
router.get('/match', getPrediction);

// Estado del modelo entrenado + métricas del backtest
router.get('/model', getModelInfo);

module.exports = router;
