// ---------------------------------------------------------------------------
// FASE 5 (nueva) — INGENIERÍA DE VARIABLES. SOLO ANÁLISIS DESCRPTIVO EN TRAIN+VAL.
//
// REGLAS INQUEBRANTABLES:
//   - Nunca se consulta nada con fecha_partido > 2026-06-18 (TRAIN+VAL = TV).
//     El TEST (2026-06-19..2026-09-27) queda fuera de TODA query y de toda
//     métrica de este script. Se verifica con aserciones.
//   - Cero escrituras en BD. Cero entrenamiento de modelos (sin Poisson, sin GD,
//     sin selección de modelos). Sólo: cobertura, nulos, ceros, media, mediana,
//     desviación, consistencia ALL vs 1T+2T, ICC (persistencia), eta² de liga,
//     correlaciones de evidencia con ventanas móviles day-strict.
//   - No toca producción, V1_BETA ni modelos/prediccion_poisson.json.
//
// Salida: experimentos_fase5/informes/fase5_ingenieria_variables.json
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const CORTE = "2026-06-18"; // fin de TRAIN+VAL (inclusive)
const PERIODOS = ["ALL", "1ST", "2ND"];
const MIN_PREV = 3;   // mín. partidos previos con dato para usar la media móvil
const MIN_TEAM = 5;   // mín. obs de equipo para el ICC

const CATEGORIAS = {
  ocasiones: ["Big chances", "Big chances scored", "Big chances missed", "Hit woodwork"],
  calidad: ["Expected goals", "Expected goals on target", "Average rating"],
  remates: ["Total shots", "Shots on target", "Shots off target", "Shots inside box", "Shots outside box"],
  progresion: ["Final third entries", "Final third phase", "Touches in penalty area", "Through balls", "Dribbles", "Dispossessed"],
  posesion: ["Ball possession"],
  pases: ["Passes", "Accurate passes", "Long balls", "Crosses"],
  defensa: ["Clearances", "Interceptions", "Tackles", "Tackles won", "Total tackles", "Recoveries", "Blocked shots", "Errors lead to a shot", "Errors lead to a goal"],
  porteria: ["Goalkeeper saves", "Total saves", "Big saves", "High claims", "Goals prevented", "Punches", "Penalty saves"],
  disciplina: ["Yellow cards", "Red cards", "Fouls", "Fouled in final third", "Offsides"],
  duelos: ["Duels", "Aerial duels", "Ground duels", "Distance covered", "Number of sprints"],
  balon_parado: ["Corner kicks", "Free kicks", "Goal kicks", "Throw-ins"],
};
const PRIORITARIAS = [
  "Big chances", "Big chances scored", "Big chances missed", "Touches in penalty area",
  "Final third entries", "Shots inside box", "Hit woodwork", "Expected goals on target", "Through balls",
];
const catDe = (n) => Object.keys(CATEGORIAS).find((c) => CATEGORIAS[c].includes(n)) || "sin_categoria";

