const express = require("express");
const router = express.Router();
const { subirEstadisticas } = require("../../controllers/estadisticas.controllers");

// Carga por lote de estadisticas desde JSONs estilo Sofascore (1 por partido).
// POST /api/estadisticas/lote
router.post("/lote", subirEstadisticas);

module.exports = router;
