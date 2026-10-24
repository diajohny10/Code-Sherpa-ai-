import React from 'react'
import ReactDOM from 'react-dom/client'
import AccountShell from './AccountShell'
import { ErrorBoundary } from './ErrorBoundary'
import CinematicEntrance from './CinematicEntrance'
import './styles.css'
import './cinematic.css'
import './professional.css'
import './cinematic-entry.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><CinematicEntrance><AccountShell /></CinematicEntrance></ErrorBoundary></React.StrictMode>,
)
