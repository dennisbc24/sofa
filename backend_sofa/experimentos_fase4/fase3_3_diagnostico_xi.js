// ---------------------------------------------------------------------------
// DIAGNOSTICO: ¿la XI aporta información más allá del historial del equipo?
//  A) Correlación entre el ratio XI/típico y el residual (goles reales - lambda v1)
//  B) Remates del partido completo: XI (tasas leave-one-out) vs promedio del equipo
//     (el test anterior tenía fuga: las tasas del jugador incluian el partido
//     que se queria predecir)
// Uso: node experiments/fase4/fase3_3_diagnostico_xi.js
// ---------------------------------------------------------------------------
const pool = require("../db");
const { predecir, probsDesdeLambdas, aPorcentajes } = require("../services/prediccion/modelo_poisson");
const r2 = (v) => Math.round(v * 100) / 100;

function corr(a, b) {
  const n = a.length;
  if (n < 5) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : null;
}

async function main() {
  const modelo = require("../modelos/prediccion_poisson.json");

  // --- datos base: partidos con jugadores + XI + stats de equipo ---
  const partidos = await pool.query(
    `SELECT pp.id, pp.equipo_local, pp.equipo_visitante, pp.liga,
        pp.goles_local::int, pp.goles_visitante::int
     FROM partidos pp
     WHERE pp.estado = 'Ended' AND pp.goles_local IS NOT NULL AND pp.goles_visitante IS NOT NULL
       AND EXISTS (SELECT 1 FROM jugadores j WHERE j.partido_id = pp.id)
     ORDER BY pp.id`
  );
  const ids = partidos.rows.map((r) => r.id);

  const jug = await pool.query(
    `SELECT partido_id, equipo, player_id, titular, minutos::float, tiros::float, xg::float
     FROM jugadores WHERE partido_id = ANY($1) AND titular = true`, [ids]
  );
  // Tiros/xG por jugador y partido (para el leave-one-out).
  const porJugadorPartido = new Map();
  for (const r of jug.rows) {
    const k = `${r.player_id}`;
    if (!porJugadorPartido.has(k)) porJugadorPartido.set(k, new Map());
    porJugadorPartido.get(k).set(Number(r.partido_id), { tiros: r.tiros || 0, minutos: r.minutos || 0 });
  }
  // XI por partido/equipo
  const xiPor = new Map();
  for (const r of jug.rows) {
    const k = `${r.partido_id}|${r.equipo}`;
    if (!xiPor.has(k)) xiPor.set(k, []);
    xiPor.get(k).push(String(r.player_id));
  }
  // Remates reales del equipo (Total shots) por partido
  const shots = await pool.query(
    `SELECT partido_id,
       MAX(CASE WHEN nombre='Total shots' THEN valor_local_num END)::float AS l,
       MAX(CASE WHEN nombre='Total shots' THEN valor_visitante_num END)::float AS v
     FROM estadisticas WHERE partido_id = ANY($1) AND nombre='Total shots' GROUP BY partido_id`, [ids]
  );
  const shotsPor = new Map(shots.rows.map((r) => [Number(r.partido_id), r]));

  // --- A) correlación ratio XI vs residual de goles ---
  const { ratiosPorPartido } = await require("./util_xi_pre").ratesPor90XI();
  const pares = [];
  for (const p of partidos.rows) {
    const r = ratiosPorPartido.get(Number(p.id));
    if (!r || !r.home || !r.away) continue;
    const pred = predecir(modelo.parametros, { home: p.equipo_local, away: p.equipo_visitante, liga: p.liga });
    pares.push({ rh: r.home.goles, ra: r.away.goles, resH: p.goles_local - pred.internos.lambdaHome, resA: p.goles_visitante - pred.internos.lambdaAway });
  }
  console.log(`A) correlacion ratio-XI vs residual (goles reales - lambda v1), n=${pares.length}`);
  console.log(`   local:  ${r2(corr(pares.map((x) => x.rh), pares.map((x) => x.resH)))}`);
  console.log(`   visita: ${r2(corr(pares.map((x) => x.ra), pares.map((x) => x.resA)))}`);
  console.log(`   (correlacion ~0 = la XI no aporta info residual)`);

  // --- B) remates: XI leave-one-out vs promedio del equipo (leave-one-out) ---
  const errXI = [], errProm = [];
  let n = 0;
  for (const p of partidos.rows) {
    const sh = shotsPor.get(Number(p.id));
    if (!sh || sh.l == null || sh.v == null) continue;
    for (const [lado, real, opp] of [["home", sh.l, "away"], ["away", sh.v, "home"]]) {
      const xi = xiPor.get(`${p.id}|${lado}`) || [];
      if (xi.length < 9) continue;
      // Tiros por 90 de cada titular, EXCLUYENDO este partido.
      let pred = 0, nCon = 0;
      for (const pid of xi) {
        const mapa = porJugadorPartido.get(pid);
        if (!mapa) continue;
        let t = 0, m = 0;
        for (const [mid, v] of mapa) {
          if (mid === Number(p.id)) continue;
          t += v.tiros; m += v.minutos;
        }
        if (m >= 270) { pred += (t / m) * 90; nCon++ }
      }
      if (nCon < 7) continue;
      // Promedio del equipo (leave-one-out) sobre los mismos partidos.
      const nombre = lado === "home" ? p.equipo_local : p.equipo_visitante;
      const hist = await pool.query(
        `SELECT e.valor_local_num::float AS l, e.valor_visitante_num::float AS v
         FROM estadisticas e JOIN partidos pp ON pp.id = e.partido_id
         WHERE e.nombre='Total shots' AND pp.id <> $1
           AND ((pp.equipo_local = $2 AND e.valor_local_num IS NOT NULL) OR (pp.equipo_visitante = $2 AND e.valor_visitante_num IS NOT NULL))`,
        [p.id, nombre]
      );
      const vals = hist.rows.map((r) => (nombre === p.equipo_local ? r.l : r.v)).filter((v) => v != null);
      if (!vals.length) continue;
      const prom = vals.reduce((s, v) => s + v, 0) / vals.length;
      errXI.push(Math.abs(pred - real));
      errProm.push(Math.abs(prom - real));
      n++;
    }
  }
  const mae = (a) => (a.reduce((s, v) => s + v, 0) / a.length);
  console.log(`\nB) remates del partido completo (n=${n} equipos-partido, leave-one-out)`);
  console.log(`   MAE prediccion XI:      ${r2(mae(errXI))}`);
  console.log(`   MAE promedio del equipo: ${r2(mae(errProm))}`);
  console.log(`   -> la XI ${mae(errXI) < mae(errProm) ? "MEJORA" : "NO mejora"} (${r2(100 * (mae(errXI) - mae(errProm)) / mae(errProm))}% de diferencia)`);
  await pool.end();
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
