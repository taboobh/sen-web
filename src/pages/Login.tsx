import { useEffect, useState } from 'react'
import { Alert, Card, Col, Row, Space, Spin, Tag, Typography, message } from 'antd'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Account } from '../types'

interface Demo extends Account { identities: { id: string; label: string; roleName: string; usable: boolean }[] }

export default function Login() {
  const { login, error } = useAuth()
  const [list, setList] = useState<Demo[] | null>(null)
  const [msg, ctx] = message.useMessage()

  useEffect(() => { api<Demo[]>('/accounts/demo').then(setList).catch(() => setList([])) }, [])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      {ctx}
      <Typography.Title level={3}>特教通報網（重建原型）</Typography.Title>
      <Typography.Paragraph type="secondary">
        模擬登入：選一個示範帳號即可進入，不需密碼（正式登入方式尚未決定）。每個帳號對應不同角色與資料範圍，可用來檢視各角色看到的畫面。
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {!list ? <Spin /> : (
        <Row gutter={[12, 12]}>
          {list.map((a) => {
            const blocked = a.status !== 'active' || a.identities.every((i) => !i.usable)
            return (
              <Col xs={24} sm={12} lg={8} key={a.id}>
                <Card
                  hoverable
                  size="small"
                  title={a.name}
                  extra={a.status === 'locked' ? <Tag color="red">已鎖定</Tag> : blocked ? <Tag color="orange">指派到期</Tag> : null}
                  onClick={() => { login(a.id).catch((e: Error) => msg.error(e.message)) }}
                  style={{ height: '100%' }}
                >
                  <Space direction="vertical" size={2}>
                    {a.identities.map((i) => (
                      <span key={i.id}><Tag color={i.usable ? 'blue' : 'default'}>{i.roleName}</Tag>{i.label}</span>
                    ))}
                    {a.note && <Typography.Text type="secondary">{a.note}</Typography.Text>}
                  </Space>
                </Card>
              </Col>
            )
          })}
        </Row>
      )}
    </div>
  )
}
