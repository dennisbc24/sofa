// ---------------------------------------------------------------------------
// MODELO 2T — proyección del segundo tiempo al descanso (sección Predicción).
//
// Entrada: JSON estilo Sofascore de UN partido al descanso (estructura de la
// carpeta HT; misma forma que SubirEstadisticas / cargaEstadisticas).
// Salida: predicción del 2T por stat (goles, remates, corners, tarjetas y
// ~37 stats más) + FT (1T real + pred 2T) para las principales.
//
// Componentes por stat (artefacto modelos/prediccion_2t.json, elegido en VAL
// por fase2t_0_backtest): B = blend {L0,T,R[,H]}, TR, R, T.
//   L0 = media de liga (familia -> base -> global, cutoff fecha < partido)
//   T  = media del equipo (shrinkage, última K por condición)
//   R  = ridge de 11 features (1T actual + historial con cutoff)
//   H  = port de la Proyección 2T tradicional (sólo goles/remates/corners)
//
// Las consultas son SOLO lectura sobre la DB local (nunca escribe nada) y el
// historial usa cutoff estricto fecha_partido < fecha del partido (igual que
// el backtest; sin datos del futuro).
// ---------------------------------------------------------------------------
const pool = require("../../db");
const path = require("path");
const { transformar } = require("../cargaEstadisticas");
const {
  TODOS, STATS, GOLES, etiqueta, familiaLiga, baseLiga,
  ridgePredecir, registro, registroVisita, predecirH, featuresLado,
} = require("../../experimentos_fase2t/comun2t");

// FT (= 1T + pred 2T) sólo para stats donde sumar tiene sentido de flujo.
const FT_WHITELIST = new Set([GOLES, "Total shots", "Corner kicks", "Yellow cards"]);

let cache = null;
function cargarModelo2T() {
  if (!cache) {
    try {
      cache = require("../../modelos/prediccion_2t.json");
    } catch {
      return null;
    }
  }
  return cache;
}
function rutaModelo2T() {
  return path.join(__dirname, "..", "..", "modelos", "prediccion_2t.json");
}

const clamp0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? 0 : v < 0 ? 0 : v);
const r2 = (v) => Math.round(v * 100) / 100;

// Lado del equipo en un partido (exacto primero, luego contiene — misma
// tolerancia ILIKE que el resto del proyecto).
function ladoDe(equipo, local, visitante) {
  if (local === equipo) return "home";
  if (visitante === equipo) return "away";
  if (local && equipo && local.toLowerCase().includes(equipo.toLowerCase())) return "home";
  if (visitante && equipo && visitante.toLowerCase().includes(equipo.toLowerCase())) return "away";
  return null;
}

// Media de liga con fallback familia -> base -> global (cutoff en la query).
function mediaLiga(sumsStat, familia, base, campo) {
  const n = campo === "s2" || campo === "s1" ? (campo === "s2" ? "n2" : "n1") : null;
  const f = sumsStat.familias.get(familia);
  if (f && f[n] >= 10) return f[campo] / f[n];
  const b = sumsStat.bases.get(base);
  if (b && b[n] >= 10) return b[campo] / b[n];
  const g = sumsStat.global;
  return g[n] ? g[campo] / g[n] : 0;
}

