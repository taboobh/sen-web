import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Card, Result, Spin, Table, Tag, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { api, ApiError } from '../api/client'
import { ACTION_LABEL, ACTION_LETTER, type AdminArea, type Account, type AuditEntry, type Identity, type Role, type RoleAssignment, type ScopeNode } from '../types'
import { REASON_TEXT } from '../auth/engine'
import { MODULES } from '../mock/modules'

type AssignmentRow = RoleAssignment & { problem: string | null }

interface Overview {
  roles: Role[]; scopes: ScopeNode[]; areas: AdminArea[]; areaProblems: string[]; accounts: Account[]; identities: Identity[]
  assignments: AssignmentRow[]; audit: AuditEntry[]
}

function useOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  useEffect(() => { api<Overview>('/admin/overview').then(setData).catch((e) => setErr(e)) }, [])
  return { data, err }
}

function Gate({ data, err, children }: { data: Overview | null; err: ApiError | null; children: (d: Overview) => ReactNode }) {
  if (err) return <Result status="403" title="後端拒絕" subTitle={err.message} />
  if (!data) return <Spin />
  return <>{children(data)}</>
}

const today = () => new Date().toISOString().slice(0, 10)

export function AccountsView() {
  const { data, err } = useOverview()
  return (
    <Gate data={data} err={err}>{(d) => (
      <Card title="帳號與角色指派">
        <Typography.Paragraph type="secondary">一個帳號可有多個身分；每個身分有「角色＋資料範圍＋教育階段＋有效期間」的指派。</Typography.Paragraph>
        <Table<AssignmentRow> size="small" rowKey="id" scroll={{ x: 900 }} pagination={false}
          dataSource={d.assignments}
          columns={[
            { title: '帳號', render: (_: unknown, a: AssignmentRow) => {
              const i = d.identities.find((x) => x.id === a.identityId)!
              const acc = d.accounts.find((x) => x.id === i.accountId)!
              return <>{acc.name}{acc.status !== 'active' && <Tag color="red" style={{ marginLeft: 6 }}>鎖定</Tag>}</>
            } },
            { title: '身分', render: (_: unknown, a: AssignmentRow) => {
              const i = d.identities.find((x) => x.id === a.identityId)!
              return `${d.scopes.find((s) => s.id === i.orgScopeId)?.name} ${i.jobTitle}`
            } },
            { title: '角色', render: (_: unknown, a: AssignmentRow) => <Tag color="blue">{d.roles.find((r) => r.code === a.roleCode)?.name}</Tag> },
            { title: '資料範圍', render: (_: unknown, a: AssignmentRow) => d.scopes.find((s) => s.id === a.scopeId)?.name },
            { title: '教育階段', render: (_: unknown, a: AssignmentRow) => a.stages.length ? a.stages.join('、') : '不限' },
            { title: '有效期間', render: (_: unknown, a: AssignmentRow) => `${a.effectiveFrom} ～ ${a.effectiveTo}` },
            { title: '狀態', render: (_: unknown, a: AssignmentRow) =>
              a.problem ? <Tag color="red">{a.problem}</Tag>
                : a.effectiveTo < today() ? <Tag color="orange">已到期</Tag> : <Tag color="green">有效</Tag> },
          ]}
        />
      </Card>
    )}</Gate>
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
            <Tree defaultExpandAll treeData={tree(null)} selectable={false} />
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
      <Card title="授權稽核紀錄（本次瀏覽期間）">
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="每次授權決定（允許或拒絕）都會寫入稽核；示範僅存於記憶體，重新整理即清空。" />
        <Table size="small" rowKey="id" scroll={{ x: 800 }} dataSource={d.audit}
          columns={[
            { title: '時間', dataIndex: 'at' },
            { title: '帳號', dataIndex: 'accountName' },
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
