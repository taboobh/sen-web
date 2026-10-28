import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Result, Select, Spin, Table, Tag, Tree, Typography, message } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { api, ApiError } from '../api/client'
import { ACTION_LABEL, ACTION_LETTER, type AdminArea, type Account, type AuditEntry, type Identity, type Role, type RoleAssignment, type ScopeNode } from '../types'
import { REASON_TEXT } from '../auth/engine'
import { MODULES } from '../mock/modules'

type AssignmentRow = RoleAssignment & { problem: string | null }

interface Overview {
  rootId: string; scopeName: string; canAssign: boolean; assignableRoles: string[]
  roles: Role[]; scopes: ScopeNode[]; areas: AdminArea[]; areaProblems: string[]; accounts: Account[]; identities: Identity[]
  assignments: AssignmentRow[]; audit: AuditEntry[]
}

function useOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => { api<Overview>('/admin/overview').then(setData).catch((e) => setErr(e)) }, [n])
  return { data, err, reload: () => setN((x) => x + 1) }
}

function Gate({ data, err, children }: { data: Overview | null; err: ApiError | null; children: (d: Overview) => ReactNode }) {
  if (err) return <Result status="403" title="後端拒絕" subTitle={err.message} />
  if (!data) return <Spin />
  return <>{children(data)}</>
}

const today = () => new Date().toISOString().slice(0, 10)

interface Row { key: string; identity: Identity; account: Account; assignment?: AssignmentRow }

export function AccountsView() {
  const { data, err, reload } = useOverview()
  const [target, setTarget] = useState<Identity | null>(null)
  return (
    <Gate data={data} err={err}>{(d) => {
      const rows: Row[] = d.identities.flatMap((i) => {
        const account = d.accounts.find((x) => x.id === i.accountId)!
        const list = d.assignments.filter((a) => a.identityId === i.id)
        return list.length
          ? list.map((a) => ({ key: a.id, identity: i, account, assignment: a }))
          : [{ key: i.id, identity: i, account }]
      })
      return (
        <Card title={`帳號與角色指派（${d.scopeName}）`}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`您目前的資料範圍是「${d.scopeName}」，只能瀏覽此範圍內的使用者與角色指派${d.canAssign ? '，並可在範圍內指派角色' : ''}。`} />
          <Typography.Paragraph type="secondary">
            「帳號」是登入用的英文代號；「使用者姓名」是本人姓名。一個帳號可有多個身分；每個身分有「角色＋資料範圍＋教育階段＋有效期間」的指派。
          </Typography.Paragraph>
          <Table<Row> size="small" rowKey="key" scroll={{ x: 1100 }} pagination={false} dataSource={rows}
            columns={[
              { title: '帳號', render: (_: unknown, r: Row) => <Typography.Text code>{r.account.username}</Typography.Text> },
              { title: '使用者姓名', render: (_: unknown, r: Row) => <>{r.account.name}{r.account.status !== 'active' && <Tag color="red" style={{ marginLeft: 6 }}>鎖定</Tag>}</> },
              { title: '身分', render: (_: unknown, r: Row) => `${d.scopes.find((s) => s.id === r.identity.orgScopeId)?.name} ${r.identity.jobTitle}` },
              { title: '角色', render: (_: unknown, r: Row) => r.assignment
                ? <Tag color="blue">{d.roles.find((x) => x.code === r.assignment!.roleCode)?.name}</Tag> : <Tag>尚未指派</Tag> },
              { title: '資料範圍', render: (_: unknown, r: Row) => r.assignment ? d.scopes.find((s) => s.id === r.assignment!.scopeId)?.name : '-' },
              { title: '教育階段', render: (_: unknown, r: Row) => r.assignment ? (r.assignment.stages.length ? r.assignment.stages.join('、') : '不限') : '-' },
              { title: '有效期間', render: (_: unknown, r: Row) => r.assignment ? `${r.assignment.effectiveFrom} ～ ${r.assignment.effectiveTo}` : '-' },
              { title: '狀態', render: (_: unknown, r: Row) => !r.assignment ? <Tag color="orange">待指派</Tag>
                : r.assignment.problem ? <Tag color="red">{r.assignment.problem}</Tag>
                  : r.assignment.effectiveTo < today() ? <Tag color="orange">已到期</Tag> : <Tag color="green">有效</Tag> },
              ...(d.canAssign ? [{ title: '操作', fixed: 'right' as const, render: (_: unknown, r: Row) =>
                <Button size="small" type="link" onClick={() => setTarget(r.identity)}>指派角色</Button> }] : []),
            ]}
          />
          <AssignModal d={d} identity={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); reload() }} />
        </Card>
      )
    }}</Gate>
  )
}

