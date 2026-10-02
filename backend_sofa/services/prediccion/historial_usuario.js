// ---------------------------------------------------------------------------
// HISTORIAL DE PREDICCIONES POR USUARIO — guarda cada predicción que hace un
// usuario (pre-partido y proyección 2T) y permite volver a verla.
//
// - Deduplicación: hash SHA-256 del contenido canónico de la predicción
//   (claves ordenadas). Si el mismo usuario repite EXACTAMENTE la misma
//   predicción para el mismo partido, no se crea otra fila: sube `veces`.
// - Al visualizar, si el partido ya existe en `partidos` con resultado, se
//   evalúa contra los datos reales (1X2 para 'pre'; stats 1T/2ND/ALL de
//   `estadisticas` + cabecera para '2t') y se clasifica cada valor como
//   exacto / cercano / lejos para el énfasis en pantalla.
// - Sólo LEE partidos/estadísticas; escribe únicamente en su propia tabla.
// - Nunca lanza hacia el flujo de predicción (los fallos se loguean).
// ---------------------------------------------------------------------------
const crypto = require("crypto");
const pool = require("../../db");
const { GOLES } = require("../../experimentos_fase2t/comun2t");

const TABLA = "predicciones_usuario";
let asegurada = false;

async function asegurarTabla() {
  if (asegurada) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      tipo         VARCHAR(10) NOT NULL,
      fecha_partido DATE NOT NULL,
      local        TEXT NOT NULL,
      visitante    TEXT NOT NULL,
      liga         TEXT,
      modelo       TEXT,
      payload      JSONB NOT NULL,
      payload_hash TEXT NOT NULL,
      veces        INT NOT NULL DEFAULT 1,
      primera_vez  TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultima_vez   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLA}_unico
      ON ${TABLA} (usuario_id, tipo, fecha_partido, local, visitante, payload_hash)`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${TABLA}_lista
      ON ${TABLA} (usuario_id, ultima_vez DESC)`);
  asegurada = true;
}

