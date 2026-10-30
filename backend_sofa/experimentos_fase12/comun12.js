// ---------------------------------------------------------------------------
// FASE 12 — datos y features para mercados pre-partido.
//
// Mercados: goles (total/1T/2T), remates y corners (total/1T/2T).
// Reglas:
//  - Solo partidos Ended con goles FT; el corte lo pone el llamador.
//  - Features con corte DÍA ESTRICTO: el estado se actualiza después de
//    predecir todos los partidos del día.
//  - Duplicados de `estadisticas` se agregan con MAX (igual que producción).
//  - Baseline de remates/corners = fórmula de producción (últimos 40,
//    condición si n>=3). Baseline de goles = lambdas V1 (se entrenan fuera).
// ---------------------------------------------------------------------------
const pool = require("../db");

const KEYS = ["goals", "shots", "corners"];
const NOMBRES = { shots: "Total shots", corners: "Corner kicks" };
const WINDOWS = [5, 10, 20, 40];

const dia = (f) => new Date(f).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function baseLiga(liga) {
  return String(liga || "")
    .replace(/\u00A0/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b\d{2}\/\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "General";
}

async function cargarPartidos(hasta) {
  const base = await pool.query(
    `SELECT p.id, p.fecha_partido::text AS fecha, p.liga,
            p.equipo_local AS home, p.equipo_visitante AS away,
            p.goles_local::int AS gh, p.goles_visitante::int AS ga,
            p.goles_local_1t::int AS gh1, p.goles_visitante_1t::int AS ga1
       FROM partidos p
      WHERE p.estado='Ended' AND p.fecha_partido IS NOT NULL
        AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
        AND p.fecha_partido <= $1
      ORDER BY p.fecha_partido ASC, p.id ASC`,
    [hasta]
  );

  const stats = await pool.query(
    `SELECT partido_id, nombre, periodo,
            MAX(valor_local_num)::float AS l,
            MAX(valor_visitante_num)::float AS a
       FROM estadisticas
      WHERE nombre IN ('Total shots','Corner kicks')
        AND periodo IN ('1ST','2ND','ALL')
      GROUP BY 1,2,3`
  );

  const porPartido = new Map();
  for (const r of stats.rows) {
    const id = String(r.partido_id);
    if (!porPartido.has(id)) porPartido.set(id, {});
    const m = porPartido.get(id);
    if (!m[r.nombre]) m[r.nombre] = {};
    m[r.nombre][r.periodo] = { l: r.l, a: r.a };
  }

  const out = [];
  for (const r of base.rows) {
    const st = porPartido.get(String(r.id)) || {};
    const statsObj = {};
    for (const key of ["shots", "corners"]) {
      const d = st[NOMBRES[key]] || {};
      const t1 = d["1ST"] || null;
      const t2 = d["2ND"] || null;
      const all = d["ALL"] || null;
      const lado = (x) => {
        if (!x) return { total: null, first: null, second: null };
        const total =
          t1 && t2 && t1[x] != null && t2[x] != null
            ? Number(t1[x]) + Number(t2[x])
            : all && all[x] != null
              ? Number(all[x])
              : null;
        const first = t1 && t1[x] != null ? Number(t1[x]) : null;
        const second =
          t2 && t2[x] != null
            ? Number(t2[x])
            : total != null && first != null
              ? total - first
              : null;
        return { total, first, second };
      };
      statsObj[key] = { home: lado("l"), away: lado("a") };
    }
    const g1h = r.gh1 == null ? null : Number(r.gh1);
    const g1a = r.ga1 == null ? null : Number(r.ga1);
    out.push({
      id: String(r.id),
      fecha: r.fecha,
      ms: Date.parse(r.fecha),
      liga: r.liga,
      base: baseLiga(r.liga),
      home: r.home,
      away: r.away,
      gh: Number(r.gh),
      ga: Number(r.ga),
      goalsH: Number(r.gh),
      goalsA: Number(r.ga),
      gh1: g1h,
      ga1: g1a,
      stats: statsObj,
    });
  }
  return out;
}

// Valor de una stat por lado/periodo. `field` ∈ for, against, firstFor, ...
function statVal(e, key, field) {
  const v = e.v[key];
  if (!v) return null;
  return v[field];
}

function agg(arr, key, field) {
  let s = 0;
  let n = 0;
  for (const e of arr) {
    const v = statVal(e, key, field);
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      s += v;
      n += 1;
    }
  }
  return { m: n ? s / n : null, n };
}

