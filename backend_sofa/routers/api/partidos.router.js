const express = require('express');
const router = express.Router();
const { getPartidosByLiga, getUltimosPartidosByLiga, getPartidoDetalle } = require('../../controllers/partidos.controllers');

// Ruta para obtener el detalle + stats de un partido específico
router.get('/detalle/:id', getPartidoDetalle);

// Ruta para obtener los últimos partidos agregados por liga
router.get('/ultimos/:liga', getUltimosPartidosByLiga);

// Ruta para obtener los partidos por liga
router.get('/:liga', getPartidosByLiga);

module.exports = router;