// JSON canónico (claves ordenadas) → hash estable para el dedup.
function canon(v) {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
function hashPayload(obj) {
  return crypto.createHash("sha256").update(canon(obj)).digest("hex");
}

const hoy = () => new Date().toISOString().slice(0, 10);

async function guardar({ usuarioId, tipo, fechaPartido, local, visitante, liga, modelo, payload, hash }) {
  await asegurarTabla();
  const r = await pool.query(
    `INSERT INTO ${TABLA}
       (usuario_id, tipo, fecha_partido, local, visitante, liga, modelo, payload, payload_hash)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (usuario_id, tipo, fecha_partido, local, visitante, payload_hash)
     DO UPDATE SET veces = ${TABLA}.veces + 1, ultima_vez = now()
     RETURNING veces`,
    [usuarioId, tipo, fechaPartido, local, visitante, liga || null, modelo || null, JSON.stringify(payload), hash]
  );
  return r.rows[0].veces;
}

// Guarda una predicción pre-partido (jamás lanza).
async function guardarPre(usuarioId, r) {
  try {
    const payload = {
      match: r.match,
      probabilities: r.probabilities,
      prediction: r.prediction,
      lambdas: r.lambdas,
      model: r.model,
      modelVersion: r.modelVersion,
      advertencias: r.advertencias,
      explanation: r.explanation,
    };
    const hash = hashPayload({
      probabilities: r.probabilities,
      principal: r.prediction.main,
      lambdas: r.lambdas,
      model: r.model,
      modelVersion: r.modelVersion,
    });
    return await guardar({
      usuarioId,
      tipo: "pre",
      fechaPartido: r.match.date || hoy(),
      local: r.match.homeTeam,
      visitante: r.match.awayTeam,
      liga: r.match.league,
      modelo: r.model,
      payload,
      hash,
    });
  } catch (e) {
    console.warn(`[historial] no se guardó predicción pre: ${e.message}`);
    return null;
  }
}

// Guarda una proyección 2T de un archivo (jamás lanza).
async function guardar2T(usuarioId, r) {
  try {
    const payload = {
      partido: r.partido,
      goles1T: r.goles1T,
      historial: r.historial,
      filas: r.filas,
      advertencias: r.advertencias,
      modelo: r.modelo,
    };
    const hash = hashPayload({
      goles1T: r.goles1T,
      filas: r.filas,
      modelo: { id: r.modelo.id, version: r.modelo.version },
    });
    return await guardar({
      usuarioId,
      tipo: "2t",
      fechaPartido: r.partido.fecha || hoy(),
      local: r.partido.local,
      visitante: r.partido.visitante,
      liga: r.partido.liga,
      modelo: r.modelo.id,
      payload,
      hash,
    });
  } catch (e) {
    console.warn(`[historial] no se guardó proyección 2T: ${e.message}`);
    return null;
  }
}

// Lista (sin payload) para el usuario; tipo opcional 'pre' | '2t'.
async function listar(usuarioId, tipo) {
  await asegurarTabla();
  const params = [usuarioId];
  let where = "usuario_id = $1";
  if (tipo === "pre" || tipo === "2t") {
    params.push(tipo);
    where += " AND tipo = $2";
  }
  const r = await pool.query(
    `SELECT id, tipo, fecha_partido::text AS fecha, local, visitante, liga, modelo,
            veces, primera_vez, ultima_vez
       FROM ${TABLA} WHERE ${where}
      ORDER BY ultima_vez DESC LIMIT 200`,
    params
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// EVALUACIÓN CONTRA DATOS REALES
// ---------------------------------------------------------------------------

// Clasifica un valor predicho vs real: exacto (|Δ|<0.5), cercano
// (|Δ| <= max(1, 15% del real)) o lejos.
function clasificar(pred, real) {
  if (pred === null || pred === undefined || real === null || real === undefined) return null;
  const d = Math.abs(Number(pred) - Number(real));
  if (d < 0.5) return "exacto";
  if (d <= Math.max(1, Math.abs(Number(real)) * 0.15)) return "cercano";
  return "lejos";
}

// Partido real: por id Sofascore si lo hay; si no, equipos + fecha (±1 día,
// misma tolerancia que cargaEstadisticas). `fecha` viene ya alias de la fila.
async function buscarPartido(row, partidoId) {
  const fecha = row.fecha_partido || row.fecha;
  const cols =
    "id, equipo_local, equipo_visitante, fecha_partido::text AS fecha, estado, " +
    "goles_local, goles_visitante, goles_local_1t, goles_visitante_1t";
  if (partidoId) {
    const r = await pool.query(`SELECT ${cols} FROM partidos WHERE id::text = $1 LIMIT 1`, [String(partidoId)]);
    if (r.rows[0]) return r.rows[0];
  }
  if (!fecha) return null;
  let r = await pool.query(
    `SELECT ${cols} FROM partidos
      WHERE equipo_local = $1 AND equipo_visitante = $2
        AND fecha_partido BETWEEN ($3::date - 1) AND ($3::date + 1)
      ORDER BY fecha_partido LIMIT 1`,
    [row.local, row.visitante, fecha]
  );
  if (r.rows[0]) return r.rows[0];
  r = await pool.query(
    `SELECT ${cols} FROM partidos
      WHERE equipo_local ILIKE '%' || $1 || '%' AND equipo_visitante ILIKE '%' || $2 || '%'
        AND fecha_partido BETWEEN ($3::date - 1) AND ($3::date + 1)
      ORDER BY fecha_partido LIMIT 1`,
    [row.local, row.visitante, fecha]
  );
  return r.rows[0] || null;
}

function resultadoReal(p) {
  if (p.goles_local === null || p.goles_local === undefined) return null;
  if (p.goles_local > p.goles_visitante) return "home";
  if (p.goles_local === p.goles_visitante) return "draw";
  return "away";
}

// 'pre' → acierto del 1X2 + probabilidad del resultado real.
function evaluarPre(row, p) {
  const real = resultadoReal(p);
  if (!real) return { tieneReal: false };
  const probs = row.payload.probabilities || {};
  const predicho = row.payload.prediction && row.payload.prediction.main;
  return {
    tieneReal: true,
    estado: p.estado,
    marcador: { local: p.goles_local, visita: p.goles_visitante },
    resultado: real,
    predicho,
    acierto: real === predicho,
    probReal: probs[real] ?? null,
    probPredicho: probs[predicho] ?? null,
  };
}

// '2t' → valor real por stat (1ST/2ND/ALL) y clasificación de cada celda.
async function evaluar2T(row, p) {
  const real = resultadoReal(p);
  if (!real) return { tieneReal: false };

  const golesReal = {
    "1ST":
      p.goles_local_1t === null || p.goles_local_1t === undefined
        ? null
        : { l: p.goles_local_1t, a: p.goles_visitante_1t },
    "2ND":
      p.goles_local_1t === null || p.goles_local_1t === undefined
        ? null
        : { l: p.goles_local - p.goles_local_1t, a: p.goles_visitante - p.goles_visitante_1t },
    ALL: { l: p.goles_local, a: p.goles_visitante },
  };

  const nombres = [...new Set((row.payload.filas || []).map((f) => f.stat).filter((s) => s && s !== GOLES))];
  const idx = new Map();
  if (nombres.length) {
    const s = await pool.query(
      `SELECT nombre, periodo, max(valor_local_num)::float AS l, max(valor_visitante_num)::float AS a
         FROM estadisticas
        WHERE partido_id = $1 AND nombre = ANY($2)
          AND periodo IN ('1ST', '2ND', 'ALL')
          AND valor_local_num IS NOT NULL AND valor_visitante_num IS NOT NULL
        GROUP BY 1, 2`,
      [p.id, nombres]
    );
    for (const r of s.rows) {
      if (!idx.has(r.nombre)) idx.set(r.nombre, {});
      idx.get(r.nombre)[r.periodo] = { l: r.l, a: r.a };
    }
  }

  const combinado = (base) => {
    if (!base) return null;
    if (base["2ND"]) return base["2ND"];
    if (base.ALL && base["1ST"]) {
      return { l: base.ALL.l - base["1ST"].l, a: base.ALL.a - base["1ST"].a };
    }
    return null;
  };
  const suma = (base) => {
    if (!base) return null;
    if (base.ALL) return base.ALL;
    if (base["1ST"] && base["2ND"]) {
      return { l: base["1ST"].l + base["2ND"].l, a: base["1ST"].a + base["2ND"].a };
    }
    return null;
  };

  const filas = [];
  const resumen = { comparaciones: 0, exactos: 0, cercanos: 0, lejos: 0 };
  const cuenta = (c) => {
    if (!c) return;
    resumen.comparaciones += 1;
    resumen[c === "exacto" ? "exactos" : c === "cercano" ? "cercanos" : "lejos"] += 1;
  };

  for (const f of row.payload.filas || []) {
    const base = f.stat === GOLES ? golesReal : idx.get(f.stat) || null;
    const real2T = combinado(base);
    const realFT = suma(base);
    const e = {
      stat: f.stat,
      real2T,
      realFT,
      cl: {
        pred2TL: clasificar(f.predLocal2T, real2T && real2T.l),
        pred2TV: clasificar(f.predVisita2T, real2T && real2T.a),
        ftL: clasificar(f.ftLocal, realFT && realFT.l),
        ftV: clasificar(f.ftVisita, realFT && realFT.a),
        ftT: clasificar(f.ftTotal, realFT && realFT.l !== null && realFT.a !== null ? realFT.l + realFT.a : null),
      },
    };
    cuenta(e.cl.pred2TL);
    cuenta(e.cl.pred2TV);
    cuenta(e.cl.ftL);
    cuenta(e.cl.ftV);
    cuenta(e.cl.ftT);
    filas.push(e);
  }

  return {
    tieneReal: true,
    estado: p.estado,
    marcador: {
      local: p.goles_local,
      visita: p.goles_visitante,
      local1T: p.goles_local_1t,
      visita1T: p.goles_visitante_1t,
    },
    goles: golesReal,
    filas,
    resumen,
  };
}

// Detalle de UNA predicción del usuario + evaluación real (null si no es suya).
async function detalle(id, usuarioId) {
  await asegurarTabla();
  const r = await pool.query(
    `SELECT id, usuario_id, tipo, fecha_partido::text AS fecha, local, visitante, liga,
            modelo, payload, veces, primera_vez, ultima_vez
       FROM ${TABLA} WHERE id = $1 AND usuario_id = $2`,
    [id, usuarioId]
  );
  const row = r.rows[0];
  if (!row) return null;

  let evaluacion = { tieneReal: false };
  try {
    const partidoId = row.tipo === "2t" ? row.payload?.partido?.id : null;
    const p = await buscarPartido(row, partidoId);
    if (p) {
      evaluacion = row.tipo === "pre" ? evaluarPre(row, p) : await evaluar2T(row, p);
      if (evaluacion.tieneReal) {
        evaluacion.partidoId = String(p.id);
        evaluacion.fecha = p.fecha;
      }
    }
  } catch (e) {
    console.warn(`[historial] no se pudo evaluar la predicción ${id}: ${e.message}`);
  }
  return { ...row, evaluacion };
}

module.exports = {
  asegurarTabla, hashPayload,
  guardarPre, guardar2T,
  listar, detalle,
  clasificar,
};
