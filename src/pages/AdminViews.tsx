import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Checkbox, Form, InputNumber, Input, Modal, Popconfirm, Result, Segmented, Select, Space, Spin, Switch, Table, Tag, Tooltip, Tree, Typography, message } from 'antd'
import DataTable, { type Col } from '../components/DataTable'
import type { DataNode } from 'antd/es/tree'
import { api, ApiError } from '../api/client'
import { ALL_CONTACTS, CONTACT_LABEL, VERIFIABLE } from '../auth/profile'
import { END_REASON_TEXT, type EndReason, ACTION_LABEL, ACTION_LETTER, type ContactField, type ProfileSettings, type AdminArea, type Account, type AuditEntry, type Identity, type Role, type RoleAssignment, type ScopeNode } from '../types'
import { REASON_TEXT } from '../auth/engine'
import { useAuth } from '../auth/AuthContext'
import type { ScopeType } from '../types'
import { MODULES } from '../mock/modules'

type AssignmentRow = RoleAssignment & { problem: string | null }

interface Overview {
  rootId: string; scopeName: string; canAssign: boolean; canEditRoles: boolean; assignableRoles: string[]
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

/** 一個帳號一列；本職機構內第一個角色為主要角色，同機構的其他角色長期有效；外部機構的角色為借調（須有效期間） */
interface Row { key: string; account: Account; identities: Identity[]; assigns: AssignmentRow[]; primary?: AssignmentRow; primaryIdentity?: Identity }

const periodText = (a?: AssignmentRow) => !a ? '-' : a.concurrent ? `${a.effectiveFrom} ～ ${a.effectiveTo}` : '無期限'
const endedText = (i: Identity) => i.endReason === 'retire' ? '退休' : `已離任（${END_REASON_TEXT[i.endReason ?? 'transfer']}）`
const asgStatus = (a: AssignmentRow) => a.problem ? a.problem : a.effectiveTo && a.effectiveTo < today() ? '已到期' : '有效'
const accountStatus = (r: Row) =>
  r.account.status !== 'active' ? '帳號鎖定'
    : r.assigns.length === 0 ? (r.primaryIdentity?.status === 'ended' ? endedText(r.primaryIdentity) : '待指派')
      : r.assigns.some((a) => a.problem) ? '指派有問題'
        : !r.primary ? '缺本職主要角色'
          : r.assigns.every((a) => asgStatus(a) === '已到期') ? '已到期' : '有效'
const STATUS_COLOR: Record<string, string> = { 有效: 'green', 待指派: 'orange', 缺本職主要角色: 'orange', 已到期: 'orange', 帳號鎖定: 'red', 指派有問題: 'red', 退休: 'default' }

export function AccountsView() {
  const { data, err, reload } = useOverview()
  const [assignFor, setAssignFor] = useState<Account | null>(null)
  const [addFor, setAddFor] = useState<Account | null>(null)
  const [endFor, setEndFor] = useState<Identity | null>(null)
  const [quick, setQuick] = useState<string>('全部')
  return (
    <Gate data={data} err={err}>{(d) => {
      const scopeName = (id?: string) => d.scopes.find((s) => s.id === id)?.name ?? '-'
      const roleName = (a: RoleAssignment) => d.roles.find((x) => x.code === a.roleCode)?.name ?? a.roleCode
      const rows: Row[] = d.accounts.map((account) => {
        const identities = d.identities.filter((i) => i.accountId === account.id)
        const assigns = d.assignments.filter((a) => a.status === 'active' && identities.some((i) => i.id === a.identityId))
          .sort((x, y) => Number(x.concurrent) - Number(y.concurrent))
        const primary = assigns.find((a) => !a.concurrent)
        const primaryIdentity = identities.find((i) => i.id === primary?.identityId) ?? identities.find((i) => i.status !== 'ended')
          ?? [...identities].sort((x, y) => (y.endedAt ?? '').localeCompare(x.endedAt ?? ''))[0]  // 退休／離任者：顯示離任前的單位
        return { key: account.id, account, identities, assigns, primary, primaryIdentity }
      })
      const asgTip = (a: AssignmentRow) => `${roleName(a)}｜${scopeName(a.scopeId)}｜${a.stages.length ? a.stages.join('、') : '不限階段'}${a.concurrent ? `｜${a.effectiveFrom} ～ ${a.effectiveTo}` : ''}`
      const chipText = (a: AssignmentRow) => `${a.concurrent ? '借調 ' : ''}${roleName(a)}・${scopeName(a.scopeId)}${a.concurrent ? ` 至 ${a.effectiveTo}` : ''}`
      // 底色之外再用符號／文字區分：★本職主要＝實心藍；本職其他＝淺藍；借調＝金色虛線框（到期轉灰）
      const chip = (r: Row, a: AssignmentRow) => {
        const live = asgStatus(a) === '有效'
        if (a.concurrent) return <Tag color={live ? 'gold' : 'default'} style={{ borderStyle: 'dashed', marginInlineEnd: 0 }}>{chipText(a)}</Tag>
        if (a === r.primary) return <Tag color={live ? '#1677ff' : 'default'} style={{ marginInlineEnd: 0 }}>★ {roleName(a)}・{scopeName(a.scopeId)}</Tag>
        return <Tag color={live ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>{roleName(a)}・{scopeName(a.scopeId)}</Tag>
      }
      const soon = (a: AssignmentRow) => !!a.effectiveTo && a.effectiveTo >= today() && a.effectiveTo <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
      const QUICK: Record<string, (r: Row) => boolean> = {
        全部: () => true,
        借調中: (r) => r.assigns.some((a) => a.concurrent && asgStatus(a) === '有效'),
        待指派: (r) => accountStatus(r) === '待指派',
        缺本職: (r) => accountStatus(r) === '缺本職主要角色',
        '30天內到期': (r) => r.assigns.some(soon),
      }
      const shownRows = rows.filter(QUICK[quick] ?? QUICK['全部'])
      const columns: Col<Row>[] = [
        { key: 'username', title: '帳號', value: (r) => r.account.username, render: (r) => <Typography.Text code>{r.account.username}</Typography.Text> },
        { key: 'name', title: '使用者姓名', value: (r) => r.account.name,
          render: (r) => <>{r.account.name}{r.account.status !== 'active' && <Tag color="red" style={{ marginLeft: 6 }}>鎖定</Tag>}</> },
        { key: 'org', title: '本職機構／職稱', value: (r) => r.primaryIdentity ? `${scopeName(r.primaryIdentity.orgScopeId)} ${r.primaryIdentity.jobTitle}${r.primaryIdentity.status === 'ended' ? `（${endedText(r.primaryIdentity)}）` : ''}` : '',
          render: (r) => r.primaryIdentity ? <>{scopeName(r.primaryIdentity.orgScopeId)} {r.primaryIdentity.jobTitle}{r.primaryIdentity.status === 'ended' && <Tag style={{ marginLeft: 6 }}>{endedText(r.primaryIdentity)}</Tag>}</> : '-' },
        { key: 'roles', title: '已指派角色', width: 360, value: (r) => r.assigns.map(chipText).join('、') || (r.primaryIdentity?.status === 'ended' ? '' : '尚未指派'),
          values: (r) => r.assigns.map((a) => roleName(a)),
          render: (r) => {
            if (r.assigns.length === 0) return r.primaryIdentity?.status === 'ended' ? '-' : <Tag>尚未指派</Tag>
            const shown = r.assigns.slice(0, 3), more = r.assigns.slice(3)
            return (
              <Space size={[4, 4]} wrap>
                {shown.map((a) => <Tooltip key={a.id} title={asgTip(a)}>{chip(r, a)}</Tooltip>)}
                {more.length > 0 && <Tooltip title={<>{more.map((a) => <div key={a.id}>{chipText(a)}</div>)}</>}><Tag>＋{more.length}</Tag></Tooltip>}
              </Space>)
          } },
        { key: 'count', title: '角色數', value: (r) => r.assigns.length },
        { key: 'idno', title: '身分證', value: (r) => r.account.idStatus === 'verified' ? '已驗證' : r.account.idStatus === 'unverified' ? '待核對' : '未填',
          render: (r) => r.account.idStatus === 'verified' ? <Tag color="green">已驗證</Tag> : r.account.idStatus === 'unverified' ? <Tag color="orange">待核對</Tag> : <Tag>未填</Tag> },
        { key: 'status', title: '狀態', value: (r) => accountStatus(r),
          render: (r) => <Tag color={STATUS_COLOR[accountStatus(r)]}>{accountStatus(r)}</Tag> },
        ...(d.canAssign ? [{ key: 'op', title: '操作', value: () => '', noExport: true, filter: false, fixed: 'right' as const, width: 190,
          render: (r: Row) => r.identities.every((i) => i.status === 'ended') && r.assigns.length === 0 && r.identities.length > 0 ? '-'
            : <Space size={0}><Button size="small" type="link" onClick={() => setAssignFor(r.account)}>指派角色</Button><Button size="small" type="link" onClick={() => setAddFor(r.account)}>新增借調機構</Button></Space> }] : []),
      ]
      const revoke = async (a: AssignmentRow) => {
        try { await api(`/admin/assignments/${a.id}/revoke`, { method: 'POST' }); message.success('已撤銷'); reload() }
        catch (e) { message.error(e instanceof ApiError ? e.message : '撤銷失敗') }
      }
      const detail = (r: Row) => (
        <div style={{ padding: '4px 0 4px 24px' }}>
          <Typography.Text type="secondary">「{r.account.name}」已指派的角色（共 {r.assigns.length} 筆）</Typography.Text>
          <Table size="small" style={{ marginTop: 6 }} pagination={false} rowKey="id" dataSource={r.assigns} locale={{ emptyText: '尚未指派角色' }}
            columns={[
              { title: '任職別', width: 110, render: (_: unknown, a: AssignmentRow) => a.concurrent ? <Tag color="gold">借調</Tag> : a === r.primary ? <Tag color="blue">本職・主要</Tag> : <Tag color="cyan">本職・其他</Tag> },
              { title: '任職機構', render: (_: unknown, a: AssignmentRow) => { const i = r.identities.find((x) => x.id === a.identityId); return `${scopeName(i?.orgScopeId)} ${i?.jobTitle ?? ''}` } },
              { title: '角色', render: (_: unknown, a: AssignmentRow) => <Tag color="blue">{roleName(a)}</Tag> },
              { title: '資料範圍', render: (_: unknown, a: AssignmentRow) => scopeName(a.scopeId) },
              { title: '教育階段', render: (_: unknown, a: AssignmentRow) => a.stages.length ? a.stages.join('、') : '不限' },
              { title: '有效期間', render: (_: unknown, a: AssignmentRow) => periodText(a) },
              { title: '狀態', render: (_: unknown, a: AssignmentRow) => <Tag color={STATUS_COLOR[asgStatus(a)] ?? 'red'}>{asgStatus(a)}</Tag> },
              ...(d.canAssign ? [{ title: '操作', width: 80, render: (_: unknown, a: AssignmentRow) =>
                <Popconfirm title={`撤銷「${roleName(a)}」？`} okText="撤銷" cancelText="取消" onConfirm={() => { void revoke(a) }}><Button size="small" type="link" danger>撤銷</Button></Popconfirm> }] : []),
            ]} />
          {r.identities.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">任職機構：</Typography.Text>
              {r.identities.map((i) => (
                <span key={i.id} style={{ marginRight: 16 }}>
                  {scopeName(i.orgScopeId)} {i.jobTitle}{i.id === r.primaryIdentity?.id && <Tag color="blue" style={{ marginLeft: 4 }}>本職機構</Tag>}
                  {i.status === 'ended' ? <Tag style={{ marginLeft: 4 }}>{endedText(i)}</Tag>
                    : d.canAssign && <Button size="small" type="link" danger onClick={() => setEndFor(i)}>調職／退休／離職</Button>}
                </span>
              ))}
            </div>
          )}
        </div>
      )
      return (
        <Card title={`帳號與角色指派（${d.scopeName}）`}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`您目前的資料範圍是「${d.scopeName}」，只能瀏覽此範圍內的使用者與角色指派${d.canAssign ? '，並可在範圍內指派角色' : ''}。`} />
          <Typography.Paragraph type="secondary">
            列表以「帳號」為單位，一個帳號一列，列出該帳號已指派的角色（點列首的展開鈕看每筆明細）。每位使用者有一個「本職」：隸屬一個機構、擔任一項主要角色（長期有效），同機構可再有其他角色（長期有效）；在外部單位（非本職機構）的角色為「借調」，才需要有效期間。退休人員保留退休前的單位並標註「退休」，角色已清空。
          </Typography.Paragraph>
          <Segmented style={{ marginBottom: 12 }} value={quick} onChange={(v) => setQuick(String(v))}
            options={Object.keys(QUICK).map((k) => ({ value: k, label: `${k}（${rows.filter(QUICK[k]).length}）` }))} />
          <DataTable<Row> rows={shownRows} columns={columns} rowKey={(r) => r.key} exportName="帳號與角色指派" scrollX={1100} expandedRowRender={detail}
            extraSheets={(view) => [{ name: '指派明細', rows: view.flatMap((r) => r.assigns.map((a) => {
              const i = r.identities.find((x) => x.id === a.identityId)
              return { 帳號: r.account.username, 使用者姓名: r.account.name, 任職別: a.concurrent ? '借調' : a === r.primary ? '本職・主要' : '本職・其他', 任職機構: scopeName(i?.orgScopeId), 職稱: i?.jobTitle ?? '', 角色: roleName(a), 資料範圍: scopeName(a.scopeId), 教育階段: a.stages.length ? a.stages.join('、') : '不限', 有效期間: periodText(a), 狀態: asgStatus(a) }
            })) }]} />
          <EndIdentityModal d={d} identity={endFor} onClose={() => setEndFor(null)} onDone={() => { setEndFor(null); reload() }} />
          <AddIdentityModal d={d} account={addFor} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); reload() }} />
          <AssignModal d={d} account={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); reload() }} />
        </Card>
      )
    }}</Gate>
  )
}

