import { http, HttpResponse } from 'msw'
import type { AuthTarget, ReasonCode, Stage } from '../types'
import { REASON_TEXT, assignableScopes, canEditRoles, diffRole, normalizeGrants, validateRoleEdit, type RoleEdit, assignmentDenial, authorize, buildMePermissions, delegableRoles, inSessionScope, resolveSession, validateAssignment, validateDistrictAreas } from '../auth/engine'
import { audit, db, logAudit } from './state'
import { MODULES } from './modules'

/**
 * 假後端：規則與未來真實後端相同——每個請求都依「帳號＋目前身分」重新判斷授權。
 * 工作階段以 X-Demo-Session 標頭傳遞（正式登入方式尚未決定，屆時改為真實憑證）。
 */
const today = () => new Date().toISOString().slice(0, 10)

interface Sess { accountId: string; identityId: string }
function readSession(req: Request): Sess | null {
  try {
    const raw = req.headers.get('X-Demo-Session')
    return raw ? (JSON.parse(raw) as Sess) : null
  } catch { return null }
}
const unauthorized = (reason: ReasonCode = 'ACCOUNT_INACTIVE') =>
  HttpResponse.json({ error: 'unauthorized', reason, message: REASON_TEXT[reason] }, { status: 401 })
const forbidden = (reason: ReasonCode) =>
  HttpResponse.json({ error: 'forbidden', reason, message: REASON_TEXT[reason] }, { status: 403 })

