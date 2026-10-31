// ---------------------------------------------------------------------------
// FASE 2T-3 — ¿la tarjeta roja en el 1T mejora la proyección del 2T?
//
// Fuente de la roja: estadisticas "Red cards" por periodo y lado (la fila sólo
// existe si hubo roja en el partido; ausencia = 0). Se valida contra
// incidentes_tarjetas (minuto 1..45, no anulada) donde hay incidencias.
//
// REGLAS PRE-REGISTRADAS
//  R1 Fuente principal: estadisticas Red cards 1ST (lado local/visita).
//  R2 Splits temporales 70/15/15 por fecha (mismo protocolo que fase2t_0):
//     TRAIN ajusta, VAL selecciona, TEST sólo lectura final.
//  R3 Baseline B0 = modelo M actual por stat (ridge TRAIN, alpha/TR/B en VAL).
//  R4 Candidatos:
//     C1 multiplicador post-hoc para partidos con roja en 1T: kOwn (equipo con
//        roja) y kOpp (rival), ajustados por grid en TRAIN y aplicados a B0.
//        No toca los partidos sin roja.
//     C2 ridge con 2 features extra (rojas propias/rival en 1T); se rehace
//        alpha/TR/B y la selección en VAL.
//  R5 Éxito: en el subconjunto con roja (VAL+TEST fuera de muestra) C1 o C2
//     baja el MAE vs B0 en Goles/Remates/Corners/Amarillas, sin degradar el
//     subconjunto sin roja (C1 lo deja idéntico por construcción).
//  R6 Métrica principal MAE; también RMSE y bias. Se reporta estabilidad en 4
//     ventanas temporales (multiplicador reajustado sólo con datos previos).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const {
  TODOS, etiqueta, cargarDataset, partirSplits,
  ridgeFit, ridgePredecir,
  registro, registroVisita, predecirH, construirFilas,
} = require("./comun2t");

const MERCADOS = ["Goles", "Total shots", "Corner kicks", "Yellow cards", "Expected goals"];
const HKEY = { Goles: "goles", "Total shots": "remates", "Corner kicks": "corners" };
const ALPHAS = [1, 5, 20, 100];
const GRID = { min: 0.3, max: 2.0, paso: 0.05 };
const ESTADOS = ["ganando", "empatando", "perdiendo"];
const FUERZAS = ["fuerte", "debil"];
const r4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);
const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(2) : null);
const clamp0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? 0 : v < 0 ? 0 : v);

function met(preds, y) {
  const n = y.length;
  if (!n) return { n: 0, mae: null, rmse: null, bias: null };
  let mae = 0, se = 0, bias = 0;
  for (let i = 0; i < n; i++) {
    const e = preds[i] - y[i];
    mae += Math.abs(e); se += e * e; bias += e;
  }
  return { n, mae: mae / n, rmse: Math.sqrt(se / n), bias: bias / n };
}

function fmt(m) {
  return m && m.n ? { n: m.n, mae: r4(m.mae), rmse: r4(m.rmse), bias: r4(m.bias) } : { n: 0 };
}

// ---------------------------------------------------------------------------
// Features de roja por fila (lado propio / lado rival en el 1T).
// ---------------------------------------------------------------------------
const rojasOwn = (f) => (f.lado === "home" ? Number(f.m.red.h1) : Number(f.m.red.a1));
const rojasOpp = (f) => (f.lado === "home" ? Number(f.m.red.a1) : Number(f.m.red.h1));
const conRoja = (f) => rojasOwn(f) > 0 || rojasOpp(f) > 0;

// Estado del marcador al descanso desde la perspectiva de la fila.
function estadoPropio(f) {
  const d = f.lado === "home" ? f.m.g.hl - f.m.g.ha : f.m.g.ha - f.m.g.hl;
  return d > 0 ? "ganando" : d < 0 ? "perdiendo" : "empatando";
}

// Celda desde la perspectiva del equipo que recibe la roja:
// estado (ganando/empatando/perdiendo) x fuerza relativa (fuerte/debil).
// La fuerza sale del historial 2T de goles con cutoff (sin fuga): team2T-rival.
function celdaRoja(f) {
  const e = estadoPropio(f);
  const fuerte = Number(f.fuerza) >= 0;
  if (rojasOwn(f) > 0) return `${e}|${fuerte ? "fuerte" : "debil"}`;
  if (rojasOpp(f) > 0) {
    const estadoRival = e === "ganando" ? "perdiendo" : e === "perdiendo" ? "ganando" : "empatando";
    return `${estadoRival}|${fuerte ? "debil" : "fuerte"}`;
  }
  return null;
}

