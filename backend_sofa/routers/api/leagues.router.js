const express = require('express');
const router = express.Router();
const { getAllLeagues } = require('../../controllers/leagues.controllers');

// Ruta para obtener todas las ligas
router.get('/', getAllLeagues);

module.exports = router;