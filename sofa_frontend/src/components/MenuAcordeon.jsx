import { useEffect, useState } from "react"

const SECCIONES = [
  {
    id: "predictivo",
    titulo: "Predicción",
    items: [
      { id: "predictivo", etiqueta: "Análisis pre-partido (1X2)" },
      { id: "prediccion2t", etiqueta: "Proyección 2T (modelo)" },
      { id: "historial", etiqueta: "Historial de predicciones" },
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

// Menú en la esquina superior derecha: un botón flotante que abre un panel
// acordeón. Colapsado no ocupa la parte central de la pantalla.
export const MenuAcordeon = ({ vista, onVista }) => {
  const [abierto, setAbierto] = useState(false)
  const [abierta, setAbierta] = useState(
    () => SECCIONES.find((s) => s.items.some((i) => i.id === vista))?.id || SECCIONES[0].id
  )

  // Cerrar al hacer clic fuera del menú.
  useEffect(() => {
    if (!abierto) return
    const h = (e) => {
      if (!e.target.closest(".menu-esquina")) setAbierto(false)
    }
    document.addEventListener("click", h)
    return () => document.removeEventListener("click", h)
  }, [abierto])

  const toggle = (id) => setAbierta((prev) => (prev === id ? null : id))
  const irA = (id) => {
    onVista(id)
    setAbierto(false)
  }

  return (
    <nav className={`menu-esquina ${abierto ? "menu-esquina-open" : ""}`}>
      <button
        className="menu-esquina-btn"
        onClick={() => setAbierto((o) => !o)}
        aria-expanded={abierto}
        aria-label="Abrir menú"
        title="Menú"
      >
        ☰ Menú
      </button>
      {abierto && (
        <div className="menu-esquina-panel" role="menu">
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
                        onClick={() => irA(item.id)}
                      >
                        {item.etiqueta}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </nav>
  )
}
