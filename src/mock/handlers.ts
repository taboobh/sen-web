import { http, HttpResponse } from 'msw'
import type { AuthTarget, ReasonCode, Stage } from '../types'
import { END_REASON_TEXT, type EndReason } from '../types'
import { REASON_TEXT, orgBlockedText, endIdentity, syncSsoAffiliation, assignableScopes, canEditRoles, diffRole, normalizeGrants, validateRoleEdit, type RoleEdit, assignmentDenial, authorize, buildMePermissions, delegableRoles, inSessionScope, validateAssignment, validateDistrictAreas, primaryConflict } from '../auth/engine'
import { audit, db, logAudit } from './state'
import { forbidden, publicAccount, readSession, resolveGated, today, unauthorized } from './session'
import { profileHandlers } from './profileHandlers'
import { schoolHandlers } from './schoolHandlers'
import { profileGate } from '../auth/profile'
import type { LoginMethod } from '../types'
import { MODULES } from './modules'

/**
 * 假後端：規則與未來真實後端相同——每個請求都依「帳號＋目前身分」重新判斷授權。
 * 工作階段以 X-Demo-Session 標頭傳遞（正式登入方式尚未決定，屆時改為真實憑證）。
 */
export const handlers = [
  ...profileHandlers,
  ...schoolHandlers,
  // 模擬登入：只選帳號，不需密碼
  http.post('*/api/auth/login', async ({ request }) => {
    const { accountId, method } = (await request.json()) as { accountId: string; method?: LoginMethod }
    const m: LoginMethod = method === 'moe_oidc' ? 'moe_oidc' : 'local'
    const account = db.accounts.find((a) => a.id === accountId)
    if (!account) return unauthorized()
    if (account.status !== 'active') return unauthorized('ACCOUNT_INACTIVE')
    // 教育雲端登入：依教育雲端回傳的學校代碼同步任職機構（首次登入建立身分；學校代碼不同則清空原學校角色）
    const sso = m === 'moe_oidc' ? db.ssoProfiles[accountId] : undefined
    if (sso) {
      for (const c of syncSsoAffiliation(db, accountId, sso.schoolIds, today(), sso.jobTitle)) {
        const org = db.scopes.find((x) => x.id === c.orgScopeId)?.name ?? c.orgScopeId
        logAudit({ accountName: account.name, roleName: '（教育雲端同步）', scopeId: c.orgScopeId, permission: 'sso:sync', decision: 'ALLOW', reason: 'OK',
          target: c.kind === 'created' ? `首次或新任職：建立 ${org} 身分，未指派角色` : `學校代碼異動：離開 ${org}，清空角色${c.clearedRoles.length ? `（${c.clearedRoles.join('、')}）` : '（原本無角色）'}` })
      }
    }
    // 不論哪種登入方式，缺必填資料或身分證待核對時，先進個人資料頁（identityId 留空，之後由 /me/status 補上）
    if (profileGate(db.profileSettings, account).code) return HttpResponse.json({ accountId, identityId: '', method: m })
    const mine = db.identities.filter((i) => i.accountId === accountId)
    const usable = mine.find((i) => 'assignment' in pickFirst(i.id))
    // 尚無可用角色也允許登入，進入「尚無可用角色」頁（identityId 留空）；真正的授權請求仍一律被拒
    return HttpResponse.json({ accountId, identityId: usable?.id ?? '', method: m })
  }),

  http.get('*/api/accounts/demo', () =>
    HttpResponse.json(db.accounts.map((a) => ({
      ...publicAccount(a),
      gate: profileGate(db.profileSettings, a).code,
      hasSsoGuid: !!db.ssoGuids[a.id],
      ssoSchools: (db.ssoProfiles[a.id]?.schoolIds ?? []).map((id) => db.scopes.find((x) => x.id === id)?.name ?? id),
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
    const acc = db.accounts.find((a) => a.id === s.accountId)
    const g = acc && acc.status === 'active' ? profileGate(db.profileSettings, acc) : null
    if (g?.code) return unauthorized(g.code)
    const me = buildMePermissions(db, s.accountId, s.identityId, today())
    if ('reason' in me) return unauthorized(me.reason)
    return HttpResponse.json(me)
  }),

  http.get('*/api/students', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
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
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    // 新增到哪所學校：學校層級用自己的學校，其他層級用範圍內第一所「使用中」的學校
    const mineScope = db.scopes.find((y) => y.id === session.assignment.scopeId)!
    const inMine = db.scopes.filter((x) => x.type === 'SCHOOL' && (x.id === mineScope.id || x.path.startsWith(mineScope.path + '/')))
    const school = mineScope.type === 'SCHOOL' ? mineScope : inMine.find((x) => (x.school?.status ?? 'active') === 'active') ?? inMine[0]
    const target: AuthTarget = { scopeId: school?.id, stage: school?.stages?.[0] }
    const d = authorize(db, session, 'students:create', target)
    logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'students:create', target: school?.name ?? '-', decision: d.allowed ? 'ALLOW' : 'DENY', reason: d.reason })
    if (!d.allowed || !school) return forbidden(d.allowed ? 'OUT_OF_SCOPE' : d.reason)
    // 學校狀態：停招不收新生、籌備處尚未開學、廢校不可新增
    const st = school.school?.status ?? 'active'
    if (st !== 'active') return HttpResponse.json({ error: 'invalid', message: `${school.name} 目前為「${st === 'closing' ? '停招' : st === 'preparing' ? '未啟用（籌備處）' : '廢校／停辦'}」，不能新增學生` }, { status: 400 })
    const n = db.students.length + 1
    const created = { id: `st${String(n).padStart(3, '0')}`, name: `新增學生${n}`, schoolId: school.id, stage: school.stages![0], grade: '一年級', category: '待鑑定' }
    db.students.push(created)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.delete('*/api/students/:id', ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
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
    const r = resolveGated(s)
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
    const r = resolveGated(s)
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
      // 學校只帶代碼與狀態（完整主檔另由 /api/schools 提供），避免全國四千多校的資料一次送出
      scopes: scopes.map((x) => x.school ? { ...x, school: undefined, schoolCode: x.school.code, schoolStatus: x.school.status } : x),
      areas,
      areaProblems: validateDistrictAreas({ ...db, scopes, areas }),
      accounts: accounts.map(publicAccount),
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
    const r = resolveGated(s)
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
    if (identity.status === 'ended') return bad('此身分已離任，不能指派角色')
    const blocked = orgBlockedText(scope) ?? orgBlockedText(db.scopes.find((x) => x.id === identity.orgScopeId))
    if (blocked) return bad(blocked)
    // 對象使用者必須在自己的資料範圍內（學校管理員只能處理本校人員）
    const gate = inSessionScope(db, session, identity.orgScopeId)
      ? authorize(db, session, 'admin:update', { scopeId: scope.id })
      : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    const denied = assignmentDenial(db, session, role.code, scope.id)
    if (denied) { log('DENY', denied); return forbidden(denied) }
    const stages = (body.stages ?? []) as Stage[]
    // 借調才需要有效期間；本職機構內為長期有效
    const concurrent = !!body.concurrent
    const draft = { id: `ra${String(db.assignments.length + 1).padStart(2, '0')}x`, identityId: identity.id, roleCode: role.code, scopeId: scope.id, stages, concurrent, effectiveFrom: concurrent ? body.effectiveFrom ?? null : null, effectiveTo: concurrent ? body.effectiveTo ?? null : null, status: 'active' as const }
    const problem = validateAssignment(db, draft)
    if (problem) return bad(problem)
    if (concurrent && (!draft.effectiveFrom || !draft.effectiveTo || !/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveTo) || draft.effectiveFrom > draft.effectiveTo)) return bad('借調必須填寫正確的有效期間')
    if (scope.stages && stages.some((x) => !scope.stages!.includes(x))) return bad('教育階段不在該學校的教育階段內')
    const sameAccount = new Set(db.identities.filter((i) => i.accountId === identity.accountId).map((i) => i.id))
    if (db.assignments.some((a) => sameAccount.has(a.identityId) && a.roleCode === role.code && a.scopeId === scope.id && a.status === 'active' && (a.effectiveTo ?? '9999-12-31') >= (draft.effectiveFrom ?? '0000-01-01') && (a.effectiveFrom ?? '0000-01-01') <= (draft.effectiveTo ?? '9999-12-31'))) return bad('此帳號在該範圍已有相同角色且期間重疊')
    const dup = primaryConflict(db, identity.accountId, draft)
    if (dup) return bad(dup)
    db.assignments.push(draft)
    log('ALLOW', 'OK')
    return HttpResponse.json(draft, { status: 201 })
  }),

  // 撤銷一筆角色指派（授權與資料範圍檢查同指派）；本職主要角色在還有其他本職角色時不能先撤銷
  http.post('*/api/admin/assignments/:id/revoke', async ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const a = db.assignments.find((x) => x.id === params.id && x.status === 'active')
    const identity = db.identities.find((i) => i.id === a?.identityId)
    const acc = db.accounts.find((x) => x.id === identity?.accountId)
    const role = db.roles.find((x) => x.code === a?.roleCode)
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode) =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `撤銷 ${role?.name ?? '-'} 自 ${acc?.name ?? '-'}`, decision, reason })
    if (!a || !identity || !role) return HttpResponse.json({ error: 'invalid', message: '指派不存在' }, { status: 400 })
    const gate = inSessionScope(db, session, identity.orgScopeId)
      ? authorize(db, session, 'admin:update', { scopeId: a.scopeId })
      : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    const denied = assignmentDenial(db, session, role.code, a.scopeId)
    if (denied) { log('DENY', denied); return forbidden(denied) }
    const mine = new Set(db.identities.filter((i) => i.accountId === identity.accountId).map((i) => i.id))
    const home = db.assignments.filter((x) => mine.has(x.identityId) && !x.concurrent && x.status === 'active')
    if (!a.concurrent && home[0]?.id === a.id && home.length > 1) return HttpResponse.json({ error: 'invalid', message: '這是本職主要角色，請先撤銷同機構的其他角色' }, { status: 400 })
    a.status = 'revoked'
    log('ALLOW', 'OK')
    return HttpResponse.json({ ok: true })
  }),

  // 新增身分：同一帳號可在多個機構任職（每個機構一個身分，再各自指派角色）
  http.post('*/api/admin/identities', async ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const body = (await request.json()) as { accountId: string; orgScopeId: string; jobTitle: string }
    const acc = db.accounts.find((a) => a.id === body.accountId)
    const org = db.scopes.find((x) => x.id === body.orgScopeId)
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode) =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `新增身分 ${org?.name ?? body.orgScopeId} 給 ${acc?.name ?? '-'}`, decision, reason })
    const bad = (message: string) => HttpResponse.json({ error: 'invalid', message }, { status: 400 })
    if (!acc || !org) return bad('帳號或機構不存在')
    const blocked = orgBlockedText(org)
    if (blocked) return bad(blocked)
    const jobTitle = (body.jobTitle ?? '').trim()
    if (!jobTitle) return bad('請填寫職稱')
    const gate = inSessionScope(db, session, org.id)
      ? authorize(db, session, 'admin:update', { scopeId: org.id })
      : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    if (db.identities.some((i) => i.accountId === acc.id && i.orgScopeId === org.id && i.status !== 'ended')) return bad('此帳號在該機構已有身分，請直接在該身分下新增角色')
    const identity = { id: `i${String(db.identities.length + 1).padStart(2, '0')}x`, accountId: acc.id, orgScopeId: org.id, jobTitle }
    db.identities.push(identity)
    log('ALLOW', 'OK')
    return HttpResponse.json(identity, { status: 201 })
  }),

  // 調職、退休、離職：清空該身分（原機構）的所有角色指派並標記離任；帳號保留
  http.post('*/api/admin/identities/:id/end', async ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const body = (await request.json()) as { reason: EndReason }
    const identity = db.identities.find((i) => i.id === params.id)
    const acc = db.accounts.find((a) => a.id === identity?.accountId)
    const org = db.scopes.find((x) => x.id === identity?.orgScopeId)
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode, detail = '') =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `${END_REASON_TEXT[body.reason] ?? '離任'} ${acc?.name ?? '-'}（${org?.name ?? '-'}）${detail}`, decision, reason })
    if (!identity || !org) return HttpResponse.json({ error: 'invalid', message: '身分不存在' }, { status: 400 })
    if (!['transfer', 'retire', 'resign'].includes(body.reason)) return HttpResponse.json({ error: 'invalid', message: '請選擇調職、退休或離職' }, { status: 400 })
    if (identity.status === 'ended') return HttpResponse.json({ error: 'invalid', message: '此身分已離任' }, { status: 400 })
    const gate = inSessionScope(db, session, org.id)
      ? authorize(db, session, 'admin:update', { scopeId: org.id })
      : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    const cleared = endIdentity(db, identity.id, body.reason, today())
    log('ALLOW', 'OK', cleared.length ? `，清空角色：${cleared.join('、')}` : '，原本無角色')
    return HttpResponse.json({ ok: true, cleared })
  }),

  // 修改角色範本（角色與權限設定）：只有全國層的署管理員可修改，修改後立即對所有被指派此角色的人生效
  http.put('*/api/admin/roles/:code', async ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
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
