// Diagnóstico: ¿es real el signo negativo de β (Elo) y γ (forma) o es bug?
const pool = require("../db");
const { entrenarExp } = require("./modelo_mu_exp");
const { calcularElo } = require("./elo");
const { dividirTemporal } = require("../services/prediccion/backtest");

const EPS = 1e-9;
const logLik = (y, l) => y * Math.log(l + EPS) - l;

(async () => {
  const { rows } = await pool.query(`
    SELECT fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos WHERE estado='Ended' AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL AND goles_visitante IS NOT NULL
    ORDER BY fecha_partido ASC, id ASC;`);
  const partidos = rows.map((x) => ({
    fecha: x.fecha_partido, liga: x.liga, home: x.equipo_local, away: x.equipo_visitante,
    goalsH: x.goles_local, goalsA: x.goles_visitante,
  }));
  const bloques = dividirTemporal(partidos, { trainPct: 0.6, valPct: 0.2 });
  const TV = [...bloques.train, ...bloques.val];
  const { antes } = calcularElo(TV, { k: 32 });
  const aug = TV.map((p, i) => ({ ...p, eloHome: antes[i].home, eloAway: antes[i].away }));

  const train = aug.slice(0, bloques.train.length);
  const val = aug.slice(bloques.train.length);

  const corr = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return n / Math.sqrt(dx * dy);
  };

  const dElo = train.map((p) => (p.eloHome - p.eloAway) / 400);
  const dGol = train.map((p) => p.goalsH - p.goalsA);
  console.log(`TRAIN: corr(Δelo/400, y_h−y_a) = ${corr(dElo, dGol).toFixed(4)}`);

  const ter = [...dElo].sort((a, b) => a - b);
  const t1 = ter[Math.floor(ter.length / 3)], t2 = ter[Math.floor((2 * ter.length) / 3)];
  const grupos = { "Δelo bajo": [], "Δelo medio": [], "Δelo alto": [] };
  train.forEach((p, i) => {
    const d = dElo[i];
    (d <= t1 ? grupos["Δelo bajo"] : d <= t2 ? grupos["Δelo medio"] : grupos["Δelo alto"]).push(dGol[i]);
  });
  for (const [g, arr] of Object.entries(grupos)) {
    console.log(`  ${g.padEnd(11)} n=${String(arr.length).padStart(4)}  E[y_h−y_a]=${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3)}`);
  }

  // modelo V1 como base
  const V1 = entrenarExp(bloques.train, "SPEC30");
  const muDe = (m, liga) => (m.ligas && m.ligas[liga]) || { muHome: m.muHomeGlobal, muAway: m.muAwayGlobal };
  const llCon = (set, beta, gamma, usarForma) => {
    let ll = 0;
    for (const p of set) {
      const mu = muDe(V1, p.liga);
      const xE = (p.eloHome - p.eloAway) / 400;
      const xF = 0;
      const lh = Math.exp(Math.log(mu.muHome) + (V1.att[p.home] ?? 0) - (V1.def[p.away] ?? 0) + beta * xE);
      const la = Math.exp(Math.log(mu.muAway) + (V1.att[p.away] ?? 0) - (V1.def[p.home] ?? 0) - beta * xE);
      ll += logLik(p.goalsH, lh) + logLik(p.goalsA, la);
    }
    return ll / set.length / 2; // por gol
  };

  // (A) SOLO β con att/def = 0 (aisla el gradiente; μ de V1)
  let beta0 = 0;
  for (let epoch = 0; epoch < 400; epoch++) {
    let lr = 0.05 * Math.pow(0.995, epoch);
    for (const p of train) {
      const mu = muDe(V1, p.liga);
      const xE = (p.eloHome - p.eloAway) / 400;
      const lh = Math.exp(Math.log(mu.muHome) + beta0 * xE);
      const la = Math.exp(Math.log(mu.muAway) - beta0 * xE);
      const gH = p.goalsH - lh, gA = p.goalsA - la;
      beta0 += lr * ((gH - gA) * xE - 0.01 * beta0);
    }
  }
  console.log(`\n(A) solo β (att/def=0): β entrenado = ${beta0.toFixed(4)} → ${beta0 > 0 ? "POSITIVO (gradiente OK si además corr>0)" : "NEGATIVO"}`);

  // (B) att/def de V1 FIJOS + grid β → mejor β en TRAIN y en VAL
  const grid = [];
  for (let b = -2; b <= 2.0001; b += 0.5) grid.push(Math.round(b * 10) / 10);
  const mejorEn = (set) => {
    let best = null;
    for (const b of grid) {
      const ll = llCon(set, b, 0);
      if (!best || ll > best.ll) best = { b, ll };
    }
    return best;
  };
  console.log("\n(B) curva LL/gol con att/def de V1 FIJOS (β=0 base):");
  for (const b of grid) {
    console.log(`  β=${String(b).padStart(4)}  train=${llCon(train, b, 0).toFixed(4)}  val=${llCon(val, b, 0).toFixed(4)}`);
  }
  const mT = mejorEn(train), mV = mejorEn(val);
  console.log(`(B) mejor β TRAIN = ${mT.b} (${mT.ll.toFixed(4)}) | mejor β VAL = ${mV.b} (${mV.ll.toFixed(4)}) | β=0: train ${llCon(train, 0, 0).toFixed(4)} / val ${llCon(val, 0, 0).toFixed(4)}`);

  // (C) misma prueba con forma reciente (γ) — forma calculada en train
  const hist = new Map();
  const formaAntes = [];
  const tasa = (a) => (a && a.length ? a.slice(-5).reduce((x, y) => x + y, 0) / (3 * Math.min(5, a.length)) : 0);
  for (const p of train) {
    formaAntes.push({ h: tasa(hist.get(p.home)), a: tasa(hist.get(p.away)) });
    const pH = p.goalsH > p.goalsA ? 3 : p.goalsH === p.goalsA ? 1 : 0;
    const pA = p.goalsA > p.goalsH ? 3 : p.goalsA === p.goalsH ? 1 : 0;
    for (const [eq, r] of [[p.home, pH], [p.away, pA]]) {
      if (!hist.has(eq)) hist.set(eq, []);
      hist.get(eq).push(r);
      if (hist.get(eq).length > 10) hist.get(eq).shift();
    }
  }
  const dForm = train.map((p, i) => formaAntes[i].h - formaAntes[i].a);
  console.log(`\nTRAIN: corr(Δforma, y_h−y_a) = ${corr(dForm, dGol).toFixed(4)}`);
  let g0 = 0;
  for (let epoch = 0; epoch < 400; epoch++) {
    const lr = 0.05 * Math.pow(0.995, epoch);
    train.forEach((p, i) => {
      const mu = muDe(V1, p.liga);
      const xF = dForm[i];
      const lh = Math.exp(Math.log(mu.muHome) + g0 * xF);
      const la = Math.exp(Math.log(mu.muAway) - g0 * xF);
      const gH = p.goalsH - lh, gA = p.goalsA - la;
      g0 += lr * ((gH - gA) * xF - 0.01 * g0);
    });
  }
  console.log(`(A') solo γ (att/def=0): γ = ${g0.toFixed(4)} → ${g0 > 0 ? "POSITIVO" : "NEGATIVO"}`);

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
