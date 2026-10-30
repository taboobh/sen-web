import { http, HttpResponse } from 'msw'
import type { Account, ContactField, ProfileSettings, ReasonCode } from '../types'
import { REASON_TEXT, authorize, canEditRoles, inSessionScope, pickAssignment } from '../auth/engine'
import {
  ALL_CONTACTS, CONTACT_LABEL, DEMO_CONTACT_CODE, VERIFIABLE, guidOf, idHash, maskId, normalizeId, profileGate,
  validateContact, validateNationalId, validateProfileSettings,
} from '../auth/profile'
import { db, logAudit } from './state'
import { badRequest, forbidden, publicAccount, readSession, resolveGated, today, unauthorized, type Sess } from './session'

/** 個人資料、身分證綁定、聯絡方式驗證，以及國教署管理員的欄位設定與身分證核對 */

function me(req: Request): { s: Sess; acc: Account } | null {
  const s = readSession(req)
  const acc = s && db.accounts.find((a) => a.id === s.accountId)
  return s && acc && acc.status === 'active' ? { s, acc } : null
}

const firstOrg = (acc: Account) => db.identities.find((i) => i.accountId === acc.id)?.orgScopeId
function logProfile(acc: Account, permission: string, target: string, decision: 'ALLOW' | 'DENY', reason: ReasonCode) {
  logAudit({ accountName: acc.name, roleName: '（個人資料）', scopeId: firstOrg(acc), permission, target, decision, reason })
}

