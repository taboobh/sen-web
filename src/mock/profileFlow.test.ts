import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'
import { db } from './state'
import { DEMO_ID_A11 } from './data'
import { DEMO_CONTACT_CODE, makeTestId } from '../auth/profile'
import type { LoginMethod } from '../types'

/** 以真實的假後端 handlers 走完「補資料導向、身分證驗證、核對、設定」的整段流程 */
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

type Sess = { accountId: string; identityId: string; method: LoginMethod }
async function call(path: string, method = 'GET', session?: Sess, body?: unknown) {
  const res = await fetch(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Demo-Session': JSON.stringify(session) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (accountId: string, method: LoginMethod): Promise<Sess> => (await call('/auth/login', 'POST', undefined, { accountId, method })).json as Sess
const a01 = (): Sess => ({ accountId: 'a01', identityId: 'i01', method: 'local' })
const a05 = (): Sess => ({ accountId: 'a05', identityId: 'i05a', method: 'local' })
const resetUser = (id: string) => {
  const a = db.accounts.find((x) => x.id === id)!
  Object.assign(a, { idHash: undefined, idMasked: undefined, idStatus: 'none', idConflictWith: undefined, contactVerified: {}, mobile: undefined, phone: undefined })
}

describe('教育雲端登入（有 guid）：補資料導向與自動驗證', () => {
  let s: Sess
  it('缺身分證與聯絡方式：登入成功但後端一律擋下，只能補資料', async () => {
    s = await login('a11', 'moe_oidc')
    expect(s.identityId).toBe('')
    const st = await call('/me/status', 'GET', s)
    expect(st.json!.gate).toEqual({ code: 'PROFILE_INCOMPLETE', missing: ['idNumber', 'contact'] })
    for (const p of ['/students', '/me/permissions', '/admin/overview']) {
      const r = await call(p, 'GET', s)
      expect(r.status, p).toBe(401)
      expect(r.json!.reason).toBe('PROFILE_INCOMPLETE')
    }
    expect((await call('/me/profile', 'GET', s)).status).toBe(200)
  })
  it('填成別人的身分證：與 guid 不符被拒絕，且不留下資料', async () => {
    const r = await call('/me/profile', 'PUT', s, { idNumber: makeTestId('Y', 1, '1111111') })
    expect(r.status).toBe(400)
    expect(r.json!.reason).toBe('ID_MISMATCH')
    expect(db.accounts.find((a) => a.id === 'a11')!.idHash).toBeUndefined()
  })
  it('檢查碼錯誤被擋；正確號碼自動驗證，只存雜湊與遮罩', async () => {
    expect((await call('/me/profile', 'PUT', s, { idNumber: DEMO_ID_A11.slice(0, 9) + String((Number(DEMO_ID_A11[9]) + 1) % 10) })).json!.message).toMatch(/檢查碼/)
    const r = await call('/me/profile', 'PUT', s, { idNumber: DEMO_ID_A11.toLowerCase(), email: 'newbie@example.test' })
    expect(r.status).toBe(200)
    const acc = db.accounts.find((a) => a.id === 'a11')!
    expect(acc.idStatus).toBe('verified')
    expect(JSON.stringify({ ...acc, note: '' })).not.toContain(DEMO_ID_A11) // note 是示範提示文字，不是儲存的資料
    const p = await call('/me/profile', 'GET', s)
    expect(p.json!.idMasked).toBe(`${DEMO_ID_A11[0]}******${DEMO_ID_A11.slice(-3)}`)
    expect(p.json!.idLocked).toBe(true)
    expect(JSON.stringify(p.json)).not.toContain(acc.idHash!)
  })
  it('已驗證的身分證不可自行修改', async () => {
    const r = await call('/me/profile', 'PUT', s, { idNumber: makeTestId('Y', 1, '2222222') })
    expect(r.status).toBe(400)
    expect(r.json!.message).toMatch(/不可自行修改/)
  })
  it('電子郵件未驗證仍算缺資料；驗證碼錯誤失敗、正確才通過', async () => {
    expect((await call('/me/status', 'GET', s)).json!.gate.missing).toEqual(['contact'])
    expect((await call('/me/contact/verify', 'POST', s, { field: 'email', code: '000000' })).status).toBe(400)
    expect((await call('/me/contact/code', 'POST', s, { field: 'phone' })).status).toBe(400)
    expect((await call('/me/contact/verify', 'POST', s, { field: 'email', code: DEMO_CONTACT_CODE })).status).toBe(200)
  })
  it('資料齊全後：沒有指派角色 → NO_ROLE（待指派）', async () => {
    const st = await call('/me/status', 'GET', s)
    expect(st.json!.gate.code).toBe('NO_ROLE')
    expect(st.json!.gate.reason).toMatch(/沒有角色指派/)
  })
  it('更改電子郵件會重置驗證', async () => {
    await call('/me/profile', 'PUT', s, { email: 'other@example.test' })
    expect(db.accounts.find((a) => a.id === 'a11')!.contactVerified?.email).toBe(false)
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('PROFILE_INCOMPLETE')
  })
})

describe('本機登入（無 guid）：自填身分證需管理員核對', () => {
  let s: Sess
  it('自填身分證 → 待核對（ID_PENDING），仍不能使用系統', async () => {
    s = await login('a12', 'local')
    const r = await call('/me/profile', 'PUT', s, { idNumber: makeTestId('X', 2, '3333333'), email: 'a12@example.test' })
    expect(r.json!.message).toMatch(/等待管理員核對/)
    await call('/me/contact/verify', 'POST', s, { field: 'email', code: DEMO_CONTACT_CODE })
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('ID_PENDING')
    expect((await call('/students', 'GET', s)).json!.reason).toBe('ID_PENDING')
  })
  it('範圍外或權限不足的管理員不能核對；範圍內的署管理員可核准', async () => {
    expect((await call('/admin/id-review', 'GET', a05())).json!.rows).toHaveLength(0) // 學校管理員的範圍看不到署轄學校人員
    expect((await call('/admin/id-review/a12', 'POST', a05(), { decision: 'approve' })).status).toBe(403)
    const list = await call('/admin/id-review', 'GET', a01())
    expect(list.json!.rows.map((x: { account: { id: string } }) => x.account.id)).toContain('a12')
    expect(JSON.stringify(list.json)).not.toMatch(/idHash/)
    expect((await call('/admin/id-review/a12', 'POST', a01(), { decision: 'approve' })).status).toBe(200)
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
  })
  it('退回：清除身分證，使用者需重填', async () => {
    resetUser('a12')
    await call('/me/profile', 'PUT', s, { idNumber: makeTestId('X', 2, '4444444') })
    expect((await call('/admin/id-review/a12', 'POST', a01(), { decision: 'reject' })).status).toBe(200)
    expect(db.accounts.find((a) => a.id === 'a12')!.idStatus).toBe('none')
  })
  it('與其他帳號身分證相同：對使用者不透露，管理員看到疑似重複且不可核准', async () => {
    resetUser('a12')
    const a01Id = makeTestId('Z', 1, String(1000100))
    const r = await call('/me/profile', 'PUT', s, { idNumber: a01Id })
    expect(r.status).toBe(200)
    expect(r.json!.message).not.toMatch(/重複|已被使用/)
    const row = (await call('/admin/id-review', 'GET', a01())).json!.rows.find((x: { account: { id: string } }) => x.account.id === 'a12')
    expect(row.conflict).toBe(true)
    expect((await call('/admin/id-review/a12', 'POST', a01(), { decision: 'approve' })).json!.message).toMatch(/重複/)
  })
  it('不可核對自己的身分證', async () => {
    // 待核對者本來就進不了管理功能；關閉身分證驗證時才可能出現「待核對的管理員」，此時仍不可自己核對自己
    const a = db.accounts.find((x) => x.id === 'a01')!
    db.profileSettings.verifyIdNumber = false
    a.idStatus = 'unverified'
    const r = await call('/admin/id-review/a01', 'POST', a01(), { decision: 'approve' })
    a.idStatus = 'verified'
    db.profileSettings.verifyIdNumber = true
    expect(r.status).toBe(400)
    expect(r.json!.message).toMatch(/自己/)
  })
})

describe('國教署管理員的欄位設定', () => {
  it('只有署管理員能修改', async () => {
    const cur = (await call('/admin/profile-settings', 'GET', a05())).json!
    expect(cur.canEdit).toBe(false)
    expect((await call('/admin/profile-settings', 'PUT', a05(), cur.settings)).status).toBe(403)
    expect((await call('/admin/profile-settings', 'GET', a01())).json!.canEdit).toBe(true)
  })
  it('無法滿足的設定被擋下（只剩市話又要求驗證、項數超過）', async () => {
    const base = db.profileSettings
    expect((await call('/admin/profile-settings', 'PUT', a01(), { ...base, contactFields: ['phone'], contactMin: 1 })).json!.message).toMatch(/無法驗證/)
    expect((await call('/admin/profile-settings', 'PUT', a01(), { ...base, contactFields: ['email'], contactMin: 2 })).status).toBe(400)
  })
  it('不可把自己鎖在系統外（署管理員自己沒有已驗證的手機）', async () => {
    const base = db.profileSettings
    const r = await call('/admin/profile-settings', 'PUT', a01(), { ...base, contactFields: ['mobile'], contactMin: 1 })
    expect(r.status).toBe(400)
    expect(r.json!.message).toMatch(/您自己/)
    expect(db.profileSettings).toBe(base)
  })
  it('關閉身分證驗證（訓練站）：虛擬號碼（檢查碼錯誤、重複）也直接通過', async () => {
    resetUser('a12')
    const cur = db.profileSettings
    expect((await call('/admin/profile-settings', 'PUT', a01(), { ...cur, verifyIdNumber: false })).status).toBe(200)
    const s = await login('a12', 'local')
    const r = await call('/me/profile', 'PUT', s, { idNumber: 'A123456788', email: 'virtual@example.test' })
    expect(r.status).toBe(200)
    expect((await call('/me/profile', 'PUT', s, { idNumber: 'A12345' })).status).toBe(400) // 仍需基本格式
    await call('/me/contact/verify', 'POST', s, { field: 'email', code: DEMO_CONTACT_CODE })
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    // 關閉後原本待核對者也立即放行
    db.accounts.find((a) => a.id === 'a12')!.idStatus = 'unverified'
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    await call('/admin/profile-settings', 'PUT', a01(), { ...db.profileSettings, verifyIdNumber: true })
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('ID_PENDING')
  })
  it('身分證改為非必填、聯絡方式不要求：立即放行；之後調回會再導向', async () => {
    const s = await login('a11', 'local')
    resetUser('a11')
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('PROFILE_INCOMPLETE')
    await call('/admin/profile-settings', 'PUT', a01(), { ...db.profileSettings, idRequired: false, contactMin: 0 })
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    await call('/admin/profile-settings', 'PUT', a01(), { ...db.profileSettings, idRequired: true, contactMin: 1 })
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('PROFILE_INCOMPLETE')
  })
  it('已齊全的帳號正常登入並取得權限（不受影響）', async () => {
    const s = await login('a06', 'local')
    expect(s.identityId).toBe('i06')
    expect((await call('/me/status', 'GET', s)).json!.gate).toBeNull()
    expect((await call('/me/permissions', 'GET', s)).status).toBe(200)
    expect((await call('/students', 'GET', s)).status).toBe(200)
  })
})

describe('教育雲端學校代碼同步與離任（假後端）', () => {
  it('首次登入的新使用者：登入成功、建立任職機構、無角色，授權請求一律被拒；學校管理員看得到', async () => {
    const s = await login('a14', 'moe_oidc')
    expect(s.identityId).toBe('')
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    for (const p of ['/students', '/me/permissions', '/admin/overview']) expect((await call(p, 'GET', s)).status, p).toBe(401)
    const ov = (await call('/admin/overview', 'GET', a05())).json!
    const idn = ov.identities.find((i: { accountId: string }) => i.accountId === 'a14')
    expect(idn.orgScopeId).toBe('sA1')
    expect(ov.assignments.some((a: { identityId: string }) => a.identityId === idn.id)).toBe(false)
    expect((await call('/auth/login', 'POST', undefined, { accountId: 'a14', method: 'moe_oidc' })).status).toBe(200)
    const again = (await call('/admin/overview', 'GET', a05())).json!
    expect(again.identities.filter((i: { accountId: string }) => i.accountId === 'a14').length).toBe(1)
  })

  it('學校代碼與記錄不同：本機登入不受影響；教育雲端登入後清空原角色、改任新學校無角色', async () => {
    const local = await login('a15', 'local')
    expect(local.identityId).toBe('i15')
    expect((await call('/students', 'GET', local)).status).toBe(200)
    const s = await login('a15', 'moe_oidc')
    expect(s.identityId).toBe('')
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    expect((await call('/students', 'GET', local)).status).toBe(401)   // 舊工作階段也立即失效
    const ov = (await call('/admin/overview', 'GET', a01())).json!
    const mine = ov.identities.filter((i: { accountId: string }) => i.accountId === 'a15')
    expect(mine.map((i: { orgScopeId: string; status?: string }) => `${i.orgScopeId}:${i.status ?? 'active'}`).sort()).toEqual(['sA2:ended', 'sA3:active'])
    expect(ov.assignments.some((a: { identityId: string }) => a.identityId === 'i15')).toBe(false)
    expect(ov.audit.some((e: { permission: string }) => e.permission === 'sso:sync')).toBe(true)
  })

  it('調職／退休／離職：只能處理自己範圍內的機構，清空該身分角色，不可重複，離任身分不能再指派', async () => {
    const out = await call('/admin/identities/i09/end', 'POST', a05(), { reason: 'retire' })
    expect(out.status).toBe(403)                                       // sA2 不在學校管理員的範圍
    expect((await call('/admin/identities/i06/end', 'POST', a05(), { reason: 'bogus' })).status).toBe(400)
    const ok = await call('/admin/identities/i06/end', 'POST', a05(), { reason: 'retire' })
    expect(ok.status).toBe(200)
    expect(ok.json!.cleared).toEqual(['特教教師'])
    expect((await call('/admin/identities/i06/end', 'POST', a05(), { reason: 'resign' })).status).toBe(400)
    const s = await login('a06', 'local')
    expect(s.identityId).toBe('')
    expect((await call('/me/status', 'GET', s)).json!.gate.code).toBe('NO_ROLE')
    const asg = await call('/admin/assignments', 'POST', a05(), { identityId: 'i06', roleCode: 'TEACHER', scopeId: 'sA1', stages: [] })
    expect(asg.status).toBe(400)
  })
})
