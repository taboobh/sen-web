import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import * as XLSX from 'xlsx'
import { readdirSync, readFileSync } from 'node:fs'
import { handlers } from './handlers'
import { db } from './state'
import { mergeMoe, parseMoeWorkbook } from '../schools/moe'
import { applyImport, previewImport } from '../schools/schoolData'

/** 學校資料的修改權責：署管理員可新增、修改全部；學校只能改本校的電話、校長、發言人（聯絡人）；縣市、分區唯讀 */
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

type Sess = { accountId: string; identityId: string; method: 'local' }
async function call(path: string, method = 'GET', session?: Sess, body?: unknown) {
  const res = await fetch(`http://localhost/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Demo-Session': JSON.stringify(session) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const NEA: Sess = { accountId: 'a01', identityId: 'i01', method: 'local' }       // 署管理員
const CITY: Sess = { accountId: 'a03', identityId: 'i03', method: 'local' }      // 新北市教育局承辦
const DIST: Sess = { accountId: 'a04', identityId: 'i04', method: 'local' }      // 新北市第一分區管理員
const SCHOOL: Sess = { accountId: 'a05', identityId: 'i05a', method: 'local' }   // 板橋國小（sA1）學校管理員
const TEACHER: Sess = { accountId: 'a06', identityId: 'i06', method: 'local' }   // 板橋國小特教教師
const self = { phone: '(02)2968-6990', principal: '陳校長', contactName: '林主任', contactTitle: '學務主任', contactPhone: '(02)2968-6990#120', contactEmail: 'pr@example.test' }

describe('學校自行維護：電話、校長、發言人（聯絡人）', () => {
  it('學校管理員可改本校', async () => {
    const r = await call('/schools/sA1/self', 'PUT', SCHOOL, self)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ phone: self.phone, principal: '陳校長', contact: { name: '林主任', title: '學務主任' }, phoneBySchool: true })
    const d = await call('/schools/sA1', 'GET', SCHOOL)
    expect(d.json).toMatchObject({ canEditSelf: true, canManage: false })
    expect(d.json!.history[0].text).toContain('校長')
    expect(d.json!.lastChange).toMatchObject({ kind: 'school', action: 'update' })
    expect(d.json!.import).toMatchObject({ id: 1, year: 114 })
  })
  it('學校管理員不能改他校，也不能改名錄欄位或新增學校', async () => {
    expect((await call('/schools/sA2/self', 'PUT', SCHOOL, self)).status).toBe(403)
    expect((await call('/schools/sA1', 'PUT', SCHOOL, { name: '改名' })).status).toBe(403)
    expect((await call('/schools', 'POST', SCHOOL, { code: '999999', name: 'x', levels: ['國小'], city: '新北市' })).status).toBe(403)
  })
  it('縣市、分區只能瀏覽；教師沒有基本資料管理權', async () => {
    expect((await call('/schools/sA1/self', 'PUT', CITY, self)).status).toBe(403)
    expect((await call('/schools/sA1/self', 'PUT', DIST, self)).status).toBe(403)
    expect((await call('/schools/sA1', 'GET', CITY)).json).toMatchObject({ canEditSelf: false, canManage: false })
    expect((await call('/schools', 'GET', TEACHER)).status).toBe(403)
  })
  it('欄位檢查：學校電話必填、電子郵件格式', async () => {
    expect((await call('/schools/sA1/self', 'PUT', SCHOOL, { ...self, phone: '' })).status).toBe(400)
    expect((await call('/schools/sA1/self', 'PUT', SCHOOL, { ...self, contactEmail: 'not-mail' })).status).toBe(400)
  })
})

describe('署管理員：新增、修改', () => {
  it('可改任一學校的電話、校長、發言人與名錄欄位', async () => {
    expect((await call('/schools/sB1/self', 'PUT', NEA, { ...self, principal: '署填校長' })).status).toBe(200)
    const r = await call('/schools/sB1', 'PUT', NEA, { name: '臺中市立大同國小（測試更名）' })
    expect(r.status).toBe(200)
    expect(r.json!.oldNames).toContain('市立大同國小')
  })
  it('可手動新增學校；代碼重複會被擋', async () => {
    const body = { code: '01X999', name: '市立測試國小籌備處', levels: ['國小'], city: '新北市', address: '新北市板橋區測試路1號', status: 'preparing' }
    const r = await call('/schools', 'POST', NEA, body)
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ status: 'preparing', source: 'manual', district: '新北市第一分區（示範）' })
    expect(r.json).toMatchObject({ importId: null, lastChange: { kind: 'manual', action: 'create' } })
    expect((await call('/schools', 'POST', NEA, body)).status).toBe(400)
  })
})

describe('學校改過的電話，名錄匯入不覆寫', () => {
  it('預覽不列電話差異，套用後保留學校填的電話', () => {
    const dir = 'public/moe/115'
    const batch = mergeMoe(readdirSync(dir).sort().map((f) => parseMoeWorkbook(XLSX, readFileSync(`${dir}/${f}`), f)))
    const sA1 = db.scopes.find((x) => x.id === 'sA1')!
    sA1.school!.phone = '(02)0000-0000'
    sA1.school!.phoneBySchool = true
    const it = previewImport(db, batch).items.find((i) => i.code === '014601')
    expect(it?.fields.some((f) => f.key === 'phone') ?? false).toBe(false)
    applyImport(db, batch, {}, '王署管', '2026-08-05', 2)
    expect(sA1.school!.phone).toBe('(02)0000-0000')
    // 沒被學校改過的學校，電話仍以名錄為準
    const other = db.scopes.find((x) => x.id === 'sA4')!
    expect(other.school!.phoneBySchool).toBeUndefined()
  })
})

describe('分班可選為本職機構', () => {
  it('署管理員可為帳號新增分班的任職身分並指派角色', async () => {
    const br = db.scopes.find((x) => x.school?.code === '011XA8-01')!
    const idn = await call('/admin/identities', 'POST', NEA, { accountId: 'a11', orgScopeId: br.id, jobTitle: '教保員' })
    expect(idn.status).toBe(201)
    const ov = await call('/admin/overview', 'GET', NEA)
    expect(ov.json!.scopes.some((x: { id: string }) => x.id === br.id)).toBe(true)
  })
  it('分班清單顯示所屬分區（同母園）', async () => {
    const r = await call('/schools', 'GET', NEA)
    const row = r.json!.rows.find((x: { code: string }) => x.code === '011XA8-01')
    expect(row).toMatchObject({ branchOf: '011XA8', district: '新北市第一分區（示範）' })
  })
})