const SHRINK_CELDA = 10; // encoge el multiplicador de cada celda hacia el pooled

// Multiplicadores por celda para el equipo con roja (own) y su rival (opp).
function ajustarCondicional(trainRed, predKey, pooled) {
  const out = new Map();
  for (const role of ["own", "opp"]) {
    const tieneRol = (f) => (role === "own" ? rojasOwn(f) > 0 : rojasOpp(f) > 0);
    const rows = trainRed.filter((f) => tieneRol(f) && celdaRoja(f));
    const celdas = [...new Set(rows.map((f) => celdaRoja(f)))];
    for (const celda of celdas) {
      const sub = rows.filter((f) => celdaRoja(f) === celda);
      let bestK = 1, bv = Infinity;
      for (let k = GRID.min; k <= GRID.max + 1e-9; k += GRID.paso) {
        let e = 0;
        for (const f of sub) {
          const otro = role === "own"
            ? (rojasOpp(f) > 0 ? pooled.kOpp : 1)
            : (rojasOwn(f) > 0 ? pooled.kOwn : 1);
          e += Math.abs(f.pred[predKey] * k * otro - f.label);
        }
        const mae = e / sub.length;
        if (mae < bv) { bv = mae; bestK = k; }
      }
      const poolK = role === "own" ? pooled.kOwn : pooled.kOpp;
      const n = sub.length;
      const k = n >= 3 ? (n * bestK + SHRINK_CELDA * poolK) / (n + SHRINK_CELDA) : poolK;
      out.set(`${role}|${celda}`, { k: +k.toFixed(3), kFit: +bestK.toFixed(2), n, celda });
    }
  }
  return out;
}

function factorC3(f, cond, pooled) {
  if (!conRoja(f)) return 1;
  let factor = 1;
  const celda = celdaRoja(f);
  if (rojasOwn(f) > 0) factor *= cond.get(`own|${celda}`)?.k ?? pooled.kOwn;
  if (rojasOpp(f) > 0) factor *= cond.get(`opp|${celda}`)?.k ?? pooled.kOpp;
  return factor;
}

// Efectos principales (sin interacción): ajuste por estado y por fuerza,
// encogidos hacia 1; cada uno se estima con todas las filas de su rol.
function ajustarEfectos(trainRed, predKey, pooled) {
  const out = {};
  for (const role of ["own", "opp"]) {
    const tieneRol = (f) => (role === "own" ? rojasOwn(f) > 0 : rojasOpp(f) > 0);
    const rows = trainRed.filter((f) => tieneRol(f) && celdaRoja(f));
    if (!rows.length) { out[role] = null; continue; }
    const a = Object.fromEntries(ESTADOS.map((e) => [e, 1]));
    const b = Object.fromEntries(FUERZAS.map((g) => [g, 1]));
    const poolK = role === "own" ? pooled.kOwn : pooled.kOpp;
    const otro = (f) => role === "own"
      ? (rojasOpp(f) > 0 ? pooled.kOpp : 1)
      : (rojasOwn(f) > 0 ? pooled.kOwn : 1);
    for (let it = 0; it < 3; it++) {
      for (const e of ESTADOS) {
        const sub = rows.filter((f) => celdaRoja(f).startsWith(e + "|"));
        if (!sub.length) continue;
        let best = 1, bv = Infinity;
        for (let k = 0.7; k <= 1.3001; k += 0.05) {
          let err = 0;
          for (const f of sub) {
            const g = celdaRoja(f).split("|")[1];
            err += Math.abs(f.pred[predKey] * poolK * k * b[g] * otro(f) - f.label);
          }
          const mae = err / sub.length;
          if (mae < bv) { bv = mae; best = k; }
        }
        a[e] = (sub.length * best + SHRINK_CELDA) / (sub.length + SHRINK_CELDA);
      }
      for (const g of FUERZAS) {
        const sub = rows.filter((f) => celdaRoja(f).endsWith("|" + g));
        if (!sub.length) continue;
        let best = 1, bv = Infinity;
        for (let k = 0.7; k <= 1.3001; k += 0.05) {
          let err = 0;
          for (const f of sub) {
            const e = celdaRoja(f).split("|")[0];
            err += Math.abs(f.pred[predKey] * poolK * a[e] * k * otro(f) - f.label);
          }
          const mae = err / sub.length;
          if (mae < bv) { bv = mae; best = k; }
        }
        b[g] = (sub.length * best + SHRINK_CELDA) / (sub.length + SHRINK_CELDA);
      }
    }
    out[role] = { a, b, n: rows.length };
  }
  return out;
}

