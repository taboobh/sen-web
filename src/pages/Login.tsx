import { useEffect, useState } from 'react'
import { Alert, Card, Col, Row, Segmented, Space, Spin, Tag, Typography, message } from 'antd'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Account, LoginMethod } from '../types'

interface Demo extends Account { gate: string | null; hasSsoGuid: boolean; ssoSchools: string[]; identities: { id: string; label: string; roleName: string; usable: boolean }[] }

export default function Login() {
  const { login, error } = useAuth()
  const [list, setList] = useState<Demo[] | null>(null)
  const [method, setMethod] = useState<LoginMethod>('moe_oidc')
  const [msg, ctx] = message.useMessage()

  useEffect(() => { api<Demo[]>('/accounts/demo').then(setList).catch(() => setList([])) }, [])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      {ctx}
      <Typography.Title level={3}>特教通報網（重建原型）</Typography.Title>
      <Typography.Paragraph type="secondary">
        模擬登入：選登入方式，再選一個示範帳號即可進入，不需密碼（正式登入方式尚未決定）。每個帳號對應不同角色與資料範圍，可用來檢視各角色看到的畫面。
        不論哪種方式，只要帳號缺少身分證或聯絡方式，登入後都會先轉到「個人資料」頁。
      </Typography.Paragraph>
      <Segmented<LoginMethod> value={method} onChange={setMethod} style={{ marginBottom: 12 }}
        options={[{ value: 'moe_oidc', label: '教育雲端帳號（教育體系身分認證，模擬）' }, { value: 'local', label: '本機帳號（模擬）' }]} />
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
                  title={<>{a.name} <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{a.username}</Typography.Text></>}
                  extra={<Space size={4}>
                    {method === 'moe_oidc' && a.hasSsoGuid && <Tag color="cyan">教育雲端提供 guid</Tag>}
                    {method === 'moe_oidc' && a.ssoSchools.length > 0 && <Tag color="purple">教育雲端學校：{a.ssoSchools.join('、')}</Tag>}
                    {a.gate === 'PROFILE_INCOMPLETE' ? <Tag color="gold">需補資料</Tag> : a.gate === 'ID_PENDING' ? <Tag color="gold">身分證待核對</Tag>
                      : a.status === 'locked' ? <Tag color="red">已鎖定</Tag> : blocked ? <Tag color="orange">無可用角色</Tag> : null}
                  </Space>}
                  onClick={() => { login(a.id, method).catch((e: Error) => msg.error(e.message)) }}
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
