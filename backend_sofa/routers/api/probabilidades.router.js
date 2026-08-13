const express = require('express');
const router = express.Router();
const {
  getProbabilidades,
  getProbabilidadesCorners,
  getProbabilidadesGoles,
  getAnalisis2,
  getAnalisis2Corners,
  getAnalisis2Goles,
  getAnalisis3,
  getAnalisis3Goles,
} = require('../../controllers/probabilidades.controllers');

// Ruta para consultar probabilidades según los filtros del formulario
router.get('/', getProbabilidades);

// Ruta para consultar la probabilidad de corners (tiempo completo)
router.get('/corners', getProbabilidadesCorners);

// Ruta para consultar la probabilidad de goles (tiempo completo)
router.get('/goles', getProbabilidadesGoles);

// Ruta para el análisis 2 (diferencia de goles 1T)
router.get('/analisis2', getAnalisis2);

// Ruta para la probabilidad de corners en el análisis 2
router.get('/analisis2/corners', getAnalisis2Corners);

// Ruta para la probabilidad de goles en el análisis 2
router.get('/analisis2/goles', getAnalisis2Goles);

// Ruta para el análisis 3 (goles según el marcador del 1T)
router.get('/analisis3', getAnalisis3);

// Ruta para la probabilidad de goles en el análisis 3
router.get('/analisis3/goles', getAnalisis3Goles);

module.exports = router;