function factorC4(f, ef, pooled) {
  if (!conRoja(f)) return 1;
  const [estado, fuerza] = celdaRoja(f).split("|");
  let factor = 1;
  if (rojasOwn(f) > 0) {
    const o = ef?.own;
    factor *= pooled.kOwn * (o ? o.a[estado] * o.b[fuerza] : 1);
  }
  if (rojasOpp(f) > 0) {
    const o = ef?.opp;
    factor *= pooled.kOpp * (o ? o.a[estado] * o.b[fuerza] : 1);
  }
  return factor;
}

// Entrena/selecciona como en fase2t_0 y devuelve predicciones por fila.
function entrenar(filas, featKey) {
  const feats = (f) => f[featKey];
  const tr = filas.filter((f) => f.split === "TRAIN");
  const va = filas.filter((f) => f.split === "VAL");

  let best = null;
  for (const alpha of ALPHAS) {
    const mod = ridgeFit(tr.map(feats), tr.map((f) => f.label), alpha);
    if (!mod) continue;
    const m = met(va.map((f) => clamp0(ridgePredecir(mod, feats(f)))), va.map((f) => f.label));
    if (!best || m.mae < best.mae) best = { alpha, mod, mae: m.mae };
  }

  const preds = new Map();
  for (const f of filas) {
    const o = { T: f.T, L0: f.L0 };
    if (best) o.R = clamp0(ridgePredecir(best.mod, feats(f)));
    if (f.H !== undefined) o.H = f.H;
    preds.set(f, o);
  }

  let wTR = null;
  if (best) {
    let bw = 0, bv = Infinity;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      const m = met(va.map((f) => clamp0(w * preds.get(f).R + (1 - w) * preds.get(f).T)), va.map((f) => f.label));
      if (m.mae < bv) { bv = m.mae; bw = w; }
    }
    wTR = bw;
    for (const f of filas) preds.get(f).TR = clamp0(bw * preds.get(f).R + (1 - bw) * preds.get(f).T);
  }

  let wB = null;
  {
    const comps = ["L0", "T"];
    if (best) comps.push("R");
    if (filas.some((f) => f.H !== undefined)) comps.push("H");
    const val = (f, c) => (c === "H" ? f.H : c === "R" ? (preds.get(f).R ?? preds.get(f).T) : preds.get(f)[c]);
    let bestW = null, bv = Infinity;
    const w = new Array(comps.length).fill(0);
    const iterar = (i, resto) => {
      if (i === comps.length - 1) {
        w[i] = resto;
        if (w[i] < -0.0001) return;
        const m = met(va.map((f) => clamp0(comps.reduce((s, c, k) => s + Math.max(w[k], 0) * val(f, c), 0))), va.map((f) => f.label));
        if (m.mae < bv) { bv = m.mae; bestW = [...w]; }
        return;
      }
      for (let x = 0; x <= resto + 0.0001; x += 0.05) { w[i] = x; iterar(i + 1, resto - x); }
    };
    iterar(0, 1);
    if (bestW) {
      wB = Object.fromEntries(comps.map((c, i) => [c, Math.max(bestW[i], 0)]));
      for (const f of filas) preds.get(f).B = clamp0(comps.reduce((s, c) => s + wB[c] * val(f, c), 0));
    }
  }

  const candidatos = ["T", "R", "TR"].filter((c) => filas.some((f) => preds.get(f)[c] !== undefined));
  if (wB) candidatos.push("B");
  let elegido = "T", valMejor = Infinity;
  for (const c of candidatos) {
    const xs = va.filter((f) => preds.get(f)[c] !== undefined);
    const m = met(xs.map((f) => preds.get(f)[c]), xs.map((f) => f.label));
    if (m.n && m.mae < valMejor) { valMejor = m.mae; elegido = c; }
  }
  for (const f of filas) preds.get(f).M = preds.get(f)[elegido];
  return { elegido, alpha: best?.alpha ?? null, wTR, wB, valMAE: valMejor, preds };
}

