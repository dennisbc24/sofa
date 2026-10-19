// ---------------------------------------------------------------------------
// FASE 3-2: ¿el ajuste por XI (pre-partido) mejora la predicción 1X2/goles?
//
// Para cada partido con datos de jugadores se compara:
//   A) modelo v1 tal cual (lambdas de prediccion_poisson.json)
//   B) v1 ajustado por el XI real de ese partido (el "angel" del LineupBuilder)
// contra los goles y el resultado reales. El barrido de pesos permite ver si
// algun peso mejora en algun mercado.
//
// Uso: node experiments/fase3_2_ajuste_xi_pre.js
// ---------------------------------------------------------------------------
const pool = require("../db");
const { predecir, probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const { ratesPor90XI } = require("./util_xi_pre");

const r2 = (v) => Math.round(v * 100) / 100;

async function main() {
  const modelo = require("../modelos/prediccion_poisson.json");
  const partidos = await pool.query(
    `SELECT pp.id, pp.equipo_local, pp.equipo_visitante, pp.liga, pp.fecha_partido::text AS fecha,
        pp.goles_local::int, pp.goles_visitante::int
     FROM partidos pp
     WHERE pp.estado = 'Ended'
       AND pp.goles_local IS NOT NULL AND pp.goles_visitante IS NOT NULL
       AND EXISTS (SELECT 1 FROM jugadores j WHERE j.partido_id = pp.id)
     ORDER BY pp.fecha_partido ASC, pp.id ASC`
  );
  console.log(`partidos con jugadores: ${partidos.rows.length}`);

  const { ratiosPorPartido } = await ratesPor90XI();
  const PESOS = [0, 0.1, 0.25, 0.5, 1];
  const acc = {};
  for (const w of PESOS) acc[w] = { maeG: [], x1: [], np: [], maeG1: [], maeG2: [] };

  let n = 0;
  for (const p of partidos.rows) {
    const r = ratiosPorPartido.get(Number(p.id));
    if (!r) continue;
    const pred = predecir(modelo.parametros, { home: p.equipo_local, away: p.equipo_visitante, liga: p.liga });
    const lh = pred.internos.lambdaHome, la = pred.internos.lambdaAway;
    const real = p.goles_local > p.goles_visitante ? "home" : p.goles_local < p.goles_visitante ? "away" : "draw";

    for (const w of PESOS) {
      let mh = lh, ma = la;
      if (w > 0 && r.home && r.away && r.home.goles && r.away.goles) {
        mh = lh * (1 + w * (r.home.goles - 1)) * (1 - w * (r.away.goles - 1) * 0.5);
        ma = la * (1 + w * (r.away.goles - 1)) * (1 - w * (r.home.goles - 1) * 0.5);
        mh = Math.max(0.05, Math.min(mh, 8));
        ma = Math.max(0.05, Math.min(ma, 8));
      }
      const pb = probsDesdeLambdas(mh, ma);
      const probs = aPorcentajes(pb.home, pb.draw, pb.away, 1);
      const predRes = probs.home >= probs.draw && probs.home >= probs.away ? "home"
        : probs.away >= probs.draw ? "away" : "draw";
      const a = acc[w];
      a.maeG.push(Math.abs(mh - p.goles_local) + Math.abs(ma - p.goles_visitante));
      a.maeG1.push(Math.abs(mh - p.goles_local));
      a.maeG2.push(Math.abs(ma - p.goles_visitante));
      a.x1.push(predRes === real ? 1 : 0);
      const pick = probs.away <= probs.home ? "away" : "home";
      a.np.push(real !== pick ? 1 : 0);
    }
    n++;
    if (n % 100 === 0) console.log(`  ...${n}/${partidos.rows.length}`);
  }

  const mae = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const pct = (a) => (a.length ? (100 * a.reduce((s, v) => s + v, 0)) / a.length : null);
  console.log(`\npartidos evaluados: ${n}\n`);
  console.log("peso   MAE goles   1X2      no-pierde");
  const informe = {};
  for (const w of PESOS) {
    const a = acc[w];
    const line = `  ${String(w).padEnd(5)} ${r2(mae(a.maeG)).toString().padEnd(11)} ${r2(pct(a.x1)).toString().padEnd(9)} ${r2(pct(a.np))}%`;
    console.log(line);
    informe[w] = { maeGoles: r2(mae(a.maeG)), maeLocal: r2(mae(a.maeG1)), maeVisita: r2(mae(a.maeG2)),
      accuracy1x2: r2(pct(a.x1)), noPierde: r2(pct(a.np)), n };
  }
  const fs = require("fs");
  const path = require("path");
  const out = path.join(__dirname, "informes", "fase3_2_ajuste_xi_pre.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    partidos: n, generated_at: new Date().toISOString(),
    nota: "Ajuste XI pre-partido: barrido de pesos. Negativo = el ajuste empeora.",
    porPeso: informe,
  }, null, 2), "utf8");
  console.log(`\ninforme: ${out}`);
  await pool.end();
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