export const profileHandlers = [
  // 登入後先問「現在能不能進系統」：缺資料／待核對／尚無角色時回傳 gate，前端據此轉向
  http.get('*/api/me/status', ({ request }) => {
    const c = me(request)
    if (!c) return unauthorized()
    const { s, acc } = c
    const base = { account: { id: acc.id, name: acc.name }, method: s.method }
    const g = profileGate(db.profileSettings, acc)
    if (g.code) return HttpResponse.json({ ...base, gate: { code: g.code, missing: g.missing }, identityId: null })
    const mine = db.identities.filter((i) => i.accountId === acc.id)
    const usable = mine.filter((i) => 'assignment' in pickAssignment(db, i.id, today()))
    const chosen = usable.find((i) => i.id === s.identityId) ?? usable[0]
    if (!chosen) {
      const reason: ReasonCode = mine.some((i) => db.assignments.some((a) => a.identityId === i.id)) ? 'ASSIGNMENT_EXPIRED' : 'NO_ASSIGNMENT'
      return HttpResponse.json({ ...base, gate: { code: 'NO_ROLE', missing: [], reason: REASON_TEXT[reason] }, identityId: null })
    }
    return HttpResponse.json({ ...base, gate: null, identityId: chosen.id })
  }),

  http.get('*/api/me/profile', ({ request }) => {
    const c = me(request)
    if (!c) return unauthorized()
    const { s, acc } = c
    const st = db.profileSettings
    return HttpResponse.json({
      username: acc.username, name: acc.name, method: s.method,
      email: acc.email, mobile: acc.mobile ?? '', phone: acc.phone ?? '', contactVerified: acc.contactVerified ?? {},
      idMasked: acc.idMasked ?? '', idStatus: acc.idStatus ?? 'none',
      idLocked: !!acc.idHash && acc.idStatus === 'verified' && st.verifyIdNumber,
      ssoGuid: s.method === 'moe_oidc' && !!db.ssoGuids[acc.id],
      settings: st,
      gate: profileGate(st, acc),
    })
  }),

  http.put('*/api/me/profile', async ({ request }) => {
    const c = me(request)
    if (!c) return unauthorized()
    const { s, acc } = c
    const st = db.profileSettings
    const body = (await request.json()) as { idNumber?: string; email?: string; mobile?: string; phone?: string }
    const notes: string[] = []

    // 先全部驗證格式，通過才寫入（避免只存一半）
    const fields: ContactField[] = ['email', 'mobile', 'phone']
    for (const f of fields) {
      if (body[f] === undefined) continue
      const bad = validateContact(f, body[f]!)
      if (bad) return badRequest(`${CONTACT_LABEL[f]}：${bad}`)
    }
    const rawId = body.idNumber?.trim() ?? ''
    let newHash: string | undefined
    let id = ''
    if (rawId) {
      id = normalizeId(rawId)
      const bad = validateNationalId(id, st.verifyIdNumber)
      if (bad) return badRequest(`身分證／居留證：${bad}`)
      newHash = idHash(id)
      if (acc.idHash && newHash !== acc.idHash && acc.idStatus === 'verified' && st.verifyIdNumber) {
        logProfile(acc, 'profile:update', '修改已驗證身分證', 'DENY', 'NO_PERMISSION')
        return badRequest('身分證已驗證，不可自行修改，請洽管理員')
      }
    }

    if (newHash && newHash !== acc.idHash) {
      if (!st.verifyIdNumber) {
        // 訓練站（虛擬資料）：不驗證，直接視為已驗證
        acc.idHash = newHash; acc.idMasked = maskId(id); acc.idStatus = 'verified'; acc.idConflictWith = undefined
        notes.push('身分證已儲存（目前未啟用身分證驗證）')
      } else {
        const guid = s.method === 'moe_oidc' ? db.ssoGuids[acc.id] : undefined
        if (guid && guid !== guidOf(id)) {
          logProfile(acc, 'profile:update', '身分證與教育雲端 guid 不符', 'DENY', 'NO_PERMISSION')
          return badRequest('填寫的身分證與教育雲端帳號資料不符，請確認後重新輸入', 'ID_MISMATCH')
        }
        const dup = db.accounts.find((x) => x.id !== acc.id && x.idHash === newHash)
        acc.idHash = newHash; acc.idMasked = maskId(id)
        acc.idConflictWith = dup?.id
        // guid 比對一致且沒有撞號才自動驗證；其餘一律交管理員核對。對使用者不透露是否撞號。
        acc.idStatus = guid && !dup ? 'verified' : 'unverified'
        notes.push(acc.idStatus === 'verified' ? '身分證已與教育雲端帳號比對一致並驗證' : '身分證已送出，等待管理員核對')
      }
      logProfile(acc, 'profile:update', `身分證 ${acc.idMasked}（${acc.idStatus}）`, 'ALLOW', 'OK')
    }

    for (const f of fields) {
      if (body[f] === undefined) continue
      const v = body[f]!.trim()
      if ((acc[f] ?? '') === v) continue
      if (f === 'email') acc.email = v; else acc[f] = v
      acc.contactVerified = { ...acc.contactVerified, [f]: false } // 內容變更要重新驗證
      notes.push(`${CONTACT_LABEL[f]}已更新${st.verifyContact && VERIFIABLE.includes(f) && v ? '，請重新驗證' : ''}`)
    }
    return HttpResponse.json({ message: notes.join('；') || '沒有變更', gate: profileGate(st, acc) })
  }),

  // 寄送驗證碼（示範：驗證碼固定，並回傳給畫面顯示；正式版只寄到 email／簡訊）
  http.post('*/api/me/contact/code', async ({ request }) => {
    const c = me(request)
    if (!c) return unauthorized()
    const { field } = (await request.json()) as { field: ContactField }
    if (!db.profileSettings.verifyContact) return badRequest('目前未要求驗證聯絡方式')
    if (!VERIFIABLE.includes(field)) return badRequest(`${CONTACT_LABEL[field] ?? '此欄位'}無法用驗證碼驗證`)
    if (!(c.acc[field] ?? '').trim()) return badRequest(`請先填寫並儲存${CONTACT_LABEL[field]}`)
    return HttpResponse.json({ sent: true, message: `驗證碼已寄送到您的${CONTACT_LABEL[field]}`, demoCode: DEMO_CONTACT_CODE })
  }),

  http.post('*/api/me/contact/verify', async ({ request }) => {
    const c = me(request)
    if (!c) return unauthorized()
    const { field, code } = (await request.json()) as { field: ContactField; code: string }
    if (!VERIFIABLE.includes(field) || !(c.acc[field] ?? '').trim()) return badRequest('此欄位無法驗證')
    if (String(code).trim() !== DEMO_CONTACT_CODE) return badRequest('驗證碼不正確')
    c.acc.contactVerified = { ...c.acc.contactVerified, [field]: true }
    return HttpResponse.json({ message: `${CONTACT_LABEL[field]}已驗證`, gate: profileGate(db.profileSettings, c.acc) })
  }),

  // 帳號資料欄位設定：所有管理者可看，只有署管理員可改
  http.get('*/api/admin/profile-settings', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const d = authorize(db, r.session, 'admin:read')
    if (!d.allowed) return forbidden(d.reason)
    return HttpResponse.json({ settings: db.profileSettings, canEdit: canEditRoles(db, r.session) })
  }),

  http.put('*/api/admin/profile-settings', async ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const log = (decision: 'ALLOW' | 'DENY', reason: ReasonCode, detail: string) =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `帳號資料欄位設定${detail}`, decision, reason })
    if (!canEditRoles(db, session)) { log('DENY', 'NO_PERMISSION', ''); return forbidden('NO_PERMISSION') }
    const b = (await request.json()) as Partial<ProfileSettings>
    const next: ProfileSettings = {
      idRequired: !!b.idRequired,
      contactFields: ALL_CONTACTS.filter((f) => b.contactFields?.includes(f)),
      contactMin: Number(b.contactMin ?? 0),
      verifyContact: !!b.verifyContact,
      verifyIdNumber: !!b.verifyIdNumber,
    }
    const bad = validateProfileSettings(next)
    if (bad) return badRequest(bad)
    // 不可把自己鎖在系統外：新設定下，操作者自己的資料也必須合格
    const self = db.accounts.find((a) => a.id === session.accountId)!
    if (profileGate(next, self).code) return badRequest('依新設定，您自己的個人資料也不合格，儲存後會無法登入。請先補齊自己的資料（例如驗證手機）再調整。')
    const cur = db.profileSettings
    const diff: string[] = []
    if (cur.idRequired !== next.idRequired) diff.push(`身分證${next.idRequired ? '必填' : '不必填'}`)
    if (cur.contactFields.join() !== next.contactFields.join()) diff.push(`聯絡方式：${next.contactFields.map((f) => CONTACT_LABEL[f]).join('、') || '無'}`)
    if (cur.contactMin !== next.contactMin) diff.push(`最少 ${next.contactMin} 項`)
    if (cur.verifyContact !== next.verifyContact) diff.push(`聯絡方式驗證${next.verifyContact ? '開' : '關'}`)
    if (cur.verifyIdNumber !== next.verifyIdNumber) diff.push(`身分證驗證${next.verifyIdNumber ? '開' : '關'}`)
    db.profileSettings = next
    if (diff.length) log('ALLOW', 'OK', `：${diff.join('；')}`)
    return HttpResponse.json({ settings: next })
  }),

  // 身分證核對：自填、無法由教育雲端 guid 驗證的身分證，由範圍內的管理員核對
  http.get('*/api/admin/id-review', ({ request }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const d = authorize(db, session, 'admin:read')
    if (!d.allowed) return forbidden(d.reason)
    const canReview = authorize(db, session, 'admin:update', { scopeId: session.assignment.scopeId }).allowed
    const rows = db.accounts.filter((a) => a.idStatus === 'unverified').flatMap((a) => {
      const ids = db.identities.filter((i) => i.accountId === a.id && inSessionScope(db, session, i.orgScopeId))
      if (!ids.length) return []
      return [{
        account: publicAccount(a), conflict: !!a.idConflictWith, self: a.id === session.accountId,
        identities: ids.map((i) => `${db.scopes.find((x) => x.id === i.orgScopeId)?.name ?? ''} ${i.jobTitle}`),
      }]
    })
    return HttpResponse.json({ scopeName: db.scopes.find((x) => x.id === session.assignment.scopeId)?.name, canReview, rows })
  }),

  http.post('*/api/admin/id-review/:accountId', async ({ request, params }) => {
    const s = readSession(request)
    if (!s) return unauthorized()
    const r = resolveGated(s)
    if ('reason' in r) return unauthorized(r.reason)
    const { session } = r
    const { decision } = (await request.json()) as { decision: 'approve' | 'reject' }
    const acc = db.accounts.find((a) => a.id === params.accountId)
    const log = (dec: 'ALLOW' | 'DENY', reason: ReasonCode) =>
      logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission: 'admin:update', target: `身分證核對（${decision === 'approve' ? '核准' : '退回'}）${acc?.name ?? ''}`, decision: dec, reason })
    if (!acc || acc.idStatus !== 'unverified') return HttpResponse.json({ error: 'not_found', message: '此帳號沒有待核對的身分證' }, { status: 404 })
    const ident = db.identities.find((i) => i.accountId === acc.id && inSessionScope(db, session, i.orgScopeId))
    const gate = ident ? authorize(db, session, 'admin:update', { scopeId: ident.orgScopeId }) : { allowed: false, reason: 'OUT_OF_SCOPE' as ReasonCode }
    if (!gate.allowed) { log('DENY', gate.reason); return forbidden(gate.reason) }
    if (acc.id === session.accountId) { log('DENY', 'NO_PERMISSION'); return badRequest('不可核對自己的身分證') }
    if (decision === 'approve') {
      if (acc.idConflictWith) return badRequest('此身分證與其他帳號相同（疑似重複帳號），需先合併帳號；原型尚未提供合併功能')
      acc.idStatus = 'verified'
    } else if (decision === 'reject') {
      acc.idHash = undefined; acc.idMasked = undefined; acc.idConflictWith = undefined; acc.idStatus = 'none'
    } else return badRequest('決定不正確')
    log('ALLOW', 'OK')
    return HttpResponse.json({ ok: true })
  }),
]

