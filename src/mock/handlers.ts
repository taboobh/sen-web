import { http, HttpResponse } from 'msw'
import type { AuthTarget, ReasonCode } from '../types'
import { REASON_TEXT, authorize, buildMePermissions, resolveSession, validateAssignment, validateDistrictAreas } from '../auth/engine'
import { audit, db, logAudit } from './state'

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
    if (!usable) return unauthorized('ASSIGNMENT_EXPIRED')
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
      logAudit({ accountName: session.accountName, roleName: session.role.name, permission: 'students:read', target: '清單', decision: 'DENY', reason: gate.reason })
      return forbidden(gate.reason)
    }
    // 資料範圍在「後端」過濾：不在範圍內的列根本不會回傳
    const rows = db.students.filter((st) =>
      authorize(db, session, 'students:read', { scopeId: st.schoolId, stage: st.stage, studentId: st.id }).allowed)
    logAudit({ accountName: session.accountName, roleName: session.role.name, permission: 'students:read', target: `清單（${rows.length} 筆）`, decision: 'ALLOW', reason: 'OK' })
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
    logAudit({ accountName: session.accountName, roleName: session.role.name, permission: 'students:create', target: school?.name ?? '-', decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
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
    logAudit({ accountName: session.accountName, roleName: session.role.name, permission: 'students:delete', target: st.name, decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
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
    logAudit({ accountName: r.session.accountName, roleName: r.session.role.name, permission, target: school?.name ?? '-', decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
    return HttpResponse.json({ ...d, message: REASON_TEXT[d.reason] })
  }),

  // 治理畫面用的唯讀資料
  http.get('*/api/admin/overview', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveSession(db, s.accountId, s.identityId, today())
    if ('reason' in r) return unauthorized(r.reason)
    const d = authorize(db, r.session, 'admin:read')
    if (!d.allowed) return forbidden(d.reason)
    return HttpResponse.json({
      roles: db.roles,
      scopes: db.scopes,
      areas: db.areas,
      areaProblems: validateDistrictAreas(db),
      accounts: db.accounts,
      identities: db.identities,
      assignments: db.assignments.map((a) => ({ ...a, problem: validateAssignment(db, a) })),
      audit,
    })
  }),
]

import { pickAssignment } from '../auth/engine'
function pickFirst(identityId: string) { return pickAssignment(db, identityId, today()) }
