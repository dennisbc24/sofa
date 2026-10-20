import { useEffect, useState } from 'react'
import axios from 'axios'
import './App.css'
import { MenuAcordeon } from './components/MenuAcordeon.jsx'
import { Login } from './components/Login.jsx'
import { Usuarios } from './components/Usuarios.jsx'
import { UltimosPartidos } from './components/UltimosPartidos.jsx'
import { StatsPartido } from './components/StatsPartido.jsx'
import { Equipos } from './components/Equipos.jsx'
import { AnalisisPredictivo } from './components/AnalisisPredictivo.jsx'
import { Prediccion2T } from './components/Prediccion2T.jsx'
import { HistorialPredicciones } from './components/HistorialPredicciones.jsx'
import { SubirEstadisticas } from './components/SubirEstadisticas.jsx'
import { aplicarTema, TEMA_2T, TEMA_PRED } from './tema.js'

const VISTA_INICIAL = "predictivo"

// Atajos del footer estático (funciones más usadas).
const FOOTER = [
  { id: "predictivo", etiqueta: "Análisis 1X2" },
  { id: "prediccion2t", etiqueta: "Proyección 2T" },
  { id: "historial", etiqueta: "Historial" },
  { id: "subir", etiqueta: "Subir stats" },
  { id: "ultimos", etiqueta: "Partidos" },
  { id: "equipos", etiqueta: "Equipos" },
]

function App() {
  const [vista, setVista] = useState(VISTA_INICIAL)
  const [sesion, setSesion] = useState(null)
  const [sesionCargando, setSesionCargando] = useState(true)

  // Estado de sesión al cargar la página.
  useEffect(() => {
    axios
      .get("/api/auth/sesion")
      .then((r) => setSesion(r.data.autenticado ? r.data.usuario : null))
      .catch(() => setSesion(null))
      .finally(() => setSesionCargando(false))
  }, [])

  // Tema de la pagina: el 2T invierte la paleta (claro) frente al 1X2 (oscuro).
  // El historial gestiona su propio theme (segun el tipo de la prediccion
  // que se este viendo), asi que aqui no lo pisamos.
  useEffect(() => {
    if (vista === "historial") return
    aplicarTema(vista === "prediccion2t" ? TEMA_2T : TEMA_PRED)
  }, [vista])

  // Si cualquier llamada responde 401 (sesión caducada), volvemos al login.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (r) => r,
      (err) => {
        if (
          err.response?.status === 401 &&
          !String(err.config?.url || "").includes("/api/auth/")
        ) {
          setSesion(null)
        }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  const salir = async () => {
    try {
      await axios.post("/api/auth/logout")
    } finally {
      setSesion(null)
      setVista(VISTA_INICIAL)
    }
  }

  if (sesionCargando) {
    return (
      <main className="app">
        <h1 className="app-title">Analytics</h1>
        <p className="view-title">Cargando…</p>
      </main>
    )
  }

  if (!sesion) {
    return (
      <main className="app">
        <h1 className="app-title">Analytics</h1>
        <Login onSesion={setSesion} />
      </main>
    )
  }

  // Tema por vista: la prediccion pre-partido y la proyeccion 2T usan
  // acentos distintos para no confundirlas.
  const tema = vista === "prediccion2t" ? "tema-2t" : "tema-pred"

  return (
    <main className={`app ${tema}`}>
      <h1 className="app-title">Analytics</h1>

      <button
        className="sesion-salir"
        onClick={salir}
        title={`${sesion.usuario} · ${sesion.rol} — cerrar sesión`}
      >
        ⏻ Salir
      </button>

      <MenuAcordeon vista={vista} onVista={setVista} />

      {vista === "ultimos" ? (
        <UltimosPartidos />
      ) : vista === "statsPartido" ? (
        <StatsPartido />
      ) : vista === "equipos" ? (
        <Equipos />
      ) : vista === "prediccion2t" ? (
        <Prediccion2T />
      ) : vista === "historial" ? (
        <HistorialPredicciones />
      ) : vista === "usuarios" ? (
        <Usuarios sesion={sesion} />
      ) : vista === "subir" ? (
        <SubirEstadisticas />
      ) : (
        <AnalisisPredictivo />
      )}

      <footer className="app-footer">
        {FOOTER.map((f) => (
          <button
            key={f.id}
            className={`footer-item ${vista === f.id ? "footer-item-active" : ""}`}
            onClick={() => setVista(f.id)}
          >
            {f.etiqueta}
          </button>
        ))}
      </footer>
    </main>
  )
}

export default App
