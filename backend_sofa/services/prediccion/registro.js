// ---------------------------------------------------------------------------
// REGISTRO DE PREDICCIONES (beta) — acumula datos para futura evaluación.
//
// - Tabla propia `predicciones_beta` (NO toca partidos/estadísticas salvo
//   SELECT de resultados cuando ya existen).
// - UN registro por (fecha_prediccion, partido, modelo): repetir la consulta
//   el mismo día no duplica filas; consultar otro día sí registra una nueva
//   predicción (la opinión del modelo puede cambiar con más historia).
// - `resultado_real` / `acierto` se rellenan SOLO cuando el partido ya está
//   Ended en `partidos` (SELECT de lectura; jamás escribe en tablas ajenas).
// - NUNCA reentrena ni modifica el modelo: es puro registro.
// - Los fallos de registro no rompen la predicción (solo se avisa por log).
// ---------------------------------------------------------------------------
const pool = require("../../db");

const TABLA = "predicciones_beta";
let tablaAsegurada = false;

async function asegurarTabla() {
  if (tablaAsegurada) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      id BIGSERIAL PRIMARY KEY,
      fecha_prediccion DATE NOT NULL DEFAULT CURRENT_DATE,
      fecha_partido DATE,
      local TEXT NOT NULL,
      visitante TEXT NOT NULL,
      liga TEXT,
      p_local NUMERIC(5,2) NOT NULL,
      p_empate NUMERIC(5,2) NOT NULL,
      p_visitante NUMERIC(5,2) NOT NULL,
      prediccion_principal TEXT NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT NOT NULL,
      goles_local INT,
      goles_visitante INT,
      resultado_real TEXT,
      acierto BOOLEAN,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLA}_unico
      ON ${TABLA} (fecha_prediccion, fecha_partido, local, visitante, model);
  `);
  tablaAsegurada = true;
}

// Rellena resultados de predicciones ya jugadas (solo lectura de partidos).
async function actualizarResultadosPendientes() {
  await pool.query(`
    UPDATE ${TABLA} pb
    SET goles_local = p.goles_local,
        goles_visitante = p.goles_visitante,
        resultado_real = CASE
          WHEN p.goles_local > p.goles_visitante THEN 'home'
          WHEN p.goles_local = p.goles_visitante THEN 'draw'
          ELSE 'away'
        END,
        acierto = (CASE
          WHEN p.goles_local > p.goles_visitante THEN 'home'
          WHEN p.goles_local = p.goles_visitante THEN 'draw'
          ELSE 'away'
        END) = pb.prediccion_principal
    FROM partidos p
    WHERE pb.resultado_real IS NULL
      AND p.estado = 'Ended'
      AND p.equipo_local = pb.local
      AND p.equipo_visitante = pb.visitante
      AND p.fecha_partido::date = pb.fecha_partido;
  `);
}

// Llamada por cada predicción servida. Nunca lanza: si el registro falla,
// la predicción igualmente se devuelve (solo se registra el aviso).
async function registrarPrediccion({
  fechaPartido,
  local,
  visitante,
  liga = null,
  probabilities,
  principal,
  model,
  modelVersion,
}) {
  try {
    await asegurarTabla();
    await actualizarResultadosPendientes();
    await pool.query(
      `INSERT INTO ${TABLA}
        (fecha_partido, local, visitante, liga, p_local, p_empate, p_visitante,
         prediccion_principal, model, model_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (fecha_prediccion, fecha_partido, local, visitante, model) DO NOTHING`,
      [
        fechaPartido,
        local,
        visitante,
        liga,
        probabilities.home,
        probabilities.draw,
        probabilities.away,
        principal,
        model,
        modelVersion,
      ]
    );
  } catch (e) {
    console.warn(`[registro-predicciones] no se pudo registrar: ${e.message}`);
  }
}

module.exports = { registrarPrediccion, asegurarTabla, actualizarResultadosPendientes };
