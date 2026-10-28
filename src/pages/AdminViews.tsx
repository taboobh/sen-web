import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Result, Select, Spin, Tag, Tree, Typography, message } from 'antd'
import DataTable, { type Col } from '../components/DataTable'
import type { DataNode } from 'antd/es/tree'
import { api, ApiError } from '../api/client'
import { ACTION_LABEL, ACTION_LETTER, type AdminArea, type Account, type AuditEntry, type Identity, type Role, type RoleAssignment, type ScopeNode } from '../types'
import { REASON_TEXT } from '../auth/engine'
import { MODULES } from '../mock/modules'

type AssignmentRow = RoleAssignment & { problem: string | null }

interface Overview {
  rootId: string; scopeName: string; canAssign: boolean; assignableRoles: string[]
  roles: Role[]; assignableScopes: Record<string, string[]>; scopes: ScopeNode[]; areas: AdminArea[]; areaProblems: string[]; accounts: Account[]; identities: Identity[]
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

const periodText = (a?: AssignmentRow) => !a ? '-' : a.concurrent ? `${a.effectiveFrom} ～ ${a.effectiveTo}` : '無期限（本職）'
const statusText = (a?: AssignmentRow) => !a ? '待指派' : a.problem ? a.problem : a.effectiveTo && a.effectiveTo < today() ? '已到期' : '有效'

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
      const scopeName = (id?: string) => d.scopes.find((s) => s.id === id)?.name
      const columns: Col<Row>[] = [
        { key: 'username', title: '帳號', value: (r) => r.account.username, render: (r) => <Typography.Text code>{r.account.username}</Typography.Text> },
        { key: 'name', title: '使用者姓名', value: (r) => r.account.name,
          render: (r) => <>{r.account.name}{r.account.status !== 'active' && <Tag color="red" style={{ marginLeft: 6 }}>鎖定</Tag>}</> },
        { key: 'identity', title: '身分', value: (r) => `${scopeName(r.identity.orgScopeId)} ${r.identity.jobTitle}` },
        { key: 'role', title: '角色', value: (r) => r.assignment ? d.roles.find((x) => x.code === r.assignment!.roleCode)?.name : '尚未指派',
          render: (r) => r.assignment ? <Tag color="blue">{d.roles.find((x) => x.code === r.assignment!.roleCode)?.name}</Tag> : <Tag>尚未指派</Tag> },
        { key: 'scope', title: '資料範圍', value: (r) => r.assignment ? scopeName(r.assignment.scopeId) : '' },
        { key: 'stages', title: '教育階段', value: (r) => r.assignment ? (r.assignment.stages.length ? r.assignment.stages.join('、') : '不限') : '' },
        { key: 'kind', title: '任職別', value: (r) => r.assignment ? (r.assignment.concurrent ? '兼任／借調' : '本職') : '' },
        { key: 'period', title: '有效期間', value: (r) => periodText(r.assignment) },
        { key: 'status', title: '狀態', value: (r) => statusText(r.assignment),
          render: (r) => !r.assignment ? <Tag color="orange">待指派</Tag>
            : r.assignment.problem ? <Tag color="red">{r.assignment.problem}</Tag>
              : statusText(r.assignment) === '已到期' ? <Tag color="orange">已到期</Tag> : <Tag color="green">有效</Tag> },
        ...(d.canAssign ? [{ key: 'op', title: '操作', value: () => '', noExport: true, filter: false, fixed: 'right' as const, width: 100,
          render: (r: Row) => <Button size="small" type="link" onClick={() => setTarget(r.identity)}>指派角色</Button> }] : []),
      ]
      return (
        <Card title={`帳號與角色指派（${d.scopeName}）`}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`您目前的資料範圍是「${d.scopeName}」，只能瀏覽此範圍內的使用者與角色指派${d.canAssign ? '，並可在範圍內指派角色' : ''}。`} />
          <Typography.Paragraph type="secondary">
            「帳號」是登入用的英文代號；「使用者姓名」是本人姓名。一個帳號可有多個身分；每個身分有「角色＋資料範圍＋教育階段」的指派，兼任／借調另有有效期間。
          </Typography.Paragraph>
          <DataTable<Row> rows={rows} columns={columns} rowKey={(r) => r.key} exportName="帳號與角色指派" scrollX={1300} />
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
  const roleCode: string | undefined = Form.useWatch('roleCode', form)
  const scopeId: string | undefined = Form.useWatch('scopeId', form)
  const concurrent: boolean = Form.useWatch('concurrent', form) ?? false
  // 資料範圍隨角色連動：只列出該角色可指派、且自己有權指派的節點
  const scopeOptions = (roleCode ? d.assignableScopes[roleCode] ?? [] : []).map((id) => d.scopes.find((s) => s.id === id)!).filter(Boolean)
  const stageOptions = d.scopes.find((s) => s.id === scopeId)?.stages ?? ['學前', '國小', '國中', '高中職', '大專']

