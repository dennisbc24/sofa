// ---------------------------------------------------------------------------
// FASE 3 — CIERRE CONSOLIDADO.
// Lee los informes ya generados (fase3_1…3_7) y construye el resumen final de
// la fase de investigación: tabla comparativa OOF, veredictos por experimento,
// candidato final y problemas abiertos. NO reentrena, NO carga datos de la BD,
// NO evalúa TEST: sólo agrega cifras ya comprobadas en informes anteriores
// (cada uno con sus sanidades 6/6 y validación de hashes 22/22).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const { r4, guardarInforme } = require("./comun");

const rd = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "informes", n), "utf8"));

(async () => {
  const f3 = rd("fase3_3_experimentos.json");
  const f4 = rd("fase3_4_af.json");
  const f5 = rd("fase3_5_empates.json");
  const f6 = rd("fase3_6_dixoncoles.json");
  const f7 = rd("fase3_7_davidson.json");

  // ---- tabla comparativa pooled (762 OOF) ----
  const modelos = [
    { id: "V1", desc: "base V1 (SPEC30) = producción", src: f4.modelos.V1.pooled, ventana: f4.modelos.V1.porVentana, estado: "producción actual" },
    { id: "A", desc: "V1 + Elo K=32", src: f4.modelos.A.pooled, ventana: f4.modelos.A.porVentana, estado: "CANDIDATO GANADOR" },
    { id: "F", desc: "V1 + localía ajustada", src: f4.modelos.F.pooled, ventana: f4.modelos.F.porVentana, estado: "descartado en 3.4" },
    { id: "AF", desc: "V1 + Elo + localía ajustada", src: f4.modelos.AF.pooled, ventana: f4.modelos.AF.porVentana, estado: "descartado en 3.4" },
    { id: "DC", desc: "A + corrección Dixon-Coles (ρ̂)", src: f6.secciones.global.DC.metricas, ventana: null, dc6: f6, estado: "descartado en 3.6 (2/7)" },
    { id: "DAV", desc: "A + Davidson (ν̂)", src: f7.secciones.global.DAV.metricas, ventana: null, dc7: f7, estado: "descartado en 3.7 (3/7)" },
  ];
  const llV1 = f4.modelos.V1.pooled.logLoss;
  const tabla = modelos.map((m) => ({
    id: m.id, desc: m.desc, accuracy: r4(m.src.accuracy), logLoss: r4(m.src.logLoss),
    brier: m.src.brier, ece: m.src.ece, dLL_vs_V1: r4(m.src.logLoss - llV1), estado: m.estado,
  }));
  console.log("=========== FASE 3 — CIERRE CONSOLIDADO (762 OOF) ===========");
  console.log("Modelo | desc                              | LogLoss | ΔLL vs V1 | Brier  | ECE    | estado");
  for (const t of tabla) {
    console.log(`${t.id.padEnd(6)} | ${t.desc.padEnd(33)} | ${t.logLoss.toFixed(4)} | ${(t.dLL_vs_V1 >= 0 ? "+" : "") + t.dLL_vs_V1.toFixed(4)}    | ${t.brier.toFixed(4)} | ${t.ece.toFixed(4)} | ${t.estado}`);
  }

  // ---- rolling LL por ventana ----
  const winLL = {};
  for (const m of modelos) {
    if (m.ventana) winLL[m.id] = { cells: ["W1", "W2", "W3", "W4"].map((w) => r4(m.ventana[w].logLoss)), oficial: r4(m.ventana.OFICIAL.logLoss) };
    else if (m.dc6) winLL[m.id] = { cells: m.dc6.secciones.ventanas.DC.cells, oficial: m.dc6.secciones.ventanas.DC.oficial };
    else if (m.dc7) winLL[m.id] = { cells: m.dc7.secciones.ventanas.DAV.cells, oficial: m.dc7.secciones.ventanas.DAV.oficial };
  }
  console.log("\nLogLoss por ventana (OFICIAL = fit TRAIN/eval VAL):");
  console.log("| Modelo | W1 | W2 | W3 | W4 | OFICIAL |");
  for (const [id, w] of Object.entries(winLL)) console.log(`| ${id.padEnd(6)} | ${w.cells.map((c) => c.toFixed(4)).join(" | ")} | ${w.oficial.toFixed(4)} |`);
  const gana = (x, y) => winLL[x].cells.reduce((s, c, i) => s + (c < winLL[y].cells[i] ? 1 : 0), 0);
  console.log(`A gana a V1 en ${gana("A", "V1")}/4 ventanas rolling; V1 gana a A en ${gana("V1", "A")}/4.`);

  // ---- veredictos por experimento ----
  const experimentos = [
    { fase: "3.1", titulo: "diagnóstico inicial", resultado: "ECE por buckets empeora con el tiempo; P(E) subestimada; ver informe fase3_1." },
    { fase: "3.2", titulo: "análisis de errores", resultado: "762 OOF: 407 errores; ~45% de los empates fallados; ver informe fase3_2." },
    { fase: "3.3", titulo: "experimentos A–G", resultado: `ganador = A (V1+Elo K=32): ${f3.ganador ? JSON.stringify(f3.ganador) : "ΔLL −0.0055 vs V1, ECE −0.0176"}` },
    { fase: "3.4", titulo: "A+F (localía ajustada)", resultado: f4.decision.veredicto, candidato: f4.decision.candidato },
    { fase: "3.5", titulo: "diagnóstico del empate", resultado: "sólo diagnóstico (sin modelo nuevo)", casos: f5.secciones.casos },
    { fase: "3.6", titulo: "Experimento 1: Dixon-Coles", resultado: f6.secciones.criterio.veredicto, senales: `${f6.secciones.criterio.nSenales}/7`, candidato: f6.secciones.criterio.candidato },
    { fase: "3.7", titulo: "Experimento 2: Davidson", resultado: f7.secciones.criterio.veredicto, senales: `${f7.secciones.criterio.nSenales}/7`, candidato: f7.secciones.criterio.candidato },
  ];
  console.log("\n--- VEREDICTOS POR FASE ---");
  for (const e of experimentos) console.log(`${e.fase} · ${e.titulo}: ${e.resultado}`);

  // ---- candidato final + problemas abiertos ----
  const aCons = f3.modelos.A.consistencia;
  const candidato = {
    modelo: "A (V1 + Elo K=32)",
    pooled: { logLoss: r4(f4.modelos.A.pooled.logLoss), brier: f4.modelos.A.pooled.brier, ece: f4.modelos.A.pooled.ece, accuracy: r4(f4.modelos.A.pooled.accuracy) },
    vsV1: { dLL: r4(f4.modelos.A.pooled.logLoss - llV1), dBrier: r4(f4.modelos.A.pooled.brier - f4.modelos.V1.pooled.brier), dECE: r4(f4.modelos.A.pooled.ece - f4.modelos.V1.pooled.ece) },
    consistencia: aCons,
    porque: "único cambio con mejora clara y consistente fuera de muestra (3.3); A+F (3.4), Dixon-Coles (3.6) y Davidson (3.7) no superaron el criterio de 7 señales sobre eval/OOF.",
  };
  const problemas = {
    composicion00_11: "CASO A de 3.5: 0-0 sobreestimado (obs 50 vs esp ~95) y 1-1 subestimado (obs 107 vs esp ~73); DC y Davidson NO lo corrigen (0-0 y 1-1 se mueven juntos o en proporción).",
    sinSenalEmpate: "CASO D: la separación P(E)|emp−|no≈ 1.1 pts apenas se mueve con cualquier transformación de la matriz; el problema es estructural de la familia Poisson+correlación.",
    argmax: "CASO C: en empates el argmax elige local/visita en ~63-68/200 casos; la P(E) correcta no gana la carrera de argmax.",
    pipeline: "CASO B descartado (conversión λ→1X2 exacta ≤0.16 pt): el problema no es el pipeline.",
  };
  const siguiente = "Fase 4: evaluación ÚNICA en TEST (378 partidos, 2026-06-19…2026-09-27) de V1 vs A (entrenados sobre TRAIN+VAL completo); si A supera a V1, promoción a producción a prueba de hashes.";

  console.log("\n--- CANDIDATO FINAL DE FASE 3 ---");
  console.log(`${candidato.modelo}: LL ${candidato.pooled.logLoss} | ΔLL vs V1 ${candidato.vsV1.dLL} | ECE ${candidato.pooled.ece} (${candidato.vsV1.dECE}) | consistencia rolling ${aCons.rolling}/4, oficial ${aCons.oficial}`);
  console.log(`Siguiente: ${siguiente}`);

  const informe = {
    generado: new Date().toISOString(),
    nota: "CIERRE DE FASE 3 — agregación de informes ya validados (sanidades 6/6 y hashes 22/22 en cada ejecución). Sin reentrenamiento, sin TEST, sin datos nuevos. Todo cifra procedente de informes/fase3_*.json.",
    tablaComparativa: tabla,
    ventanasLL: winLL,
    experimentos,
    candidato,
    problemasAbiertos: problemas,
    siguiente,
    referencias: ["fase3_1_diagnostico.json", "fase3_2_errores.json", "fase3_3_experimentos.json", "fase3_4_af.json", "fase3_5_empates.json", "fase3_6_dixoncoles.json", "fase3_7_davidson.json"],
  };
  const ruta = guardarInforme("fase3_cierre.json", informe);
  console.log(`\nInforme guardado: ${ruta}`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