function EndIdentityModal({ d, identity, onClose, onDone }: { d: Overview; identity: Identity | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<EndReason | undefined>()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const account = d.accounts.find((a) => a.id === identity?.accountId)
  const org = d.scopes.find((s) => s.id === identity?.orgScopeId)?.name
  const count = d.assignments.filter((a) => a.identityId === identity?.id).length
  const submit = async () => {
    if (!reason) { msg.warning('請選擇原因'); return }
    setSaving(true)
    try {
      await api(`/admin/identities/${identity!.id}/end`, { method: 'POST', json: { reason } })
      msg.success('已清空原機構的角色'); setReason(undefined); onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '處理失敗') } finally { setSaving(false) }
  }
  return (
    <Modal open={!!identity} title={`調職／退休／離職：${account?.name ?? ''}（${org ?? ''}）`} okText="確認並清空角色" okButtonProps={{ danger: true }} cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={() => { setReason(undefined); onClose() }} destroyOnClose>
      {ctx}
      <Typography.Paragraph type="secondary">
        會清空此帳號在「{org}」的全部角色指派（目前 {count} 筆）並標記為已離任；帳號與個人資料保留，在其他機構的身分與角色不受影響。處理紀錄會寫入稽核。
      </Typography.Paragraph>
      <Select style={{ width: '100%' }} placeholder="選擇原因" value={reason} onChange={setReason}
        options={(['transfer', 'retire', 'resign'] as EndReason[]).map((x) => ({ value: x, label: END_REASON_TEXT[x] }))} />
    </Modal>
  )
}