export const handlers = [
  // 模擬登入：只選帳號，不需密碼
  http.post('*/api/auth/login', async ({ request }) => {
    const { accountId } = (await request.json()) as { accountId: string }
    const account = db.accounts.find((a) => a.id === accountId)
    if (!account) return unauthorized()
    if (account.status !== 'active') return unauthorized('ACCOUNT_INACTIVE')
    const mine = db.identities.filter((i) => i.accountId === accountId)
    const usable = mine.find((i) => 'assignment' in pickFirst(i.id))
    if (!usable) return unauthorized(mine.some((i) => db.assignments.some((a) => a.identityId === i.id)) ? 'ASSIGNMENT_EXPIRED' : 'NO_ASSIGNMENT')
    return HttpResponse.json({ accountId, identityId: usable.id })
  }),

  http.get('*/api/accounts/demo', () =>
    HttpResponse.json(db.accounts.map((a) => ({
      ...a,
      identities: db.identities.filter((i) => i.accountId === a.id).map((i) => {
        const p = pickFirst(i.id)
        const asg = 'assignment' in p ? p.assignment : db.assignments.find((x) => x.identityId === i.id)
        const role = db.roles.find((r) => r.code === asg?.roleCode)
        return {
          id: i.id,
          label: `${db.scopes.find((s) => s.id === i.orgScopeId)?.name} ${i.jobTitle}`,
          roleName: role?.name ?? '-',
          usable: 'assignment' in p,
        }
      }),
    })))),

  http.get('*/api/me/permissions', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const me = buildMePermissions(db, s.accountId, s.identityId, today())
    if ('reason' in me) return unauthorized(me.reason)
    return HttpResponse.json(me)
  }),

  http.get('*/api/students', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const gate = authorize(db, session, 'students:read')
    if (!gate.allowed) {
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'students:read', target: '清單', decision: 'DENY', reason: gate.reason })
      return forbidden(gate.reason)
    }
    // 資料範圍在「後端」過濾：不在範圍內的列根本不會回傳
    const rows = db.students.filter((st) =>
      authorize(db, session, 'students:read', { scopeId: st.schoolId, stage: st.stage, studentId: st.id }).allowed)
    logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'students:read', target: `清單（${rows.length} 筆）`, decision: 'ALLOW', reason: 'OK' })
    return HttpResponse.json(rows.map((st) => ({ ...st, schoolName: db.scopes.find((x) => x.id === st.schoolId)?.name })))
  }),

  http.post('*/api/students', async ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    // 新增到哪所學校：學校層級用自己的學校，其他層級用範圍內第一所學校
    const school = db.scopes.find((x) => x.type === 'SCHOOL' && (x.id === session.assignment.scopeId ||
      x.path.startsWith(db.scopes.find((y) => y.id === session.assignment.scopeId)!.path + '/')))
    const target: AuthTarget = { scopeId: school?.id, stage: school?.stages?.[0] }
    const d = authorize(db, session, 'students:create', target)
    logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'students:create', target: school?.name ?? '-', decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
    if (!d.allowed || !school) return forbidden(d.allowed ? 'OUT_OF_SCOPE' : d.reason)
    const n = db.students.length + 1
    const created = { id: `st${String(n).padStart(3, '0')}`, name: `新增學生${n}`, schoolId: school.id, stage: school.stages![0], grade: '一年級', category: '待鑑定' }
    db.students.push(created)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.delete('*/api/students/:id', ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const st = db.students.find((x) => x.id === params.id)
    if (!st) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const d = authorize(db, session, 'students:delete', { scopeId: st.schoolId, stage: st.stage, studentId: st.id })
    logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'students:delete', target: st.name, decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
    if (!d.allowed) return forbidden(d.reason)
    db.students.splice(db.students.indexOf(st), 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // 權限模擬：給定「模組:動作＋目標學校」回傳決定與原因
  http.post('*/api/authz/check', async ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { permission, schoolId, studentId } = (await request.json()) as { permission: string; schoolId?: string; studentId?: string }
    const school = db.scopes.find((x) => x.id === schoolId)
    const d = authorize(db, r.session, permission, { scopeId: schoolId, stage: school?.stages?.[0], studentId })
    logAudit({ accountName: r.session.accountName, roleName: r.session.role.name, scopeId: r.session.assignment.scopeId, permission, target: school?.name ?? '-', decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
    return HttpResponse.json({ ...d, message: REASON_TEXT[d.reason] })
  }),

  // 治理畫面用的資料：依目前身分的「資料範圍」過濾，學校管理員只看得到本校的使用者與紀錄
  http.get('*/api/admin/overview', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const d = authorize(db, session, 'admin:read')
    if (!d.allowed) return forbidden(d.reason)
    const mine = session.assignment.scopeId
    const inMine = (id: string) => inSessionScope(db, session, id)
    const scopes = db.scopes.filter((x) => inMine(x.id))
    const identities = db.identities.filter((i) => inMine(i.orgScopeId))
    const assignments = db.assignments.filter((a) => inMine(a.scopeId) && identities.some((i) => i.id === a.identityId))
    const accounts = db.accounts.filter((a) => identities.some((i) => i.accountId === a.id))
    const areas = db.areas.filter((a) => inMine(a.districtId) || scopes.some((x) => x.areaId === a.id))
    const canAssign = authorize(db, session, 'admin:update', { scopeId: mine }).allowed
    return HttpResponse.json({
      rootId: mine,
      scopeName: db.scopes.find((x) => x.id === mine)?.name,
      roles: db.roles,
      scopes,
      areas,
      areaProblems: validateDistrictAreas({ ...db, scopes, areas }),
      accounts,
      identities,
      assignments: assignments.map((a) => ({ ...a, problem: validateAssignment(db, a) })),
      canAssign,
      canEditRoles: canEditRoles(db, session),
      assignableRoles: canAssign ? delegableRoles(db, session).map((x) => x.code) : [],
      // 角色 → 可選的資料範圍（指派畫面的「資料範圍」隨角色連動）
      assignableScopes: canAssign
        ? Object.fromEntries(delegableRoles(db, session).map((x) => [x.code, assignableScopes(db, session, x.code).map((sc) => sc.id)]))
        : {},
      audit: audit.filter((e) => e.scopeId && inMine(e.scopeId)),
    })
  }),

  // 指派角色：授權（admin:update＋資料範圍）、可委派的角色層級、角色最高層級，都由後端判斷
  http.post('*/api/admin/assignments', async ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const body = (await request.json()) as { identityId: string; roleCode: string; scopeId: string; stages?: string[]; concurrent?: boolean; effectiveFrom?: string | null; effectiveTo?: string | null }
    const identity = db.identities.find((i) => i.id === body.identityId)
    const role = db.roles.find((x) => x.code === body.roleCode)
    const scope = db.scopes.find((x) => x.id === body.scopeId)
    const acc = db.accounts.find((a) => a.id === identity?.accountId)
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode) =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `指派 ${role?.name ?? body.roleCode} 給 ${acc?.name ?? '-'}`, decision, reason })
    const bad = (message: string) => HttpResponse.json({ error: 'invalid', message }, { status: 400 })
    if (!identity || !role || !scope) return bad('身分、角色或資料範圍不存在')
    // 對象使用者必須在自己的資料範圍內（學校管理員只能處理本校人員）
    const gate = inSessionScope(db, session, identity.orgScopeId)
      ? authorize(db, session, 'admin:update', { scopeId: scope.id })
      : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    const denied = assignmentDenial(db, session, role.code, scope.id)
    if (denied) { log('DENY', denied); return forbidden(denied) }
    const stages = (body.stages ?? []) as Stage[]
    // 兼任／借調才需要有效期間；本職為長期有效
    const concurrent = !!body.concurrent
    const draft = { id: `ra${String(db.assignments.length + 1).padStart(2, '0')}x`, identityId: identity.id, roleCode: role.code, scopeId: scope.id, stages, concurrent, effectiveFrom: concurrent ? body.effectiveFrom ?? null : null, effectiveTo: concurrent ? body.effectiveTo ?? null : null, status: 'active' as const }
    const problem = validateAssignment(db, draft)
    if (problem) return bad(problem)
    if (concurrent && (!draft.effectiveFrom || !draft.effectiveTo || !/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveTo) || draft.effectiveFrom > draft.effectiveTo)) return bad('兼任／借調必須填寫正確的有效期間')
    if (scope.stages && stages.some((x) => !scope.stages!.includes(x))) return bad('教育階段不在該學校的教育階段內')
    if (db.assignments.some((a) => a.identityId === identity.id && a.roleCode === role.code && a.scopeId === scope.id && a.status === 'active' && (a.effectiveTo ?? '9999-12-31') >= (draft.effectiveFrom ?? '0000-01-01') && (a.effectiveFrom ?? '0000-01-01') <= (draft.effectiveTo ?? '9999-12-31'))) return bad('此身分在該範圍已有相同角色且期間重疊')
    db.assignments.push(draft)
    log('ALLOW', 'OK')
    return HttpResponse.json(draft, { status: 201 })
  }),

  // 修改角色範本（角色與權限設定）：只有全國層的署管理員可修改，修改後立即對所有被指派此角色的人生效
  http.put('*/api/admin/roles/:code', async ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const role = db.roles.find((x) => x.code === params.code)
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode, detail = '') =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `修改角色 ${role?.name ?? String(params.code)}${detail}`, decision, reason })
    if (!canEditRoles(db, session)) { log('DENY', 'NO_PERMISSION'); return forbidden('NO_PERMISSION') }
    if (!role) return HttpResponse.json({ error: 'not_found', message: '角色不存在' }, { status: 404 })
    const body = (await request.json()) as RoleEdit
    const problem = validateRoleEdit(db, role.code, body, MODULES.map((m) => m.id))
    if (problem) return HttpResponse.json({ error: 'invalid', message: problem }, { status: 400 })
    const changes = diffRole(role, body).map((c) => c.replace(/^([a-z]+) /, (_m, id: string) => `${MODULES.find((x) => x.id === id)?.name ?? id} `))
    if (changes.length === 0) return HttpResponse.json(role)
    role.name = body.name.trim()
    role.maxScope = body.maxScope
    role.relationLimited = !!body.relationLimited || undefined
    role.grants = normalizeGrants(body.grants)
    log('ALLOW', 'OK', `：${changes.join('；')}`)
    return HttpResponse.json(role)
  }),
]

import { pickAssignment } from '../auth/engine'
function pickFirst(identityId: string) { return pickAssignment(db, identityId, today()) }
