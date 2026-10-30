import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Alert, Button, Layout, Select, Space, Tag, Typography } from 'antd'
import { ExperimentOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import { REASON_TEXT } from '../auth/engine'

const { Header, Content } = Layout

export default function AppLayout() {
  const { me, status, switchIdentity, logout } = useAuth()
  const nav = useNavigate()
  if (!me) return null
  const a = me.active
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', height: 'auto', minHeight: 56, lineHeight: 'normal', paddingBlock: 8 }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 18, color: '#1d6fb8' }}>特教通報網</Link>
        <Tag color="orange">重建原型</Tag>
        <div style={{ flex: 1 }} />
        <Space wrap>
          <Select
            style={{ minWidth: 230 }}
            value={a.identityId}
            aria-label="切換目前身分"
            onChange={(v) => { void switchIdentity(v); nav('/') }}
            options={me.identities.map((i) => ({
              value: i.id,
              disabled: !i.usable,
              label: i.usable ? i.label : `${i.label}（${i.reason ? REASON_TEXT[i.reason] : '不可用'}）`,
            }))}
          />
          <Tag color="blue">{a.role.name}</Tag>
          <Tag>{a.scope.name}</Tag>
          {a.stages.length > 0 && <Tag color="purple">{a.stages.join('、')}</Tag>}
          <Typography.Text type="secondary">{me.account.name}</Typography.Text>
          {status && <Tag>{status.method === 'moe_oidc' ? '教育雲端登入' : '本機登入'}</Tag>}
          <Button icon={<ExperimentOutlined />} onClick={() => nav('/lab')}>權限模擬</Button>
          <Button icon={<LogoutOutlined />} onClick={() => { logout(); nav('/') }}>登出</Button>
        </Space>
      </Header>
      <Alert banner type="warning" showIcon message="示範資料與示範權限：角色切換不是正式授權，請勿輸入真實學生資料。" />
      <Content style={{ padding: 16 }}>
        <Outlet />
      </Content>
    </Layout>
  )
}
