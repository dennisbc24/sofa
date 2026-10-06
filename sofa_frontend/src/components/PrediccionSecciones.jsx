import { formatearFecha } from "../utils.js"

const FILAS_TIEMPO = [
  { key: "gf_t1", etiqueta: "Goles a favor 1T" },
  { key: "gf_t2", etiqueta: "Goles a favor 2T" },
  { key: "gc_t1", etiqueta: "Goles en contra 1T" },
  { key: "gc_t2", etiqueta: "Goles en contra 2T" },
  { key: "xg_t1", etiqueta: "xG 1T" },
  { key: "remates_t1", etiqueta: "Remates 1T" },
  { key: "al_arco_t1", etiqueta: "Remates al arco 1T" },
  { key: "corners_t1", etiqueta: "Corners 1T" },
]

const redondear = (v) => (v === null || v === undefined ? "—" : Math.round(v * 100) / 100)

export const FormaEquipo = ({ titulo, perfil }) => {
  const f = perfil.forma
  return (
    <section className="card">
      <div className="card-header">{titulo}</div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Periodo</th>
            <th>V</th>
            <th>E</th>
            <th>D</th>
            <th>%Vict</th>
            <th>GF</th>
            <th>GC</th>
          </tr>
        </thead>
        <tbody>
          {[["Últimos 5", f.ultimos5], ["Últimos 10", f.ultimos10], ["Últimos 20", f.ultimos20]].map(
            ([etiqueta, fila]) => (
              <tr key={etiqueta}>
                <td>{etiqueta}</td>
                <td className="tabla-num">{fila.victorias}</td>
                <td className="tabla-num">{fila.empates}</td>
                <td className="tabla-num">{fila.derrotas}</td>
                <td className="tabla-num">{fila.pctVictorias}%</td>
                <td className="tabla-num">{fila.golesFavor}</td>
                <td className="tabla-num">{fila.golesContra}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
      <div className="card-header" style={{ marginTop: 12 }}>Últimos partidos</div>
      <ul className="lista-recientes">
        {perfil.recientes.map((p) => (
          <li key={p.fecha + p.rival} className="reciente-item">
            <span className="reciente-fecha">{formatearFecha(p.fecha)}</span>
            <span className={`resultado-chip resultado-${p.resultado.toLowerCase()}`}>{p.resultado}</span>
            <span className="reciente-rival">
              ({p.condicion}) {p.rival} {p.gf}-{p.gc}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Secciones COMPLETAS de una predicción pre-partido: comparación de métricas,
// forma de ambos equipos, datos por tiempo, enfrentamientos directos,
// explicación del modelo y datos/backtest. Se usan tanto en la vista de
// análisis original como en el detalle del historial (payload completo);
// cada sección sólo se pinta si su dato existe (filas antiguas sin backfill).
export const SeccionesAnalisis = ({ datos }) => {
  if (!datos) return null
  const hf = datos.homeFeatures
  const af = datos.awayFeatures
  const hayComparacion = Array.isArray(datos.comparison) && hf?.equipo && af?.equipo
  const hayForma = hf?.forma && hf?.recientes && af?.forma && af?.recientes
  const hayTiempo = hf?.statsComparadas && af?.statsComparadas
  const hayH2H = datos.headToHead?.resumen
  const hayDatos = datos.datosUtilizados && datos.modelInfo

  return (
    <>
      {hayComparacion && (
        <section className="card">
          <div className="card-header">
            Comparación — {hf.equipo} (local) vs {af.equipo} (visita)
          </div>
          <p className="tabla-status">
            Fuente: {hf.fuenteStats === "local" && af.fuenteStats === "visita"
              ? "partidos en la condición del partido (local vs local, visita vs visita)"
              : "historial general (alguno de los equipos tiene < 3 partidos en su condición)"}
          </p>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>{hf.equipo}</th>
                  <th>{af.equipo}</th>
                </tr>
              </thead>
              <tbody>
                {datos.comparison.map((c) => (
                  <tr key={c.metrica}>
                    <td>{c.metrica}</td>
                    <td className={`tabla-num ${c.ventaja === "local" ? "ventaja-local" : ""}`}>
                      {c.local ?? "—"}
                    </td>
                    <td className={`tabla-num ${c.ventaja === "visita" ? "ventaja-local" : ""}`}>
                      {c.visitante ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hayForma && (
        <div className="dos-col">
          <FormaEquipo titulo={`Forma — ${hf.equipo}`} perfil={hf} />
          <FormaEquipo titulo={`Forma — ${af.equipo}`} perfil={af} />
        </div>
      )}

      {hayTiempo && (
        <section className="card">
          <div className="card-header">Por tiempo (1T / 2T)</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>{hf.equipo}</th>
                  <th>{af.equipo}</th>
                </tr>
              </thead>
              <tbody>
                {FILAS_TIEMPO.map((f) => (
                  <tr key={f.key}>
                    <td>{f.etiqueta}</td>
                    <td className="tabla-num">{redondear(hf.statsComparadas[f.key])}</td>
                    <td className="tabla-num">{redondear(af.statsComparadas[f.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hayH2H && (
        <section className="card">
          <div className="card-header">Enfrentamientos directos (H2H)</div>
          {datos.headToHead.resumen.n === 0 ? (
            <p className="tabla-status">
              Sin enfrentamientos directos previos antes de {formatearFecha(datos.match?.date)}.
            </p>
          ) : (
            <>
              <p className="tabla-status">
                {datos.headToHead.resumen.n} partido(s) — para {hf?.equipo}:{" "}
                {datos.headToHead.resumen.victorias}v {datos.headToHead.resumen.empates}e{" "}
                {datos.headToHead.resumen.derrotas}d (de local{" "}
                {datos.headToHead.resumen.comoLocal.victorias}-{datos.headToHead.resumen.comoLocal.empates}-
                {datos.headToHead.resumen.comoLocal.derrotas}, de visita{" "}
                {datos.headToHead.resumen.comoVisitante.victorias}-{datos.headToHead.resumen.comoVisitante.empates}-
                {datos.headToHead.resumen.comoVisitante.derrotas}), promedio{" "}
                {datos.headToHead.resumen.promedioGoles} goles.
              </p>
              <div className="tabla-scroll">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Local</th>
                      <th>Marcador</th>
                      <th>Visita</th>
                      <th>{hf?.equipo}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.headToHead.partidos.map((p) => (
                      <tr key={p.fecha + p.equipo_local}>
                        <td>{formatearFecha(p.fecha)}</td>
                        <td className={p.equipoLocalEsLocal ? "tabla-equipo" : ""}>{p.equipo_local}</td>
                        <td className="tabla-num">{p.goles_local}-{p.goles_visitante}</td>
                        <td className={!p.equipoLocalEsLocal ? "tabla-equipo" : ""}>{p.equipo_visitante}</td>
                        <td className={`resultado-chip resultado-${p.resultadoParaLocal.toLowerCase()}`}>
                          {p.resultadoParaLocal}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {datos.explanation?.length > 0 && (
        <section className="card">
          <div className="card-header">Explicación del modelo</div>
          <ul className="explicacion">
            {datos.explanation.map((frase) => (
              <li key={frase}>{frase}</li>
            ))}
          </ul>
        </section>
      )}

      {hayDatos && (
        <section className="card card-clara">
          <div className="card-header">Datos y backtest</div>
          <div className="result-row">
            <span className="result-label">Fecha de corte</span>
            <span className="result-value">{formatearFecha(datos.datosUtilizados.fechaCorte)}</span>
          </div>
          <div className="result-row">
            <span className="result-label">{datos.datosUtilizados.local.condicion === "local" ? "Local (como local)" : "Local (general)"}</span>
            <span className="result-value">
              {datos.datosUtilizados.local.partidos} partidos · {formatearFecha(datos.datosUtilizados.local.desde)} → {formatearFecha(datos.datosUtilizados.local.hasta)}
            </span>
          </div>
          <div className="result-row">
            <span className="result-label">{datos.datosUtilizados.visitante.condicion === "visita" ? "Visita (como visita)" : "Visita (general)"}</span>
            <span className="result-value">
              {datos.datosUtilizados.visitante.partidos} partidos · {formatearFecha(datos.datosUtilizados.visitante.desde)} → {formatearFecha(datos.datosUtilizados.visitante.hasta)}
            </span>
          </div>
          <div className="result-row">
            <span className="result-label">Muestra del modelo</span>
            <span className="result-value">
              {datos.modelInfo.muestra?.partidos} partidos, {datos.modelInfo.muestra?.equipos} equipos
              ({formatearFecha(datos.modelInfo.muestra?.desde)} → {formatearFecha(datos.modelInfo.muestra?.hasta)})
            </span>
          </div>
          {datos.modelInfo.backtest?.test && (
            <>
              <div className="result-row">
                <span className="result-label">Test (accuracy / log loss / Brier)</span>
                <span className="result-value">
                  {(datos.modelInfo.backtest.test.accuracy * 100).toFixed(2)}% · {datos.modelInfo.backtest.test.logLoss} · {datos.modelInfo.backtest.test.brier}
                </span>
              </div>
              <div className="result-row">
                <span className="result-label">Baseline en test</span>
                <span className="result-value">{(datos.modelInfo.backtest.baselineTest * 100).toFixed(2)}%</span>
              </div>
            </>
          )}
          <p className="tabla-status">{datos.modelInfo.backtest?.nota}</p>
        </section>
      )}
    </>
  )
}
