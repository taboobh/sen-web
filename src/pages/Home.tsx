import { Link } from 'react-router-dom'
import { Card, Col, Empty, Row, Space, Tag, Typography } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { MODULES } from '../mock/modules'
import { ACTION_LABEL, type Action } from '../types'

export default function Home() {
  const { me } = useAuth()
  if (!me) return null
  const mods = MODULES.map((m) => ({
    m,
    actions: me.permissions.filter((p) => p.startsWith(m.id + ':')).map((p) => p.split(':')[1] as Action),
  })).filter((x) => x.actions.length > 0)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4}>
        {me.active.role.name}・{me.active.scope.name}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        只顯示此角色有權限的模組（共 {mods.length} / {MODULES.length}）。{me.active.expiresAt ? `借調，到期日：${me.active.expiresAt}` : '長期有效'}
      </Typography.Paragraph>
      {mods.length === 0 ? <Empty description="此身分沒有任何可用模組" /> : (
        <Row gutter={[12, 12]}>
          {mods.map(({ m, actions }) => (
            <Col xs={24} sm={12} lg={8} key={m.id}>
              <Link to={`/m/${m.id}`}>
                <Card hoverable size="small" title={m.name} style={{ height: '100%' }}>
                  <Space direction="vertical" size={6}>
                    <Typography.Text type="secondary">{m.desc}</Typography.Text>
                    <span>{actions.map((a) => <Tag key={a}>{ACTION_LABEL[a]}</Tag>)}</span>
                  </Space>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      )}
    </div>
  )
}
