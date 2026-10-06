import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import { API_URL } from "../config.js"
import { formatearFecha, formatearFechaHora } from "../utils.js"

// Historial de predicciones del usuario: se guardan SOLAS cada vez que se
// analiza un partido (1X2 o proyección 2T). Si se repite exactamente la misma
// predicción sólo sube el contador "veces". Al ver una predicción pasada, si el
// partido ya tiene datos reales, se marcan en verde/ámbar/rojo los aciertos.
const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2))
const RESULTADOS = { home: "Local", draw: "Empate", away: "Visita" }
const CLASE_CELDA = { exacto: "celda-exacto", cercano: "celda-cercano", lejos: "celda-lejos" }

const etiquetaTipo = (t) => (t === "pre" ? "Pre-partido" : "Proyección 2T")
const MERCADOS = [
  { key: "goles", etiqueta: "Goles" },
  { key: "corners", etiqueta: "Corners" },
  { key: "remates", etiqueta: "Remates" },
  { key: "tarjetas", etiqueta: "Tarjetas amarillas" },
]
const ETIQUETA_CLASE = { exacto: "exacto", cercano: "cerca", lejos: "lejos" }
const claseCelda = (cl) => (cl ? CLASE_CELDA[cl] || "" : "")

export const HistorialPredicciones = () => {
  const [filtro, setFiltro] = useState("todos")
  const [lista, setLista] = useState(null)
  const [error, setError] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [meta, setMeta] = useState(null)

  const cargar = useCallback(async (tipo, pg) => {
    setError(null)
    setDetalle(null)
    try {
      const params = { pagina: pg }
      if (tipo !== "todos") params.tipo = tipo
      const r = await axios.get(`${API_URL}/api/predictions/historial`, { params })
      setLista(r.data.predicciones)
      setMeta({ total: r.data.total, pagina: r.data.pagina, paginas: r.data.paginas })
    } catch (err) {
      setError(err.response?.data?.message || "Error al cargar el historial.")
      setLista([])
      setMeta(null)
    }
  }, [])

  useEffect(() => {
    cargar(filtro, pagina)
  }, [cargar, filtro, pagina])

  const cambiarFiltro = (k) => {
    setFiltro(k)
    setPagina(1)
  }

  const ver = async (id) => {
    setCargandoDetalle(true)
    setError(null)
    try {
      const r = await axios.get(`${API_URL}/api/predictions/historial/${id}`)
      setDetalle(r.data)
    } catch (err) {
      setError(err.response?.data?.message || "Error al cargar la predicción.")
      setDetalle(null)
    } finally {
      setCargandoDetalle(false)
    }
  }

  const ev = detalle?.evaluacion
  const payload = detalle?.payload

  return (
    <section className="historial-vista">
      <h2 className="view-title">Historial de predicciones</h2>

      <div className="historial-split">
      <section className="card">
        <div className="card-header">Mis predicciones</div>
        <p className="tabla-status">
          Se guardan solas al analizar un partido. Si repites exactamente la misma predicción, sólo
          sube el contador de veces hecha. Cada usuario ve las suyas.
        </p>
        <div className="tabs">
          {[
            { key: "todos", etiqueta: "Todas" },
            { key: "pre", etiqueta: "Pre-partido (1X2)" },
            { key: "2t", etiqueta: "Proyección 2T" },
          ].map((t) => (
            <button
              key={t.key}
              className={`tab ${filtro === t.key ? "tab-active" : ""}`}
              onClick={() => cambiarFiltro(t.key)}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>

        {error && <p className="tabla-status tabla-status-error">{error}</p>}

        {lista && lista.length === 0 && (
          <p className="tabla-status">
            Aún no hay predicciones guardadas con este filtro. Se guardan al usar "Analizar"
            (1X2) o "Predecir 2T".
          </p>
        )}

        {lista && lista.length > 0 && (
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Partido</th>
                  <th>Fecha</th>
                  <th>Modelo</th>
                  <th>Veces</th>
                  <th>Última vez</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr
                    key={p.id}
                    className={`fila-clic ${detalle?.id === p.id ? "fila-activa" : ""}`}
                    onClick={() => ver(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        ver(p.id)
                      }
                    }}
                    tabIndex={0}
                  >
                    <td>
                      <span className={`resultado-chip ${p.tipo === "pre" ? "resultado-v" : "resultado-e"}`}>
                        {etiquetaTipo(p.tipo)}
                      </span>
                    </td>
                    <td>{p.local} vs {p.visitante}</td>
                    <td className="tabla-num">{formatearFecha(p.fecha)}</td>
                    <td>{p.modelo || "—"}</td>
                    <td className="tabla-num">
                      <span className="resultado-chip resultado-e">×{p.veces}</span>
                    </td>
                    <td className="tabla-num">
                      {new Date(p.ultima_vez).toLocaleString("es-ES")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="paginacion">
            <button
              className="btn btn-secondary"
              disabled={meta.pagina <= 1}
              onClick={() => setPagina(meta.pagina - 1)}
            >
              ← Anterior
            </button>
            <span className="paginacion-info">
              Página {meta.pagina} de {meta.paginas} · {meta.total} predicciones
            </span>
            <button
              className="btn btn-secondary"
              disabled={meta.pagina >= meta.paginas}
              onClick={() => setPagina(meta.pagina + 1)}
            >
              Siguiente →
            </button>
          </div>
        )}
      </section>

      <div className="historial-detalle">
      {cargandoDetalle && <p className="tabla-status">Cargando predicción…</p>}

      {!cargandoDetalle && !detalle && (
        <section className="card historial-panel-vacio">
          <div className="card-header">Detalle</div>
          <p className="tabla-status">
            Haz clic en una predicción de la lista para ver aquí su detalle: partido real
            vinculado, acierto 1X2 y aciertos por mercado.
          </p>
        </section>
      )}

      {detalle && (
        <>
          <section className="card">
            <div className="card-header">
              {detalle.local} vs {detalle.visitante} — {formatearFecha(detalle.fecha)}
              <span className={`resultado-chip ${detalle.tipo === "pre" ? "resultado-v" : "resultado-e"}`}>
                {etiquetaTipo(detalle.tipo)}
              </span>
              <span className="modelo-chip">hecha ×{detalle.veces}</span>
              <span className="modelo-chip">
                {etiquetaTipo(detalle.tipo)} · {formatearFechaHora(detalle.primera_vez)}
                {detalle.veces > 1 ? ` → ${formatearFechaHora(detalle.ultima_vez)}` : ""}
              </span>
            </div>

            {ev?.tieneReal ? (
              detalle.tipo === "pre" ? (
                <div className="evaluacion-cabecera">
                  <span className={`resultado-chip ${ev.acierto ? "resultado-v" : "resultado-d"}`}>
                    {ev.acierto ? "✓ Predicción correcta" : "✗ Predicción fallida"}
                  </span>
                  <span className="evaluacion-texto">
                    Resultado real: <strong>{RESULTADOS[ev.resultado]}</strong> ·{" "}
                    {ev.marcador.local}-{ev.marcador.visita}
                    {ev.probReal !== null && ev.probReal !== undefined && (
                      <> · probabilidad del resultado real en tu predicción: <strong>{ev.probReal}%</strong></>
                    )}
                  </span>
                </div>
              ) : (
                <div className="evaluacion-cabecera">
                  <span className="resultado-chip resultado-e">Datos reales disponibles</span>
                  <span className="evaluacion-texto">
                    Marcador real: <strong>{ev.marcador.local}-{ev.marcador.visita}</strong>
                    {ev.marcador.local1T !== null && ev.marcador.local1T !== undefined && (
                      <> (1T {ev.marcador.local1T}-{ev.marcador.visita1T})</>
                    )}
                  </span>
                  <span className="evaluacion-resumen">
                    <span className="resultado-chip celda-exacto">{ev.resumen.exactos} exactos</span>{" "}
                    <span className="resultado-chip celda-cercano">{ev.resumen.cercanos} cercanos</span>{" "}
                    <span className="resultado-chip celda-lejos">{ev.resumen.lejos} lejos</span>
                    <span className="evaluacion-texto"> ({ev.resumen.comparaciones} comparaciones)</span>
                  </span>
                </div>
              )
            ) : (
              <p className="tabla-status">
                El partido aún no tiene datos reales en la base (o el vínculo automático no lo
                encontró): revisa el <strong>partido real vinculado</strong> de abajo — si no es el
                correcto, cámbialo y se recalculará la evaluación.
              </p>
            )}

            <Vinculo detalle={detalle} setDetalle={setDetalle} />

            {detalle.tipo === "pre" ? (
              <PreDetalle payload={payload} ev={ev} />
            ) : (
              <DosTDetalle payload={payload} ev={ev} />
            )}
          </section>

          <div className="actions">
            <button className="btn btn-secondary" onClick={() => setDetalle(null)}>
              Volver a la lista
            </button>
          </div>
        </>
      )}
      </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Vínculo con el partido real: muestra con qué partido está evaluada la
// predicción (automático por equipos+fecha, o el id del JSON en el 2T) y
// permite cambiarlo a mano si la coincidencia automática fue otra.
// ---------------------------------------------------------------------------
const Vinculo = ({ detalle, setDetalle }) => {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState("")
  const [fecha, setFecha] = useState("")
  const [candidatos, setCandidatos] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const v = detalle.vinculo
  const p = v?.partido

  const abrir = () => {
    setError(null)
    if (!abierto && !candidatos) {
      setQ(detalle.local)
      setFecha("")
    }
    setAbierto((a) => !a)
  }

  const buscar = async () => {
    setBuscando(true)
    setError(null)
    try {
      const params = {}
      if (q.trim()) params.q = q.trim()
      if (fecha) params.fecha = fecha
      const r = await axios.get(`${API_URL}/api/predictions/partidos-buscar`, { params })
      setCandidatos(r.data.partidos)
    } catch (err) {
      setError(err.response?.data?.message || "Error al buscar partidos.")
    } finally {
      setBuscando(false)
    }
  }

  const aplicar = async (partidoId) => {
    setGuardando(true)
    setError(null)
    try {
      const r = await axios.put(`${API_URL}/api/predictions/historial/${detalle.id}/partido`, {
        partidoId,
      })
      setDetalle(r.data)
      setAbierto(false)
      setCandidatos(null)
    } catch (err) {
      setError(err.response?.data?.message || "Error al guardar el vínculo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="vinculo-box">
      <div className="vinculo-titulo">
        Partido real vinculado:
        <span className={`resultado-chip ${v?.manual ? "resultado-v" : "resultado-e"}`}>
          {v?.manual ? "manual" : "automático"}
        </span>
        <span className="actions">
          <button className="btn btn-secondary" onClick={abrir} disabled={guardando}>
            {abierto ? "Cancelar" : "Cambiar vínculo"}
          </button>
          {v?.manual && (
            <button className="btn btn-secondary" onClick={() => aplicar(null)} disabled={guardando}>
              Quitar vínculo
            </button>
          )}
        </span>
      </div>

      {p ? (
        <p className="tabla-status">
          {p.local} vs {p.visitante} · {formatearFecha(p.fecha)} ·{" "}
          {p.golesLocal !== null && p.golesLocal !== undefined
            ? `finalizado ${p.golesLocal}-${p.golesVisitante}`
            : p.estado || "sin resultado"}{" "}
          · id Sofascore {p.id}
        </p>
      ) : (
        <p className="tabla-status">
          Sin coincidencia automática en la base. Busca el partido real para vincularlo.
        </p>
      )}

      {error && <p className="tabla-status tabla-status-error">{error}</p>}

      {abierto && (
        <div className="vinculo-busca">
          <label className="field">
            <span className="field-label">Equipos</span>
            <input
              className="field-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="p. ej. France"
            />
          </label>
          <label className="field">
            <span className="field-label">Fecha (YYYY-MM-DD)</span>
            <input
              className="field-input"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" onClick={buscar} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      )}

      {abierto && candidatos && (
        <div className="tabla-scroll vinculo-resultados">
          {candidatos.length === 0 && <p className="tabla-status">Sin partidos con esa búsqueda.</p>}
          {candidatos.length > 0 && (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Visitante</th>
                  <th>Fecha</th>
                  <th>Resultado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((c) => (
                  <tr key={c.id} className={p?.id === c.id ? "fila-activa" : ""}>
                    <td>{c.equipo_local}</td>
                    <td>{c.equipo_visitante}</td>
                    <td className="tabla-num">{formatearFecha(c.fecha)}</td>
                    <td className="tabla-num">
                      {c.goles_local !== null && c.goles_local !== undefined
                        ? `${c.goles_local}-${c.goles_visitante}`
                        : c.estado || "—"}
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => aplicar(c.id)}
                        disabled={guardando}
                      >
                        {p?.id === c.id ? "Vinculado" : "Vincular"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalle de una predicción PRE-PARTIDO (1X2)
// ---------------------------------------------------------------------------
const PreDetalle = ({ payload, ev }) => {
  if (!payload) return null
  const probs = [
    { key: "home", etiqueta: "Local", valor: payload.probabilities?.home },
    { key: "draw", etiqueta: "Empate", valor: payload.probabilities?.draw },
    { key: "away", etiqueta: "Visita", valor: payload.probabilities?.away },
  ]
  const predicho = payload.prediction?.main
  const real = ev?.tieneReal ? ev.resultado : null
  return (
    <>
      <div className="prob-grid">
        {probs.map((p) => (
          <div
            key={p.key}
            className={[
              "prob-item",
              p.key === predicho ? "prob-item-fav" : "",
              p.key === real ? "prob-item-real" : "",
            ].join(" ").trim()}
          >
            <div className="prob-etiqueta">
              {p.etiqueta}
              {p.key === predicho ? " (predicha)" : ""}
              {p.key === real ? " (real)" : ""}
            </div>
            <div className="prob-valor">{p.valor}%</div>
            <div className="prob-barra">
              <span style={{ width: `${p.valor}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="result-row">
        <span className="result-label">Predicción principal</span>
        <span className="result-value">
          {RESULTADOS[predicho] || "—"}
          {payload.prediction?.probability !== undefined && ` (${payload.prediction.probability}%)`}
        </span>
      </div>
      <div className="result-row">
        <span className="result-label">Goles esperados</span>
        <span className="result-value">
          {payload.lambdas?.home} (local) · {payload.lambdas?.away} (visita)
        </span>
      </div>
      {ev?.mercados && (
        <>
          <div className="card-header">Acierto por mercado</div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Pred L</th>
                  <th>Pred V</th>
                  <th>Real L</th>
                  <th>Real V</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {MERCADOS.map((m) => {
                  const e = ev.mercados[m.key]
                  if (!e) return null
                  return (
                    <tr key={m.key}>
                      <td>{m.etiqueta}</td>
                      <td className="tabla-num">{fmt(e.predL)}</td>
                      <td className="tabla-num">{fmt(e.predV)}</td>
                      <td className={`tabla-num ${claseCelda(e.clL)}`}>{fmt(e.realL)}</td>
                      <td className={`tabla-num ${claseCelda(e.clV)}`}>{fmt(e.realV)}</td>
                      <td className="tabla-num">
                        <span className={`resultado-chip ${CLASE_CELDA[e.clT] || ""}`}>
                          {ETIQUETA_CLASE[e.clT] || "—"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="tabla-status">
            Predicho: goles = lambdas del Poisson; corners/remates/tarjetas = promedio histórico de
            cada equipo al corte. Total: <span className="celda-exacto">exacto</span> (|Δ|&lt;0.5) ·{" "}
            <span className="celda-cercano">cerca</span> (≤1 o 15%) ·{" "}
            <span className="celda-lejos">lejos</span>.
          </p>
        </>
      )}
      {payload.advertencias?.length > 0 && (
        <p className="tabla-status">{payload.advertencias.join(" ")}</p>
      )}
      {payload.explanation?.length > 0 && (
        <ul className="explicacion">
          {payload.explanation.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Detalle de una PROYECCIÓN 2T (tabla con énfasis vs datos reales)
// ---------------------------------------------------------------------------
const DosTDetalle = ({ payload, ev }) => {
  if (!payload) return null
  const conReal = ev?.tieneReal
  const evalPorStat = new Map((conReal ? ev.filas : []).map((f) => [f.stat, f]))
  const r1 = payload.resultado1x2
  const e1 = ev?.resultado1x2
  const pred1x2 = r1?.prediccion ?? e1?.predicho
  const probs1x2 = r1?.probabilidades ?? e1?.probabilidades

  const clase = (cl) => (cl ? CLASE_CELDA[cl] || "" : "")
  const realTxt = (r, lado) => (r && r[lado] !== null && r[lado] !== undefined ? fmt(r[lado]) : "—")
  const realPar = (r) => (r ? `${realTxt(r, "l")}-${realTxt(r, "a")}` : "—")

  return (
    <>
      <div className="result-row">
        <span className="result-label">Modelo</span>
        <span className="result-value">
          <span className={`resultado-chip ${payload.modelo?.estado === "BETA" ? "resultado-e" : "resultado-v"}`}>
            {payload.modelo?.id} {payload.modelo?.estado ? `(${payload.modelo.estado})` : ""}
          </span>{" "}
          {payload.goles1T ? `1T ${payload.goles1T.local}-${payload.goles1T.visita}` : ""}
          {payload.historial
            ? ` · historial ${payload.historial.local}/${payload.historial.visitante} partidos`
            : ""}
        </span>
      </div>
      {payload.advertencias?.length > 0 && (
        <p className="tabla-status">{payload.advertencias.join(" ")}</p>
      )}
      {pred1x2 && (
        <div className="result-row">
          <span className="result-label">Resultado final (1X2)</span>
          <span className="result-value">
            Predicho: <strong>{RESULTADOS[pred1x2]}</strong>
            {r1?.probabilidad != null && ` (${r1.probabilidad}%)`}
            {probs1x2 &&
              ` · Local ${probs1x2.home}% / Empate ${probs1x2.draw}% / Visita ${probs1x2.away}%`}
            {e1 ? (
              <>
                {" "}· real: <strong>{RESULTADOS[e1.real]}</strong>{" "}
                <span className={`resultado-chip ${e1.acierto ? "resultado-v" : "resultado-d"}`}>
                  {e1.acierto ? "✓ acertó" : "✗ falló"}
                </span>
              </>
            ) : (
              " · aún sin resultado"
            )}
          </span>
        </div>
      )}
      {conReal && (
        <p className="tabla-status">
          Énfasis: <span className="celda-exacto">verde = exacto</span> ·{" "}
          <span className="celda-cercano">ámbar = cerca</span> (≤1 o 15% del real) ·{" "}
          <span className="celda-lejos">rojo = lejos</span>. Sólo se comparan las celdas con datos
          reales.
        </p>
      )}
      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Stat</th>
              <th>1T</th>
              <th>Pred 2T L</th>
              <th>Pred 2T V</th>
              {conReal && <th>Real 2T</th>}
              <th>FT Local</th>
              <th>FT Visita</th>
              <th>FT Total</th>
              {conReal && <th>Real FT</th>}
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {payload.filas.map((f) => {
              const e = evalPorStat.get(f.stat)
              return (
                <tr key={f.stat}>
                  <td>{f.etiqueta}</td>
                  <td className="tabla-num">
                    {f.local1T === null || f.local1T === undefined
                      ? "—"
                      : `${fmt(f.local1T)}-${fmt(f.visita1T)}`}
                  </td>
                  <td className={`tabla-num ${clase(e?.cl?.pred2TL)}`}>{fmt(f.predLocal2T)}</td>
                  <td className={`tabla-num ${clase(e?.cl?.pred2TV)}`}>{fmt(f.predVisita2T)}</td>
                  {conReal && <td className="tabla-num">{realPar(e?.real2T)}</td>}
                  <td className={`tabla-num ${clase(e?.cl?.ftL)}`}>
                    {f.ftLocal !== undefined ? fmt(f.ftLocal) : "—"}
                  </td>
                  <td className={`tabla-num ${clase(e?.cl?.ftV)}`}>
                    {f.ftVisita !== undefined ? fmt(f.ftVisita) : "—"}
                  </td>
                  <td className={`tabla-num ${clase(e?.cl?.ftT)}`}>
                    {f.ftTotal !== undefined ? fmt(f.ftTotal) : "—"}
                  </td>
                  {conReal && <td className="tabla-num">{realPar(e?.realFT)}</td>}
                  <td>
                    <span className={`resultado-chip ${f.fuente === "historial" ? "resultado-e" : "resultado-v"}`}>
                      {f.fuente === "historial" ? "Historial" : f.fuente}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
