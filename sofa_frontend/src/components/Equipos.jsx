import { useState } from "react"
import useFetch from "../hooks/useFetch.jsx"
import { BuscadorEquipo } from "./BuscadorEquipo.jsx"

const numero = (valor) =>
  valor === null || valor === undefined || Number.isNaN(Number(valor)) ? "—" : Number(valor)

export const Equipos = () => {
  const [equipo, setEquipo] = useState(null)
  const [liga, setLiga] = useState(null)

  const url = equipo
    ? liga
      ? `/api/equipos/${encodeURIComponent(equipo)}/promedios?liga=${encodeURIComponent(liga)}`
      : `/api/equipos/${encodeURIComponent(equipo)}`
    : null

  const { data, loading, error } = useFetch(url)

  const stats = data?.estadisticas || []
  const grupos = [...new Set(stats.map((s) => s.grupo))]

  return (
    <section className="equipos">
      <h2 className="view-title">Promedios por equipo</h2>

      <BuscadorEquipo onSelect={setEquipo} />

      {!equipo && (
        <p className="tabla-status">Busca y selecciona un equipo para ver sus promedios estadísticos.</p>
      )}

      {equipo && loading && <p className="tabla-status">Cargando promedios de {equipo}...</p>}
      {equipo && error && (
        <p className="tabla-status tabla-status-error">Error al cargar los promedios de {equipo}.</p>
      )}

      {equipo && data && !error && (
        <>
          <section className="card">
            <div className="card-header">{liga ? `${equipo} — ${liga}` : equipo}</div>
            <div className="result-row">
              <span className="result-label">Partidos (finalizados)</span>
              <span className="result-value">{numero(data.partidos)}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Promedio goles a favor</span>
              <span className="result-value">{numero(data.goles_favor)}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Promedio goles en contra</span>
              <span className="result-value">{numero(data.goles_contra)}</span>
            </div>
            <div className="result-row">
              <span className="result-label">Victorias / Empates / Derrotas</span>
              <span className="result-value">
                {numero(data.victorias)} / {numero(data.empates)} / {numero(data.derrotas)}
              </span>
            </div>
          </section>

          {data.ligas?.length > 0 && (
            <>
              <div className="tabs">
                <button
                  className={`tab ${!liga ? "tab-active" : ""}`}
                  onClick={() => setLiga(null)}
                >
                  Todas
                </button>
                {data.ligas.map((l) => (
                  <button
                    key={l}
                    className={`tab ${liga === l ? "tab-active" : ""}`}
                    onClick={() => setLiga(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="tabla-status">Desglose por liga: selecciona una liga.</p>
            </>
          )}

          {grupos.map((grupo) => (
            <section key={grupo} className="card">
              <div className="card-header">{grupo}</div>
              {stats.filter((s) => s.grupo === grupo).length === 0 ? (
                <p className="tabla-status">Sin datos para este grupo.</p>
              ) : (
                <div className="tabla-scroll">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Estadística</th>
                        <th>Promedio</th>
                        <th>Partidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats
                        .filter((s) => s.grupo === grupo)
                        .map((s) => (
                          <tr key={s.id ?? `${s.grupo}-${s.nombre}`}>
                            <td>{s.nombre}</td>
                            <td className="tabla-num">{numero(s.promedio)}</td>
                            <td className="tabla-num">{numero(s.n)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {stats.length === 0 && (
            <p className="tabla-status">Sin estadísticas disponibles para {equipo}.</p>
          )}
        </>
      )}
    </section>
  )
}