async function cargarContexto({ local, visitante, fecha, liga }) {
  // 1) Historial de ambos equipos (fecha estrictamente anterior).
  const hist = await pool.query(
    `SELECT id::text AS id, fecha_partido::text AS fecha, equipo_local, equipo_visitante,
            goles_local, goles_visitante, goles_local_1t, goles_visitante_1t, liga
       FROM partidos
      WHERE fecha_partido < $3::date
        AND goles_local IS NOT NULL AND goles_local_1t IS NOT NULL
        AND ((equipo_local ILIKE '%' || $1 || '%' OR equipo_visitante ILIKE '%' || $1 || '%')
          OR (equipo_local ILIKE '%' || $2 || '%' OR equipo_visitante ILIKE '%' || $2 || '%'))
      ORDER BY fecha_partido, id`,
    [local, visitante, fecha]
  );

  const objs = hist.rows.map((r) => ({
    id: r.id,
    fecha: r.fecha,
    ms: Date.parse(r.fecha),
    local: r.equipo_local,
    visitante: r.equipo_visitante,
    liga: r.liga,
    familia: familiaLiga(r.liga),
    base: baseLiga(r.liga),
    g: {
      hl: Number(r.goles_local_1t), ha: Number(r.goles_visitante_1t),
      fl: Number(r.goles_local), fa: Number(r.goles_visitante),
    },
    stats: {},
  }));
  for (const m of objs) {
    m.stats[GOLES] = {
      "1ST": { l: m.g.hl, a: m.g.ha },
      "2ND": { l: m.g.fl - m.g.hl, a: m.g.fa - m.g.ha },
    };
  }

  // 2) Stats 1ST/2ND de esos partidos.
  const ids = objs.map((m) => m.id);
  if (ids.length) {
    const s = await pool.query(
      `SELECT partido_id::text AS partido_id, nombre, periodo,
              max(valor_local_num)::float AS l, max(valor_visitante_num)::float AS a
         FROM estadisticas
        WHERE partido_id = ANY($1) AND periodo IN ('1ST','2ND')
          AND nombre = ANY($2)
          AND valor_local_num IS NOT NULL AND valor_visitante_num IS NOT NULL
        GROUP BY 1,2,3`,
      [ids, STATS]
    );
    const idx = new Map(objs.map((m) => [m.id, m]));
    for (const r of s.rows) {
      const m = idx.get(r.partido_id);
      if (!m) continue;
      if (!m.stats[r.nombre]) m.stats[r.nombre] = {};
      m.stats[r.nombre][r.periodo] = { l: r.l, a: r.a };
    }
  }

  // 3) Sumas por liga de TODAS las stats (cutoff) — para L0/priors.
  const ligaRows = await pool.query(
    `SELECT liga, nombre, periodo, count(*)::int AS n, sum(v)::float AS s
       FROM (
         SELECT p.liga, e.partido_id, e.nombre, e.periodo,
                max((e.valor_local_num + e.valor_visitante_num) / 2) AS v
           FROM estadisticas e
           JOIN partidos p ON p.id = e.partido_id
          WHERE e.periodo IN ('1ST','2ND') AND e.valor_local_num IS NOT NULL
            AND e.nombre = ANY($1) AND p.fecha_partido < $2::date
          GROUP BY p.liga, e.partido_id, e.nombre, e.periodo
       ) t
      GROUP BY 1,2,3`,
    [STATS, fecha]
  );

  // 4) Sumas de liga del pseudo-stat Goles (desde la cabecera).
  const golesRows = await pool.query(
    `SELECT liga, count(*)::int AS n,
            sum(((goles_local - goles_local_1t) + (goles_visitante - goles_visitante_1t)) / 2.0)::float AS s2,
            sum((goles_local_1t + goles_visitante_1t) / 2.0)::float AS s1
       FROM partidos
      WHERE fecha_partido < $1::date
        AND goles_local IS NOT NULL AND goles_local_1t IS NOT NULL
      GROUP BY 1`,
    [fecha]
  );

  const nuevoSums = () => ({ familias: new Map(), bases: new Map(), global: { n2: 0, s2: 0, n1: 0, s1: 0 } });
  const sums = {};
  for (const s of TODOS) sums[s] = nuevoSums();
  const acum = (stat, liga, n2, s2, n1, s1) => {
    const S = sums[stat];
    const fam = familiaLiga(liga), bse = baseLiga(liga);
    if (!S.familias.has(fam)) S.familias.set(fam, { n2: 0, s2: 0, n1: 0, s1: 0 });
    if (!S.bases.has(bse)) S.bases.set(bse, { n2: 0, s2: 0, n1: 0, s1: 0 });
    const f = S.familias.get(fam), bb = S.bases.get(bse);
    f.n2 += n2; f.s2 += s2; f.n1 += n1; f.s1 += s1;
    bb.n2 += n2; bb.s2 += s2; bb.n1 += n1; bb.s1 += s1;
    S.global.n2 += n2; S.global.s2 += s2; S.global.n1 += n1; S.global.s1 += s1;
  };
  for (const r of ligaRows.rows) {
    const n = Number(r.n), s = Number(r.s);
    if (r.periodo === "2ND") acum(r.nombre, r.liga, n, s, 0, 0);
    else acum(r.nombre, r.liga, 0, 0, n, s);
  }
  for (const r of golesRows.rows) {
    const n = Number(r.n);
    acum(GOLES, r.liga, n, Number(r.s2), n, Number(r.s1));
  }

  // 5) Entradas por stat/ equipo (para featuresLado) + registros H.
  const entradas = {};
  for (const stat of TODOS) {
    entradas[stat] = { home: [], away: [] };
    for (const m of objs) {
      const st = m.stats[stat];
      if (!st) continue;
      const t2 = st["2ND"];
      if (!t2) continue;
      const t1 = st["1ST"];
      for (const [eq, lado] of [[local, "home"], [visitante, "away"]]) {
        const dl = ladoDe(eq, m.local, m.visitante);
        if (dl !== lado) continue;
        entradas[stat][lado].push({
          ms: m.ms,
          t1: t1 ? (dl === "home" ? t1.l : t1.a) : null,
          t2: dl === "home" ? t2.l : t2.a,
          rivT2: dl === "home" ? t2.a : t2.l,
          cond: dl,
        });
      }
    }
  }

  const registrosDe = (eq) => objs
    .filter((m) => ladoDe(eq, m.local, m.visitante))
    .map((m) => (ladoDe(eq, m.local, m.visitante) === "home" ? registro(m) : registroVisita(m)));

  return {
    objs, sums, entradas,
    recHome: registrosDe(local),
    recAway: registrosDe(visitante),
    globalGoles: {
      v: sums[GOLES].global.n2 ? sums[GOLES].global.s2 / sums[GOLES].global.n2 : 0,
      n: sums[GOLES].global.n2,
    },
    nHistorial: { local: registrosDe(local).length, visitante: registrosDe(visitante).length },
  };
}

