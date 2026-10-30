import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb, Button, Card, Layout, Menu, Result, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { MODULES } from '../mock/modules'
import { ACTION_LABEL, type Action } from '../types'
import StudentTable from './StudentTable'
import { AccountsView, AuditView, IdReviewView, ProfileSettingsView, RoleMatrixView } from './AdminViews'
import ProfileView from './ProfilePage'
import SchoolsView from './SchoolsView'

const ACTIONS: Action[] = ['create', 'read', 'update', 'delete', 'approve', 'export']

export default function ModulePage() {
  const { moduleId = '', itemId } = useParams()
  const nav = useNavigate()
  const { me, can } = useAuth()
  const mod = MODULES.find((m) => m.id === moduleId)
  const allowed = !!me?.permissions.some((p) => p.startsWith(moduleId + ':'))

  const items: MenuProps['items'] = useMemo(() => mod?.menu.map((g) => ({
    type: 'group' as const, key: g.title, label: g.title,
    children: g.items.map((i) => ({ key: i.id, label: i.title })),
  })), [mod])

  if (!mod) return <Navigate to="/" replace />
  if (!allowed) return <Result status="403" title="沒有權限" subTitle="目前身分沒有此模組的任何權限" extra={<Button onClick={() => nav('/')}>回首頁</Button>} />

  const firstId = mod.menu[0].items[0].id
  const currentId = itemId ?? firstId
  const group = mod.menu.find((g) => g.items.some((i) => i.id === currentId))
  const item = group?.items.find((i) => i.id === currentId)

  let body
  if (moduleId === 'students' && (currentId === 'swd' || currentId === 'gift')) body = <StudentTable />
  else if (moduleId === 'base' && currentId === 'school') body = <SchoolsView />
  else if (moduleId === 'admin' && currentId === 'account') body = <AccountsView />
  else if (moduleId === 'admin' && currentId === 'role') body = <RoleMatrixView />
  else if (moduleId === 'admin' && currentId === 'audit') body = <AuditView />
  else if (moduleId === 'admin' && currentId === 'profile') body = <ProfileView />
  else if (moduleId === 'admin' && currentId === 'id-review') body = <IdReviewView />
  else if (moduleId === 'admin' && currentId === 'profile-settings') body = <ProfileSettingsView />
  else body = (
    <Card>
      <Typography.Paragraph type="secondary">
        這裡是「{item?.title}」的功能掛載點，目前尚未實作畫面。下方按鈕依目前角色在「{mod.name}」的權限啟用或停用。
      </Typography.Paragraph>
      <Space wrap>
        {ACTIONS.map((a) => (
          <Tooltip key={a} title={can(moduleId, a) ? '' : '目前角色沒有此權限'}>
            <Button type={a === 'create' ? 'primary' : 'default'} disabled={!can(moduleId, a)}>{ACTION_LABEL[a]}</Button>
          </Tooltip>
        ))}
      </Space>
    </Card>
  )

  return (
    <Layout style={{ background: 'transparent' }}>
      <Layout.Sider breakpoint="lg" collapsedWidth={0} width={240} theme="light" style={{ borderRadius: 8, marginRight: 16 }}>
        <Typography.Title level={5} style={{ padding: '12px 16px 0', margin: 0 }}>{mod.name}</Typography.Title>
        <Menu mode="inline" items={items} selectedKeys={[currentId]} onClick={(e) => nav(`/m/${mod.id}/${e.key}`)} style={{ border: 0 }} />
      </Layout.Sider>
      <Layout.Content style={{ minWidth: 0 }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <a onClick={() => nav('/')}>首頁</a> }, { title: mod.name }, { title: group?.title }, { title: item?.title }]} />
        {body}
      </Layout.Content>
    </Layout>
  )
}
