import { Button, Layout, Result, Space, Tag, Typography } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import ProfileView from './ProfilePage'

export const METHOD_LABEL = { moe_oidc: '教育雲端帳號登入', local: '本機帳號登入' } as const

/** 登入成功但還不能進系統：補個人資料（身分證、聯絡方式）、等待身分證核對、或尚無可用角色 */
export default function GatePage() {
  const { status, logout } = useAuth()
  if (!status?.gate) return null
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#1d6fb8' }}>特教通報網</span>
        <Tag color="orange">重建原型</Tag>
        <div style={{ flex: 1 }} />
        <Space>
          <Tag>{METHOD_LABEL[status.method]}</Tag>
          <Typography.Text type="secondary">{status.account.name}</Typography.Text>
          <Button icon={<LogoutOutlined />} onClick={logout}>登出</Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 16, maxWidth: 760, width: '100%', margin: '0 auto' }}>
        {status.gate.code === 'NO_ROLE'
          ? <Result status="info" title="資料已完成，尚無可用角色" subTitle={`${status.gate.reason ?? ''}。請洽所屬單位的管理員指派角色後，重新登入。`}
              extra={<Button onClick={logout}>登出</Button>} />
          : <ProfileView />}
      </Layout.Content>
    </Layout>
  )
}