function AddIdentityModal({ d, account, onClose, onDone }: { d: Overview; account: Account | null; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const has = new Set(d.identities.filter((i) => i.accountId === account?.id && i.status !== 'ended').map((i) => i.orgScopeId))
  const options = d.scopes.filter((x) => !has.has(x.id)).map((x) => ({ value: x.id, label: x.name }))
  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      await api('/admin/identities', { method: 'POST', json: { accountId: account!.id, orgScopeId: v.orgScopeId, jobTitle: v.jobTitle } })
      msg.success('已新增身分，請接著為該身分指派角色'); onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '新增失敗') } finally { setSaving(false) }
  }
  return (
    <Modal open={!!account} title={`新增身分：${account?.name ?? ''}（${account?.username ?? ''}）`} okText="新增" cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) form.resetFields() }}>
      {ctx}
      <Typography.Paragraph type="secondary">
        同一帳號可在多個機構任職：每個機構一個身分，之後再為該身分指派角色。已有身分的機構不會列出；後端會再檢查您是否有權處理該機構。
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item name="orgScopeId" label="機構" rules={[{ required: true, message: '請選擇機構' }]}>
          <Select showSearch optionFilterProp="label" options={options} placeholder="選擇機構（學校、單位）" />
        </Form.Item>
        <Form.Item name="jobTitle" label="職稱" rules={[{ required: true, message: '請填寫職稱' }]}><Input /></Form.Item>
      </Form>
    </Modal>
  )
}

