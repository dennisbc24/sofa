// FASE 2 — Auditoría de calidad de xG/remates/arco antes de V4/V5/V6.
// SOLO TRAIN+VAL (TEST no se toca). Solo lectura.
// Uso: node experimentos/fase_stats_auditoria.js
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { cargarPartidosConStats, limpiarPartido, cobertura } = require("./stats_features");
const { dividirTemporal } = require("../services/prediccion/backtest");

const pct = (x, d = 1) => (x === null || x === undefined ? "—" : x.toFixed(d) + "%");
const r3 = (x, d = 3) => (x === null || x === undefined ? "—" : Math.round(x * 10 ** d) / 10 ** d);
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

(async () => {
  console.log("=========== AUDITORÍA DE ESTADÍSTICAS (V4/V5/V6) — SOLO train+val ===========");
  const todos = await cargarPartidosConStats(pool);
  // misma división que todos los experimentos
  const ordenados = [...todos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);
  const bloques = dividirTemporal(ordenados, { trainPct: 0.6, valPct: 0.2 });
  const TV = [...bloques.train, ...bloques.val];
  const TESTn = bloques.test.length;
  console.log(`partidos totales con goles: ${todos.length} | TRAIN+VAL (auditoría) = ${TV.length} | TEST (NO SE TOCA) = ${TESTn}`);

  const limpios = TV.map(limpiarPartido);

  // ------------------------------------------------ REGISTROS VÁLIDOS TRAS LIMPIEZA
  console.log("\n--- 1. REGISTROS VÁLIDOS TRAS LIMPIEZA (lados-equipo en train+val) ---");
  const ladosTot = 2 * TV.length;
  let cXg = 0, cTs = 0, cSt = 0;
  const razones = {};
  let cerosXgConGoles = 0;
  TV.forEach((p, i) => {
    const lim = limpios[i];
    for (const r of lim.razones) razones[r] = (razones[r] || 0) + 1;
    for (const lado of [lim.L, lim.V]) {
      if (lado.xg !== null) cXg++;
      if (lado.ts !== null) cTs++;
      if (lado.st !== null) cSt++;
    }
    if (lim.razones.some((r) => r.includes("xg_cero"))) {
      const goles = (lim.razones.some((r) => r === "L:xg_cero") ? p.goalsH : 0) + (lim.razones.some((r) => r === "V:xg_cero") ? p.goalsA : 0);
      if (goles > 0) cerosXgConGoles++;
    }
  });
  console.log(`  lados-equipo totales: ${ladosTot}`);
  console.log(`  xG  válidos: ${cXg} (${pct((100 * cXg) / ladosTot)})   tras limpiar (NULL y 0 → ausentes)`);
  console.log(`  Remates totales válidos: ${cTs} (${pct((100 * cTs) / ladosTot)})`);
  console.log(`  Remates al arco válidos: ${cSt} (${pct((100 * cSt) / ladosTot)})`);
  console.log(`  partidos con xG=0 en un lado Y goles>0 en ese lado: ${cerosXgConGoles} (xG=0 con goles imposibles salvo autogol → tratado como ausente)`);
  console.log("  motivos descartados:");
  for (const [k, v] of Object.entries(razones).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${String(v).padStart(5)}`);
  }

  // ------------------------------------------------ CALIDAD xG vs GOLES (pre/post)
  console.log("\n--- 2. xG vs GOLES REALES por liga (pre/post limpieza; ¿mejora el sesgo?) ---");
  const porLiga = new Map();
  TV.forEach((p, i) => {
    if (!porLiga.has(p.liga)) porLiga.set(p.liga, []);
    porLiga.get(p.liga).push({ p, lim: limpios[i] });
  });
  const filasCal = [];
  for (const [liga, ms] of porLiga) {
    const xgCrudo = [], xgLimpio = [], golesDondeXgCrudo = [], golesDondeXgLimpio = [];
    for (const { p, lim } of ms) {
      const lados = [
        { xgRaw: p.xgL, xgLim: lim.L.xg, goles: p.goalsH },
        { xgRaw: p.xgV, xgLim: lim.V.xg, goles: p.goalsA },
      ];
      for (const l of lados) {
        if (l.xgRaw !== null) { xgCrudo.push(l.xgRaw); golesDondeXgCrudo.push(l.goles); }
        if (l.xgLim !== null) { xgLimpio.push(l.xgLim); golesDondeXgLimpio.push(l.goles); }
      }
    }
    if (ms.length < 15) continue;
    filasCal.push({
      liga, n: ms.length,
      xgCrudo: media(xgCrudo), golesCrudo: media(golesDondeXgCrudo),
      xgLimpio: media(xgLimpio), golesLimpio: media(golesDondeXgLimpio),
      nCrudo: xgCrudo.length, nLimpio: xgLimpio.length,
    });
  }
  filasCal.sort((a, b) => b.n - a.n);
  console.log("  liga | n | xG crudo→goles (sesgo) | xG limpio→goles (sesgo) | válidos crudo→limpio");
  for (const f of filasCal) {
    const s1 = f.xgCrudo !== null ? f.golesCrudo - f.xgCrudo : null;
    const s2 = f.xgLimpio !== null ? f.golesLimpio - f.xgLimpio : null;
    console.log(
      `  ${f.liga.slice(0, 32).padEnd(32)} | ${String(f.n).padStart(4)} | ${r3(f.xgCrudo, 2)}→${r3(f.golesCrudo, 2)} (sesgo ${s1 === null ? "—" : (s1 >= 0 ? "+" : "") + r3(s1, 2)}) | ${r3(f.xgLimpio, 2)}→${r3(f.golesLimpio, 2)} (sesgo ${s2 === null ? "—" : (s2 >= 0 ? "+" : "") + r3(s2, 2)}) | ${f.nCrudo}→${f.nLimpio}`
    );
  }

  // ------------------------------------------------ COBERTURA POR LIGA TRAS LIMPIEZA
  console.log("\n--- 3. COBERTURA POR LIGA TRAS LIMPIEZA (n≥15; AVISO si xG < 80%) ---");
  const cob = cobertura(TV, limpios);
  console.log("  liga | n | xG% | remates% | alArco% | con_xG_ambos_lados%");
  let avisos = [];
  for (const f of cob.porLiga.filter((x) => x.n >= 15)) {
    const flag = f.xgPct < 80 ? "  ⚠ AVISO: cobertura xG <80%" : "";
    if (flag) avisos.push(`${f.liga} (${f.xgPct}%)`);
    console.log(
      `  ${f.liga.slice(0, 34).padEnd(34)} | ${String(f.n).padStart(4)} | ${String(f.xgPct).padStart(5)} | ${String(f.tsPct).padStart(8)} | ${String(f.stPct).padStart(8)} | ${String(f.xgAmbosPct).padStart(5)}${flag}`
    );
  }
  if (avisos.length) console.log(`  LIGAS CON COBERTURA INSUFICIENTE DE xG: ${avisos.join(" | ")}`);
  else console.log("  ninguna liga con n≥15 queda bajo 80% de cobertura xG tras limpiar");

  const informe = {
    generado: new Date().toISOString(),
    nota: "SOLO train+val. NULL y 0 no se usan como valor real.",
    ladosTotales: ladosTot,
    validos: { xg: cXg, ts: cTs, st: cSt },
    cerosXgConGoles,
    razones,
    porLiga: cob.porLiga,
    ligasAviso: avisos,
    calidadXg: filasCal,
  };
  const ruta = path.join(__dirname, "informes", "fase_stats_auditoria.json");
  fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));
  console.log(`\nInforme guardado: ${ruta}`);

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