// Grid de multiplicadores para filas con roja en 1T (TRAIN).
function ajustarMultiplicadores(trainRed, predKey) {
  let best = { kOwn: 1, kOpp: 1, mae: Infinity };
  for (let kOwn = GRID.min; kOwn <= GRID.max + 1e-9; kOwn += GRID.paso) {
    for (let kOpp = GRID.min; kOpp <= GRID.max + 1e-9; kOpp += GRID.paso) {
      let e = 0;
      for (const f of trainRed) {
        const factor = (rojasOwn(f) > 0 ? kOwn : 1) * (rojasOpp(f) > 0 ? kOpp : 1);
        e += Math.abs(f.pred[predKey] * factor - f.label);
      }
      const mae = e / trainRed.length;
      if (mae < best.mae) best = { kOwn: +kOwn.toFixed(2), kOpp: +kOpp.toFixed(2), mae };
    }
  }
  return best;
}

const factorDe = (f, { kOwn, kOpp }) =>
  (rojasOwn(f) > 0 ? kOwn : 1) * (rojasOpp(f) > 0 ? kOpp : 1);

function evalSub(filas, key, split, sub) {
  const xs = filas.filter((f) => {
    if (f.split !== split || f.pred[key] === undefined) return false;
    if (sub === "red") return conRoja(f);
    if (sub === "nonred") return !conRoja(f);
    if (sub === "own") return rojasOwn(f) > 0;
    if (sub === "opp") return rojasOpp(f) > 0;
    return true;
  });
  return fmt(met(xs.map((f) => f.pred[key]), xs.map((f) => f.label)));
}

function bloque(filas, key, split) {
  return {
    all: evalSub(filas, key, split, "all"),
    red: evalSub(filas, key, split, "red"),
    nonred: evalSub(filas, key, split, "nonred"),
    own: evalSub(filas, key, split, "own"),
    opp: evalSub(filas, key, split, "opp"),
  };
}