function AssignModal({ d, account, onClose, onDone }: { d: Overview; account: Account | null; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const ids = d.identities.filter((i) => i.accountId === account?.id && i.status !== 'ended')
  const hasPrimary = d.assignments.some((a) => a.status === 'active' && !a.concurrent && ids.some((i) => i.id === a.identityId))
  const defaultIdentity = ids.find((i) => d.assignments.some((a) => a.status === 'active' && !a.concurrent && a.identityId === i.id)) ?? ids[0]
  const identityId: string | undefined = Form.useWatch('identityId', form)
  const identity = ids.find((i) => i.id === identityId) ?? defaultIdentity
  const roles = d.roles.filter((r) => d.assignableRoles.includes(r.code))
  const roleCode: string | undefined = Form.useWatch('roleCode', form)
  const scopeId: string | undefined = Form.useWatch('scopeId', form)
  // 本職機構內的角色長期有效；外部單位的角色為借調（須有效期間）
  const external = hasPrimary && !!identity && identity.id !== defaultIdentity?.id
  const concurrent = external
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
      await api('/admin/assignments', { method: 'POST', json: { identityId: v.identityId, roleCode: v.roleCode, scopeId: v.scopeId, stages: v.stages ?? [], concurrent, effectiveFrom: concurrent ? v.from : null, effectiveTo: v.concurrent ? v.to : null } })
      msg.success('已指派角色'); onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '指派失敗') } finally { setSaving(false) }
  }

  return (
    <Modal open={!!account} title={`指派角色：${account?.name ?? ''}（${account?.username ?? ''}）`} okText="指派" cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) form.resetFields() }}>
      {ctx}
      <Typography.Paragraph type="secondary">
        只列出您有權限指派的角色；「資料範圍」會隨所選角色連動。學校管理員：署轄學校由署端管理員指派，其餘學校由縣市管理員指派。後端會再檢查一次。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ identityId: defaultIdentity?.id }}>
        <Form.Item name="identityId" label="任職機構" rules={[{ required: true, message: '請選擇機構' }]}
          extra={hasPrimary ? '本職機構內的角色長期有效；選擇其他（外部）機構時為借調，須填有效期間。借調的機構若未列出，請先「新增借調機構」。' : '此帳號尚無本職：第一個角色即為本職主要角色，所在機構即為本職機構。'}>
          <Select options={ids.map((i) => ({ value: i.id, label: `${d.scopes.find((x) => x.id === i.orgScopeId)?.name ?? ''} ${i.jobTitle}` }))} onChange={() => form.setFieldsValue({ scopeId: undefined, stages: undefined })} />
        </Form.Item>
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
        {external && <Form.Item style={{ marginBottom: 12 }}><Checkbox checked disabled>借調（外部單位，須填寫有效期間）</Checkbox></Form.Item>}
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