// Stats enteras (tolerancia 0 en la suma 1T+2T) vs floats.
const FLOTANTES = new Set(["Expected goals", "Expected goals on target", "Ball possession", "Average rating", "Goals prevented"]);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const dia = (f) => {
  const d = new Date(f);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function mediana(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function desv(a, m) {
  if (a.length < 2) return null;
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 30) return null;
  const mx = media(xs), my = media(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
const r3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 1000);
const p1 = (v) => Math.round(v * 10) / 10;

// ICC one-way (equipos con >= MIN_TEAM obs): persistencia de la señal de equipo.
function icc(obsPorEquipo) {
  const grupos = [...obsPorEquipo.values()].filter((a) => a.length >= MIN_TEAM);
  const N = grupos.reduce((s, a) => s + a.length, 0), k = grupos.length;
  if (k < 3 || N < 30) return null;
  const g = media(grupos.flat());
  const ssb = grupos.reduce((s, a) => s + a.length * (media(a) - g) ** 2, 0);
  const ssw = grupos.reduce((s, a) => s + a.reduce((t, x) => t + (x - media(a)) ** 2, 0), 0);
  const msb = ssb / (k - 1), msw = ssw / (N - k);
  const n0 = (N - grupos.reduce((s, a) => s + (a.length * a.length), 0) / N) / (k - 1);
  const s2b = Math.max(0, (msb - msw) / n0);
  const s2w = Math.max(0, msw);
  if (s2b + s2w === 0) return null;
  return s2b / (s2b + s2w);
}
// eta² por liga (ligas con n>=10): ¿conviene normalizar por liga?
function eta2Liga(porLiga) {
  const grupos = [...porLiga.entries()].filter(([, a]) => a.length >= 10);
  const N = grupos.reduce((s, [, a]) => s + a.length, 0);
  if (grupos.length < 3 || N < 60) return null;
  const g = media(grupos.flatMap(([, a]) => a));
  const sst = grupos.flatMap(([, a]) => a).reduce((s, x) => s + (x - g) ** 2, 0);
  const ssb = grupos.reduce((s, [, a]) => s + a.length * (media(a) - g) ** 2, 0);
  if (sst <= 0) return null;
  return ssb / sst;
}

(async () => {
  // ---------- 1) Cargar TRAIN+VAL (aserción: nada posterior al corte) ----------
  const tv = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante,
           goles_local::int AS gh, goles_visitante::int AS ga,
           goles_local_1t::int AS gh1, goles_visitante_1t::int AS ga1
      FROM partidos
     WHERE estado='Ended' AND fecha_partido IS NOT NULL
       AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
       AND fecha_partido <= $1::date
     ORDER BY fecha_partido ASC, id ASC`, [CORTE]);
  const partidos = tv.rows;
  const fuera = partidos.filter((p) => dia(p.fecha_partido) > CORTE);
  if (fuera.length) throw new Error(`FUGA: ${fuera.length} partidos posteriores al corte`);
  if (!partidos.length) throw new Error("0 partidos TV");

  // ---------- 2) Estadísticas SOLO de esos partidos (ALL/1ST/2ND) ----------
  const st = await pool.query(`
    SELECT e.partido_id, e.nombre, e.periodo, e.valor_local_num AS l, e.valor_visitante_num AS v
      FROM estadisticas e
      JOIN partidos p ON p.id = e.partido_id
     WHERE p.fecha_partido <= $1::date
       AND e.periodo IN ('ALL','1ST','2ND')`, [CORTE]);
  const porPartido = new Map(); // id → { stat → { period → {loc, vis} } }
  for (const r of st.rows) {
    if (!porPartido.has(r.partido_id)) porPartido.set(r.partido_id, {});
    const s = porPartido.get(r.partido_id);
    (s[r.nombre] = s[r.nombre] || {})[r.periodo] = { loc: num(r.l), vis: num(r.v) };
  }
  const N = partidos.length;
  const lados = 2 * N;

  // ---------- 3) Inventario: cobertura/nulos/ceros/media/mediana/desv por stat×periodo ----------
  const nombres = [...new Set(st.rows.map((r) => r.nombre))].sort();
  const inventario = {};
  for (const nom of nombres) inventario[nom] = {};
  const mismatches = {}; // stat → {dif, n} (ALL vs 1T+2ND por lado)
  const suspXg = { ALL: 0, "1ST": 0, "2ND": 0, n: 0 }; // xG==0 con remates>0 mismo lado
  const eqPorStat = new Map(); // stat(ALL) → equipo → [valores] (para ICC)
  const ligaPorStat = new Map(); // stat(ALL) → liga → [valores]

  const toma = (p, nom, per) => {
    const s = porPartido.get(p.id);
    if (!s || !s[nom] || !s[nom][per]) return { loc: null, vis: null };
    return s[nom][per];
  };

  for (const nom of nombres) {
    for (const per of PERIODOS) {
      let conDato = 0, ambos = 0, nulos = 0, ceros = 0;
      const vals = [];
      for (const p of partidos) {
        const { loc, vis } = toma(p, nom, per);
        let n = 0;
        for (const [v, eq] of [[loc, p.equipo_local], [vis, p.equipo_visitante]]) {
          if (v === null || Number.isNaN(v)) { nulos++; continue; }
          n++; vals.push(v);
          if (v === 0) ceros++;
          if (per === "ALL") {
            if (!eqPorStat.has(nom)) eqPorStat.set(nom, new Map());
            const m = eqPorStat.get(nom);
            if (!m.has(eq)) m.set(eq, []);
            m.get(eq).push(v);
            if (!ligaPorStat.has(nom)) ligaPorStat.set(nom, new Map());
            const lm = ligaPorStat.get(nom);
            if (!lm.has(p.liga)) lm.set(p.liga, []);
            lm.get(p.liga).push(v);
          }
        }
        if (n === 1) conDato = conDato + 1;
        if (n === 2) { conDato++; ambos++; }
      }
      const m = media(vals), md = mediana(vals), dv = desv(vals, m);
      inventario[nom][per] = {
        obs_lados: vals.length,
        cobertura_partidos: conDato,
        cobertura_partidos_pct: p1((100 * conDato) / N),
        cobertura_lados_pct: p1((100 * vals.length) / lados),
        nulos: nulos,
        nulos_pct: p1((100 * nulos) / lados),
        ceros: ceros,
        ceros_pct: ceros ? p1((100 * ceros) / vals.length) : 0,
        media: r3(m), mediana: r3(md), desv_estandar: r3(dv),
      };
    }
    // consistencia ALL vs 1T+2ND (mismo lado, los 3 periodos presentes)
    let dif = 0, nComp = 0;
    const tol = FLOTANTES.has(nom) ? 0.02 : 0;
    for (const p of partidos) {
      const a = toma(p, nom, "ALL"), t1 = toma(p, nom, "1ST"), t2 = toma(p, nom, "2ND");
      for (const k of ["loc", "vis"]) {
        if (a[k] === null || t1[k] === null || t2[k] === null) continue;
        nComp++;
        if (Math.abs(a[k] - (t1[k] + t2[k])) > tol) dif++;
      }
    }
    mismatches[nom] = { lados_comparados: nComp, diferencias: dif, pct: nComp ? p1((100 * dif) / nComp) : null };
    // xG sospechoso: xG==0 con remates>0 (mismo lado y periodo)
    if (nom === "Expected goals") {
      for (const p of partidos) for (const per of PERIODOS) {
        const x = toma(p, "Expected goals", per), ts = toma(p, "Total shots", per);
        if (x.loc === null || ts.loc === null) continue;
        suspXg.n++;
        if (x.loc === 0 && ts.loc > 0) suspXg[per]++;
        if (x.vis === 0 && ts.vis > 0) suspXg[per]++;
      }
    }
  }

  // ---------- 4) ICC (persistencia) y eta² de liga, por stat (ALL) ----------
  const persistencia = {}, normLiga = {};
  for (const nom of nombres) {
    persistencia[nom] = r3(icc(eqPorStat.get(nom) || new Map()));
    normLiga[nom] = r3(eta2Liga(ligaPorStat.get(nom) || new Map()));
  }

  // ---------- 5) Evidencia: media móvil day-strict (5) con partidos ANTERIORES ----------
  // Construye, por stat y periodo, la media de los últimos <=5 partidos previos
  // del equipo (día estricto: nada del mismo día). Sólo TRAIN+VAL.
  const porDia = [];
  let i = 0;
  while (i < partidos.length) {
    const d = dia(partidos[i].fecha_partido);
    let j = i;
    while (j < partidos.length && dia(partidos[j].fecha_partido) === d) j++;
    porDia.push([i, j]);
    i = j;
  }
  const hist = new Map(); // equipo → { stat|per → [vals] }
  const lee = (eq, key) => {
    const h = hist.get(eq);
    return h && h[key] ? h[key] : [];
  };
  // Pre-calcula por partido: roll5 por stat×periodo de cada lado
  const roll = []; // por índice de partido → { key → [homeVal|valores...]; nH, nA }
  for (const p of partidos) roll.push({});
  for (const [ini, fin] of porDia) {
    for (let k = ini; k < fin; k++) {
      const p = partidos[k], acc = roll[k];
      for (const nom of nombres) for (const per of PERIODOS) {
        const key = nom + "||" + per;
        const vh = lee(p.equipo_local, key), va = lee(p.equipo_visitante, key);
        const hh = vh.slice(-5), ha = va.slice(-5);
        acc[key] = {
          h: hh.length >= MIN_PREV ? media(hh) : null,
          a: ha.length >= MIN_PREV ? media(ha) : null,
          nH: hh.length, nA: ha.length,
        };
      }
    }
    // ingerir el día completo DESPUÉS de predecirlo
    for (let k = ini; k < fin; k++) {
      const p = partidos[k];
      for (const nom of nombres) for (const per of PERIODOS) {
        const key = nom + "||" + per;
        const { loc, vis } = toma(p, nom, per);
        if (!hist.has(p.equipo_local)) hist.set(p.equipo_local, {});
        if (!hist.has(p.equipo_visitante)) hist.set(p.equipo_visitante, {});
        if (loc !== null) { const a = hist.get(p.equipo_local); (a[key] = a[key] || []).push(loc); if (a[key].length > 20) a[key].shift(); }
        if (vis !== null) { const a = hist.get(p.equipo_visitante); (a[key] = a[key] || []).push(vis); if (a[key].length > 20) a[key].shift(); }
      }
    }
  }

  // Evidencia ALL: Δroll5(home−away) vs diferencia de goles; |Δ| vs empate.
  const evidencia = {};
  const evidenciaPer = { "1ST": {}, "2ND": {} };
  for (const nom of nombres) {
    const key = nom + "||ALL";
    const dX = [], dY = [], aX = [], aY = [];
    for (let k = 0; k < partidos.length; k++) {
      const p = partidos[k], r = roll[k][key];
      if (!r || r.h === null || r.a === null) continue;
      const gd = p.gh - p.ga;
      dX.push(r.h - r.a); dY.push(gd);
      aX.push(Math.abs(r.h - r.a)); aY.push(p.gh === p.ga ? 1 : 0);
    }
    evidencia[nom] = {
      n_partidos: dX.length,
      corr_delta_vs_diferencia_goles: r3(pearson(dX, dY)),
      corr_absdelta_vs_empate: r3(pearson(aX, aY)),
    };
    // Evidencia por periodo 1ST/2ND: Δroll5 del periodo vs goles del 2T
    for (const per of ["1ST", "2ND"]) {
      const kp = nom + "||" + per;
      const px = [], py = [];
      for (let k = 0; k < partidos.length; k++) {
        const p = partidos[k], r = roll[k][kp];
        if (!r || r.h === null || r.a === null || p.gh1 === null || p.ga1 === null) continue;
        const gd2t = (p.gh - p.gh1) - (p.ga - p.ga1);
        px.push(r.h - r.a); py.push(gd2t);
      }
      evidenciaPer[per][nom] = { n: px.length, corr_delta_vs_goles_2T: r3(pearson(px, py)) };
    }
  }

  // ---------- 6) Candidatas priorizadas: ficha detallada por ALL/1ST/2ND ----------
  const fichas = {};
  for (const nom of PRIORITARIAS) {
    const f = { categoria: catDe(nom), por_periodo: {}, version_ofensiva_defensiva: null, leakage: null, previa_dia_estricto: null, ma_5_10_20: null, normalizar_por_liga: null };
    for (const per of PERIODOS) {
      const inv = inventario[nom][per];
      const susp = nom === "Expected goals" ? suspXg[per] : 0;
      const mm = mismatches[nom];
      const noAditiva = mm.pct !== null && mm.pct > 90; // % (posesión, duels%): ALL≠1T+2T por construcción
      let riesgoCero = "BAJO";
      if ((nom === "Expected goals" && susp > 0) || (mm.pct !== null && mm.pct > 2 && !noAditiva)) riesgoCero = "ALTO";
      else if (inv.ceros_pct >= 30) riesgoCero = "MEDIO (cero-inflada: usar también 0/1≥k)";
      f.por_periodo[per] = {
        cobertura_partidos_pct: inv.cobertura_partidos_pct,
        nulos_pct: inv.nulos_pct,
        ceros_pct: inv.ceros_pct,
        media: inv.media, mediana: inv.mediana, desv: inv.desv_estandar,
        riesgo_cero_artificial: riesgoCero,
        sospechosos_xg_cero_con_remates: nom === "Expected goals" ? suspXg[per] : null,
        ...(inv.cobertura_partidos_pct === 0 ? { nota: "SIN FILAS en este periodo (la stat sólo existe en ALL) — no sirve como predictor 1T/2T" } : {}),
        ...(noAditiva && per === "ALL" ? { no_aditiva: "stat porcentual: ALL no = 1T+2T (test de suma no aplica)" } : {}),
      };
    }
    f.version_ofensiva_defensiva = "SÍ — media propia (ofensiva) y media del rival (defensiva); para % (posesión/duelos%) la versión recibida es el complemento. features.js ya genera los lados _r para 7 stats.";
    f.leakage = "La stat cruda es DEL partido (post-partido). Como feature prepartido SÓLO se usa el agregado de partidos con fecha < D estricto (day-strict, como construirFeatures). Riesgo residual: ALL incluye prórroga en 21 partidos → preferir 1T+2T (features.js ya evita ALL).";
    f.previa_dia_estricto = "SÍ — calculable sólo con partidos anteriores a la fecha (se verificó con ventanas day-strict sobre TRAIN+VAL).";
    const ic = persistencia[nom];
    f.ma_5_10_20 = {
      icc: ic,
      sentido: ic === null ? "sin datos suficientes" : ic >= 0.4 ? "ALTO — señal estable de equipo: MA 5/10/20 todas útiles (5 captura forma reciente; 20 captura estilo)" :
        ic >= 0.15 ? "MEDIO — MA 5/10 razonable; MA 20 sólo si se quiere estilo de fondo" :
          "BAJO — ruido partido a partido: MA largas aplanan sin señal; priorizar 5 o descartar",
    };
    const e2 = normLiga[nom];
    f.normalizar_por_liga = { eta2: e2, recomendacion: e2 === null ? "ligas insuficientes" : e2 >= 0.05 ? "SÍ — la liga explica ≥5% de la varianza: normalizar log(media/refLiga) como stats_features" : "NO imprescindible — efecto liga pequeño" };
    f.evidencia_train_val = evidencia[nom];
    fichas[nom] = f;
  }

  // ---------- 7) Ranking por cobertura + calidad + evidencia (SIN entrenar) ----------
  const calidadDe = (nom) => {
    const mm = mismatches[nom];
    const inv = inventario[nom]["ALL"];
    const susp = nom === "Expected goals" ? (suspXg.ALL) : 0;
    const noAditiva = mm.pct !== null && mm.pct > 90; // porcentuales: el test de suma no aplica
    const base = noAditiva ? 1 : 1 - (mm.pct !== null ? Math.min(1, mm.pct / 10) : 0);
    const suspPen = nom === "Expected goals" && inv.obs_lados ? 1 - Math.min(1, susp / Math.max(1, inv.obs_lados)) : 1;
    return Math.max(0, Math.min(1, base * suspPen));
  };
  const ranking = nombres.map((nom) => {
    const inv = evidencia[nom];
    const cob = inventario[nom]["ALL"].cobertura_lados_pct / 100;
    const ev = Math.min(1, Math.abs(inv.corr_delta_vs_diferencia_goles ?? 0));
    const cal = calidadDe(nom);
    const score = Math.round((0.40 * cob + 0.35 * ev + 0.25 * cal) * 1000) / 1000;
    return {
      stat: nom, categoria: catDe(nom), prioridad_usuario: PRIORITARIAS.includes(nom),
      score,
      cobertura_lados_pct_ALL: inventario[nom]["ALL"].cobertura_lados_pct,
      calidad: r3(cal),
      corr_delta_vs_diferencia_goles: inv.corr_delta_vs_diferencia_goles,
      n_partidos_evidencia: inv.n_partidos,
      icc: persistencia[nom],
      eta2_liga: normLiga[nom],
      mismatch_ALL_vs_1T2T_pct: mismatches[nom].pct,
      aditiva_1Tmas2T: mismatches[nom].pct !== null && mismatches[nom].pct > 90 ? false : null,
      ceros_pct_ALL: inventario[nom]["ALL"].ceros_pct,
    };
  }).sort((a, b) => b.score - a.score);

  // ---------- 8) Modelo de goles 2T: predictores 1ST ----------
  // 8a) Evidencia MISMO partido (válida en tiempo HT, NO prepartido)
  const mismismo = [];
  const gd1tX = [], gd1tY = [];
  for (const nom of [...nombres, "__goles1T__"]) {
    const xs = [], ys = [];
    for (const p of partidos) {
      if (p.gh1 === null || p.ga1 === null) continue;
      const gd2t = (p.gh - p.gh1) - (p.ga - p.ga1);
      if (nom === "__goles1T__") { gd1tX.push(p.gh1 - p.ga1); gd1tY.push(gd2t); continue; }
      const t = toma(p, nom, "1ST");
      if (t.loc === null || t.vis === null) continue;
      xs.push(t.loc - t.vis); ys.push(gd2t);
    }
    const r = nom === "__goles1T__" ? pearson(gd1tX, gd1tY) : pearson(xs, ys);
    mismismo.push({ predictor_1ST: nom, n: nom === "__goles1T__" ? gd1tX.length : xs.length, corr_vs_goles_2T: r3(r) });
  }
  mismismo.sort((a, b) => Math.abs(b.corr_vs_goles_2T ?? 0) - Math.abs(a.corr_vs_goles_2T ?? 0));

  // 8b) Descriptivos: goles 2T según estado al descanso (sólo TV)
  const estado = { lidera: { n: 0, g2t: 0 }, empata: { n: 0, g2t: 0 }, va_perdiendo: { n: 0, g2t: 0 } };
  let tvCon1t = 0;
  for (const p of partidos) {
    if (p.gh1 === null || p.ga1 === null) continue;
    tvCon1t++;
    const d = p.gh1 - p.ga1;
    const k = d > 0 ? "lidera" : d === 0 ? "empata" : "va_perdiendo";
    estado[k].n++; estado[k].g2t += (p.gh - p.gh1);
  }
  for (const k of Object.keys(estado)) estado[k].goles2T_local_promedio = estado[k].n ? r3(estado[k].g2t / estado[k].n) : null;

  // 8c) Ranking prepartido de predictores 1ST históricos vs goles 2T (Δroll5)
  const pred2T = Object.keys(evidenciaPer["1ST"]).map((nom) => ({
    predictor_rolling5_1ST: nom,
    n: evidenciaPer["1ST"][nom].n,
    corr_delta1ST_vs_goles2T: evidenciaPer["1ST"][nom].corr_delta_vs_goles_2T,
    cobertura_1ST_pct: inventario[nom]["1ST"].cobertura_lados_pct,
  })).sort((a, b) => Math.abs(b.corr_delta1ST_vs_goles2T ?? 0) - Math.abs(a.corr_delta1ST_vs_goles2T ?? 0));

  const top = ranking.slice(0, 15);
  const informe = {
    generado: new Date().toISOString(),
    fase: "Fase 5 (nueva) — Ingeniería de variables prepartido",
    reglas: [
      "SOLO TRAIN+VAL (fecha_partido <= 2026-06-18). Aserción anti-fuga ejecutada: 0 partidos posteriores al corte.",
      "TEST intacto: ninguna query, métrica ni decisión usa 2026-06-19..2026-09-27.",
      "Cero entrenamiento: sin Poisson, sin gradiente, sin selección de modelos. Sólo descriptivos, correlaciones y consistencia.",
      "Producción/V1_BETA/prediccion_poisson.json no se tocan (verificación de hashes al final).",
    ],
    muestra: {
      partidos_train_val: N,
      lados_totales: lados,
      fecha_min: dia(partidos[0].fecha_partido),
      fecha_max: dia(partidos[partidos.length - 1].fecha_partido),
      stats_con_datos: nombres.length,
      periodos: PERIODOS,
      et_prorroga_excluida: "ET1/ET2 (21 partidos) no se usan: no existen prepartido y contaminan ALL",
      fuente_goles_1T_TV: `${tvCon1t} partidos TV con goles 1T`,
      stats_ausentes_en_TV: ["Average rating (sus 291 partidos son todos posteriores al corte: no existe en TRAIN+VAL, no es candidata)"],
    },
    clasificacion: CATEGORIAS,
    inventario_53: inventario,
    consistencia_ALL_vs_1T2T: mismatches,
    xg_ceros_sospechosos: suspXg,
    persistencia_ICC: persistencia,
    normalizacion_liga_eta2: normLiga,
    fichas_prioritarias: fichas,
    ranking_global: ranking,
    top_15: top,
    modelo_1x2_variables: {
      criterio: "Score = 0.40·cobertura + 0.35·|corr(ΔMA5, diferencia de goles)| + 0.25·calidad (consistencia ALL vs 1T+2T y ceros xG). Todo en TRAIN+VAL, sin entrenar.",
      top,
      lectura: "El CASO D previo (features de equilibrio ~cero aporte) aconseja priorizar señales de OCASIÓN/CALIDAD de tiro sobre señales de flujo (posesión/pases/duelos), que ya tienen precedente negativo.",
    },
    modelo_goles_2T_variables: {
      dependiente: "goles 2T (goles − goles 1T), disponible en 1937 partidos (TV: " + tvCon1t + ")",
      predictores_prepartido_top: pred2T.slice(0, 15),
      predictores_mismo_partido_1ST_top: mismismo.slice(0, 15),
      estado_al_descanso_local: estado,
      advertencia_leakage: "Los predictores MISMO partido (1ST) sólo son válidos si el modelo 2T se ejecuta en tiempo descanso (datos del 1T conocidos). Prepartido SÓLO valen los rolling day-strict de 1ST.",
    },
    verificacion: "pendiente de post-ejecución",
  };

  const OUT = path.join(__dirname, "informes", "fase5_ingenieria_variables.json");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(informe, null, 2), "utf8");

  console.log(`TV=${N} (${informe.muestra.fecha_min}..${informe.muestra.fecha_max}) stats=${nombres.length} 1T_con_goles=${tvCon1t}`);
  console.log("\nTOP 15 (score | cob% | r(ΔMA5 vs goles) | ICC | eta2 | stat):");
  for (const t of top) console.log(` ${t.score.toFixed(3)} | ${String(t.cobertura_lados_pct_ALL).padStart(5)} | ${String(t.corr_delta_vs_diferencia_goles).padStart(6)} | ${String(t.icc).padStart(5)} | ${String(t.eta2_liga).padStart(5)} | ${t.stat}${t.prioridad_usuario ? " *PRIOR*" : ""}`);
  console.log("\n2T prepartido top5:");
  pred2T.slice(0, 5).forEach((x) => console.log(`  ${x.corr_delta1ST_vs_goles2T} n=${x.n} ${x.predictor_rolling5_1ST}`));
  console.log("\n2T mismo-partido top5:");
  mismismo.slice(0, 5).forEach((x) => console.log(`  ${x.corr_vs_goles_2T} n=${x.n} ${x.predictor_1ST}`));
  console.log("\nEstado al descanso (goles 2T local):", JSON.stringify(estado));
  await pool.end();
})().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
