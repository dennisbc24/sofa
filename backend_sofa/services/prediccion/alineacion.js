// ---------------------------------------------------------------------------
// ALINEACIONES: squad por equipo y ajuste del modelo 1X2 segun el XI.
//
// Modelo hibrido: parte de la prediccion v1 (bien calibrada) y ajusta los
// lambdas con la fuerza del XI declarado:
//   lambda_home = lambda_v1_home * (XI_home_xG / tipico_home_xG)
//                              * (tipico_away_xG / XI_away_xG)
// Un XI mas fuerte que el habitual sube el lambda; un rival fuerte lo baja.
// Los suplentes entran con peso 0.1 (juegan una fraccion del partido).
// ---------------------------------------------------------------------------
const pool = require("../../db");

const PESO_SUPLENTE = 0.1;
// Guardarrail: el ratio XI-vs-tipico se acota para que un XI con cobertura de
// xG desigual no dispare el lambda (el ajuste debe ser un matiz, no un giro).
const RATIO_MIN = 0.5;
const RATIO_MAX = 2;

// Formacion tipica del equipo: la mas frecuente en sus XIs historicos
// (cuenta G/D/M/F de cada XI y se queda con la mas repetida). Ej: 1-4-3-3.
async function formacionTipica(equipo) {
  const r = await pool.query(
    `SELECT j.partido_id, j.posicion
     FROM jugadores j
     JOIN partidos p ON p.id = j.partido_id
     WHERE j.titular = true
       AND ((p.equipo_local = $1 AND j.equipo = 'home')
         OR (p.equipo_visitante = $1 AND j.equipo = 'away'))`,
    [equipo]
  );
  const porPartido = new Map();
  for (const row of r.rows) {
    if (!porPartido.has(row.partido_id)) porPartido.set(row.partido_id, { G: 0, D: 0, M: 0, F: 0 });
    const c = porPartido.get(row.partido_id);
    if (row.posicion && c[row.posicion] !== undefined) c[row.posicion]++;
  }
  const conteo = new Map();
  for (const c of porPartido.values()) {
    const f = `${c.G}-${c.D}-${c.M}-${c.F}`;
    conteo.set(f, (conteo.get(f) || 0) + 1);
  }
  let mejor = null, n = 0;
  for (const [f, c] of conteo) {
    if (c > n) { mejor = f; n = c }
  }
  if (!mejor) return null;
  // Notacion sin el portero (estilo FotMob: "4-2-3-1", no "1-4-2-3-1").
  const [, d, m, f] = mejor.split("-");
  return { forma: `${d}-${m}-${f}`, completa: mejor, partidos: n, variantes: conteo.size };
}

// Squad de un equipo: jugadores distintos con posicion, dorsal y tasas.
// Un mismo player_id puede aparecer con dorsal/nombre distinto entre
// partidos: se agrupa solo por player_id y se toma el valor mas frecuente.
async function getSquad(equipo) {
  const r = await pool.query(
    `SELECT j.player_id,
       mode() WITHIN GROUP (ORDER BY j.nombre) AS nombre,
       mode() WITHIN GROUP (ORDER BY j.posicion) AS posicion,
       mode() WITHIN GROUP (ORDER BY j.dorsal) AS dorsal,
       ROUND(AVG(j.xg)::numeric, 3) AS xg_prom,
       ROUND(AVG(j.tiros)::numeric, 3) AS tiros_prom,
       COUNT(*)::int AS partidos
     FROM jugadores j
     JOIN partidos p ON p.id = j.partido_id
     WHERE (p.equipo_local = $1 AND j.equipo = 'home')
        OR (p.equipo_visitante = $1 AND j.equipo = 'away')
     GROUP BY j.player_id
     ORDER BY posicion, nombre`,
    [equipo]
  );
  const jugadores = r.rows.map((p) => ({ ...p, player_id: String(p.player_id) }));
  const formacion = await formacionTipica(equipo);
  return { jugadores, formacion };
}

// Mapa player_id -> xg_prom (tasa historica del jugador, cualquier equipo).
async function mapaTasasJugadores() {
  const r = await pool.query(
    `SELECT player_id, AVG(xg)::float AS xg, AVG(tiros)::float AS tiros
     FROM jugadores WHERE xg IS NOT NULL GROUP BY player_id`
  );
  const m = new Map();
  for (const row of r.rows) m.set(String(row.player_id), { xg: row.xg, tiros: row.tiros });
  return m;
}

