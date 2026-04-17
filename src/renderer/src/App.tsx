import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Library from './pages/Library'
import Servers from './pages/Servers'
import Anime from './pages/Anime'
import Player from './pages/Player'
import Favorites from './pages/Favorites'

export default function App(): JSX.Element {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-title">
          <span className="dot" />
          <span>FTP Anime</span>
        </div>
        <nav>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/favorites">Favorites</NavLink>
          <NavLink to="/servers">Servers</NavLink>
        </nav>
        <div className="sidebar-footer">Streaming from FTP / SFTP</div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<Library />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/anime/:serverId/:libraryRootId" element={<Anime />} />
          <Route path="/player/:serverId" element={<Player />} />
        </Routes>
      </main>
    </div>
  )
}
