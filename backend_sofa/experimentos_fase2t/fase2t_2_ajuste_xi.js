// ---------------------------------------------------------------------------
// FASE 2T-2: ¿el ajuste por XI mejora la proyección del 2T?
//
// Arma dumps de "descanso" sinteticos desde la DB (stats 1ST + jugadores) y
// compara la proyección del 2T CON y SIN ajuste por XI contra el 2T real
// (final - 1T) de goles y remates.
//
// Uso: node experiments/fase2t_2_ajuste_xi.js
// ---------------------------------------------------------------------------
const pool = require("../db");
const { predecirArchivo } = require("../services/prediccion/modelo_2t");

const STATS = ["Goles", "Total shots"];
const r2 = (v) => Math.round(v * 100) / 100;

// Stat "Goles" es el marcador: el 2T real = final - 1T.
function filas2TReal(partido, stats1T, statsALL) {
  const out = {};
  for (const stat of STATS) {
    if (stat === "Goles") {
      out[stat] = {
        local: (partido.goles_local - partido.goles_local_1t),
        visita: (partido.goles_visitante - partido.goles_visitante_1t),
      };
      continue;
    }
    const s1 = stats1T[stat];
    const sA = statsALL[stat];
    if (!s1 || !sA) { out[stat] = null; continue }
    out[stat] = { local: sA.local - s1.local, visita: sA.visita - s1.visita };
  }
  return out;
}