const SCOPE_LABEL: Record<ScopeType, string> = { ROOT: '全國（署）', CITY: '縣市', DISTRICT: '分區', SCHOOL: '學校' }
const LETTERS = Object.keys(ACTION_LETTER)

export function RoleMatrixView() {
  const { data, err, reload } = useOverview()
  const [editing, setEditing] = useState<Role | null>(null)
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
            {d.canEditRoles
              ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="您是署管理員，可點角色欄位上方的「修改」調整角色的權限、最高層級與責任關係限制。"
                  description="修改會立即套用到所有被指派此角色的使用者，並寫入稽核紀錄。示範資料只存在記憶體，重新整理即還原。" />
              : <Alert type="info" showIcon style={{ marginBottom: 12 }} message="唯讀：角色與權限只有署管理員可以修改。" />}
            <Typography.Paragraph type="secondary">
              {Object.entries(ACTION_LETTER).map(([k, v]) => `${k}＝${ACTION_LABEL[v]}`).join('　')}　｜　「最高層級」是角色可被指派的最高節點。
            </Typography.Paragraph>
            <DataTable<{ id: string; name: string }> rows={MODULES.map((m) => ({ id: m.id, name: m.name }))} rowKey={(m) => m.id} exportName="角色模組動作矩陣"
              pagination={false} scrollX={1100}
              columns={[
                { key: 'module', title: '模組', value: (m) => m.name, fixed: 'left', width: 140 },
                ...d.roles.map((r): Col<{ id: string; name: string }> => ({
                  key: r.code, title: r.name,
                  titleNode: <>{r.name}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>最高：{r.maxScope}{r.relationLimited ? '・關係' : ''}</Typography.Text>
                    {d.canEditRoles && <><br /><Button size="small" type="link" style={{ padding: 0, height: 'auto' }} onClick={(e) => { e.stopPropagation(); setEditing(r) }}>修改</Button></>}</>,
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
          <RoleEditModal role={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload() }} />
        </>
      )
    }}</Gate>
  )
}