function shrink(m, n, prior, c) {
  if (m === null || m === undefined) return prior;
  if (!n) return prior;
  return (n * m + c * prior) / (n + c);
}

function adj(ownAgg, oppAgg, ref, c) {
  const a = shrink(ownAgg.m, ownAgg.n, ref, c);
  const d = shrink(oppAgg.m, oppAgg.n, ref, c);
  return (a * d) / Math.max(ref, 1e-6);
}

function pack(arrOwn, arrOpp, key) {
  return {
    for: agg(arrOwn, key, "for"),
    against: agg(arrOwn, key, "against"),
    firstFor: agg(arrOwn, key, "firstFor"),
    firstAgainst: agg(arrOwn, key, "firstAgainst"),
    secondFor: agg(arrOwn, key, "secondFor"),
    secondAgainst: agg(arrOwn, key, "secondAgainst"),
    oppFor: agg(arrOpp, key, "for"),
    oppAgainst: agg(arrOpp, key, "against"),
    oppFirstFor: agg(arrOpp, key, "firstFor"),
    oppFirstAgainst: agg(arrOpp, key, "firstAgainst"),
    oppSecondFor: agg(arrOpp, key, "secondFor"),
    oppSecondAgainst: agg(arrOpp, key, "secondAgainst"),
  };
}

function baseSide(poolArr, key) {
  const own = agg(poolArr, key, "for");
  const first = agg(poolArr, key, "firstFor");
  const total = own.m;
  const fallback = key === "goals" ? 0.45 : 0.5;
  const share =
    total !== null && total > 0 && first.m !== null
      ? clamp(first.m / total, 0.15, 0.85)
      : fallback;
  return {
    total,
    first: total === null ? null : total * share,
    second: total === null ? null : total * (1 - share),
    share,
    n: own.n,
  };
}

function sideFeatures(h, ho, cond, refs, c = 6) {
  const h40 = h.slice(-40);
  const condH = h40.filter((e) => e.cond === cond);
  const pool = condH.length >= 3 ? condH : h40;
  const oppCond = cond === "home" ? "away" : "home";

  const out = {};
  for (const key of KEYS) {
    const ref = refs[key].total;
    const refFirst = refs[key].first;
    const refSecond = refs[key].second;
    const base = baseSide(pool, key);
    const ws = {};
    for (const W of WINDOWS) {
      const hW = h.slice(-W);
      const hoW = ho.slice(-W);
      const condHW = h.filter((e) => e.cond === cond).slice(-W);
      const condHoW = ho.filter((e) => e.cond === oppCond).slice(-W);
      const g = pack(hW, hoW, key);
      const q = pack(condHW, condHoW, key);
      ws[W] = {
        general: {
          total: adj(g.for, g.oppAgainst, ref, c),
          first: adj(g.firstFor, g.oppFirstAgainst, refFirst, c),
          second: adj(g.secondFor, g.oppSecondAgainst, refSecond, c),
          against: adj(g.against, g.oppFor, ref, c),
          nOwn: g.for.n,
          nOpp: g.oppAgainst.n,
        },
        cond: {
          total: adj(q.for, q.oppAgainst, ref, c),
          first: adj(q.firstFor, q.oppFirstAgainst, refFirst, c),
          second: adj(q.secondFor, q.oppSecondAgainst, refSecond, c),
          against: adj(q.against, q.oppFor, ref, c),
          nOwn: q.for.n,
          nOpp: q.oppAgainst.n,
        },
        raw: {
          ownFor: g.for.m,
          ownAgainst: g.against.m,
          oppFor: g.oppFor.m,
          oppAgainst: g.oppAgainst.m,
          ownFirst: g.firstFor.m,
          oppFirstAgainst: g.oppFirstAgainst.m,
          ownSecond: g.secondFor.m,
          oppSecondAgainst: g.oppSecondAgainst.m,
          ownForCond: q.for.m,
          oppAgainstCond: q.oppAgainst.m,
        },
      };
    }
    out[key] = { base, ws };
  }
  return out;
}

function entryFor(p, side) {
  const isHome = side === "home";
  const gf = isHome ? p.gh : p.ga;
  const ga = isHome ? p.ga : p.gh;
  const gf1 = isHome ? p.gh1 : p.ga1;
  const ga1 = isHome ? p.ga1 : p.gh1;
  const v = {
    goals: {
      for: gf,
      against: ga,
      firstFor: gf1,
      firstAgainst: ga1,
      secondFor: gf1 === null ? null : gf - gf1,
      secondAgainst: ga1 === null ? null : ga - ga1,
    },
  };
  for (const key of ["shots", "corners"]) {
    const own = p.stats[key][side];
    const opp = p.stats[key][isHome ? "away" : "home"];
    v[key] = {
      for: own.total,
      against: opp.total,
      firstFor: own.first,
      firstAgainst: opp.first,
      secondFor: own.second,
      secondAgainst: opp.second,
    };
  }
  return { ms: p.ms, fecha: p.fecha, cond: side, v };
}

