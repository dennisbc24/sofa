import { useState } from "react"
import { Desplegable } from "./Desplegable.jsx"
import { PartidosPorLiga } from "./PartidosPorLiga.jsx"

export const UltimosPartidos = () => {
  const [ligas, setLigas] = useState([])
  const [activa, setActiva] = useState(null)

  const handleLigaChange = (e) => {
    const liga = e.target.value
    setLigas((prev) => (prev.includes(liga) ? prev : [...prev, liga]))
    setActiva(liga)
  }

  return (
    <section>
      <h2 className="view-title">Últimos partidos agregados</h2>

      <Desplegable onChange={handleLigaChange} />

      {ligas.length > 0 ? (
        <>
          <div className="tabs">
            {ligas.map((liga) => (
              <button
                key={liga}
                className={`tab ${liga === activa ? "tab-active" : ""}`}
                onClick={() => setActiva(liga)}
              >
                {liga}
              </button>
            ))}
          </div>
          <div className="card">
            <PartidosPorLiga liga={activa} />
          </div>
        </>
      ) : (
        <p className="tabla-status">Busca y selecciona una liga para ver sus últimos partidos.</p>
      )}
    </section>
  )
}