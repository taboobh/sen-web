import { http, HttpResponse } from 'msw'
import type { ReasonCode, SchoolInfo, SchoolStatus, ScopeNode } from '../types'
import { SCHOOL_STATUS_TEXT } from '../types'
import { authorize, inSessionScope, type ResolvedSession } from '../auth/engine'
import { CODE_RE, mergeMoe, SCHOOL_LEVELS, townOf, type MoeFile, type MoeSchool, type SchoolLevel } from '../schools/moe'
import { applyImport, createSchoolNode, MOE_FIELDS, placeSchool, previewImport, schoolStages, type ImportDecision } from '../schools/schoolData'
import { db, logAudit } from './state'
import { badRequest, forbidden, readSession, resolveGated, today, unauthorized } from './session'

/**
 * 學校基本資料（基本資料管理 › 學校基本資料）：
 * - 瀏覽：有「基本資料管理」查詢權者，看自己資料範圍內的學校；
 * - 署管理員（全國層）：可新增學校、修改全部欄位與狀態，並負責每年匯入統計處名錄；
 * - 學校（學校層級的指派、具基本資料管理修改權，僅限本校）：只能修改電話、校長、發言人（聯絡人）；
 *   學校改過電話後，之後的名錄匯入不再覆寫電話；
 * - 縣市、分區：只能瀏覽自己範圍內的學校。
 */

function sessionOf(request: Request): { session: ResolvedSession } | { res: Response } {
  const s = readSession(request)
  if (!s) return { res: unauthorized() }
  const r = resolveGated(s)
  if ('reason' in r) return { res: unauthorized(r.reason) }
  return { session: r.session }
}

/** 署管理員（全國層）且有基本資料管理新增＋修改權 → 可匯入名錄、修改名錄欄位與狀態 */
function canManageMoe(session: ResolvedSession) {
  const scope = db.scopes.find((x) => x.id === session.assignment.scopeId)
  return scope?.type === 'ROOT' && authorize(db, session, 'base:create').allowed && authorize(db, session, 'base:update').allowed
}

const districtName = (n: ScopeNode): string => {
  if (n.ntaDirect) return '署轄'
  const p = db.scopes.find((x) => x.id === n.parentId)
  if (p?.type === 'SCHOOL') return districtName(p)   // 分班：同母園
  return p?.type === 'DISTRICT' ? p.name : '未歸分區'
}
const cnt = (id: string) => ({
  students: db.students.filter((s) => s.schoolId === id).length,
  people: db.identities.filter((i) => i.orgScopeId === id && i.status !== 'ended').length,
})

/** 列表用：不含異動紀錄（避免全國四千多校一次送出太大） */
function row(n: ScopeNode) {
  const { history: _h, ...school } = n.school!
  return { id: n.id, name: n.name, stages: n.stages ?? [], ntaDirect: !!n.ntaDirect, district: districtName(n), ...school, ...cnt(n.id) }
}

function log(session: ResolvedSession, permission: string, target: string, decision: 'ALLOW' | 'DENY', reason: ReasonCode) {
  logAudit({ accountName: session.accountName, roleName: session.role.name, scopeId: session.assignment.scopeId, permission, target, decision, reason })
}

/** 可修改電話、校長、發言人：署管理員，或本校（學校層級指派＋基本資料管理修改權） */
function canEditSchoolSelf(session: ResolvedSession, n: ScopeNode) {
  if (canManageMoe(session)) return true
  const mine = db.scopes.find((x) => x.id === session.assignment.scopeId)
  // 本校，或本校的分班（母園的學校管理員可維護分班）
  return mine?.type === 'SCHOOL' && (mine.id === n.id || n.parentId === mine.id) && authorize(db, session, 'base:update', { scopeId: n.id }).allowed
}

const nowText = () => new Date().toLocaleString('zh-TW', { hour12: false })

const isFiles = (v: unknown): v is MoeFile[] => Array.isArray(v) && v.every((f) => f && typeof f === 'object' && Array.isArray((f as MoeFile).schools))