// Predicción completa de un JSON de partido al descanso.
async function predecirArchivo({ nombre, contenido }) {
  const modelo = cargarModelo2T();
  if (!modelo) {
    const e = new Error("Modelo 2T no entrenado (ejecuta: node scripts/entrenar_modelo_2t.js)");
    e.statusCode = 503;
    throw e;
  }

  let json;
  try {
    json = JSON.parse(contenido);
  } catch {
    throw Object.assign(new Error(`no es JSON valido: ${nombre}`), { statusCode: 400 });
  }
  const { evento, filas } = transformar(json); // lanza si no es dump de partido

  const fecha = evento.fecha;
  const local = evento.local, visitante = evento.visitante;
  const advertencias = [];

  // 1T actual del partido desde el dump (period1; fallback al marcador).
  const gHL = evento.golesLocal1T;
  const gHA = evento.golesVisitante1T;
  if (gHL === null || gHA === null) {
    advertencias.push("El JSON no trae goles del 1T (homeScore.period1); se usan 0 en features de goles.");
  }
  const estadoTipo = (json.info.event.status && json.info.event.status.type) || "";
  if (estadoTipo === "finished" || estadoTipo === "aftertime" || estadoTipo === "penalties") {
    advertencias.push("El partido parece finalizado: la proyección es sólo informativa (el 2T ya se jugó).");
  }

  // Stats del 1T (1ST; fallback ALL con advertencia).
  const porNombre = {};
  for (const f of filas) {
    if (f.periodo !== "1ST" && f.periodo !== "ALL") continue;
    if (!porNombre[f.nombre]) porNombre[f.nombre] = {};
    const v = { l: Number(f.valor_local_num ?? 0), a: Number(f.valor_visitante_num ?? 0) };
    if (f.periodo === "1ST") porNombre[f.nombre]["1ST"] = v;
    else if (!porNombre[f.nombre]["ALL"]) porNombre[f.nombre]["ALL"] = v;
  }
  const t1De = (stat) => {
    // El pseudo-stat Goles no viene en stats.statistics: va del marcador 1T.
    if (stat === GOLES) {
      if (gHL === null || gHL === undefined || gHA === null || gHA === undefined) return null;
      return { l: Number(gHL), a: Number(gHA) };
    }
    const p = porNombre[stat] || {};
    return p["1ST"] || p["ALL"] || null;
  };
  const sin1T = TODOS.filter((s) => !t1De(s));

  const ctx = await cargarContexto({ local, visitante, fecha, liga: evento.liga });
  if (!ctx.nHistorial.local) advertencias.push(`Sin historial en la DB para ${local}; se usan priors de liga/global.`);
  if (!ctx.nHistorial.visitante) advertencias.push(`Sin historial en la DB para ${visitante}; se usan priors de liga/global.`);
  if (sin1T.length) {
    advertencias.push(`${sin1T.length} stats sin valor en el 1T del JSON; esas se estiman sólo con historial.`);
  }

  const familia = familiaLiga(evento.liga || ligaFallback(ctx));
  const base = baseLiga(evento.liga || ligaFallback(ctx));
  const gHLn = gHL === null || gHL === undefined ? 0 : Number(gHL);
  const gHAn = gHA === null || gHA === undefined ? 0 : Number(gHA);
  const state = gHLn - gHAn;

  // H (Proyección 2T tradicional) — se calcula una vez; sólo lo consumen los
  // blends de goles/remates/corners con peso H > 0.
  const mH = {
    ms: Date.parse(fecha),
    g: { hl: gHLn, ha: gHAn },
    stats: {},
    local, visitante, fecha,
  };
  for (const s of ["Total shots", "Corner kicks"]) {
    const v = t1De(s);
    if (v) mH.stats[s] = { "1ST": v };
  }
  const H = predecirH(mH, ctx.recHome, ctx.recAway, ctx.globalGoles);
  const Hkey = { [GOLES]: "goles", "Total shots": "remates", "Corner kicks": "corners" };

  const filasPred = [];
  const orden = [
    GOLES, "Total shots", "Corner kicks", "Yellow cards",
    ...TODOS.filter((s) => ![GOLES, "Total shots", "Corner kicks", "Yellow cards"].includes(s)),
  ];
  const sinRidge = [];
  const conFallback = [];

  for (const stat of orden) {
    const info = modelo.stats[stat];
    if (!info) continue;
    const lado0 = t1De(stat);
    const hay1T = lado0 !== null;
    const l2T = mediaLiga(ctx.sums[stat], familia, base, "s2");
    const l1T = mediaLiga(ctx.sums[stat], familia, base, "s1");

    const pred = {};
    let fuente = info.elegido;
    if (!hay1T) {
      fuente = "historial";
      for (const lado of ["home", "away"]) {
        const f = featuresLado({
          h: ctx.entradas[stat][lado], hR: ctx.entradas[stat][lado === "home" ? "away" : "home"],
          own1t: 0, opp1t: 0, stateLado: 0, lado, l2T, l1T,
        });
        pred[lado] = clamp0(f.T);
      }
      conFallback.push(etiqueta(stat));
    } else {
      const own = { home: lado0.l, away: lado0.a };
      const opp = { home: lado0.a, away: lado0.l };
      for (const lado of ["home", "away"]) {
        const f = featuresLado({
          h: ctx.entradas[stat][lado], hR: ctx.entradas[stat][lado === "home" ? "away" : "home"],
          own1t: own[lado], opp1t: opp[lado],
          stateLado: lado === "home" ? state : -state,
          lado, l2T, l1T,
        });
        const comps = { L0: f.L0, T: f.T };
        if (info.ridge) comps.R = clamp0(ridgePredecir(info.ridge, f.feats));
        else sinRidge.push(etiqueta(stat));

        let v;
        if (info.elegido === "B" && info.pesosB && comps.R !== undefined) {
          v = 0;
          for (const [k, w] of Object.entries(info.pesosB)) {
            if (!w) continue;
            if (k === "H") {
              const hk = Hkey[stat];
              v += w * (hk && H[lado] ? H[lado][hk].v : comps.T);
            } else v += w * (comps[k] !== undefined ? comps[k] : comps.T);
          }
        } else if (info.elegido === "TR" && info.pesosTR !== null && comps.R !== undefined) {
          v = info.pesosTR * comps.R + (1 - info.pesosTR) * comps.T;
        } else if (info.elegido === "R" && comps.R !== undefined) {
          v = comps.R;
        } else if (comps.T !== undefined) {
          v = comps.T;
        } else {
          v = comps.L0;
        }
        pred[lado] = clamp0(v);
      }
    }

    const l1 = hay1T ? lado0.l : null, a1 = hay1T ? lado0.a : null;
    const fila = {
      stat,
      etiqueta: etiqueta(stat),
      local1T: l1 === null ? null : r2(l1),
      visita1T: a1 === null ? null : r2(a1),
      predLocal2T: r2(pred.home),
      predVisita2T: r2(pred.away),
      fuente,
    };
    if (FT_WHITELIST.has(stat) && hay1T) {
      fila.ftLocal = r2(l1 + pred.home);
      fila.ftVisita = r2(a1 + pred.away);
      fila.ftTotal = r2(l1 + a1 + pred.home + pred.away);
    }
    filasPred.push(fila);
  }

  if (sinRidge.length) advertencias.push(`Sin ridge entrenado: ${sinRidge.join(", ")} (se usa T).`);
  if (conFallback.length) {
    advertencias.push(`Sin dato 1T en el JSON para: ${conFallback.join(", ")} — estimadas con historial/priors.`);
  }

  const backtestPrincipales = {};
  for (const s of [GOLES, "Total shots", "Corner kicks", "Yellow cards"]) {
    const info = modelo.stats[s];
    if (info && info.backtest) {
      backtestPrincipales[etiqueta(s)] = {
        mae_modelo_TEST: info.backtest.TEST && info.backtest.TEST.M ? info.backtest.TEST.M.mae : null,
        mae_proyeccion2T_TEST: info.backtest.TEST && info.backtest.TEST.H ? info.backtest.TEST.H.mae : null,
        mae_mejor_baseline_TEST: info.backtest.TEST
          ? Math.min(
              info.backtest.TEST.T ? info.backtest.TEST.T.mae : Infinity,
              info.backtest.TEST.L0 ? info.backtest.TEST.L0.mae : Infinity)
          : null,
      };
    }
  }

  return {
    archivo: nombre,
    partido: {
      id: String(evento.id),
      local, visitante, fecha, liga: evento.liga,
      jornada: evento.jornada, estado: evento.estado,
    },
    goles1T: { local: gHL, visita: gHA },
    historial: {
      local: ctx.nHistorial.local,
      visitante: ctx.nHistorial.visitante,
    },
    filas: filasPred,
    advertencias,
    modelo: {
      name: "Modelo análisis 2T",
      version: modelo.version,
      entrenadoEn: modelo.entrenadoEn,
      backtestPrincipales,
    },
  };
}

function ligaFallback(ctx) {
  // Si el JSON no trae liga, cae a la liga más frecuente del historial.
  const cuenta = {};
  for (const m of ctx.objs) if (m.liga) cuenta[m.liga] = (cuenta[m.liga] || 0) + 1;
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] || "General";
}

// files: [{nombre, contenido}] — procesa todos; nunca lanza por archivo.
async function predecirLote2T(files) {
  const resultados = [];
  for (const f of files) {
    try {
      resultados.push({ accion: "ok", ...(await predecirArchivo(f)) });
    } catch (e) {
      resultados.push({
        accion: "error",
        archivo: f.nombre,
        message: e.message,
      });
    }
  }
  return {
    resultados,
    resumen: {
      archivos: resultados.length,
      ok: resultados.filter((r) => r.accion === "ok").length,
      errores: resultados.filter((r) => r.accion === "error").length,
    },
  };
}

module.exports = { predecirLote2T, predecirArchivo, cargarModelo2T, rutaModelo2T };
