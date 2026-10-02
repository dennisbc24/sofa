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

const VISTA_INICIAL = "predictivo"

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

  return (
    <main className="app">
      <h1 className="app-title">Analytics</h1>

      <div className="sesion-barra">
        <span className="sesion-usuario">
          {sesion.usuario} · {sesion.rol}
        </span>
        <button className="btn btn-secondary" onClick={salir}>
          Salir
        </button>
      </div>

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
    </main>
  )
}

export default App