export const schoolHandlers = [
  http.get('*/api/schools', ({ request }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const { session } = r
    const d = authorize(db, session, 'base:read')
    if (!d.allowed) { log(session, 'base:read', '學校清單', 'DENY', d.reason); return forbidden(d.reason) }
    const rows = db.scopes.filter((x) => x.type === 'SCHOOL' && x.school && inSessionScope(db, session, x.id)).map(row)
    const manage = canManageMoe(session)
    return HttpResponse.json({
      scopeName: db.scopes.find((x) => x.id === session.assignment.scopeId)?.name,
      rows,
      canManage: manage,
      // 學校層級的使用者（本校）可修改電話、校長、發言人
      canEditSelf: manage || rows.some((x) => canEditSchoolSelf(session, db.scopes.find((y) => y.id === x.id)!)),
      lastImport: db.schoolImports[0] ?? null,
      imports: manage ? db.schoolImports : [],
    })
  }),

  http.get('*/api/schools/:id', ({ request, params }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const n = db.scopes.find((x) => x.id === params.id && x.school)
    if (!n) return HttpResponse.json({ error: 'not_found', message: '學校不存在' }, { status: 404 })
    const d = authorize(db, r.session, 'base:read', { scopeId: n.id })
    if (!d.allowed) return forbidden(d.reason)
    const imp = db.schoolImports.find((x) => x.id === n.school!.importId) ?? null
    return HttpResponse.json({ ...row(n), history: n.school!.history, import: imp && { id: imp.id, year: imp.year, at: imp.at, by: imp.by }, canEditSelf: canEditSchoolSelf(r.session, n), canManage: canManageMoe(r.session) })
  }),

  // 學校自行維護：電話、校長、發言人（聯絡人）。署管理員與本校可改；縣市、分區不可
  http.put('*/api/schools/:id/self', async ({ request, params }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const { session } = r
    const n = db.scopes.find((x) => x.id === params.id && x.school)
    if (!n) return HttpResponse.json({ error: 'not_found', message: '學校不存在' }, { status: 404 })
    const ok = canEditSchoolSelf(session, n)
    const deny: ReasonCode = !authorize(db, session, 'base:update').allowed ? 'NO_PERMISSION' : 'OUT_OF_SCOPE'
    if (!ok) { log(session, 'base:update', `${n.name} 電話／校長／發言人`, 'DENY', deny); return forbidden(deny) }
    const b = (await request.json()) as { phone?: string; principal?: string; contactName?: string; contactTitle?: string; contactPhone?: string; contactEmail?: string }
    const t = (v?: string) => (v ?? '').trim()
    const email = t(b.contactEmail)
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest('發言人電子郵件格式不正確')
    for (const [label, v] of [['學校電話', t(b.phone)], ['發言人電話', t(b.contactPhone)]] as const) {
      if (v && !/^[0-9()（）+\-#＃ 　、,，轉ext.]{6,40}$/i.test(v)) return badRequest(`${label}格式不正確`)
    }
    if (!t(b.phone)) return badRequest('請填寫學校電話')
    const sc = n.school!
    const before = { phone: sc.phone, principal: sc.principal ?? '', contact: [sc.contact?.name, sc.contact?.title, sc.contact?.phone, sc.contact?.email].map((x) => x ?? '').join('｜') }
    const next = { phone: t(b.phone), principal: t(b.principal), contact: { name: t(b.contactName) || undefined, title: t(b.contactTitle) || undefined, phone: t(b.contactPhone) || undefined, email: email || undefined } }
    const changes: string[] = []
    if (before.phone !== next.phone) changes.push(`電話 ${before.phone || '—'}→${next.phone}`)
    if (before.principal !== next.principal) changes.push(`校長 ${before.principal || '—'}→${next.principal || '—'}`)
    if (before.contact !== [next.contact.name, next.contact.title, next.contact.phone, next.contact.email].map((x) => x ?? '').join('｜')) changes.push(`發言人（聯絡人）${next.contact.name ?? '—'}`)
    if (!changes.length) return HttpResponse.json(row(n))
    const bySchool = !canManageMoe(session)
    if (before.phone !== next.phone && bySchool) sc.phoneBySchool = true
    sc.phone = next.phone
    sc.principal = next.principal || undefined
    sc.contact = next.contact
    sc.history.unshift({ at: nowText(), by: `${session.accountName}（${session.role.name}）`, text: changes.join('；') })
    sc.lastChange = { kind: bySchool ? 'school' : 'manual', action: 'update', at: nowText(), by: `${session.accountName}（${session.role.name}）`, fields: changes.map((c) => c.split(' ')[0]) }
    log(session, 'base:update', `${sc.code} ${n.name}：${changes.join('；')}`, 'ALLOW', 'OK')
    return HttpResponse.json(row(n))
  }),

  // 名錄欄位與狀態：只有署管理員（名錄有誤、或統計處尚未公告時的臨時修正；下次匯入以名錄為準）
  http.put('*/api/schools/:id', async ({ request, params }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const { session } = r
    const n = db.scopes.find((x) => x.id === params.id && x.school)
    if (!n) return HttpResponse.json({ error: 'not_found', message: '學校不存在' }, { status: 404 })
    if (!canManageMoe(session)) { log(session, 'base:update', `${n.name} 名錄欄位`, 'DENY', 'NO_PERMISSION'); return forbidden('NO_PERMISSION') }
    const b = (await request.json()) as Partial<SchoolInfo> & { name?: string; statusNote?: string }
    const sc = n.school!
    const name = (b.name ?? n.name).trim()
    if (!name) return badRequest('請輸入校名')
    const levels = (b.levels ?? sc.levels).filter((l) => SCHOOL_LEVELS.includes(l))
    if (!levels.length) return badRequest('請至少選擇一個學制')
    const status = (b.status ?? sc.status) as SchoolStatus
    if (!(status in SCHOOL_STATUS_TEXT)) return badRequest('狀態不正確')
    const c = cnt(n.id)
    if (status === 'closed' && sc.status !== 'closed' && c.students > 0) return badRequest(`仍有 ${c.students} 名學生，請先設為「停招」，待學生畢業或轉出後再設為廢校`)
    if (status !== sc.status && !(b.statusNote ?? '').trim()) return badRequest('變更狀態請填寫原因（例如公文字號）')
    const before = { ...sc, name: n.name }
    const next = {
      name, levels, ownership: b.ownership ?? sc.ownership, city: b.city ?? sc.city, zip: (b.zip ?? sc.zip).trim(), address: (b.address ?? sc.address).trim(),
      phone: (b.phone ?? sc.phone).trim(), website: (b.website ?? sc.website).trim(),
    }
    const town = townOf(next.city, next.address) || sc.town
    const changes = MOE_FIELDS.map((f) => {
      const from = f.key === 'name' ? before.name : String((before as never)[f.key] ?? '')
      const to = f.key === 'name' ? name : f.key === 'town' ? town : String((next as never)[f.key] ?? '')
      return from !== to ? `${f.label} ${from || '—'}→${to || '—'}` : ''
    }).filter(Boolean)
    if (status !== sc.status) changes.push(`狀態 ${SCHOOL_STATUS_TEXT[sc.status]}→${SCHOOL_STATUS_TEXT[status]}（${b.statusNote!.trim()}）`)
    if (!changes.length) return HttpResponse.json(row(n))
    if (n.name !== name) sc.oldNames = [...(sc.oldNames ?? []), n.name]
    n.name = name
    Object.assign(sc, { ...next, town })
    if (status !== sc.status) Object.assign(sc, { status, statusSince: today(), statusNote: b.statusNote!.trim() })
    n.stages = schoolStages(levels, name)
    if (!sc.branchOf) {   // 分班固定掛在母園之下
      const place = placeSchool(db, { ...sc, name })
      n.areaId = place.areaId
      n.ntaDirect = place.ntaDirect || undefined
      if (place.parentId !== n.parentId) {
        n.parentId = place.parentId; n.path = `${db.scopes.find((x) => x.id === place.parentId)!.path}/${n.id}`
        for (const c of db.scopes.filter((x) => x.parentId === n.id)) c.path = `${n.path}/${c.id}`
      }
    }
    sc.history.unshift({ at: nowText(), by: session.accountName, text: `手動修正：${changes.join('；')}` })
    sc.lastChange = { kind: 'manual', action: 'update', at: nowText(), by: `${session.accountName}（${session.role.name}）`, fields: changes.map((c) => c.split(' ')[0]) }
    log(session, 'base:update', `${sc.code} ${name}：${changes.join('；')}`, 'ALLOW', 'OK')
    return HttpResponse.json(row(n))
  }),

  // 手動新增（名錄尚未公告的新設校等）；下次匯入若名錄出現同代碼，即改為以名錄為準
  http.post('*/api/schools', async ({ request }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const { session } = r
    if (!canManageMoe(session)) { log(session, 'base:create', '新增學校', 'DENY', 'NO_PERMISSION'); return forbidden('NO_PERMISSION') }
    const b = (await request.json()) as Partial<MoeSchool> & { status?: SchoolStatus }
    const code = (b.code ?? '').trim().toUpperCase()
    if (!CODE_RE.test(code)) return badRequest('學校代碼須為 6 碼英數字（教育部學校代碼）')
    if (db.scopes.some((x) => x.school?.code === code || x.school?.oldCodes?.includes(code))) return badRequest(`學校代碼 ${code} 已存在`)
    const name = (b.name ?? '').trim()
    if (!name) return badRequest('請輸入校名')
    const levels = (b.levels ?? []).filter((l) => SCHOOL_LEVELS.includes(l)) as SchoolLevel[]
    if (!levels.length) return badRequest('請至少選擇一個學制')
    if (!db.scopes.some((x) => x.type === 'CITY' && x.cityName === b.city)) return badRequest('請選擇縣市')
    const address = (b.address ?? '').trim()
    const m: MoeSchool = { code, name, ownership: b.ownership ?? '', city: b.city!, zip: (b.zip ?? '').trim(), address, town: townOf(b.city!, address), phone: (b.phone ?? '').trim(), website: (b.website ?? '').trim(), levels }
    const st: SchoolStatus = b.status === 'preparing' ? 'preparing' : 'active'
    const n = createSchoolNode(db, m, { year: null, by: session.accountName, now: nowText(), importId: null }, `s${code}`, st)
    n.school!.history = [{ at: nowText(), by: session.accountName, text: `手動新增（${SCHOOL_STATUS_TEXT[st]}），待統計處名錄確認` }]
    log(session, 'base:create', `手動新增學校 ${code} ${name}`, 'ALLOW', 'OK')
    return HttpResponse.json(row(n), { status: 201 })
  }),

  // 年度名錄匯入：先預覽（不改資料）
  http.post('*/api/schools/import/preview', async ({ request }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    if (!canManageMoe(r.session)) return forbidden('NO_PERMISSION')
    const b = (await request.json()) as { files: unknown }
    if (!isFiles(b.files) || !b.files.length) return badRequest('請先選擇名錄檔案')
    const batch = mergeMoe(b.files)
    if (!batch.schools.length) return badRequest('檔案中沒有可匯入的學校（請確認是統計處「各級學校名錄」）')
    return HttpResponse.json(previewImport(db, batch))
  }),

  // 確認套用：後端重新比對一次（預覽之後資料可能已被其他人改過），依每項處理方式更新
  http.post('*/api/schools/import/apply', async ({ request }) => {
    const r = sessionOf(request)
    if ('res' in r) return r.res
    const { session } = r
    if (!canManageMoe(session)) { log(session, 'base:create', '匯入學校名錄', 'DENY', 'NO_PERMISSION'); return forbidden('NO_PERMISSION') }
    const b = (await request.json()) as { files: unknown; decisions?: Record<string, ImportDecision> }
    if (!isFiles(b.files) || !b.files.length) return badRequest('請先選擇名錄檔案')
    const batch = mergeMoe(b.files)
    if (!batch.schools.length) return badRequest('檔案中沒有可匯入的學校')
    const id = (db.schoolImports[0]?.id ?? 0) + 1
    const at = nowText()
    const { done } = applyImport(db, batch, b.decisions ?? {}, session.accountName, at, id)
    const rec = { id, at, by: session.accountName, year: batch.year, levels: batch.levels, files: b.files.map((f) => f.fileName), summary: done }
    db.schoolImports.unshift(rec)
    log(session, 'base:create', `匯入 ${batch.year ?? ''} 學年度學校名錄：${Object.entries(done).map(([k, v]) => `${k} ${v}`).join('、')}`, 'ALLOW', 'OK')
    return HttpResponse.json(rec)
  }),
]
