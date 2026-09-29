const { procesarLote } = require("../services/cargaEstadisticas");

// POST /api/estadisticas/lote
// Body: { files: [{ nombre: "15534026.json", contenido: "<json crudo>" }, ...],
//         liga?: string, jornada?: number }   // asignación manual de todo el lote
// Devuelve informe por archivo + resumen. Nunca falla el lote entero por 1 archivo.
const subirEstadisticas = async (req, res, next) => {
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

    // Asignación manual opcional del lote (vacío/ausente = lo del JSON).
    const opciones = {};
    if (req.body.liga !== undefined && req.body.liga !== null && req.body.liga !== "") {
      if (typeof req.body.liga !== "string") {
        return res.status(400).json({ message: "'liga' debe ser un string (o vacío para usar la del JSON)." });
      }
      opciones.liga = req.body.liga;
    }
    if (req.body.jornada !== undefined && req.body.jornada !== null && req.body.jornada !== "") {
      const j = Number(req.body.jornada);
      if (!Number.isInteger(j) || j < 1) {
        return res.status(400).json({ message: "'jornada' debe ser un entero >= 1 (o vacío para usar la del JSON)." });
      }
      opciones.jornada = j;
    }

    const { resultados, resumen } = await procesarLote(files, opciones);
    res.json({ resultados, resumen });
  } catch (error) {
    next(error);
  }
};

module.exports = { subirEstadisticas };