// Suma de xG de un XI (titulares + 0.1*suplentes). defaultXg para sin datos.
function sumaXI(titulares, suplentes, tasas, defaultXg) {
  const suma = (lista) => lista.reduce((s, pid) => {
    const t = tasas.get(String(pid));
    return s + (t && Number.isFinite(t.xg) ? t.xg : defaultXg);
  }, 0);
  return suma(titulares) + PESO_SUPLENTE * suma(suplentes);
}

// xG tipico del equipo: promedio de la suma de XI en sus partidos con datos.
async function xgTipicoEquipo(equipo, tasas, defaultXg) {
  const r = await pool.query(
    `SELECT j.partido_id, j.equipo, j.player_id, j.titular
     FROM jugadores j
     JOIN partidos p ON p.id = j.partido_id
     WHERE ((p.equipo_local = $1 AND j.equipo = 'home')
         OR (p.equipo_visitante = $1 AND j.equipo = 'away'))
       AND j.xg IS NOT NULL`,
    [equipo]
  );
  const porPartido = new Map();
  for (const row of r.rows) {
    const k = `${row.partido_id}|${row.equipo}`;
    if (!porPartido.has(k)) porPartido.set(k, { tit: [], sup: [] });
    const lista = row.titular ? porPartido.get(k).tit : porPartido.get(k).sup;
    lista.push(String(row.player_id));
  }
  if (!porPartido.size) return null;
  let total = 0;
  for (const { tit, sup } of porPartido.values()) {
    total += sumaXI(tit, sup, tasas, defaultXg);
  }
  return total / porPartido.size;
}