async function main() {
  // 1) Partidos con 1ST + jugadores + resultado final.
  const partidos = await pool.query(
    `SELECT pp.id, pp.equipo_local, pp.equipo_visitante, pp.liga, pp.fecha_partido::text AS fecha,
        pp.goles_local::int, pp.goles_visitante::int,
        pp.goles_local_1t::int, pp.goles_visitante_1t::int
     FROM partidos pp
     WHERE pp.estado = 'Ended'
       AND pp.goles_local IS NOT NULL AND pp.goles_visitante IS NOT NULL
       AND pp.goles_local_1t IS NOT NULL AND pp.goles_visitante_1t IS NOT NULL
       AND EXISTS (SELECT 1 FROM jugadores j WHERE j.partido_id = pp.id)
     ORDER BY pp.fecha_partido ASC, pp.id ASC`
  );
  const ids = partidos.rows.map((r) => r.id);

  // 2) Stats por partido: 1ST (para el dump) y ALL (para el 2T real).
  const stats = await pool.query(
    `SELECT partido_id, periodo, nombre, valor_local_num::float, valor_visitante_num::float
     FROM estadisticas
     WHERE partido_id = ANY($1) AND periodo IN ('1ST','ALL') AND nombre = ANY($2)`,
    [ids, STATS.filter((s) => s !== "Goles")]
  );
  const porPartido = new Map();
  for (const row of stats.rows) {
    const k = `${row.partido_id}|${row.periodo}|${row.nombre}`;
    porPartido.set(k, { local: row.valor_local_num, visita: row.valor_visitante_num });
  }

  // 3) Jugadores por partido (XI del descanso).
  const jug = await pool.query(
    `SELECT partido_id, equipo, player_id, nombre, posicion, dorsal, titular, jugo,
        minutos::float, xg::float, tiros::float, crosses::float, goles::int
     FROM jugadores WHERE partido_id = ANY($1)`,
    [ids]
  );
  const jugPor = new Map();
  for (const row of jug.rows) {
    if (!jugPor.has(row.partido_id)) jugPor.set(row.partido_id, []);
    jugPor.get(row.partido_id).push({
      equipo: row.equipo, player_id: String(row.player_id), nombre: row.nombre,
      posicion: row.posicion, dorsal: row.dorsal, titular: row.titular, jugo: row.jugo,
      minutesPlayed: row.minutos, expectedGoals: row.xg, totalShots: row.tiros,
      totalCross: row.crosses, goals: row.goals,
    });
  }

  // 4) Correr la proyección (1 llamada por partido: trae base sin ajuste +
  //    ratios, y despues se barre el peso del ajuste).
  const PESOS_BARRIDO = [0, 0.1, 0.25, 0.5, 1];
  const LIMITES = { Goles: [0.85, 1.15], "Total shots": [0.85, 1.15] };
  const acc = {};
  for (const stat of STATS) {
    acc[stat] = {};
    for (const w of PESOS_BARRIDO) acc[stat][w] = { e: [], l: [], v: [] };
  }
  let n = 0, errores = 0;

  for (const p of partidos.rows) {
    const jugadores = jugPor.get(p.id) || [];
    if (!jugadores.length) continue;
    const stats1T = {};
    for (const stat of STATS) {
      if (stat === "Goles") continue;
      const s = porPartido.get(`${p.id}|1ST|${stat}`);
      if (!s) continue;
      stats1T[stat] = s;
    }
    if (!stats1T["Total shots"]) continue;
    const statsALL = {};
    for (const stat of STATS) {
      if (stat === "Goles") continue;
      const s = porPartido.get(`${p.id}|ALL|${stat}`);
      if (s) statsALL[stat] = s;
    }

    // Dump de descanso (formato nuevo).
    const filas1T = [];
    for (const [k, v] of porPartido) {
      const [pid, periodo, nombre] = k.split("|");
      if (Number(pid) !== Number(p.id) || periodo !== "1ST") continue;
      filas1T.push({
        periodo: "1ST", grupo: "Match overview", nombre, clave: null,
        home: String(v.local), away: String(v.visita),
        home_num: v.local, away_num: v.visita,
      });
    }
    const dump = {
      match_id: String(p.id),
      info: {
        home: p.equipo_local, away: p.equipo_visitante,
        goles_h: p.goles_local, goles_a: p.goles_visitante,
        goles_h_1T: p.goles_local_1t, goles_a_1T: p.goles_visitante_1t,
        fecha: p.fecha, estado: "Halftime", torneo: p.liga,
      },
      estadisticas: filas1T,
      jugadores,
    };
    const contenido = JSON.stringify(dump);

    let res;
    try {
      res = await predecirArchivo({ nombre: `bt_${p.id}.json`, contenido, aplicarXI: true });
    } catch (e) {
      errores++;
      continue;
    }
    const real = filas2TReal(p, stats1T, statsALL);
    const ratios = res.ajusteXI;
    for (const stat of STATS) {
      const r = real[stat];
      if (!r) continue;
      const f = res.filas.find((x) => x.stat === stat);
      if (!f) continue;
      const baseL = f.baseLocal2T != null ? f.baseLocal2T : f.predLocal2T;
      const baseV = f.baseVisita2T != null ? f.baseVisita2T : f.predVisita2T;
      for (const w of PESOS_BARRIDO) {
        let pl = baseL, pv = baseV;
        if (w > 0 && ratios) {
          const merc = stat === "Goles" ? "goles" : "remates";
          const rl = ratios.local.ratio[merc];
          const rv = ratios.visitante.ratio[merc];
          const lim = LIMITES[stat];
          if (rl != null) pl = baseL * Math.min(Math.max(1 + w * (rl - 1), lim[0]), lim[1]);
          if (rv != null) pv = baseV * Math.min(Math.max(1 + w * (rv - 1), lim[0]), lim[1]);
        }
        const a = acc[stat][w];
        a.e.push(Math.abs(pl - r.local) + Math.abs(pv - r.visita));
        a.l.push(Math.abs(pl - r.local));
        a.v.push(Math.abs(pv - r.visita));
      }
    }
    n++;
    if (n % 50 === 0) console.log(`  ...${n}/${partidos.rows.length}`);
  }

  const mae = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  console.log(`\npartidos evaluados: ${n} (errores: ${errores})\n`);
  console.log("MAE del 2T por peso del ajuste XI (0 = sin ajuste):");
  const informe = {};
  for (const stat of STATS) {
    if (!acc[stat][0].e.length) continue;
    const base = mae(acc[stat][0].e);
    const linea = PESOS_BARRIDO.map((w) => {
      const m = mae(acc[stat][w].e);
      const d = base ? (100 * (m - base) / base) : 0;
      return `${w}: ${r2(m)} (${d > 0 ? "+" : ""}${r2(d)}%)`;
    }).join("   ");
    console.log(`  ${stat.padEnd(13)} ${linea}`);
    informe[stat] = Object.fromEntries(PESOS_BARRIDO.map((w) => [w, {
      mae: r2(mae(acc[stat][w].e)),
      deltaPct: base ? r2((100 * (mae(acc[stat][w].e) - base)) / base) : null,
    }]));
  }
  const fs = require("fs");
  const path = require("path");
  const out = path.join(__dirname, "informes", "fase2t_2_ajuste_xi.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    partidos: n, errores, generated_at: new Date().toISOString(),
    nota: "MAE del 2T (goles/remates) por peso del ajuste por XI. Negativo = el ajuste empeora.",
    metricas: informe,
    detallePorLado: Object.fromEntries(STATS.map((s) => [s, Object.fromEntries(PESOS_BARRIDO.map((w) => [w, {
      local: r2(mae(acc[s][w].l)), visita: r2(mae(acc[s][w].v)),
    }]))])),
  }, null, 2), "utf8");
  console.log(`\ninforme: ${out}`);
  await pool.end();
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
