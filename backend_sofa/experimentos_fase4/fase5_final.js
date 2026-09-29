// ---------------------------------------------------------------------------
// FASE 5 — CIERRE FINAL DEL PROCESO.
// Como la decisión pre-registrada de Fase 4 fue NO_MEJORA_MANTENER_V1, NO hay
// promoción: producción (V1_BETA) queda intacta y este script sólo agrega los
// informes ya validados (fase3_cierre.json + fase4_1_test.json) en el resumen
// final. No reentrena, no carga la BD, no toca archivos protegidos.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");

const rd = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const cierre3 = rd(path.join(__dirname, "..", "experimentos_fase3", "informes", "fase3_cierre.json"));
const f4 = rd(path.join(__dirname, "informes", "fase4_1_test.json"));

const proceso = [
  { fase: "0-1", titulo: "auditoría, V1, splits temporales", estado: "HECHA", nota: "splits TRAIN/VAL/TEST con backtest registrado en el JSON oficial" },
  { fase: "2", titulo: "V1 + backtest completo + diagnóstico", estado: "HECHA", nota: "V1 (SPEC30) = modelo en producción V1_BETA" },
  { fase: "3.1-3.2", titulo: "diagnóstico y análisis de errores (OOF 762)", estado: "HECHA", nota: "407 errores; P(E) subestimada; ~45% de empates fallados" },
  { fase: "3.3", titulo: "experimentos A-G", estado: "HECHA", nota: "ganador OOF: A (V1+Elo K=32), ΔLL −0.0055, 3/4 ventanas" },
  { fase: "3.4", titulo: "A+F (localía ajustada)", estado: "DESCARTADA", nota: "gana LL pero empeora ECE → mantener A" },
  { fase: "3.5", titulo: "diagnóstico del empate", estado: "DIAGNÓSTICO", nota: "CASOS A (0-0/1-1 invertidos), C (argmax), D (sin señal); B descartado" },
  { fase: "3.6", titulo: "Experimento 1: Dixon-Coles", estado: "DESCARTADA (2/7 señales)", nota: "ρ̂≈−0.05 estable pero sin mejora eval/OOF; composición intacta" },
  { fase: "3.7", titulo: "Experimento 2: Davidson", estado: "DESCARTADA (3/7 señales)", nota: "ν̂≈1.02: masa de empate ya correcta; gana LL empate pero pierde global/H/A" },
  { fase: "3-cierre", titulo: "consolidado de Fase 3", estado: "HECHA", nota: "candidato OOF = A; problemas estructurales abiertos" },
  { fase: "4", titulo: "evaluación ÚNICA en TEST (378)", estado: "HECHA — A FALLA", nota: "decisión pre-registrada: NO_MEJORA_MANTENER_V1" },
  { fase: "5", titulo: "promoción", estado: "NO APLICA", nota: "TEST no confirma a A → producción V1_BETA intacta (22/22 hashes, endpoints 200, activeModel V1_BETA)" },
];

const decisionFinal = {
  modeloEnProduccion: "V1_BETA (V1 SPEC30, refit TV=1523)",
  promocion: false,
  porque: `A superó a V1 en OOF (ΔLL −0.0055) pero FALLÓ en TEST: ΔLL +${f4.deltas.dLL}, ΔBrier +${f4.deltas.dBrier}, ΔECE +${f4.deltas.dECE}, ΔAcc ${f4.deltas.dAcc}; pareado media +${f4.pareado.mediaDeltaLL} con IC95 [${f4.pareado.ic95[0]}, ${f4.pareado.ic95[1]}] (significativo), A peor en ${f4.pareado.ganaV1}/${f4.splits.test} partidos. La mejora OOF no generaliza.`,
  cambiosEnProduccion: "ninguno (cero archivos protegidos modificados en todo el proceso)",
  verificacionesFinales: "22/22 hashes SHA-256 == baseline · prediccion_poisson.json == F6E3405C…5BD1 · endpoints HTTP 200 · activeModel V1_BETA",
};

const lecciones = [
  "OOF no garantiza TEST: A ganaba de forma consistente en OOF (3/4 ventanas, −0.0055) y empeoró +0.0283 en el bloque reciente — el criterio de 7 señales con ventanas era necesario pero no suficiente.",
  "El TEST de V1 ya estaba registrado en backtest.test desde Fase 1 (LL 0.9719); se replicó exactamente como sanidad, y la evaluación de A fue primera y única (sin shopping).",
  "Los empates son el problema estructural sin resolver: CASO A (0-0 sobreestimado / 1-1 subestimado) persiste en V1 y A; DC y Davidson no lo corrigen; la familia Poisson+correlación no lo arregla.",
  "V1 sobreestima P(E) también en TEST (ΣP(E)=92.83 vs 77 empates reales) pero sigue siendo mejor calibrado que A (ECE 0.0673 vs 0.1238).",
];

const informe = {
  generado: new Date().toISOString(),
  nota: "CIERRE FINAL — agrega informes ya validados. Sin reentrenamiento, sin datos nuevos, sin tocar producción.",
  proceso,
  fase4: {
    splits: f4.splits, sanidades: f4.sanidades,
    backtestTestRegistradoFase1: f4.backtestTestRegistradoFase1,
    metricas: { V1: f4.modelos.V1.metricas, A: f4.modelos.A.metricas },
    deltas: f4.deltas, pareado: f4.pareado, decision: f4.decision,
  },
  decisionFinal,
  lecciones,
  referencias: [
    "../experimentos_fase3/informes/fase3_cierre.json",
    "fase4_1_test.json",
  ],
};

const dir = path.join(__dirname, "informes");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const ruta = path.join(dir, "fase5_final.json");
fs.writeFileSync(ruta, JSON.stringify(informe, null, 2));

console.log("=========== FASE 5 — CIERRE FINAL ===========");
for (const p of proceso) console.log(`Fase ${p.fase.padEnd(10)} · ${p.titulo.padEnd(45)} ${p.estado}`);
console.log(`\nPROMOCIÓN: NO → ${decisionFinal.porque}`);
console.log(`Producción: ${decisionFinal.modeloEnProduccion} | ${decisionFinal.verificacionesFinales}`);
console.log(`\nInforme: ${ruta}`);
process.exit(0);