  const onRoleChange = (code: string) => {
    const ok = (d.assignableScopes[code] ?? [])
    const keep = ok.includes(scopeId ?? '') ? scopeId : ok.includes(identity?.orgScopeId ?? '') ? identity?.orgScopeId : ok.length === 1 ? ok[0] : undefined
    form.setFieldsValue({ scopeId: keep, stages: undefined })
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api('/admin/assignments', { method: 'POST', json: { identityId: identity!.id, roleCode: v.roleCode, scopeId: v.scopeId, stages: v.stages ?? [], concurrent: !!v.concurrent, effectiveFrom: v.concurrent ? v.from : null, effectiveTo: v.concurrent ? v.to : null } })
      msg.success('已指派角色'); onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '指派失敗') } finally { setSaving(false) }
  }

  return (
    <Modal open={!!identity} title={`指派角色：${account?.name ?? ''}（${account?.username ?? ''}）`} okText="指派" cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) form.resetFields() }}>
      {ctx}
      <Typography.Paragraph type="secondary">
        只列出您有權限指派的角色；「資料範圍」會隨所選角色連動。學校管理員：署轄學校由署端管理員指派，其餘學校由縣市管理員指派。後端會再檢查一次。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ concurrent: false }}>
        <Form.Item name="roleCode" label="角色" rules={[{ required: true, message: '請選擇角色' }]}>
          <Select options={roles.map((r) => ({ value: r.code, label: r.name }))} placeholder="選擇角色" onChange={onRoleChange} />
        </Form.Item>
        <Form.Item name="scopeId" label="資料範圍" rules={[{ required: true, message: '請選擇資料範圍' }]}
          extra={roleCode ? `此角色可指派的範圍：${scopeOptions.length} 個` : '請先選擇角色'}>
          <Select disabled={!roleCode} showSearch optionFilterProp="label" placeholder={roleCode ? '選擇資料範圍' : '請先選擇角色'}
            options={scopeOptions.map((s) => ({ value: s.id, label: s.ntaDirect ? `${s.name}` : s.name }))} />
        </Form.Item>
        <Form.Item name="stages" label="教育階段（不選＝不限）">
          <Select mode="multiple" allowClear options={stageOptions.map((x) => ({ value: x, label: x }))} />
        </Form.Item>
        <Form.Item name="concurrent" valuePropName="checked" style={{ marginBottom: concurrent ? 12 : 0 }}>
          <Checkbox>兼任／借調（勾選才需填寫有效期間；未勾選為本職，長期有效）</Checkbox>
        </Form.Item>
        {concurrent && (
          <Form.Item label="有效期間" required style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Form.Item name="from" rules={[{ required: true, message: '請輸入起日' }]} style={{ flex: 1 }}><Input type="date" aria-label="起日" /></Form.Item>
              <Form.Item name="to" rules={[{ required: true, message: '請輸入迄日' }]} style={{ flex: 1 }}><Input type="date" aria-label="迄日" /></Form.Item>
            </div>
          </Form.Item>
        )}
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
            <DataTable<{ id: string; name: string }> rows={MODULES.map((m) => ({ id: m.id, name: m.name }))} rowKey={(m) => m.id} exportName="角色模組動作矩陣"
              pagination={false} scrollX={1100}
              columns={[
                { key: 'module', title: '模組', value: (m) => m.name, fixed: 'left', width: 140 },
                ...d.roles.map((r): Col<{ id: string; name: string }> => ({
                  key: r.code, title: r.name,
                  titleNode: <>{r.name}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>最高：{r.maxScope}{r.relationLimited ? '・關係' : ''}</Typography.Text></>,
                  value: (m) => r.grants[m.id] ?? '',
                  render: (m) => r.grants[m.id] ? <Tag color="blue">{r.grants[m.id]}</Tag> : <span style={{ color: '#ccc' }}>—</span>,
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
        <DataTable<AuditEntry> rows={d.audit} rowKey={(e) => String(e.id)} exportName="授權稽核紀錄" scrollX={900}
          columns={[
            { key: 'at', title: '時間', value: (e) => e.at },
            { key: 'accountName', title: '使用者姓名', value: (e) => e.accountName },
            { key: 'roleName', title: '角色', value: (e) => e.roleName },
            { key: 'permission', title: '權限', value: (e) => e.permission },
            { key: 'target', title: '目標', value: (e) => e.target },
            { key: 'decision', title: '結果', value: (e) => e.decision === 'ALLOW' ? '允許' : '拒絕',
              render: (e) => <Tag color={e.decision === 'ALLOW' ? 'green' : 'red'}>{e.decision === 'ALLOW' ? '允許' : '拒絕'}</Tag> },
            { key: 'reason', title: '原因', value: (e) => REASON_TEXT[e.reason] },
          ]}
        />
      </Card>
    )}</Gate>
  )
}
