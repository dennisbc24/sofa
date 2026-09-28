// FASE 0 — Auditoría de datos: cobertura, estadística por liga, tendencias, uso de μ.
// SOLO LECTURA. No modifica nada. Uso: node experimentos/fase0_auditoria.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const STATS = ["Expected goals", "Total shots", "Shots on target", "Corner kicks"];
const r3 = (x, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const pct = (x, d = 1) => (x === null ? "—" : x.toFixed(d) + "%");

function percentil(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const b = Math.floor(pos), rest = pos - b;
  return s[b + 1] !== undefined ? s[b] + rest * (s[b + 1] - s[b]) : s[b];
}
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = media(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

(async () => {
  console.log("=========== FASE 0 — AUDITORÍA ===========");

  // ---------------------------------------------------------------- A. COBERTURA
  console.log("\n--- A. COBERTURA TEMPORAL DE ESTADÍSTICAS ---");
  const cob = await pool.query(`
    SELECT EXTRACT(YEAR FROM p.fecha_partido)::int AS anio,
      count(DISTINCT p.id)::int AS partidos,
      count(DISTINCT CASE WHEN e.nombre='Expected goals' THEN p.id END)::int AS con_xg,
      count(DISTINCT CASE WHEN e.nombre='Total shots' THEN p.id END)::int AS con_remates,
      count(DISTINCT CASE WHEN e.nombre='Shots on target' THEN p.id END)::int AS con_arco,
      count(DISTINCT CASE WHEN e.nombre='Corner kicks' THEN p.id END)::int AS con_corners
    FROM partidos p
    LEFT JOIN estadisticas e ON e.partido_id = p.id
    WHERE p.estado='Ended' AND p.fecha_partido IS NOT NULL AND p.goles_local IS NOT NULL
    GROUP BY 1 ORDER BY 1;`);
  console.log("  año | partidos | xG% | remates% | al arco% | corners%");
  for (const c of cob.rows) {
    console.log(`  ${c.anio} | ${String(c.partidos).padStart(4)} | ${pct((100 * c.con_xg) / c.partidos)} | ${pct((100 * c.con_remates) / c.partidos)} | ${pct((100 * c.con_arco) / c.partidos)} | ${pct((100 * c.con_corners) / c.partidos)}`);
  }

  // patrón EXACTO de features.js: 1ST + 2ND con ambos periodos
  const pat = await pool.query(`
    WITH est AS (
      SELECT partido_id, nombre,
        MAX(CASE WHEN periodo='1ST' THEN 1 END) AS t1,
        MAX(CASE WHEN periodo='2ND' THEN 1 END) AS t2,
        MAX(CASE WHEN periodo='ALL' THEN 1 END) AS allp
      FROM estadisticas
      WHERE nombre IN (${STATS.map((s) => `'${s}'`).join(",")})
      GROUP BY partido_id, nombre
    )
    SELECT nombre,
      count(DISTINCT partido_id)::int AS con_1t2t,
      count(DISTINCT CASE WHEN allp=1 THEN partido_id END)::int AS con_all
    FROM est GROUP BY nombre ORDER BY nombre;`);
  console.log("\n  patrón features.js (suma 1T+2T, requiere ambos periodos) vs ALL:");
  const coberturaFeatures = {};
  const totalPartidos = cob.rows.reduce((a, c) => a + c.partidos, 0);
  for (const p of pat.rows) {
    coberturaFeatures[p.nombre] = { t1t2: p.con_1t2t, all: p.con_all };
    console.log(`    ${p.nombre.padEnd(16)} 1T+2T=${String(p.con_1t2t).padStart(4)}/${totalPartidos} (${pct((100 * p.con_1t2t) / totalPartidos)})   ALL=${String(p.con_all).padStart(4)} (${pct((100 * p.con_all) / totalPartidos)})`);
  }

  // ---------------------------------------------------------------- B. POR LIGA
  // valores por partido: 1T+2T si existe, si no ALL (fallback documentado)
  const q = `
    WITH est AS (
      SELECT partido_id, nombre,
        CASE WHEN MAX(CASE WHEN periodo='1ST' THEN 1 END)=1 AND MAX(CASE WHEN periodo='2ND' THEN 1 END)=1
          THEN COALESCE(MAX(CASE WHEN periodo='1ST' THEN valor_local_num END),0)
             + COALESCE(MAX(CASE WHEN periodo='2ND' THEN valor_local_num END),0) END AS loc_t,
        CASE WHEN MAX(CASE WHEN periodo='1ST' THEN 1 END)=1 AND MAX(CASE WHEN periodo='2ND' THEN 1 END)=1
          THEN COALESCE(MAX(CASE WHEN periodo='1ST' THEN valor_visitante_num END),0)
             + COALESCE(MAX(CASE WHEN periodo='2ND' THEN valor_visitante_num END),0) END AS vis_t,
        MAX(CASE WHEN periodo='ALL' THEN valor_local_num END) AS loc_a,
        MAX(CASE WHEN periodo='ALL' THEN valor_visitante_num END) AS vis_a
      FROM estadisticas
      WHERE nombre IN (${STATS.map((s) => `'${s}'`).join(",")})
      GROUP BY partido_id, nombre
    ),
    w AS (
      SELECT partido_id,
        MAX(CASE WHEN nombre='Expected goals' THEN COALESCE(loc_t, loc_a) END) AS xgl,
        MAX(CASE WHEN nombre='Expected goals' THEN COALESCE(vis_t, vis_a) END) AS xgv,
        MAX(CASE WHEN nombre='Total shots'      THEN COALESCE(loc_t, loc_a) END) AS reml,
        MAX(CASE WHEN nombre='Total shots'      THEN COALESCE(vis_t, vis_a) END) AS remv,
        MAX(CASE WHEN nombre='Shots on target'  THEN COALESCE(loc_t, loc_a) END) AS arol,
        MAX(CASE WHEN nombre='Shots on target'  THEN COALESCE(vis_t, vis_a) END) AS arov,
        MAX(CASE WHEN nombre='Corner kicks'     THEN COALESCE(loc_t, loc_a) END) AS corl,
        MAX(CASE WHEN nombre='Corner kicks'     THEN COALESCE(vis_t, vis_a) END) AS corv
      FROM est GROUP BY partido_id
    )
    SELECT p.id, p.liga, EXTRACT(YEAR FROM p.fecha_partido)::int AS anio,
      p.goles_local, p.goles_visitante, w.*
    FROM partidos p LEFT JOIN w ON w.partido_id = p.id
    WHERE p.estado='Ended' AND p.fecha_partido IS NOT NULL AND p.goles_local IS NOT NULL;`;
  const { rows: matches } = await pool.query(q);
  console.log(`\n  partidos cargados: ${matches.length}`);

  const porLiga = new Map();
  for (const m of matches) {
    if (!porLiga.has(m.liga)) porLiga.set(m.liga, []);
    porLiga.get(m.liga).push(m);
  }

  // tabla de ligas
  const tabla = [];
  for (const [liga, ms] of porLiga) {
    const golesTot = ms.map((m) => m.goles_local + m.goles_visitante);
    const conXg = ms.filter((m) => m.xgl !== null);
    const xgEquipo = [];
    for (const m of conXg) { xgEquipo.push(Number(m.xgl)); xgEquipo.push(Number(m.xgv)); }
    const remEq = [];
    for (const m of ms.filter((m) => m.reml !== null)) { remEq.push(Number(m.reml)); remEq.push(Number(m.remv)); }
    const corEq = [];
    for (const m of ms.filter((m) => m.corl !== null)) { corEq.push(Number(m.corl)); corEq.push(Number(m.corv)); }
    const n = ms.length;
    tabla.push({
      liga, n,
      gl: media(ms.map((m) => m.goles_local)),
      ga: media(ms.map((m) => m.goles_visitante)),
      tot: media(golesTot),
      sdTot: sd(golesTot),
      medTot: percentil(golesTot, 0.5),
      p25: percentil(golesTot, 0.25),
      p75: percentil(golesTot, 0.75),
      pctVL: (100 * ms.filter((m) => m.goles_local > m.goles_visitante).length) / n,
      pctE: (100 * ms.filter((m) => m.goles_local === m.goles_visitante).length) / n,
      pctVV: (100 * ms.filter((m) => m.goles_local < m.goles_visitante).length) / n,
      xgCob: (100 * conXg.length) / n,
      xg: media(xgEquipo), xgSd: sd(xgEquipo), xgMed: percentil(xgEquipo, 0.5),
      xgP25: percentil(xgEquipo, 0.25), xgP75: percentil(xgEquipo, 0.75),
      xgl: media(conXg.map((m) => Number(m.xgl))), xgv: media(conXg.map((m) => Number(m.xgv))),
      rem: media(remEq), remSd: sd(remEq),
      arol: media(ms.filter((m) => m.arol !== null).map((m) => Number(m.arol))),
      cor: media(corEq), corSd: sd(corEq),
      remCob: (100 * ms.filter((m) => m.reml !== null).length) / n,
      corCob: (100 * ms.filter((m) => m.corl !== null).length) / n,
    });
  }
  tabla.sort((a, b) => b.n - a.n);

  console.log("\n--- B. TABLA ESTADÍSTICA POR LIGA (historia completa; media por partido/equipo) ---");
  console.log("  liga | n | goles L | goles V | total | sd | med | %VL %E %VV | xG(eq) | rem(eq) | alArco(L) | corners(eq) | cob xG/rem/cor");
  for (const t of tabla) {
    console.log(
      `  ${t.liga.slice(0, 30).padEnd(30)} | ${String(t.n).padStart(4)} | ${r3(t.gl, 2)} | ${r3(t.ga, 2)} | ${r3(t.tot, 2)} | ${r3(t.sdTot, 2)} | ${r3(t.medTot, 2)} | ${pct(t.pctVL)} ${pct(t.pctE)} ${pct(t.pctVV)} | ${t.xg === null ? "—" : r3(t.xg, 2)} | ${t.rem === null ? "—" : r3(t.rem, 1)} | ${t.arol === null ? "—" : r3(t.arol, 1)} | ${t.cor === null ? "—" : r3(t.cor, 1)} | ${pct(t.xgCob, 0)}/${pct(t.remCob, 0)}/${pct(t.corCob, 0)}`
    );
  }

  // percentiles detallados para ligas con n>=30
  console.log("\n  percentiles de goles totales (ligas con n>=30):");
  for (const t of tabla.filter((x) => x.n >= 30)) {
    console.log(`    ${t.liga.slice(0, 34).padEnd(34)} p25=${r3(t.p25, 2)} mediana=${r3(t.medTot, 2)} p75=${r3(t.p75, 2)} sd=${r3(t.sdTot, 2)}`);
  }

  // ---------------------------------------------------------------- C. TENDENCIAS
  console.log("\n--- C. TENDENCIAS POR PERIODO ---");
  const anualGlobal = new Map();
  for (const m of matches) {
    if (!anualGlobal.has(m.anio)) anualGlobal.set(m.anio, []);
    anualGlobal.get(m.anio).push(m);
  }
  console.log("  GLOBAL: año | n | goles tot | %VL | %E | %VV | xG prom(eq)");
  for (const [anio, ms] of [...anualGlobal].sort()) {
    const xg = [];
    for (const m of ms) if (m.xgl !== null) { xg.push(Number(m.xgl)); xg.push(Number(m.xgv)); }
    console.log(`    ${anio} | ${String(ms.length).padStart(4)} | ${r3(media(ms.map((m) => m.goles_local + m.goles_visitante)), 2)} | ${pct((100 * ms.filter((m) => m.goles_local > m.goles_visitante).length) / ms.length)} | ${pct((100 * ms.filter((m) => m.goles_local === m.goles_visitante).length) / ms.length)} | ${pct((100 * ms.filter((m) => m.goles_local < m.goles_visitante).length) / ms.length)} | ${xg.length ? r3(media(xg), 2) : "—"}`);
  }
  console.log("  POR LIGA (n>=40): año: golesTot/%VL  [cambio de tendencia]");
  for (const t of tabla.filter((x) => x.n >= 40)) {
    const ms = porLiga.get(t.liga);
    const porAnio = new Map();
    for (const m of ms) {
      if (!porAnio.has(m.anio)) porAnio.set(m.anio, []);
      porAnio.get(m.anio).push(m);
    }
    const partes = [...porAnio].sort().map(([a, v]) => {
      if (v.length < 5) return null;
      return `${a}: ${r3(media(v.map((m) => m.goles_local + m.goles_visitante)), 2)}/${((100 * v.filter((m) => m.goles_local > m.goles_visitante).length) / v.length).toFixed(0)}%VL(n=${v.length})`;
    }).filter(Boolean);
    console.log(`    ${t.liga.slice(0, 30).padEnd(30)} ${partes.join("  ")}`);
  }

  // ---------------------------------------------------------------- D. DIFERENCIAS / NORMALIZACIÓN
  console.log("\n--- D. DIFERENCIAS ENTRE LIGAS (¿justifican normalizar por liga?) ---");
  // eta² (variación explicada por la liga) para cada métrica
  const eta2 = (sel, nombre) => {
    let ssb = 0, ssw = 0, grand = [];
    const grupos = [];
    for (const [liga, ms] of porLiga) {
      if (ms.length < 10) continue;
      const vals = ms.map(sel).filter((v) => v !== null && v !== undefined).map(Number);
      if (vals.length < 10) continue;
      grupos.push({ liga, n: vals.length, m: media(vals), v: sd(vals) ** 2 });
      grand.push(...vals);
    }
    const G = media(grand);
    for (const g of grupos) { ssb += g.n * (g.m - G) ** 2; ssw += (g.n - 1) * g.v; }
    const eta = ssb / (ssb + ssw);
    const medias = grupos.map((g) => g.m);
    const cv = sd(medias) / media(medias);
    console.log(`    ${nombre.padEnd(16)} eta²=${r3(eta, 3)}  media de medias=${r3(media(medias), 2)}  rango=[${r3(Math.min(...medias), 2)}, ${r3(Math.max(...medias), 2)}]  CVentreLigas=${pct(100 * cv)}`);
    return { eta, cv, min: Math.min(...medias), max: Math.max(...medias) };
  };
  const difs = {
    golesTot: eta2((m) => m.goles_local + m.goles_visitante, "goles totales"),
    xg: eta2((m) => (m.xgl !== null ? (Number(m.xgl) + Number(m.xgv)) / 2 : null), "xG/equipo"),
    remates: eta2((m) => (m.reml !== null ? (Number(m.reml) + Number(m.remv)) / 2 : null), "remates/eq"),
    alArco: eta2((m) => (m.arol !== null ? (Number(m.arol) + Number(m.arov)) / 2 : null), "al arco/eq"),
    corners: eta2((m) => (m.corl !== null ? (Number(m.corl) + Number(m.corv)) / 2 : null), "corners/eq"),
    pctVL: null, // se ve en la tabla
  };

  // ---------------------------------------------------------------- E. USO DE μ EN EL MODELO
  console.log("\n--- E. USO DE μ EN EL MODELO ACTUAL (V1) ---");
  const modelo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "modelos", "prediccion_poisson.json"), "utf8"));
  const ligasModelo = Object.keys(modelo.parametros.ligas || {});
  const ligasDb = [...porLiga.keys()].sort();
  const enTrainVal = new Set(matches.filter((m) => m.fecha_partido >= "2019-06-01").map((m) => m.liga)); // aproximación; el exacto se recalcula abajo
  console.log(`  μ global: home=${modelo.parametros.muHomeGlobal} away=${modelo.parametros.muAwayGlobal} (razón ${r3(modelo.parametros.muHomeGlobal / modelo.parametros.muAwayGlobal, 3)})`);
  console.log(`  regla: liga con n>=30 en la MUESTRA DE AJUSTE (train+val) → μ propio; si no → μ global`);
  console.log(`  ligas CON μ específico (${ligasModelo.length}):`);
  for (const l of ligasModelo) {
    const info = modelo.parametros.ligas[l];
    console.log(`    ${l.slice(0, 40).padEnd(40)} n_ajuste=${info.n} μh=${r3(info.muHome, 3)} μa=${r3(info.muAway, 3)} razón=${r3(info.muHome / info.muAway, 3)}`);
  }
  const sinMu = ligasDb.filter((l) => !ligasModelo.includes(l));
  console.log(`  ligas SIN μ propio → usan μ GLOBAL (${sinMu.length}):`);
  for (const l of sinMu) console.log(`    ${l.slice(0, 40).padEnd(40)} n_en_BD=${porLiga.get(l).length}`);

  // ataque/defensa y localía
  const att = Object.values(modelo.parametros.att || {});
  const def = Object.values(modelo.parametros.def || {});
  console.log(`  ataque/defensa: SIEMPRE global por equipo (una sola cifra por equipo, ${att.length} equipos; sin split local/visita)`);
  console.log(`  localía: EXCLUSIVAMENTE vía μ_local/μ_visita de la liga (si la liga no tiene μ → razón global 1.401); ningún parámetro de localía por equipo`);

  // guardar informe
  const out = {
    generado: new Date().toISOString(),
    coberturaAnual: cob.rows,
    coberturaFeatures,
    tablaLigas: tabla.map((t) => ({ ...t, tot: r3(t.tot, 3), gl: r3(t.gl, 3), ga: r3(t.ga, 3), xg: r3(t.xg, 3) })),
    diferencias: difs,
    ligasConMu: ligasModelo,
    ligasSinMu: sinMu,
  };
  const rutaOut = path.join(__dirname, "informes", "fase0_auditoria.json");
  fs.mkdirSync(path.dirname(rutaOut), { recursive: true });
  fs.writeFileSync(rutaOut, JSON.stringify(out, null, 2));
  console.log(`\nInforme guardado en ${rutaOut}`);

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