const campoVacio = () => ({
  total: { s: 0, n: 0 },
  first: { s: 0, n: 0 },
  second: { s: 0, n: 0 },
});

function addAgg(map, key, field, liga, vals) {
  if (!map.has(liga)) map.set(liga, {});
  const m = map.get(liga);
  if (!m[key]) m[key] = campoVacio();
  const t = m[key][field];
  for (const v of vals) {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      t.s += v;
      t.n += 1;
    }
  }
}

function construirFeatures(partidos, { c = 6 } = {}) {
  const hist = new Map();
  const aggLiga = new Map();
  const aggBase = new Map();
  const aggGlobal = Object.fromEntries(KEYS.map((k) => [k, campoVacio()]));

  const refDe = (key, field, liga, base) => {
    const g = aggGlobal[key][field];
    const l = aggLiga.get(liga);
    if (l && l[key] && l[key][field] && l[key][field].n >= 10) {
      return l[key][field].s / l[key][field].n;
    }
    const b = aggBase.get(base);
    if (b && b[key] && b[key][field] && b[key][field].n >= 10) {
      return b[key][field].s / b[key][field].n;
    }
    if (g.n > 0) return g.s / g.n;
    if (key === "goals") return field === "total" ? 1.35 : field === "first" ? 0.6 : 0.75;
    if (key === "shots") return field === "total" ? 12.8 : field === "first" ? 5.8 : 7;
    return field === "total" ? 4.6 : field === "first" ? 2.1 : 2.5;
  };

  const out = [];
  let i = 0;
  while (i < partidos.length) {
    const d = dia(partidos[i].fecha);
    let j = i;
    while (j < partidos.length && dia(partidos[j].fecha) === d) j += 1;

    for (let k = i; k < j; k++) {
      const p = partidos[k];
      const h = hist.get(p.home) || [];
      const a = hist.get(p.away) || [];
      const refs = {
        goals: {
          total: refDe("goals", "total", p.liga, p.base),
          first: refDe("goals", "first", p.liga, p.base),
          second: refDe("goals", "second", p.liga, p.base),
        },
        shots: {
          total: refDe("shots", "total", p.liga, p.base),
          first: refDe("shots", "first", p.liga, p.base),
          second: refDe("shots", "second", p.liga, p.base),
        },
        corners: {
          total: refDe("corners", "total", p.liga, p.base),
          first: refDe("corners", "first", p.liga, p.base),
          second: refDe("corners", "second", p.liga, p.base),
        },
      };
      p.f = {
        home: sideFeatures(h, a, "home", refs, c),
        away: sideFeatures(a, h, "away", refs, c),
        refs,
      };
      out.push(p);
    }

    for (let k = i; k < j; k++) {
      const p = partidos[k];
      for (const side of ["home", "away"]) {
        const eq = side === "home" ? p.home : p.away;
        if (!hist.has(eq)) hist.set(eq, []);
        hist.get(eq).push(entryFor(p, side));
      }
      for (const key of KEYS) {
        const own =
          key === "goals"
            ? {
                total: [p.gh, p.ga],
                first: [p.gh1, p.ga1],
                second: [
                  p.gh1 === null ? null : p.gh - p.gh1,
                  p.ga1 === null ? null : p.ga - p.ga1,
                ],
              }
            : {
                total: [p.stats[key].home.total, p.stats[key].away.total],
                first: [p.stats[key].home.first, p.stats[key].away.first],
                second: [p.stats[key].home.second, p.stats[key].away.second],
              };
        for (const field of ["total", "first", "second"]) {
          addAgg(aggLiga, key, field, p.liga, own[field]);
          addAgg(aggBase, key, field, p.base, own[field]);
          const g = aggGlobal[key][field];
          for (const v of own[field]) {
            if (v !== null && v !== undefined && Number.isFinite(v)) {
              g.s += v;
              g.n += 1;
            }
          }
        }
      }
    }
    i = j;
  }
  return out;
}

module.exports = {
  KEYS, NOMBRES, WINDOWS,
  dia, clamp, baseLiga, cargarPartidos, construirFeatures,
  agg, shrink,
};