function RoleEditModal({ role, onClose, onDone }: { role: Role | null; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const { refresh } = useAuth()
  const isNea = role?.code === 'NEA_ADMIN'

  const init = () => {
    if (!role) return
    form.setFieldsValue({
      name: role.name, maxScope: role.maxScope, relationLimited: !!role.relationLimited,
      ...Object.fromEntries(MODULES.map((m) => [`g_${m.id}`, [...(role.grants[m.id] ?? '')]])),
    })
  }

  const submit = async () => {
    const v = await form.validateFields()
    const grants = Object.fromEntries(MODULES.map((m) => [m.id, ((v[`g_${m.id}`] ?? []) as string[]).join('')]))
    setSaving(true)
    try {
      await api(`/admin/roles/${role!.code}`, { method: 'PUT', json: { name: v.name, maxScope: v.maxScope, relationLimited: !!v.relationLimited, grants } })
      msg.success('已更新角色權限')
      await refresh() // 若改到自己的角色，選單與按鈕立即更新
      onDone()
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '儲存失敗') } finally { setSaving(false) }
  }

  return (
    <Modal open={!!role} width={720} title={`修改角色：${role?.name ?? ''}（${role?.code ?? ''}）`} okText="儲存" cancelText="取消"
      confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) init() }}>
      {ctx}
      <Typography.Paragraph type="secondary">
        儲存後立即套用到所有被指派此角色的使用者，並寫入稽核紀錄。{isNea && '署管理員須保留全國層級及「帳號與權限」的查詢、修改，避免無人能再修改角色。'}
        後端會再檢查一次（例如既有指派高於新的最高層級時不可儲存）。
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="name" label="角色名稱" rules={[{ required: true, whitespace: true, message: '請輸入角色名稱' }]} style={{ flex: '1 1 200px' }}>
            <Input maxLength={30} />
          </Form.Item>
          <Form.Item name="maxScope" label="最高層級（可被指派的最高節點）" style={{ flex: '1 1 200px' }}>
            <Select disabled={isNea} options={(Object.keys(SCOPE_LABEL) as ScopeType[]).map((k) => ({ value: k, label: `${SCOPE_LABEL[k]}（${k}）` }))} />
          </Form.Item>
        </div>
        <Form.Item name="relationLimited" valuePropName="checked">
          <Checkbox>限責任關係（只能操作與自己有責任關係的學生，例如特教教師）</Checkbox>
        </Form.Item>
        <Typography.Text strong>模組權限</Typography.Text>
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: '4px 12px', marginTop: 8 }}>
          {MODULES.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #fafafa' }}>
              <span style={{ width: 120, flex: '0 0 auto' }}>{m.name}</span>
              <Form.Item name={`g_${m.id}`} style={{ margin: 0 }}>
                <Checkbox.Group options={LETTERS.map((c) => ({ value: c, label: `${ACTION_LABEL[ACTION_LETTER[c]]}`, disabled: isNea && m.id === 'admin' && (c === 'R' || c === 'U') }))} />
              </Form.Item>
            </div>
          ))}
        </div>
      </Form>
    </Modal>
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