function AssignModal({ d, identity, onClose, onDone }: { d: Overview; identity: Identity | null; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const account = d.accounts.find((a) => a.id === identity?.accountId)
  const roles = d.roles.filter((r) => d.assignableRoles.includes(r.code))
  const scopeId: string | undefined = Form.useWatch('scopeId', form)
  const stageOptions = d.scopes.find((s) => s.id === scopeId)?.stages ?? ['學前', '國小', '國中', '高中職', '大專']

  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api('/admin/assignments', { method: 'POST', json: { identityId: identity!.id, roleCode: v.roleCode, scopeId: v.scopeId, stages: v.stages ?? [], effectiveFrom: v.from, effectiveTo: v.to } })
      msg.success('已指派角色'); onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '指派失敗') } finally { setSaving(false) }
  }

  return (
    <Modal open={!!identity} title={`指派角色：${account?.name ?? ''}（${account?.username ?? ''}）`} okText="指派" cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) form.resetFields() }}>
      {ctx}
      <Typography.Paragraph type="secondary">只列出您有權限指派的角色與資料範圍；後端會再檢查一次。</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ scopeId: identity?.orgScopeId, from: '2026-08-01', to: '2027-07-31' }}>
        <Form.Item name="roleCode" label="角色" rules={[{ required: true, message: '請選擇角色' }]}>
          <Select options={roles.map((r) => ({ value: r.code, label: r.name }))} placeholder="選擇角色" />
        </Form.Item>
        <Form.Item name="scopeId" label="資料範圍" rules={[{ required: true, message: '請選擇資料範圍' }]}>
          <Select options={d.scopes.map((s) => ({ value: s.id, label: s.name }))} />
        </Form.Item>
        <Form.Item name="stages" label="教育階段（不選＝不限）">
          <Select mode="multiple" allowClear options={stageOptions.map((x) => ({ value: x, label: x }))} />
        </Form.Item>
        <Form.Item label="有效期間" required style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Form.Item name="from" rules={[{ required: true, message: '請輸入起日' }]} style={{ flex: 1 }}><Input type="date" aria-label="起日" /></Form.Item>
            <Form.Item name="to" rules={[{ required: true, message: '請輸入迄日' }]} style={{ flex: 1 }}><Input type="date" aria-label="迄日" /></Form.Item>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function RoleMatrixView() {
  const { data, err } = useOverview()
  return (
    <Gate data={data} err={err}>{(d) => {
      const tree = (parent: string | null): DataNode[] =>
        d.scopes.filter((s) => s.parentId === parent).map((s) => ({
          key: s.id,
          title: s.type === 'DISTRICT'
            ? `${s.name}（DISTRICT）涵蓋：${d.areas.filter((a) => a.districtId === s.id).map((a) => a.name).join('、')}`
            : s.type === 'SCHOOL' ? `${s.name}（SCHOOL，位於${d.areas.find((a) => a.id === s.areaId)?.name ?? '未指定'}）` : `${s.name}（${s.type}）`,
          children: tree(s.id),
        }))
      return (
        <>
          <Card title="角色 × 模組 × 動作（示範值，待業務核准）" style={{ marginBottom: 16 }}>
            <Typography.Paragraph type="secondary">
              {Object.entries(ACTION_LETTER).map(([k, v]) => `${k}＝${ACTION_LABEL[v]}`).join('　')}　｜　「最高層級」是角色可被指派的最高節點。
            </Typography.Paragraph>
            <Table size="small" rowKey="id" pagination={false} scroll={{ x: 1100 }}
              dataSource={MODULES}
              columns={[
                { title: '模組', dataIndex: 'name', fixed: 'left', width: 140 },
                ...d.roles.map((r) => ({
                  title: <>{r.name}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>最高：{r.maxScope}{r.relationLimited ? '・關係' : ''}</Typography.Text></>,
                  key: r.code,
                  render: (_: unknown, m: { id: string }) => r.grants[m.id] ? <Tag color="blue">{r.grants[m.id]}</Tag> : <span style={{ color: '#ccc' }}>—</span>,
                })),
              ]}
            />
          </Card>
          <Card title="資料範圍樹（分區 = 多個行政區／鄉鎮）">
            {d.areaProblems.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="分區組成有問題" description={d.areaProblems.join("；")} />}
            <Tree defaultExpandAll treeData={tree(d.scopes.find((s) => s.id === d.rootId)?.parentId ?? null)} selectable={false} />
          </Card>
        </>
      )
    }}</Gate>
  )
}

export function AuditView() {
  const { data, err } = useOverview()
  return (
    <Gate data={data} err={err}>{(d) => (
      <Card title={`授權稽核紀錄（${d.scopeName}，本次瀏覽期間）`}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="每次授權決定（允許或拒絕）都會寫入稽核；示範僅存於記憶體，重新整理即清空。" />
        <Table size="small" rowKey="id" scroll={{ x: 800 }} dataSource={d.audit}
          columns={[
            { title: '時間', dataIndex: 'at' },
            { title: '使用者姓名', dataIndex: 'accountName' },
            { title: '角色', dataIndex: 'roleName' },
            { title: '權限', dataIndex: 'permission' },
            { title: '目標', dataIndex: 'target' },
            { title: '結果', dataIndex: 'decision', render: (v: string) => <Tag color={v === 'ALLOW' ? 'green' : 'red'}>{v === 'ALLOW' ? '允許' : '拒絕'}</Tag> },
            { title: '原因', dataIndex: 'reason', render: (v: keyof typeof REASON_TEXT) => REASON_TEXT[v] },
          ]}
        />
      </Card>
    )}</Gate>
  )
}
