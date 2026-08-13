import useFetch from "../hooks/useFetch.jsx";
import { useMemo, useState } from "react";

export const Desplegable = ({ onChange }) => {
  const [query, setQuery] = useState("");
  const { data: leagues, loading: loadingLeagues, error: errorLeagues } = useFetch("/api/leagues");

  const suggestions = useMemo(() => {
    if (!query) return [];
    const normalized = query.toLowerCase();
    return (leagues || [])
      .filter((league) => league?.name?.toLowerCase().includes(normalized))
      .map((league) => {
        const index = league.name.toLowerCase().indexOf(normalized);
        return {
          id: league.name,
          name: league.name,
          before: league.name.slice(0, index),
          match: league.name.slice(index, index + query.length),
          after: league.name.slice(index + query.length),
        };
      });
  }, [query, leagues]);

  const handleClick = (name) => {
    setQuery("");
    onChange({ target: { value: name } });
  };

  return (
    <div className="search">
      <input
        className="search-input"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar liga"
      />
      {query && (
        <ul className="suggestions_lu">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="suggestion-item" onClick={() => handleClick(suggestion.name)}>
              {suggestion.before}
              <strong>{suggestion.match}</strong>
              {suggestion.after}
            </li>
          ))}
          {suggestions.length === 0 && <li className="suggestion-empty">Sin resultados</li>}
        </ul>
      )}
      {loadingLeagues && <p className="search-status">Cargando ligas...</p>}
      {errorLeagues && <p className="search-status search-status-error">Error al cargar ligas.</p>}
    </div>
  );
};
