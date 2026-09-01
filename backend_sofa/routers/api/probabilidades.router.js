const express = require('express');
const router = express.Router();
const {
  getProbabilidades,
  getProbabilidadesCorners,
  getProbabilidadesRemates,
  getProbabilidadesRematesOver,
  getProbabilidadesGoles,
  getRoja1t,
  getRoja1tCorners,
  getRoja1tRemates,
  getRoja1tGoles,
  getAnalisis2,
  getAnalisis2Corners,
  getAnalisis2Goles,
  getAnalisis3,
  getAnalisis3Goles,
  getGolesEquipo,
  getGolesEquipoDistribucion,
  getAnalisisEquipo1T,
} = require('../../controllers/probabilidades.controllers');

// Ruta para consultar probabilidades según los filtros del formulario
router.get('/', getProbabilidades);

// Ruta para consultar la probabilidad de corners (tiempo completo)
router.get('/corners', getProbabilidadesCorners);

// Ruta para consultar la probabilidad de remates (tiempo completo)
router.get('/remates', getProbabilidadesRemates);

// Ruta para la probabilidad de remates (distribución over/under)
router.get('/remates/over', getProbabilidadesRematesOver);

// Análisis: partidos con al menos 1 tarjeta roja en el 1T
router.get('/roja1t', getRoja1t);
router.get('/roja1t/corners', getRoja1tCorners);
router.get('/roja1t/remates', getRoja1tRemates);
router.get('/roja1t/goles', getRoja1tGoles);

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

// Análisis: partidos de un equipo con X goles totales en el 1T
router.get('/equipo/goles', getGolesEquipo);

// Distribución de probabilidad de goles en esos partidos
router.get('/equipo/goles/distribucion', getGolesEquipoDistribucion);

// Análisis: partidos de equipo X donde equipo X hizo Y goles en 1T (detalle goles/remates/corners 1T/2T)
router.get('/equipo/analisis-1t', getAnalisisEquipo1T);

module.exports = router;