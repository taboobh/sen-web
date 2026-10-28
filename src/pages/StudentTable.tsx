import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Popconfirm, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Student } from '../types'

type Row = Student & { schoolName: string }

/** 示範「資料範圍」：清單由後端依角色、範圍、教育階段、責任關係過濾，前端只負責顯示。 */
export default function StudentTable() {
  const { me, can } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, ctx] = message.useMessage()

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await api<Row[]>('/students')); setErr(null) }
    catch (e) { setRows([]); setErr(e instanceof ApiError ? e.message : '載入失敗') }
    finally { setLoading(false) }
  }, [])
  // 切換身分時 me 會變，重新載入
  useEffect(() => { void load() }, [load, me?.active.assignmentId])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); msg.success(ok); await load() }
    catch (e) { msg.error(e instanceof ApiError ? `被拒絕：${e.message}` : '操作失敗') }
  }

  return (
    <Card title="身障／資優學生資料（合成資料）" extra={
      <Space>
        <Tooltip title={can('students', 'create') ? '' : '目前角色沒有新增權限'}>
          <Button type="primary" disabled={!can('students', 'create')} onClick={() => run(() => api('/students', { method: 'POST', json: {} }), '已新增（僅存於記憶體）')}>新增</Button>
        </Tooltip>
        <Tooltip title={can('students', 'export') ? '' : '目前角色沒有匯出權限'}>
          <Button disabled={!can('students', 'export')} onClick={() => msg.info('示範：匯出需另有「匯出」權限，並會寫入稽核')}>匯出</Button>
        </Tooltip>
      </Space>
    }>
      {ctx}
      <Typography.Paragraph type="secondary">
        可見資料範圍：<b>{me?.active.scope.name}</b>
        {me && me.active.stages.length > 0 && <>，教育階段：<b>{me.active.stages.join('、')}</b></>}
        {me?.active.relationLimited && <>，僅限<b>有責任關係</b>的學生</>}。共 {rows.length} 筆。
      </Typography.Paragraph>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <Table<Row>
        rowKey="id" size="small" loading={loading} dataSource={rows}
        scroll={{ x: 640 }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        columns={[
          { title: '姓名', dataIndex: 'name' },
          { title: '學校', dataIndex: 'schoolName' },
          { title: '教育階段', dataIndex: 'stage', render: (v: string) => <Tag>{v}</Tag> },
          { title: '年級', dataIndex: 'grade' },
          { title: '障礙類別', dataIndex: 'category' },
          {
            title: '操作', render: (_: unknown, r) => (
              <Space>
                <Button size="small" disabled={!can('students', 'update')}>修改</Button>
                <Popconfirm title="確定刪除？" disabled={!can('students', 'delete')} onConfirm={() => run(() => api(`/students/${r.id}`, { method: 'DELETE' }), '已刪除')}>
                  <Button size="small" danger disabled={!can('students', 'delete')}>刪除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  )
}