interface ReviewData { scopeName: string; canReview: boolean; rows: { account: Account; conflict: boolean; self: boolean; identities: string[] }[] }
type ReviewRow = ReviewData['rows'][number]

/** 身分證核對：自填、無法由教育雲端 guid 驗證者，由資料範圍內的管理員核對後核准或退回 */
export function IdReviewView() {
  const [data, setData] = useState<ReviewData | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [n, setN] = useState(0)
  const [msg, ctx] = message.useMessage()
  useEffect(() => { api<ReviewData>('/admin/id-review').then(setData).catch((e) => setErr(e)) }, [n])
  if (err) return <Result status="403" title="後端拒絕" subTitle={err.message} />
  if (!data) return <Spin />
  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await api(`/admin/id-review/${id}`, { method: 'POST', json: { decision } })
      msg.success(decision === 'approve' ? '已核准' : '已退回，使用者需重新填寫身分證')
      setN((x) => x + 1)
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '操作失敗') }
  }
  return (
    <Card title={`身分證核對（${data.scopeName}）`}>
      {ctx}
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="待核對＝使用者自行填寫、無法由教育雲端 guid 自動驗證的身分證。核准前，該使用者只能停在個人資料頁。"
        description="請以人事資料或當面確認核對本人；畫面只顯示遮罩，不顯示完整號碼。與其他帳號相同者（疑似重複帳號）不可直接核准，需先合併帳號。" />
      <DataTable<ReviewRow> rows={data.rows} rowKey={(r) => r.account.id} exportName="待核對身分證" scrollX={900}
        columns={[
          { key: 'username', title: '帳號', value: (r) => r.account.username, render: (r) => <Typography.Text code>{r.account.username}</Typography.Text> },
          { key: 'name', title: '使用者姓名', value: (r) => r.account.name },
          { key: 'org', title: '單位與職稱', value: (r) => r.identities.join('、') },
          { key: 'id', title: '身分證（遮罩）', value: (r) => r.account.idMasked ?? '' },
          { key: 'flag', title: '備註', value: (r) => r.conflict ? '疑似重複帳號' : r.self ? '本人' : '',
            render: (r) => r.conflict ? <Tag color="red">與其他帳號相同（疑似重複）</Tag> : r.self ? <Tag>本人，不可自行核對</Tag> : null },
          ...(data.canReview ? [{ key: 'op', title: '操作', value: () => '', noExport: true, filter: false, fixed: 'right' as const, width: 160,
            render: (r: ReviewRow) => (
              <Space size={4}>
                <Popconfirm title="確認已核對本人身分？" okText="核准" cancelText="取消" onConfirm={() => { void decide(r.account.id, 'approve') }}>
                  <Button size="small" type="link" disabled={r.conflict || r.self}>核准</Button>
                </Popconfirm>
                <Popconfirm title="退回後使用者需重新填寫身分證" okText="退回" cancelText="取消" onConfirm={() => { void decide(r.account.id, 'reject') }}>
                  <Button size="small" type="link" danger disabled={r.self}>退回</Button>
                </Popconfirm>
              </Space>) }] : []),
        ]} />
    </Card>
  )
}