// Ajusta los lambdas de una prediccion v1 segun la alineacion declarada.
// alineacion: { local: {titulares, suplentes, suspendidos}, visitante: {...} }
// Devuelve { lambdaHome, lambdaAway, ajuste } o null si no hay alineacion.
async function ajustarPorAlineacion({ local, visitante, alineacion, lambdaHome, lambdaAway }) {
  if (!alineacion || !alineacion.local || !alineacion.visitante) return null;
  const tasas = await mapaTasasJugadores();
  // xG por defecto: media de las tasas disponibles (o 0.1 si no hay).
  let defaultXg = 0.1;
  if (tasas.size) {
    let s = 0;
    for (const t of tasas.values()) s += t.xg;
    defaultXg = s / tasas.size;
  }

  const xiHome = sumaXI(alineacion.local.titulares || [], alineacion.local.suplentes || [], tasas, defaultXg);
  const xiAway = sumaXI(alineacion.visitante.titulares || [], alineacion.visitante.suplentes || [], tasas, defaultXg);
  const tipHome = await xgTipicoEquipo(local, tasas, defaultXg);
  const tipAway = await xgTipicoEquipo(visitante, tasas, defaultXg);

  // Si no hay tipico (sin historial de XI), no se ajusta.
  if (!tipHome || !tipAway) return null;

  const ratioHome = Math.min(Math.max(xiHome / tipHome, RATIO_MIN), RATIO_MAX);
  const ratioAway = Math.min(Math.max(xiAway / tipAway, RATIO_MIN), RATIO_MAX);
  const nuevoHome = lambdaHome * ratioHome / ratioAway;
  const nuevoAway = lambdaAway * ratioAway / ratioHome;

  return {
    lambdaHome: Math.min(nuevoHome, 8),
    lambdaAway: Math.min(nuevoAway, 8),
    ajuste: {
      xiHome: Math.round(xiHome * 100) / 100,
      xiAway: Math.round(xiAway * 100) / 100,
      tipicoHome: Math.round(tipHome * 100) / 100,
      tipicoAway: Math.round(tipAway * 100) / 100,
      ratioHome: Math.round(ratioHome * 100) / 100,
      ratioAway: Math.round(ratioAway * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// SOPORTE PARA EL 2T: el XI del descanso se conoce con certeza (viene en el
// JSON), asi que el ajuste es automatico. Se compara el "potencial" del XI
// que esta en cancha contra el XI tipico del equipo (promedio de sus
// partidos con datos de jugadores):
//   potencial = SUM de las tasas por 90 de los jugadores del XI
// Si hoy juega el XI habitual -> ratio ~ 1 (no cambia nada). Sisale un XI mas
// fuerte -> sube la projection del 2T; si son suplentes -> baja.
// ---------------------------------------------------------------------------

// Tasas por 90 minutos de cada jugador (xG, tiros, centros).
// OJO: los minutos se cuentan SOLO de los partidos donde esa stat existe (si
// no, la tasa se diluye: minutos de partidos sin xG + xG de los que sí lo
// tienen). Se exige un minimo de minutos por stat para usar la tasa.
const MIN_MINUTOS_TASA = 270; // ~3 partidos completos
const TOPES = { xg90: 1.5, tiros90: 5, crosses90: 3 };
const TTL_CACHE_MS = 10 * 60 * 1000;

// Cache en memoria (tasas y potencial tipico por equipo): son datos que
// cambian muy rara vez y se consultedan en cada proyeccion 2T.
let cacheTasas = { t: 0, v: null };
let cacheTipico = new Map(); // equipo -> { t, v }

async function tasasPor90() {
  const ahora = Date.now();
  if (cacheTasas.v && ahora - cacheTasas.t < TTL_CACHE_MS) return cacheTasas.v;
  const r = await pool.query(
    `SELECT player_id,
       mode() WITHIN GROUP (ORDER BY posicion) AS posicion,
       SUM(COALESCE(tiros,0))::float AS tiros,
       SUM(COALESCE(crosses,0))::float AS crosses,
       SUM(COALESCE(xg,0))::float AS xg,
       SUM(COALESCE(minutos,0)) FILTER (WHERE tiros IS NOT NULL)::float AS min_tiros,
       SUM(COALESCE(minutos,0)) FILTER (WHERE crosses IS NOT NULL)::float AS min_crosses,
       SUM(COALESCE(minutos,0)) FILTER (WHERE xg IS NOT NULL)::float AS min_xg,
       SUM(COALESCE(minutos,0))::float AS minutos
     FROM jugadores
     GROUP BY player_id
     HAVING SUM(COALESCE(minutos,0)) > 0`
  );
  const tasa = (suma, minutos) =>
    minutos >= MIN_MINUTOS_TASA ? (suma / minutos) * 90 : null;
  const m = new Map();
  for (const row of r.rows) {
    m.set(String(row.player_id), {
      posicion: row.posicion || null,
      tiros90: tasa(row.tiros, row.min_tiros),
      crosses90: tasa(row.crosses, row.min_crosses),
      xg90: tasa(row.xg, row.min_xg),
      minutos: row.minutos,
    });
  }
  // Topes de seguridad (rates absurdos por muestras minimas).
  for (const t of m.values()) {
    if (t.tiros90 != null) t.tiros90 = Math.min(t.tiros90, TOPES.tiros90);
    if (t.crosses90 != null) t.crosses90 = Math.min(t.crosses90, TOPES.crosses90);
    if (t.xg90 != null) t.xg90 = Math.min(t.xg90, TOPES.xg90);
  }
  cacheTasas = { t: ahora, v: m };
  return m;
}

// Defaults por posicion (para jugadores sin historia suficiente): un titular
// sin datos debe valer como un jugador promedio de SU posicion, no como la
// media global (si no, el ajuste castiga artificialmente a las rotaciones).
function defaultsPorPosicion(tasas) {
  const acc = { G: { xg: [], tiros: [], cross: [] }, D: { xg: [], tiros: [], cross: [] }, M: { xg: [], tiros: [], cross: [] }, F: { xg: [], tiros: [], cross: [] } };
  const global = { xg: [], tiros: [], cross: [] };
  for (const t of tasas.values()) {
    const pos = acc[t.posicion] ? t.posicion : null
    if (t.xg90 != null) { global.xg.push(t.xg90); if (pos) acc[pos].xg.push(t.xg90) }
    if (t.tiros90 != null) { global.tiros.push(t.tiros90); if (pos) acc[pos].tiros.push(t.tiros90) }
    if (t.crosses90 != null) { global.cross.push(t.crosses90); if (pos) acc[pos].cross.push(t.crosses90) }
  }
  const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
  const g = { xg: media(global.xg), tiros: media(global.tiros), cross: media(global.cross) }
  const porPosicion = {}
  for (const pos of ["G", "D", "M", "F"]) {
    porPosicion[pos] = {
      xg90: media(acc[pos].xg) ?? g.xg,
      tiros90: media(acc[pos].tiros) ?? g.tiros,
      crosses90: media(acc[pos].cross) ?? g.cross,
    }
  }
  return {
    xg90: g.xg ?? 0.1,
    tiros90: g.tiros ?? 1,
    crosses90: g.cross ?? 0.2,
    porPosicion,
  }
}

// Potencial de un XI (suma de tasas por 90 de sus jugadores).
// Solo cuenta a los queestan en cancha: titulares (peso 1) y suplentes que
// entraron (peso 0.5: aportan parte del partido).
function potencialXI(jugadores, tasas, defaults) {
  const pot = { goles: 0, remates: 0, corners: 0 };
  for (const j of jugadores) {
    const t = tasas.get(String(j.player_id));
    const peso = j.titular ? 1 : 0.5;
    const pos = j.posicion || (t && t.posicion) || null;
    const def = (defaults.porPosicion && defaults.porPosicion[pos]) || null;
    const defXg = def ? def.xg90 : defaults.xg90;
    const defTiros = def ? def.tiros90 : defaults.tiros90;
    const defCross = def ? def.crosses90 : defaults.crosses90;
    const xg = t && t.xg90 != null ? t.xg90 : defXg;
    pot.goles += peso * xg;
    pot.remates += peso * (t && t.tiros90 != null ? t.tiros90 : defTiros);
    pot.corners += peso * (t && t.crosses90 != null ? t.crosses90 : defCross);
  }
  return pot;
}

// Potencial tipico del equipo: MEDIANA del potencial de sus XIs historicos.
// Se usa la mediana (no la media) porque los XI historicos incluyen los
// mejores jugadores y la media quedaria inflada: con la media, un XI de
// rotados siempre salia "mas flojo" de lo que es (sesgo de seleccion).
async function potencialTipicoEquipo(equipo, tasas, defaults) {
  const ahora = Date.now();
  const hit = cacheTipico.get(equipo);
  if (hit && ahora - hit.t < TTL_CACHE_MS) return hit.v;
  const r = await pool.query(
    `SELECT j.partido_id, j.equipo, j.player_id, j.titular, j.posicion
     FROM jugadores j
     JOIN partidos p ON p.id = j.partido_id
     WHERE ((p.equipo_local = $1 AND j.equipo = 'home')
         OR (p.equipo_visitante = $1 AND j.equipo = 'away'))`,
    [equipo]
  );
  const porPartido = new Map();
  for (const row of r.rows) {
    // Sólo el XI que empezó (11): la comparación debe ser contra el XI, no
    // contra los 22 del partido (si no, los suplentes inflan la referencia).
    if (!row.titular) continue;
    const k = `${row.partido_id}|${row.equipo}`;
    if (!porPartido.has(k)) porPartido.set(k, []);
    porPartido.get(k).push({ player_id: row.player_id, titular: true, posicion: row.posicion });
  }
  if (!porPartido.size) return null;
  const pots = [...porPartido.values()].map((xi) => potencialXI(xi, tasas, defaults));
  const mediana = (arr) => {
    const s = [...arr].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  };
  const res = {
    goles: mediana(pots.map((p) => p.goles)),
    remates: mediana(pots.map((p) => p.remates)),
    corners: mediana(pots.map((p) => p.corners)),
  };
  cacheTipico.set(equipo, { t: ahora, v: res });
  return res;
}

// ---------------------------------------------------------------------------
// REMATES POR XI: estimacion de los remates (tiros) del equipo a partir del
// XI declarado. Es el UNICO mercado donde la XI mejora (backtest leave-one-out
// sobre 664 equipos-partido: MAE 5.01 con XI vs 5.59 con el promedio del
// equipo, -10.4%). En goles/1X2 la XI no aporta informacion residual
// (correlacion 0.05/0.01) y en el 2T el 1T ya la contiene.
// ---------------------------------------------------------------------------
async function estimarRematesXI(playerIds) {
  const tasas = await tasasPor90();
  if (!tasas.size) return null;
  const defaults = defaultsPorPosicion(tasas);
  const xi = (playerIds || []).map((pid) => ({
    player_id: pid,
    titular: true,
    posicion: (tasas.get(String(pid)) || {}).posicion || null,
  }));
  if (!xi.length) return null;
  const pot = potencialXI(xi, tasas, defaults);
  // Un XI de 11 con ~1.5 tiros/90 cada uno ~ 16 remates; si sale un valor
  // absurdo (XI incompleto) se descarta.
  if (!Number.isFinite(pot.remates) || pot.remates <= 0 || pot.remates > 40) return null;
  return Math.round(pot.remates * 100) / 100;
}

module.exports = {
  getSquad, formacionTipica, ajustarPorAlineacion, mapaTasasJugadores, xgTipicoEquipo,
  tasasPor90, potencialXI, potencialTipicoEquipo, defaultsPorPosicion,
  estimarRematesXI,
};
