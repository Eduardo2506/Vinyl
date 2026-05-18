import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import MiniPlayer from './MiniPlayer.jsx'
import './index.css'

const isMini = window.location.hash === '#mini'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMini ? <MiniPlayer /> : <App />}
  </React.StrictMode>
)