// ---------------------------------------------------------------------------
(async () => {
  console.log("Cargando dataset 2T…");
  const partidos = await cargarDataset();
  const splits = partirSplits(partidos);

  // Rojas 1T/2T desde estadisticas (ausencia = 0).
  const rojasRows = await pool.query(
    `SELECT partido_id::text AS id,
            max(valor_local_num) FILTER (WHERE periodo='1ST')::int AS h1,
            max(valor_visitante_num) FILTER (WHERE periodo='1ST')::int AS a1,
            max(valor_local_num) FILTER (WHERE periodo='2ND')::int AS h2,
            max(valor_visitante_num) FILTER (WHERE periodo='2ND')::int AS a2
       FROM estadisticas WHERE nombre='Red cards' GROUP BY 1`
  );
  const rojas = new Map(rojasRows.rows.map((r) => [r.id, r]));
  for (const m of partidos) {
    const r = rojas.get(m.id) || {};
    m.red = { h1: Number(r.h1 || 0), a1: Number(r.a1 || 0), h2: Number(r.h2 || 0), a2: Number(r.a2 || 0) };
  }
  const redMatches = partidos.filter((m) => m.red.h1 + m.red.a1 > 0);

  // Validación contra incidentes donde existan.
  const incRows = await pool.query(
    `SELECT partido_id::text AS id, equipo,
            count(*) FILTER (WHERE tarjeta IN ('red','second_yellow') AND COALESCE(anulada,false)=false AND minuto BETWEEN 1 AND 45)::int AS r
       FROM incidentes_tarjetas GROUP BY 1,2`
  );
  const inc = new Map();
  for (const r of incRows.rows) {
    if (!inc.has(r.id)) inc.set(r.id, { h: 0, a: 0 });
    inc.get(r.id)[r.equipo === "home" ? "h" : "a"] = r.r;
  }
  let incVal = 0, incAcuerdo = 0;
  for (const m of partidos) {
    const i = inc.get(m.id);
    if (!i) continue;
    incVal++;
    if ((i.h + i.a > 0) === (m.red.h1 + m.red.a1 > 0)) incAcuerdo++;
  }

  // Historial H (proyección 2T tradicional) con cutoff por fecha.
  const hist = new Map(), hPred = new Map();
  const gg = { n: 0, s: 0 };
  for (const m of partidos) {
    const h = hist.get(m.local) || [], a = hist.get(m.visitante) || [];
    hPred.set(m.id, predecirH(m, h, a, { v: gg.n ? gg.s / gg.n : 0, n: gg.n }));
    h.push(registro(m)); a.push(registroVisita(m));
    hist.set(m.local, h); hist.set(m.visitante, a);
    gg.n += 2; gg.s += (m.g.fl - m.g.hl) + (m.g.fa - m.g.ha);
  }

  // Fuerza relativa sin fuga: team2T propio - team2T rival del mercado Goles
  // (features 3 y 6), calculada con cutoff por fecha.
  const filasG = construirFilas(partidos, "Goles");
  const fuerza = new Map();
  for (const f of filasG) fuerza.set(`${f.m.id}|${f.lado}`, f.feats[3] - f.feats[6]);

  // Estado del marcador al minuto exacto de la roja (sólo donde hay incidencias).
  const partidoPorId = new Map(partidos.map((m) => [m.id, m]));
  const golesInc = await pool.query(
    `SELECT partido_id::text AS id, minuto, minuto_extra, marcador_h, marcador_a
       FROM incidentes_goles ORDER BY partido_id, minuto, minuto_extra`
  );
  const golesPor = new Map();
  for (const g of golesInc.rows) {
    if (!golesPor.has(g.id)) golesPor.set(g.id, []);
    golesPor.get(g.id).push(g);
  }
  const rojasInc = await pool.query(
    `SELECT partido_id::text AS id, equipo, minuto, minuto_extra
       FROM incidentes_tarjetas
      WHERE tarjeta IN ('red','second_yellow') AND COALESCE(anulada,false)=false
        AND minuto BETWEEN 1 AND 45`
  );
  const validacionEstado = { n: 0, acuerdo: 0, celdas: {} };
  for (const r of rojasInc.rows) {
    const m = partidoPorId.get(r.id);
    if (!m) continue;
    const goles = golesPor.get(r.id) || [];
    let h = 0, a = 0;
    for (const g of goles) {
      const antes = g.minuto < r.minuto || (g.minuto === r.minuto && (g.minuto_extra || 0) < (r.minuto_extra || 0));
      if (antes) { h = Number(g.marcador_h); a = Number(g.marcador_a); }
    }
    const diffRoja = r.equipo === "home" ? h - a : a - h;
    const diffHT = r.equipo === "home" ? m.g.hl - m.g.ha : m.g.ha - m.g.hl;
    const est = (d) => (d > 0 ? "ganando" : d < 0 ? "perdiendo" : "empatando");
    const key = `${est(diffRoja)}|${est(diffHT)}`;
    validacionEstado.n++;
    if (est(diffRoja) === est(diffHT)) validacionEstado.acuerdo++;
    validacionEstado.celdas[key] = (validacionEstado.celdas[key] || 0) + 1;
  }
  validacionEstado.nota =
    "estado_en_roja|estado_al_descanso en los partidos con incidencias (30 rojas 1T); " +
    "el experimento condiciona por estado al descanso porque estadisticas no trae minuto.";

  const informe = {
    fase: "2T-3 roja en el 1T",
    generadoEn: new Date().toISOString(),
    nota_deltas:
      "Los % de 'veredicto' son (candidato - B0)/B0 sobre MAE en el subconjunto CON roja 1T: " +
      "negativo = mejora (menos error). El subconjunto 'all' incluye todos los partidos.",
    dataset: {
      fuente: "DB local: partidos + estadisticas 1ST/2ND + Red cards 1ST",
      partidos: partidos.length,
      splits,
      conRoja1T: redMatches.length,
      validacionIncidentes: { partidosConIncidencias: incVal, acuerdo: incAcuerdo },
      validacionEstadoRoja: validacionEstado,
      nota_desacuerdo:
        "Se usa estadisticas Red cards (periodo/lado); incidentes sólo valida cuando existe. " +
        "En 10 partidos incidentes no marca roja 1T pero la stat sí (casos de borde 45+/fuera de campo).",
    },
    reglas: {
      R1: "Roja 1T desde estadisticas 'Red cards' (ausencia=0)",
      R2: "Splits 70/15/15 por fecha; TEST sólo lectura final",
      R3: "B0 = modelo M actual por stat (ridge TRAIN, alpha/TR/B en VAL)",
      R4: "C1 multiplicador pooled kOwn/kOpp; C2 ridge con rojas; C3 celdas estado x fuerza (encogidas al pooled); C4 efectos principales de estado y fuerza (sin interacción)",
      R5: "Éxito = mejora MAE con roja (VAL+TEST) sin degradar sin roja",
      R6: "MAE principal; RMSE/bias; 4 ventanas temporales; validación del estado al minuto de la roja con incidencias",
    },
    mercados: {},
  };

  for (const stat of MERCADOS) {
    console.log("Mercado:", stat);
    const filas = construirFilas(partidos, stat);
    for (const f of filas) {
      f.split = f.m.split;
      f.fuerza = fuerza.get(`${f.m.id}|${f.lado}`) ?? 0;
      f.featsRed = [...f.feats, rojasOwn(f), rojasOpp(f)];
      f.pred = {};
      if (HKEY[stat]) f.H = hPred.get(f.m.id)[f.lado][HKEY[stat]].v;
    }

    const b0 = entrenar(filas, "feats");
    for (const f of filas) f.pred.B0 = b0.preds.get(f).M;

    const c2 = entrenar(filas, "featsRed");
    for (const f of filas) f.pred.C2 = c2.preds.get(f).M;

    const trainRed = filas.filter((f) => f.split === "TRAIN" && conRoja(f));
    const mult = trainRed.length >= 20 ? ajustarMultiplicadores(trainRed, "B0") : { kOwn: 1, kOpp: 1, mae: null, n: trainRed.length };
    for (const f of filas) f.pred.C1 = clamp0(f.pred.B0 * factorDe(f, mult));

    const cond = trainRed.length >= 20 ? ajustarCondicional(trainRed, "B0", mult) : null;
    for (const f of filas) f.pred.C3 = cond ? clamp0(f.pred.B0 * factorC3(f, cond, mult)) : f.pred.C1;

    const ef = trainRed.length >= 20 ? ajustarEfectos(trainRed, "B0", mult) : null;
    for (const f of filas) f.pred.C4 = ef ? clamp0(f.pred.B0 * factorC4(f, ef, mult)) : f.pred.C1;

    // Diagnóstico: etiqueta media / predicha media en TRAIN con roja.
    const ratio = (sub) => {
      const xs = filas.filter((f) => f.split === "TRAIN" && sub(f));
      const sy = xs.reduce((s, f) => s + f.label, 0);
      const sp = xs.reduce((s, f) => s + f.pred.B0, 0);
      return { n: xs.length, ratio: sp ? r2(sy / sp) : null };
    };

    const val = {
      B0: bloque(filas, "B0", "VAL"),
      C1: bloque(filas, "C1", "VAL"),
      C2: bloque(filas, "C2", "VAL"),
      C3: bloque(filas, "C3", "VAL"),
      C4: bloque(filas, "C4", "VAL"),
    };
    const test = {
      B0: bloque(filas, "B0", "TEST"),
      C1: bloque(filas, "C1", "TEST"),
      C2: bloque(filas, "C2", "TEST"),
      C3: bloque(filas, "C3", "TEST"),
      C4: bloque(filas, "C4", "TEST"),
    };

    // Pool VAL+TEST (fuera de muestra) para el subconjunto con roja.
    const poolRed = (key) => {
      const xs = filas.filter((f) => (f.split === "VAL" || f.split === "TEST") && f.pred[key] !== undefined);
      return {
        all: fmt(met(xs.map((f) => f.pred[key]), xs.map((f) => f.label))),
        red: fmt(met(xs.filter(conRoja).map((f) => f.pred[key]), xs.filter(conRoja).map((f) => f.label))),
      };
    };
    const pool = { B0: poolRed("B0"), C1: poolRed("C1"), C2: poolRed("C2"), C3: poolRed("C3"), C4: poolRed("C4") };

    // Detalle por celda (roja propia/rival x estado x fuerza) en VAL+TEST.
    const accCelda = {};
    for (const f of filas) {
      if (f.split !== "VAL" && f.split !== "TEST") continue;
      if (!conRoja(f)) continue;
      const role = rojasOwn(f) > 0 ? "own" : "opp";
      const key = `${role}|${celdaRoja(f)}`;
      const a = (accCelda[key] ||= { n: 0, e: { B0: 0, C1: 0, C2: 0, C3: 0, C4: 0 } });
      a.n++;
      for (const k of ["B0", "C1", "C2", "C3", "C4"]) a.e[k] += Math.abs(f.pred[k] - f.label);
    }
    const porCelda = Object.fromEntries(
      Object.entries(accCelda).map(([k, a]) => [
        k,
        {
          n: a.n, B0: r4(a.e.B0 / a.n), C1: r4(a.e.C1 / a.n),
          C2: r4(a.e.C2 / a.n), C3: r4(a.e.C3 / a.n), C4: r4(a.e.C4 / a.n),
        },
      ])
    );

    // Sensibilidad del kOwn (goles): evita depender del borde del grid.
    let sensibilidadKOwn = null;
    if (stat === "Goles") {
      sensibilidadKOwn = [];
      for (const kOwn of [0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7]) {
        const pred = (f) => clamp0(f.pred.B0 * ((rojasOwn(f) > 0 ? kOwn : 1) * (rojasOpp(f) > 0 ? mult.kOpp : 1)));
        const ev = (split) => {
          const xs = filas.filter((f) => f.split === split && conRoja(f));
          return fmt(met(xs.map(pred), xs.map((f) => f.label)));
        };
        sensibilidadKOwn.push({ kOwn, kOpp: mult.kOpp, VAL: ev("VAL"), TEST: ev("TEST") });
      }
    }

    // Ventanas temporales: 4 bloques en el último 60% del dataset; el
    // multiplicador se reajusta sólo con rojas anteriores a cada bloque.
    const conRedB0 = filas.filter(conRoja).sort((a, b) => a.m.ms - b.m.ms);
    const i0 = Math.floor(partidos.length * 0.4);
    const bloques = [];
    const tam = Math.max(1, Math.floor((partidos.length - i0) / 4));
    for (let w = 0; w < 4; w++) {
      const desde = i0 + w * tam, hasta = w === 3 ? partidos.length : i0 + (w + 1) * tam;
      const inicioMs = partidos[desde]?.ms ?? Infinity;
      const finMs = hasta < partidos.length ? partidos[hasta].ms : Infinity;
      const prev = conRedB0.filter((f) => f.m.ms < inicioMs);
      const enVentana = filas.filter((f) => conRoja(f) && f.m.ms >= inicioMs && f.m.ms < finMs);
      if (prev.length < 20 || !enVentana.length) { bloques.push({ w: w + 1, n: enVentana.length, sinDatos: true }); continue; }
      const mm = ajustarMultiplicadores(prev, "B0");
      const cc = ajustarCondicional(prev, "B0", mm);
      const ee = ajustarEfectos(prev, "B0", mm);
      let eb = 0, ec = 0, e3 = 0, e4 = 0;
      for (const f of enVentana) {
        eb += Math.abs(f.pred.B0 - f.label);
        ec += Math.abs(clamp0(f.pred.B0 * factorDe(f, mm)) - f.label);
        e3 += Math.abs(clamp0(f.pred.B0 * factorC3(f, cc, mm)) - f.label);
        e4 += Math.abs(clamp0(f.pred.B0 * factorC4(f, ee, mm)) - f.label);
      }
      const maeB0 = eb / enVentana.length, maeC1 = ec / enVentana.length;
      const maeC3 = e3 / enVentana.length, maeC4 = e4 / enVentana.length;
      bloques.push({
        w: w + 1, n: enVentana.length, kOwn: mm.kOwn, kOpp: mm.kOpp,
        maeB0: r4(maeB0), maeC1: r4(maeC1), maeC3: r4(maeC3), maeC4: r4(maeC4),
        deltaPct: pct(maeC1, maeB0), deltaC3Pct: pct(maeC3, maeB0), deltaC4Pct: pct(maeC4, maeB0),
        gana: maeC1 < maeB0, ganaC3: maeC3 < maeB0, ganaC4: maeC4 < maeB0,
      });
    }

    informe.mercados[stat] = {
      etiqueta: etiqueta(stat),
      baseline: { elegido: b0.elegido, alpha: b0.alpha, pesosTR: b0.wTR, pesosB: b0.wB },
      candidatoRidge: { elegido: c2.elegido, alpha: c2.alpha, pesosTR: c2.wTR, pesosB: c2.wB },
      n: {
        filas: filas.length,
        trainRed: trainRed.length,
        valRed: filas.filter((f) => f.split === "VAL" && conRoja(f)).length,
        testRed: filas.filter((f) => f.split === "TEST" && conRoja(f)).length,
      },
      diagnosticoTrain: { conRojaPropia: ratio((f) => rojasOwn(f) > 0), conRojaRival: ratio((f) => rojasOpp(f) > 0) },
      C1: { factores: { kOwn: mult.kOwn, kOpp: mult.kOpp }, VAL: val.C1, TEST: test.C1, pool: pool.C1 },
      C2: { VAL: val.C2, TEST: test.C2, pool: pool.C2 },
      C3: {
        celdas: cond ? Object.fromEntries(cond) : null,
        VAL: val.C3, TEST: test.C3, pool: pool.C3, porCelda,
      },
      C4: { efectos: ef, VAL: val.C4, TEST: test.C4, pool: pool.C4 },
      sensibilidadKOwn,
      B0: { VAL: val.B0, TEST: test.B0, pool: pool.B0 },
      ventanas: bloques,
      veredicto: {
        C1_red_pool: pct(pool.C1.red.mae, pool.B0.red.mae),
        C2_red_pool: pct(pool.C2.red.mae, pool.B0.red.mae),
        C3_red_pool: pct(pool.C3.red.mae, pool.B0.red.mae),
        C4_red_pool: pct(pool.C4.red.mae, pool.B0.red.mae),
        C1_all_pool: pct(pool.C1.all.mae, pool.B0.all.mae),
        C2_all_pool: pct(pool.C2.all.mae, pool.B0.all.mae),
        C3_all_pool: pct(pool.C3.all.mae, pool.B0.all.mae),
        C4_all_pool: pct(pool.C4.all.mae, pool.B0.all.mae),
        C1_red_test: pct(test.C1.red.mae, test.B0.red.mae),
        C2_red_test: pct(test.C2.red.mae, test.B0.red.mae),
        C3_red_test: pct(test.C3.red.mae, test.B0.red.mae),
        C4_red_test: pct(test.C4.red.mae, test.B0.red.mae),
        C1_ventanas_gana: `${bloques.filter((b) => b.gana).length}/${bloques.filter((b) => !b.sinDatos).length}`,
        C3_ventanas_gana: `${bloques.filter((b) => b.ganaC3).length}/${bloques.filter((b) => !b.sinDatos).length}`,
        C4_ventanas_gana: `${bloques.filter((b) => b.ganaC4).length}/${bloques.filter((b) => !b.sinDatos).length}`,
      },
    };

    console.log("  B0:", b0.elegido, "| C2:", c2.elegido, "| roja TRAIN/VAL/TEST:",
      trainRed.length, informe.mercados[stat].n.valRed, informe.mercados[stat].n.testRed);
    console.log("  C1 red pool:", informe.mercados[stat].veredicto.C1_red_pool + "%",
      "| C2:", informe.mercados[stat].veredicto.C2_red_pool + "%",
      "| C3:", informe.mercados[stat].veredicto.C3_red_pool + "%",
      "| C4:", informe.mercados[stat].veredicto.C4_red_pool + "%",
      "| ventanas C1/C3/C4:", informe.mercados[stat].veredicto.C1_ventanas_gana,
      informe.mercados[stat].veredicto.C3_ventanas_gana,
      informe.mercados[stat].veredicto.C4_ventanas_gana);
  }

  const outDir = path.join(__dirname, "informes");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "fase2t_3_roja_1t.json");
  fs.writeFileSync(out, JSON.stringify(informe, null, 2));
  console.log("\nInforme:", out);
  await pool.end();
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
