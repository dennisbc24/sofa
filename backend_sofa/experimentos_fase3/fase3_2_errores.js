// ---------------------------------------------------------------------------
// FASE 3.2 — REPORTE DE ERRORES de V1 (TRAIN+VAL; TEST no se carga).
// Pooled W1..W4 (fuera de muestra) + referencia OFICIAL/VAL.
// Categorías: confiados (≥60/≥70%), equilibrados (<40%), empates fallidos,
// ganó local, ganó visita, casi-empate (top2 < 5 pts), celdas específicas
// P(H)>70 / P(A)>70 / P(E)>30 fallidas. Listado completo en el JSON.
// ---------------------------------------------------------------------------
const pool = require("../db");
const { entrenarExp } = require("../experimentos/modelo_mu_exp");
const { calcularMetricas } = require("../services/prediccion/backtest");
const {
  r4, pct, argmax, cargarTV, construirVentanas, evaluarExp, llSubconjunto, guardarInforme,
} = require("./comun");

function enriquecer(items, modelo) {
  return items.map((x) => {
    const p = x.pred;
    const orden = [p.probs.home, p.probs.draw, p.probs.away].sort((a, b) => b - a);
    const fuerzaH = (modelo.att[x.m.home] ?? 0) + (modelo.def[x.m.home] ?? 0);
    const fuerzaA = (modelo.att[x.m.away] ?? 0) + (modelo.def[x.m.away] ?? 0);
    return {
      fecha: new Date(p.fecha).toISOString().slice(0, 10), id: p.id, partido: `${p.home} vs ${p.away}`,
      local: p.home, visitante: p.away, liga: p.liga, marcador: p.marcador,
      probs: p.probs, predicho: argmax(p.probs), real: p.real,
      acierto: argmax(p.probs) === p.real,
      pMax: orden[0] / 100, pSegundo: orden[1] / 100, margenTop2: orden[0] - orden[1],
      lambdaHome: r4(p.lambdaHome), lambdaAway: r4(p.lambdaAway),
      lambdaTotal: r4(p.lambdaHome + p.lambdaAway),
      deltaFuerza: r4(fuerzaH - fuerzaA),
    };
  });
}

function reportar(nombre, arr, consola) {
  const n = arr.length;
  const errs = arr.filter((x) => !x.acierto);
  const ll = errs.length ? errs.reduce((a, x) => a - Math.log(Math.max(1e-15, x.probs[x.real] / 100)), 0) / errs.length : null;
  const filas = { n, nErrores: n ? errs.length : 0, tasaError: n ? r4(errs.length / n) : null, llPromedioErrores: ll === null ? null : r4(ll) };
  if (consola) {
    console.log(`\n--- ${nombre} · n=${n} errores=${errs.length}${ll !== null ? ` LL(errores)=${ll.toFixed(4)}` : ""} ---`);
    for (const e of errs.slice(0, 12)) {
      console.log(`  ${e.fecha.slice(0, 10)} ${e.partido.slice(0, 58).padEnd(58)} ${e.marcador} | P ${e.probs.home}/${e.probs.draw}/${e.probs.away} → pred ${e.predicho} real ${e.real}`);
    }
    if (errs.length > 12) console.log(`  … +${errs.length - 12} en el JSON`);
  }
  return { ...filas, listado: errs };
}

