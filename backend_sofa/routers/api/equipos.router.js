const express = require('express');
const router = express.Router();
const { getAllEquipos, getEquipo, getPromediosEquipo } = require('../../controllers/equipos.controllers');

// Ruta para obtener todos los equipos
router.get('/', getAllEquipos);

// Ruta para obtener los promedios de un equipo (con filtro opcional por liga)
router.get('/:equipo/promedios', getPromediosEquipo);

// Ruta para obtener la info de un equipo (ligas + promedios globales)
router.get('/:equipo', getEquipo);

module.exports = router;