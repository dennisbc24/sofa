// ---------------------------------------------------------------------------
// FASE 1.1 — EVALUACIÓN PRE-REGISTRADA del parche de robustez (antes de tocar
// producción). TEST NO se carga (SQL <= 2026-06-18, n=1523=TV). Ningún archivo
// protegido se modifica (sólo lectura de JSON + informe nuevo).
//
// PROBLEMAS QUE EVALÚA:
//  (A) Rollover de temporada: `predecir` busca ligas[liga] por nombre EXACTO
//      (services/prediccion/modelo_poisson.js:222). Un nombre nuevo
//      ("Premier League 2026 2027") cae a μ global aunque exista la historia
//      de la familia ("Premier League 2025 2026").
//  (B) Guardrail de λ: equipos con pocas generaciones dan att/def extremos
//      (Málaga v Almería: λ_home 10.55 → p_draw al piso numérico → ll 34.5).
//
// DISEÑO DE EVALUACIÓN (3 bloques):
//  A1 · RETRO-ROLLOVER REAL: fit < 2025-08-01 (n≈313), eval 2025-08-01..2026-06-18.
//       Documentado como SUPLEMENTARIO: fit pequeño → pocas ligas n≥30 → mapa de
//       familias casi vacío → poder insuficiente para discriminar la familia.
//  A2 · ROLLOVER SIMULADO sobre VAL (DECISIVO para la familia): modelo fresco
//       train(1159) → eval val(364) con liga RENOMBRADA ("X 2099": falla la
//       clave exacta, la familia sigue siendo "X"). Mecánica idéntica al
//       despliegue actual (nombres 2026-2027 ausentes), datos y partición
//       oficiales, sin tocar TEST.
//  B · TV con protocolo fiel: VAL LL bajo R0 debe reproducir 1.0751 (sanidad
//       contra producción) + grid de guardrail + evento Málaga + invariancia.
//  C · Impacto de despliegue (> 2026-06-18): sólo conteos de resolución de
//       liga (sin usar resultados).
//
// REGLAS DE DECISIÓN (fijadas ANTES de ver resultados):
//  - FAMILIA se adopta si en A2: ΔLL(subset familia-resolvable) <= 0  Y
//    ΔLL(overall) <= +0.001  (y A1 sin daño: |Δ| cumple umbrales iguales).
//  - CAP se adopta si en B (modelo fresco): (i) partidos de VAL con λ>cap <= 5,
//    (ii) LL_VAL(cap) <= LL_VAL(sin) + 0.0002, (iii) LL_A2global(cap) <= LL_A2global(sin) + 0.001,
//    (iv) el peor ll de VAL queda < 6. Orden de elección: 8 → 6 → 5 (primero que cumpla).
//  - Si FAMILIA no se adopta, el 1.1 queda sólo con el guardrail (o sin cambios si tampoco).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { entrenarExp, familia } = require("../experimentos/modelo_mu_exp");
const { probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const { calcularMetricas } = require("../services/prediccion/backtest");
const { cargarTV, llSubconjunto, r4, realDe, dia, modeloJson } = require("../experimentos_fase3/comun");

const OUT = path.join(__dirname, "informes", "fase11_1_eval_rollover.json");
const HASTA = "2026-06-18";
const ROLLOVER = "2025-08-01";

const familiaPlus = (l) => familia(l).replace(/\b(apertura|clausura)\b/gi, " ").replace(/\s+/g, " ").trim();

function construirFamilias(ligas, famFn) {
  const m = {};
  for (const [k, v] of Object.entries(ligas)) {
    const f = famFn(k);
    if (!f) continue;
    if (!m[f]) m[f] = { n: 0, sh: 0, sa: 0 };
    const n = v.n || 0;
    m[f].n += n; m[f].sh += n * v.muHome; m[f].sa += n * v.muAway;
  }
  const out = {};
  for (const [f, v] of Object.entries(m)) if (v.n > 0) out[f] = { n: v.n, muHome: v.sh / v.n, muAway: v.sa / v.n };
  return out;
}

function muDe(modelo, famMap, famFn, liga) {
  if (liga && modelo.ligas[liga]) return { base: modelo.ligas[liga], origen: "exacta" };
  if (liga && famMap) { const f = famMap[famFn(liga)]; if (f) return { base: f, origen: "familia" }; }
  return { base: { muHome: modelo.muHomeGlobal, muAway: modelo.muAwayGlobal }, origen: "global" };
}

const attDe = (att, eq) => (att instanceof Map ? (att.get(eq) ?? 0) : (att[eq] ?? 0));

function predecir(modelo, famMap, famFn, cap, p) {
  const res = muDe(modelo, famMap, famFn, p.liga);
  let lh = Math.exp(Math.log(res.base.muHome) + attDe(modelo.att, p.home) - attDe(modelo.def, p.away));
  let la = Math.exp(Math.log(res.base.muAway) + attDe(modelo.att, p.away) - attDe(modelo.def, p.home));
  const lh0 = lh, la0 = la;
  if (cap) { lh = Math.min(lh, cap); la = Math.min(la, cap); }
  const { home, draw, away } = probsDesdeLambdas(lh, la);
  const probs = aPorcentajes(home, draw, away, 1);
  return { probs, real: realDe(p), fecha: p.fecha, id: p.id, home: p.home, away: p.away, liga: p.liga,
    marcador: `${p.goalsH}-${p.goalsA}`, lh0, la0, lh, la, origen: res.origen };
}

const llDe = (pr) => -Math.log(Math.max((pr.probs[pr.real] ?? 0.1) / 100, 1e-15));

function resumen(preds, mask) {
  const sub = mask ? preds.filter((_, i) => mask[i]) : preds;
  if (!sub.length) return { n: 0 };
  const m = calcularMetricas(sub);
  return { n: sub.length, accuracy: r4(m.accuracy), logLoss: r4(m.logLoss), brier: m.brier, ece: m.ece,
    llEmp: llSubconjunto(sub, "draw") };
}

function percentiles(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const q = (f) => r4(s[Math.min(s.length - 1, Math.floor(s.length * f))]);
  return { p50: q(0.5), p90: q(0.9), p99: q(0.99), p999: q(0.999), max: r4(s[s.length - 1]) };
}

const REGLAS = [["R0", null, familia], ["R1", "FAM1", familia], ["R1b", "FAM1b", familiaPlus]];
const mapaDe = (regla, maps) => (regla === "R0" ? null : regla === "R1" ? maps.fam1 : maps.fam1b);

(async () => {
  console.log("=========== FASE 1.1 · EVAL PRE-REGISTRADA (TEST intacto) ===========");
  const mj = modeloJson();
  const dep = mj.parametros;

  // ---- carga: TODO <= 2026-06-18 ----
  const { rows } = await pool.query(`
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos
    WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
      AND fecha_partido <= '${HASTA}'
    ORDER BY fecha_partido ASC, id ASC;`);
  const todo = rows.map((x) => ({ id: x.id, fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local,
    away: x.equipo_visitante, goalsH: x.goles_local, goalsA: x.goles_visitante }));
  if (todo.length !== 1523) throw new Error(`esperaba 1523 TV, llegaron ${todo.length} — DRIFT, detener`);
  const fit1 = todo.filter((p) => dia(p) < ROLLOVER);
  const eva1 = todo.filter((p) => dia(p) >= ROLLOVER);

  const { train, val } = await cargarTV(pool); // DRIFT-check contra JSON incluido
  console.log(`TV 1523 = train ${train.length} + val ${val.length} | A1: fit ${fit1.length} / eval ${eva1.length}`);

  const mapsDe = (modelo, incluyePlus) => ({ fam1: construirFamilias(modelo.ligas, familia),
    fam1b: construirFamilias(modelo.ligas, familiaPlus) });

  // ================= A1 · retro-rollover real (suplementario) =================
  const modelA1 = entrenarExp(fit1, "SPEC30");
  const mapsA1 = mapsDe(modelA1);
  const enFit = new Set(Object.keys(modelA1.ligas));
  const maskFB1 = eva1.map((p) => !enFit.has(p.liga));
  const A1 = { nFit: fit1.length, nEval: eva1.length, nFallback: maskFB1.filter(Boolean).length,
    ligasConParametrosFit: Object.keys(modelA1.ligas).length, metricas: {} };
  for (const [regla, , famFn] of REGLAS) {
    const preds = eva1.map((p) => predecir(modelA1, mapaDe(regla, mapsA1), famFn, null, p));
    A1.metricas[regla] = { overall: resumen(preds), fallback: resumen(preds, maskFB1),
      nCambiaOrigen: preds.filter((p) => p.origen === "familia").length };
  }
  console.log(`A1 (fit=${A1.nFit}, ligas n≥30=${A1.ligasConParametrosFit}): R0 LL=${A1.metricas.R0.overall.logLoss} → R1b ${A1.metricas.R1b.overall.logLoss} (familia resuelve ${A1.metricas.R1b.nCambiaOrigen})`);

  // ================= A2 · rollover SIMULADO sobre VAL (decisivo) =================
  const modelV = entrenarExp(train, "SPEC30"); // modelo fresco = protocolo oficial
  const mapsV = mapsDe(modelV);
  const valRen = val.map((p) => ({ ...p, liga: `${p.liga} 2099` })); // falla clave exacta; familia intacta
  const maskResol = valRen.map((p) => Boolean(mapsV.fam1b[familiaPlus(p.liga)]));
  const A2 = { descripcion: "VAL(364) con liga renombrada '<liga> 2099': la clave exacta falla, la familia ('<liga>') no cambia",
    nResolvable: maskResol.filter(Boolean).length, metricas: {} };
  for (const [regla, , famFn] of REGLAS) {
    const preds = valRen.map((p) => predecir(modelV, mapaDe(regla, mapsV), famFn, null, p));
    if (preds.some((p) => !Number.isFinite(p.probs.home))) throw new Error(`A2 ${regla}: probs no finitas`);
    A2.metricas[regla] = { overall: resumen(preds), resolvable: resumen(preds, maskResol),
      noResolvable: resumen(preds, maskResol.map((x) => !x)),
      nOrigenFamilia: preds.filter((p) => p.origen === "familia").length,
      peores: [...preds].sort((a, b) => llDe(b) - llDe(a)).slice(0, 3)
        .map((p) => ({ fecha: dia(p), partido: `${p.home} v ${p.away}`, liga: p.liga, marcador: p.marcador, ll: r4(llDe(p)) })) };
  }
  const dA2_res = r4(A2.metricas.R1b.resolvable.logLoss - A2.metricas.R0.resolvable.logLoss);
  const dA2_ov = r4(A2.metricas.R1b.overall.logLoss - A2.metricas.R0.overall.logLoss);
  console.log(`A2: resolvable ${A2.nResolvable}/364 — R0 LL=${A2.metricas.R0.resolvable.logLoss} → R1b ${A2.metricas.R1b.resolvable.logLoss} (Δ=${dA2_res}); overall Δ=${dA2_ov}`);

  // ================= B · protocolo fiel + guardrail =================
  const B = { fresco: {}, desplegado: {} };
  const valGrid = (modelo, maps) => {
    const out = {};
    for (const [regla, , famFn] of REGLAS) for (const cap of [null, 8, 6, 5]) {
      const key = `${regla}_${cap ? "c" + cap : "sin"}`;
      const preds = val.map((p) => predecir(modelo, mapaDe(regla, maps), famFn, cap, p));
      out[key] = { n: preds.length, ...resumen(preds),
        nCap: cap ? preds.filter((p) => p.lh0 > cap || p.la0 > cap).length : 0,
        _preds: preds };
    }
    return out;
  };
  B.fresco = valGrid(modelV, mapsV);
  B.desplegado = valGrid(dep, mapsDe(dep));
  const sanidad = Math.abs(B.fresco.R0_sin.logLoss - 1.0751);
  console.log(`B fresco: VAL R0 LL=${B.fresco.R0_sin.logLoss} (esperado 1.0751, Δ=${sanidad.toFixed(4)})`);
  if (sanidad > 0.0005) throw new Error("SANIDAD VAL FALLADA — la reimplementación no reproduce producción");
  const cambiaTV = val.filter((p, i) => {
    const a = B.fresco.R0_sin._preds[i], b = B.fresco.R1b_sin._preds[i];
    return a.origen !== b.origen;
  }).length;
  console.log(`B: VAL con origen 'familia' bajo R1b: ${cambiaTV}/${val.length}`);

  // eventos Málaga (ambos modelos)
  const malaga = val.find((p) => dia(p) === "2026-06-14" && p.home.includes("Málaga"));
  const eventoDe = (modelo, maps) => {
    if (!malaga) return null;
    const p0 = predecir(modelo, null, familia, null, malaga);
    const ev = { lambdaHome: r4(p0.lh0), lambdaAway: r4(p0.la0), ll_sinGuardrail: r4(llDe(p0)), ll_con: {} };
    for (const cap of [8, 6, 5]) ev.ll_con["c" + cap] = r4(llDe(predecir(modelo, null, familia, cap, malaga)));
    return ev;
  };
  const evFresco = eventoDe(modelV, mapsV), evDep = eventoDe(dep);
  console.log(`B: Málaga fresco λh=${evFresco.lambdaHome} ll=${evFresco.ll_sinGuardrail} c8=${evFresco.ll_con.c8} c6=${evFresco.ll_con.c6} c5=${evFresco.ll_con.c5}`);
  console.log(`B: Málaga desplegado λh=${evDep.lambdaHome} ll=${evDep.ll_sinGuardrail} c8=${evDep.ll_con.c8}`);

  const peorLLTV = Math.max(...B.fresco.R0_sin._preds.map(llDe));

  // ================= C · impacto de despliegue (sin resultados) =================
  const { rows: rec } = await pool.query(`
    SELECT liga, count(*) AS n FROM partidos
    WHERE estado='Ended' AND fecha_partido IS NOT NULL AND goles_local IS NOT NULL
      AND fecha_partido > '${HASTA}'
    GROUP BY liga ORDER BY 2 DESC;`);
  const famDep1b = construirFamilias(dep.ligas, familiaPlus);
  const C = { total: 0, bajoRegla: { R0: { exacta: 0, global: 0 }, R1b: { exacta: 0, familia: 0, global: 0 } }, ligas: [] };
  for (const r of rec) {
    const liga = r.liga, n = Number(r.n);
    C.total += n;
    const ex = Boolean(dep.ligas[liga]);
    const fa = Boolean(famDep1b[familiaPlus(liga)]);
    C.bajoRegla.R0.exacta += ex ? n : 0; C.bajoRegla.R0.global += ex ? 0 : n;
    C.bajoRegla.R1b.exacta += ex ? n : 0; C.bajoRegla.R1b.familia += (!ex && fa) ? n : 0;
    C.bajoRegla.R1b.global += (!ex && !fa) ? n : 0;
    if (!ex) C.ligas.push({ liga, n, resuelve: fa ? "familia" : "global" });
  }
  console.log(`C: ${C.total} post-VAL — R0: global ${C.bajoRegla.R0.global} → R1b: familia ${C.bajoRegla.R1b.familia}, global ${C.bajoRegla.R1b.global}`);

  // ================= REGLAS DE DECISIÓN =================
  const dA1_fb = A1.nFallback ? r4(A1.metricas.R1b.fallback.logLoss - A1.metricas.R0.fallback.logLoss) : 0;
  const dA1_ov = r4(A1.metricas.R1b.overall.logLoss - A1.metricas.R0.overall.logLoss);
  const familiaOk = dA2_res <= 0 && dA2_ov <= 0.001 && dA1_fb <= 0.001 && dA1_ov <= 0.001;

  const candidatosCap = [];
  for (const cap of [8, 6, 5]) {
    const kF = `R1b_c${cap}`, kS = "R1b_sin";
    const nCap = B.fresco[kF].nCap;
    const dLLTV = r4(B.fresco[kF].logLoss - B.fresco[kS].logLoss);
    const predsCap = valRen.map((p) => predecir(modelV, mapsV.fam1b, familiaPlus, cap, p));
    const dLLren = r4(resumen(predsCap).logLoss - A2.metricas.R1b.overall.logLoss);
    const peorTras = evFresco.ll_con["c" + cap] < 6;
    const cumple = nCap <= 5 && dLLTV <= 0.0002 && dLLren <= 0.001 && peorTras;
    candidatosCap.push({ cap, nCapTV: nCap, dLL_VAL: dLLTV, dLL_evalRen: dLLren, peorLLTras: evFresco.ll_con["c" + cap], cumple });
  }
  const capElegido = (candidatosCap.find((c) => c.cumple) || {}).cap ?? null;

  const veredicto = {
    familia: { adoptar: familiaOk, A2_deltaLL_resolvable: dA2_res, A2_deltaLL_overall: dA2_ov,
      A1_deltaLL_fallback: dA1_fb, A1_deltaLL_overall: dA1_ov },
    guardrail: { adoptar: capElegido !== null, cap: capElegido, candidatos: candidatosCap,
      peorLL_VAL_antes: r4(peorLLTV) },
    resultado_1_1: familiaOk && capElegido !== null ? "FAMILIA+GUARDRAIL"
      : familiaOk ? "SOLO_FAMILIA" : capElegido !== null ? "SOLO_GUARDRAIL" : "SIN_CAMBIOS",
  };
  console.log(`\nVEREDICTO: familia=${familiaOk} (A2 Δres=${dA2_res}, Δov=${dA2_ov}) | cap=${capElegido} → ${veredicto.resultado_1_1}`);

  const limpiar = (o) => { if (o && typeof o === "object") { delete o._preds; for (const v of Object.values(o)) limpiar(v); } return o; };

  const informe = {
    generado: new Date().toISOString(),
    fase: "1.1 — evaluación pre-registrada del parche de robustez (rollover de ligas + guardrail λ)",
    reglas: [
      "TEST NO cargado (SQL <= 2026-06-18, n=1523=TV). Ningún archivo protegido modificado.",
      "FAMILIA adopta si en A2 (rollover simulado sobre VAL): ΔLL(resolvable)<=0 y ΔLL(overall)<=+0.001; y A1 sin daño (≤+0.001).",
      "CAP adopta si en B (modelo fresco): nCapVAL<=5, LL_VAL(cap)<=LL_VAL(sin)+0.0002, LL_ren(cap)<=LL_ren(sin)+0.001 y el peor ll de VAL queda <6. Orden: 8 → 6 → 5.",
      "A2 renombra liga a '<liga> 2099': la familia ('<liga>') no cambia y la clave exacta falla — mecánica idéntica al rollover 2026-2027.",
    ],
    ventanas: { A1_fit: `${fit1.length} (< ${ROLLOVER})`, A1_eval: `${eva1.length}`, A2: `${val.length} (VAL, liga renombrada)`, B: `VAL ${val.length}` },
    sanidad: { valR0FrescoIgualProduccion: sanidad <= 0.0005, valR0_fresco: B.fresco.R0_sin.logLoss,
      esperado_1_0751: 1.0751, driftTV1523: true, notaDesplegado: "el JSON desplegado es refit(1901): su VAL LL (in-sample) es una referencia distinta, ver B.desplegado" },
    A1_retro_real: A1,
    A2_rollover_simulado: A2,
    B_protocolo: { fresco: B.fresco, desplegado: B.desplegado, cambiosOrigenR1b: cambiaTV,
      eventoMalaga_fresco: evFresco, eventoMalaga_desplegado: evDep,
      raiz: { attMalaga: dep.att["Málaga CF"], defMalaga: dep.def["Málaga CF"], attAlmeria: dep.att["Almería"],
        defAlmeria: dep.def["Almería"], nota: "Málaga 14 partidos / Almería 3 en DB → att/def con pocas generaciones" } },
    C_impacto_despliegue: C,
    veredicto,
    verificacion: "pendiente",
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(limpiar(informe), null, 2), "utf8");
  console.log(`Informe: ${OUT}`);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