/** 帳號資料欄位設定：國教署管理員決定哪些欄位必填、聯絡方式與身分證是否驗證 */
export function ProfileSettingsView() {
  const [data, setData] = useState<{ settings: ProfileSettings; canEdit: boolean } | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [form] = Form.useForm<ProfileSettings>()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const fields: ContactField[] = Form.useWatch('contactFields', form) ?? []
  const verifyContact: boolean = Form.useWatch('verifyContact', form) ?? false
  const verifyId: boolean = Form.useWatch('verifyIdNumber', form) ?? true
  const load = () => api<{ settings: ProfileSettings; canEdit: boolean }>('/admin/profile-settings')
    .then((d) => { setData(d); form.setFieldsValue(d.settings) }).catch((e) => setErr(e))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Result status="403" title="後端拒絕" subTitle={err.message} />
  if (!data) return <Spin />
  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try { await api('/admin/profile-settings', { method: 'PUT', json: v }); msg.success('已儲存，立即套用到所有使用者'); await load() }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '儲存失敗') } finally { setSaving(false) }
  }
  return (
    <Card title="帳號資料欄位設定">
      {ctx}
      {data.canEdit
        ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="儲存後立即套用到所有使用者"
            description="不符合新規則的使用者，下一次操作會被導向個人資料頁補齊；已通過的資料不會被清除。操作者自己的資料也必須符合新規則，否則無法儲存。" />
        : <Alert type="info" showIcon style={{ marginBottom: 12 }} message="唯讀：只有署管理員可以修改" />}
      <Form form={form} layout="vertical" disabled={!data.canEdit} style={{ maxWidth: 640 }}>
        <Form.Item name="idRequired" label="身分證／居留證號必填" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="verifyIdNumber" label="驗證身分證" valuePropName="checked"
          extra={verifyId
            ? '開：檢查碼檢查；以教育雲端登入且有 guid 者自動比對；其餘（含本機帳號）需範圍內管理員在「身分證核對」核准後才能使用系統。'
            : '關（訓練站／虛擬資料用）：只檢查寬鬆格式（10 碼、英文字母開頭），不比對 guid、不需核對、不檢查重複，填完即可使用。'}>
          <Switch checkedChildren="驗證" unCheckedChildren="不驗證" />
        </Form.Item>
        <Form.Item name="contactFields" label="可填的聯絡方式">
          <Checkbox.Group options={ALL_CONTACTS.map((f) => ({ value: f, label: CONTACT_LABEL[f] }))} />
        </Form.Item>
        <Form.Item name="contactMin" label="聯絡方式至少要有幾項（0＝不要求）" rules={[{ required: true, message: '請輸入' }]}>
          <InputNumber min={0} max={Math.max(fields.length, 0)} precision={0} />
        </Form.Item>
        <Form.Item name="verifyContact" label="聯絡方式需通過驗證碼驗證" valuePropName="checked"
          extra={verifyContact
            ? `開：只有${VERIFIABLE.map((f) => CONTACT_LABEL[f]).join('、')}可驗證；市話無法驗證，不計入最少項數。`
            : '關：有填就算，不寄驗證碼。'}>
          <Switch checkedChildren="驗證" unCheckedChildren="不驗證" />
        </Form.Item>
        <Button type="primary" loading={saving} disabled={!data.canEdit} onClick={() => { void save() }}>儲存設定</Button>
      </Form>
    </Card>
  )
}