(async () => {
  console.log("=========== FASE 3.2 — ERRORES V1 · solo TRAIN+VAL (TEST no cargado) ===========");
  const { train, val, TV, nTrain } = await cargarTV(pool);
  console.log(`TRAIN ${train.length} | VAL ${val.length} | TV ${TV.length}`);

  // items POOLED fuera de muestra (W1..W4), como fase_elo
  const { oficial, ventanas } = construirVentanas(TV, nTrain);
  const pooled = [];
  for (const w of ventanas) {
    const modelo = entrenarExp(w.fit, "SPEC30");
    const ev = evaluarExp(modelo, w.eval);
    pooled.push(...enriquecer(w.eval.map((m, i) => ({ m, pred: ev.predicciones[i] })), modelo));
  }
  const modOf = entrenarExp(oficial.fit, "SPEC30");
  const evVal = evaluarExp(modOf, oficial.eval);
  const valItems = enriquecer(oficial.eval.map((m, i) => ({ m, pred: evVal.predicciones[i] })), modOf);

  const metPooled = calcularMetricas(pooled.map((x) => ({ probs: x.probs, real: x.real, fecha: x.fecha, home: x.local, away: x.visitante, liga: x.liga })));
  console.log(`POOLED ${pooled.length} | acc ${pct(metPooled.accuracy)} LL ${metPooled.logLoss.toFixed(4)} | errores totales ${pooled.filter((x) => !x.acierto).length}`);

  const errsPooled = pooled.filter((x) => !x.acierto);
  const secciones = {};
  const crear = (arr) => ({
    todos: reportar("todos (pooled)", arr, true),
    errConfiado60: reportar("errores con P(predicho) ≥ 60%", arr.filter((x) => !x.acierto && x.pMax >= 0.60), true),
    errConfiado70: reportar("errores con P(predicho) ≥ 70%", arr.filter((x) => !x.acierto && x.pMax >= 0.70), true),
    errEquilibrado: reportar("errores con P(predicho) < 40% (equilibrados)", arr.filter((x) => !x.acierto && x.pMax < 0.40), false),
    errEmpate: reportar("errores: era empate y no lo predijo", arr.filter((x) => x.real === "draw" && x.predicho !== "draw"), true),
    ganoLocal: reportar("errores: ganó el local", arr.filter((x) => x.real === "home" && x.predicho !== "home"), false),
    ganoVisita: reportar("errores: ganó la visita", arr.filter((x) => x.real === "away" && x.predicho !== "away"), false),
    ph70Fallo: reportar("P(H) > 70% y no ganó local", arr.filter((x) => x.probs.home > 70 && x.real !== "home"), true),
    pa70Fallo: reportar("P(A) > 70% y no ganó visita", arr.filter((x) => x.probs.away > 70 && x.real !== "away"), true),
    pe30Fallo: reportar("P(E) > 30% y no fue empate", arr.filter((x) => x.probs.draw > 30 && x.real !== "draw"), true),
    casiEmpate: reportar("casi empate: top2 separados < 5 pts", arr.filter((x) => x.margenTop2 < 5), false),
    casiEmpateErrores: reportar("casi empate Y error", arr.filter((x) => x.margenTop2 < 5 && !x.acierto), false),
  });

  console.log("\n================ RESUMEN POOLED (W1..W4) ================");
  secciones.pooled = crear(pooled);
  const rp = secciones.pooled;
  console.log("\n--- TABLA RESUMEN (pooled) ---");
  console.log(`categoría                     | n     | errores | % del total de errores`);
  const filasTabla = [
    ["todos", rp.todos], ["confiados ≥60%", rp.errConfiado60], ["confiados ≥70%", rp.errConfiado70],
    ["equilibrados <40%", rp.errEquilibrado], ["era empate", rp.errEmpate], ["ganó local", rp.ganoLocal],
    ["ganó visita", rp.ganoVisita], ["P(H)>70 falló", rp.ph70Fallo], ["P(A)>70 falló", rp.pa70Fallo],
    ["P(E)>30 falló", rp.pe30Fallo], ["casi empate top2<5", rp.casiEmpate], ["casi empate+error", rp.casiEmpateErrores],
  ];
  for (const [nom, f] of filasTabla) {
    const share = errsPooled.length ? pct(f.nErrores / errsPooled.length, 1) : "—";
    console.log(`${nom.padEnd(29)} | ${String(f.n).padStart(5)} | ${String(f.nErrores).padStart(7)} | ${share}`);
  }

  console.log("\n================ REFERENCIA VAL (OFICIAL) ================");
  secciones.valOficial = crear(valItems);

  const informe = {
    generado: new Date().toISOString(),
    nota: "TEST no cargado. Pooled = W1..W4 fuera de muestra. 'confiado' usa P de la clase predicha (argmax).",
    metricasPooled: { accuracy: r4(metPooled.accuracy), logLoss: r4(metPooled.logLoss), brier: r4(metPooled.brier), ece: r4(metPooled.ece) },
    llPorResultado: { home: llSubconjunto(pooled.map((x) => ({ probs: x.probs, real: x.real })), "home"), draw: llSubconjunto(pooled.map((x) => ({ probs: x.probs, real: x.real })), "draw"), away: llSubconjunto(pooled.map((x) => ({ probs: x.probs, real: x.real })), "away") },
    pooled: secciones.pooled,
    valOficial: secciones.valOficial,
  };
  const ruta = guardarInforme("fase3_2_errores.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  console.log("TEST: NO EVALUADO.");
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
