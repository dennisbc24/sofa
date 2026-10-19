// Utilidad compartida: ratio XI/tipico por partido (para el backtest pre-partido).
const pool = require("../db");
const { tasasPor90, potencialXI, potencialTipicoEquipo, defaultsPorPosicion } = require("../services/prediccion/alineacion");

// Devuelve Map<partido_id, { home: {goles,remates}, away: {...} }> con el ratio
// del XI de ese partido frente al XI tipico (mediana) del equipo.
async function ratesPor90XI() {
  const tasas = await tasasPor90();
  const defaults = defaultsPorPosicion(tasas);
  const jug = await pool.query(
    `SELECT j.partido_id, j.equipo, j.player_id, j.titular, j.posicion,
        p.equipo_local, p.equipo_visitante
     FROM jugadores j JOIN partidos p ON p.id = j.partido_id`
  );
  // XI (titulares) por partido/equipo
  const xis = new Map();
  const equiposPorPartido = new Map();
  for (const row of jug.rows) {
    equiposPorPartido.set(`${row.partido_id}|home`, row.equipo_local);
    equiposPorPartido.set(`${row.partido_id}|away`, row.equipo_visitante);
    if (!row.titular) continue;
    const k = `${row.partido_id}|${row.equipo}`;
    if (!xis.has(k)) xis.set(k, []);
    xis.get(k).push({ player_id: row.player_id, titular: true, posicion: row.posicion });
  }
  // Tipico (mediana) por equipo
  const tipicos = new Map();
  const ratiosPorPartido = new Map();
  for (const [k, xi] of xis) {
    const [pid, lado] = k.split("|");
    const equipo = equiposPorPartido.get(k);
    if (!equipo) continue;
    if (!tipicos.has(equipo)) {
      tipicos.set(equipo, await potencialTipicoEquipo(equipo, tasas, defaults));
    }
    const tip = tipicos.get(equipo);
    if (!tip || !tip.goles) continue;
    const pot = potencialXI(xi, tasas, defaults);
    if (!ratiosPorPartido.has(Number(pid))) ratiosPorPartido.set(Number(pid), {});
    ratiosPorPartido.get(Number(pid))[lado] = {
      goles: pot.goles / tip.goles,
      remates: pot.remates / tip.remates,
    };
  }
  return { ratiosPorPartido, tasas, defaults };
}

module.exports = { ratesPor90XI };
