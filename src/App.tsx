import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './auth/AuthContext'
import AppLayout from './layout/AppLayout'
import Login from './pages/Login'
import Home from './pages/Home'
import ModulePage from './pages/ModulePage'
import Simulator from './pages/Simulator'

export default function App() {
  const { me, loading } = useAuth()
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spin size="large" /></div>
  if (!me) return <Login />
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="m/:moduleId/:itemId?" element={<ModulePage />} />
        <Route path="lab" element={<Simulator />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
