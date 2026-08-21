import useFetch from "../hooks/useFetch.jsx"
import { useMemo, useState } from "react"

export const BuscadorEquipo = ({ onSelect }) => {
  const [query, setQuery] = useState("")
  const { data: equipos, loading, error } = useFetch("/api/equipos")

  const suggestions = useMemo(() => {
    if (!query) return []
    const normalized = query.toLowerCase()
    return (equipos || [])
      .map((e) => e.nombre)
      .filter((name) => name?.toLowerCase().includes(normalized))
      .slice(0, 20)
  }, [query, equipos])

  const handleClick = (nombre) => {
    setQuery("")
    onSelect(nombre)
  }

  return (
    <div className="search">
      <input
        className="search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar equipo"
      />
      {query && (
        <ul className="suggestions_lu">
          {suggestions.map((nombre) => (
            <li key={nombre} className="suggestion-item" onClick={() => handleClick(nombre)}>
              {nombre}
            </li>
          ))}
          {suggestions.length === 0 && <li className="suggestion-empty">Sin resultados</li>}
        </ul>
      )}
      {loading && <p className="search-status">Cargando equipos...</p>}
      {error && <p className="search-status search-status-error">Error al cargar equipos.</p>}
    </div>
  )
}