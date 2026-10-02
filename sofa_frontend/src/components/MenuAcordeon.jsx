import { useState } from "react"

const SECCIONES = [
  {
    id: "analisis",
    titulo: "Análisis",
    items: [
      { id: "proyeccion", etiqueta: "Proyección 2T (Betis vs Madrid)" },
      { id: "analisis1", etiqueta: "Corners y goles" },
      { id: "analisis2", etiqueta: "Corners y diferencia" },
      { id: "analisis3", etiqueta: "Marcador 1T" },
      { id: "remates", etiqueta: "Remates y goles" },
      { id: "roja1t", etiqueta: "Roja 1T" },
      { id: "golesEquipo", etiqueta: "Goles por equipo" },
      { id: "analisisEquipo1T", etiqueta: "Equipo × Goles 1T" },
    ],
  },
  {
    id: "predictivo",
    titulo: "Predicción",
    items: [
      { id: "predictivo", etiqueta: "Análisis pre-partido (1X2)" },
      { id: "prediccion2t", etiqueta: "Proyección 2T (modelo)" },
    ],
  },
  {
    id: "partidos",
    titulo: "Partidos",
    items: [
      { id: "ultimos", etiqueta: "Últimos partidos" },
      { id: "statsPartido", etiqueta: "Buscar stats de partido" },
      { id: "subir", etiqueta: "Subir estadísticas por lote" },
    ],
  },
  {
    id: "equipos",
    titulo: "Equipos",
    items: [{ id: "equipos", etiqueta: "Promedios por equipo" }],
  },
  {
    id: "sistema",
    titulo: "Sistema",
    items: [{ id: "usuarios", etiqueta: "Usuarios y acceso" }],
  },
]

export const MenuAcordeon = ({ vista, onVista }) => {
  const [abierta, setAbierta] = useState(
    () => SECCIONES.find((s) => s.items.some((i) => i.id === vista))?.id || SECCIONES[0].id
  )

  const toggle = (id) => setAbierta((prev) => (prev === id ? null : id))

  return (
    <nav className="menu-acordeon">
      {SECCIONES.map((seccion) => {
        const estaAbierta = abierta === seccion.id
        return (
          <div key={seccion.id} className="acordeon-section">
            <button
              className={`acordeon-header ${estaAbierta ? "acordeon-header-open" : ""}`}
              onClick={() => toggle(seccion.id)}
              aria-expanded={estaAbierta}
            >
              <span>{seccion.titulo}</span>
              <span className="acordeon-chevron">{estaAbierta ? "−" : "+"}</span>
            </button>
            {estaAbierta && (
              <div className="acordeon-body">
                {seccion.items.map((item) => (
                  <button
                    key={item.id}
                    className={`acordeon-item ${vista === item.id ? "acordeon-item-active" : ""}`}
                    onClick={() => onVista(item.id)}
                  >
                    {item.etiqueta}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}