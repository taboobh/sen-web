import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './auth/AuthContext'
import AppLayout from './layout/AppLayout'
import Login from './pages/Login'
import GatePage from './pages/GatePage'
import Home from './pages/Home'
import ModulePage from './pages/ModulePage'
import Simulator from './pages/Simulator'

export default function App() {
  const { me, status, loading } = useAuth()
  const spin = <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spin size="large" /></div>
  if (loading) return spin
  if (!status) return <Login />
  // 不論哪種登入方式：缺必填資料、身分證待核對、尚無角色時，只能停在這一頁
  if (status.gate) return <GatePage />
  if (!me) return spin
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
