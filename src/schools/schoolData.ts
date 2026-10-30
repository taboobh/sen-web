import type { AdminArea, RbacData, SchoolInfo, SchoolStatus, ScopeNode } from '../types'
import { SCHOOL_STATUS_TEXT } from '../types'
import { stagesOf, type MoeBatch, type MoeSchool, type SchoolLevel } from './moe'

/**
 * 學校主檔：教育部統計處名錄 → 資料範圍樹（縣市 › 分區 › 學校）。
 * 學校所在的鄉鎮市區（由地址取得）決定分區；署轄學校直接掛在國教署之下。
 */

const DIRECT_CITIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市']

/**
 * 署轄判定（示範規則，待業務確認）：國立學校、海外臺校，以及「非直轄市」的私立高級中等學校，由國教署主管；
 * 其餘（縣市立、直轄市的私立高中、私立國中小、實驗教育機構）由縣市主管。
 */
export function isNtaDirect(m: Pick<MoeSchool, 'name' | 'ownership' | 'city' | 'levels'>): boolean {
  if (/^國立/.test(m.name) || m.city === '海外' || m.levels.includes('海外臺校')) return true
  return m.ownership === '私立' && m.levels.includes('高中職') && !DIRECT_CITIES.includes(m.city)
}

export const cityScopeOf = (data: RbacData, city: string) => data.scopes.find((x) => x.type === 'CITY' && x.cityName === city)
export function areaOf(data: RbacData, cityId: string, town: string): AdminArea | undefined {
  const city = data.scopes.find((x) => x.id === cityId)
  return town && city ? data.areas.find((a) => a.cityId === cityId && a.name === `${city.cityName}${town}`) : undefined
}

/** 決定學校掛在哪個節點：署轄→國教署；否則依鄉鎮市區所屬分區；鄉鎮不明→縣市（並列為待處理） */
export function placeSchool(data: RbacData, m: Pick<MoeSchool, 'name' | 'ownership' | 'city' | 'town' | 'levels'>): { parentId: string; areaId?: string; ntaDirect?: boolean } {
  const root = data.scopes.find((x) => x.type === 'ROOT')!
  const city = cityScopeOf(data, m.city)
  const area = city ? areaOf(data, city.id, m.town) : undefined
  if (isNtaDirect(m)) return { parentId: root.id, areaId: area?.id, ntaDirect: true }
  if (!city) return { parentId: root.id }
  if (area) return { parentId: area.districtId, areaId: area.id }
  return { parentId: city.id }
}

export function schoolStages(levels: SchoolLevel[], name: string) {
  const st = stagesOf(levels)
  // 國小進修部的代碼與國中進修部同屬一個名錄，依校名修正
  if (levels.length === 1 && levels[0] === '國中小進修部' && /國小/.test(name)) return ['國小' as const]
  return st
}

const pathOf = (data: RbacData, parentId: string, id: string) => `${data.scopes.find((x) => x.id === parentId)!.path}/${id}`

/** 依名錄資料建立學校節點（不檢查重複；呼叫端負責） */
/** 匯入（importId 有值）或手動新增（importId 為 null）的來源資訊 */
export interface ChangeCtx { year: number | null; by: string; now: string; importId: number | null }

export function createSchoolNode(data: RbacData, m: MoeSchool, ctx: ChangeCtx, id = `s${m.code}`, status?: SchoolStatus): ScopeNode {
  const { year, by, now, importId } = ctx
  const place = placeSchool(data, m)
  const st: SchoolStatus = status ?? (m.preparing ? 'preparing' : 'active')
  const node: ScopeNode = {
    id, parentId: place.parentId, type: 'SCHOOL', name: m.name, path: pathOf(data, place.parentId, id),
    stages: schoolStages(m.levels, m.name), areaId: place.areaId, ...(place.ntaDirect ? { ntaDirect: true } : {}),
    school: {
      code: m.code, levels: [...m.levels], ownership: m.ownership, city: m.city, town: m.town, zip: m.zip, address: m.address,
      phone: m.phone, website: m.website, ...(m.branches?.length ? { branches: m.branches.map((b) => ({ ...b })) } : {}), status: st, statusSince: now, moeYear: year, source: importId === null ? 'manual' : 'moe', importId,
      lastChange: importId === null ? { kind: 'manual', action: 'create', at: now, by, fields: [] } : { kind: 'import', importId, year, at: now, by },
      history: [{ at: now, by, text: `${year ?? ''}學年度名錄匯入建立（${SCHOOL_STATUS_TEXT[st]}）` }],
    },
  }
  data.scopes.push(node)
  syncBranches(data, node, ctx)
  return node
}

const DIRECT_CHILD_PATH = (parent: ScopeNode, id: string) => `${parent.path}/${id}`
/** 節點移動後，更新其下（分班）節點的路徑 */
function repathChildren(data: RbacData, node: ScopeNode) {
  for (const c of data.scopes.filter((x) => x.parentId === node.id)) { c.path = DIRECT_CHILD_PATH(node, c.id); repathChildren(data, c) }
}
const counts2 = (data: RbacData, id: string) =>
  data.students.filter((s) => s.schoolId === id).length + data.identities.filter((i) => i.orgScopeId === id && i.status !== 'ended').length

/**
 * 分班：母園之下的獨立機構節點（可選為本職機構、指派角色範圍）。依母園名錄的分班清單建立、更新；
 * 名錄不再列出的分班：無人員與學生→廢校／停辦，否則→停招。母園廢校時分班一併廢校。
 */
export function syncBranches(data: RbacData, main: ScopeNode, ctx: ChangeCtx): string[] {
  const sc = main.school!
  const out: string[] = []
  const listed = sc.branches ?? []
  const existing = data.scopes.filter((x) => x.parentId === main.id && x.school?.branchOf)
  const stamp = (n: ScopeNode, text: string) => {
    n.school!.history.unshift({ at: ctx.now, by: ctx.by, text })
    n.school!.lastChange = ctx.importId === null ? { kind: 'manual', action: 'update', at: ctx.now, by: ctx.by, fields: [] } : { kind: 'import', importId: ctx.importId, year: ctx.year, at: ctx.now, by: ctx.by }
    out.push(`${n.school!.code} ${text}`)
  }
  for (const b of listed) {
    const cur = existing.find((x) => x.school!.code === b.code)
    const status: SchoolStatus = sc.status === 'closed' ? 'closed' : sc.status
    if (!cur) {
      const id = `s${b.code}`
      const city = data.scopes.find((x) => x.type === 'CITY' && x.cityName === sc.city)
      const area = city ? areaOf(data, city.id, b.town) : undefined
      const n: ScopeNode = {
        id, parentId: main.id, type: 'SCHOOL', name: b.name, path: DIRECT_CHILD_PATH(main, id), stages: [...(main.stages ?? [])], areaId: area?.id ?? main.areaId,
        ...(main.ntaDirect ? { ntaDirect: true } : {}),
        school: {
          code: b.code, branchOf: sc.code, levels: [...sc.levels], ownership: sc.ownership, city: sc.city, town: b.town, zip: '', address: b.address, phone: b.phone, website: '',
          status, statusSince: ctx.now, moeYear: ctx.year, source: sc.source, importId: ctx.importId,
          lastChange: ctx.importId === null ? { kind: 'manual', action: 'create', at: ctx.now, by: ctx.by, fields: [] } : { kind: 'import', importId: ctx.importId, year: ctx.year, at: ctx.now, by: ctx.by },
          history: [{ at: ctx.now, by: ctx.by, text: `${ctx.year ?? ''}學年度名錄匯入建立（${main.name} 的分班）` }],
        },
      }
      data.scopes.push(n)
      if (existing.length || sc.history.length > 1) out.push(`${b.code} 新增分班`)
      continue
    }
    const c = cur.school!
    const diffs = [cur.name !== b.name && `名稱 ${cur.name}→${b.name}`, c.address !== b.address && `地址 ${c.address}→${b.address}`,
      !c.phoneBySchool && c.phone !== b.phone && `電話 ${c.phone}→${b.phone}`].filter(Boolean) as string[]
    if (cur.name !== b.name) c.oldNames = [...(c.oldNames ?? []), cur.name]
    cur.name = b.name; c.address = b.address; c.town = b.town; if (!c.phoneBySchool) c.phone = b.phone
    c.moeYear = ctx.year; c.importId = ctx.importId ?? c.importId
    if (c.status === 'closed' && sc.status !== 'closed') { c.status = sc.status; c.statusSince = ctx.now; diffs.push('名錄再次列出，恢復') }
    if (diffs.length) stamp(cur, diffs.join('；'))
  }
  for (const n of existing) {
    const c = n.school!
    if (c.status === 'closed') continue
    if (sc.status === 'closed') { c.status = 'closed'; c.statusSince = ctx.now; c.statusNote = '母園廢校／停辦'; stamp(n, '母園廢校／停辦，分班一併設為廢校／停辦'); continue }
    if (listed.some((b) => b.code === c.code)) continue
    const st: SchoolStatus = counts2(data, n.id) > 0 ? 'closing' : 'closed'
    c.status = st; c.statusSince = ctx.now; c.statusNote = '名錄未再列出此分班'
    stamp(n, `名錄未再列出此分班，設為${SCHOOL_STATUS_TEXT[st]}`)
  }
  return out
}

/** 名錄欄位（匯入時以名錄為準覆寫）；在地欄位（特教窗口、備註）不受匯入影響 */
export const MOE_FIELDS: { key: keyof SchoolInfo | 'name'; label: string }[] = [
  { key: 'name', label: '校名' }, { key: 'levels', label: '學制' }, { key: 'ownership', label: '公私立' }, { key: 'city', label: '縣市' },
  { key: 'town', label: '鄉鎮市區' }, { key: 'zip', label: '郵遞區號' }, { key: 'address', label: '地址' }, { key: 'phone', label: '電話' }, { key: 'website', label: '網址' }, { key: 'branches', label: '分班' },
]
const show = (v: unknown) => Array.isArray(v)
  ? v.map((x) => typeof x === 'object' && x ? `${(x as { code: string }).code} ${(x as { name: string }).name}｜${(x as { address: string }).address}｜${(x as { phone: string }).phone}` : String(x)).join('、')
  : String(v ?? '')

function fieldDiff(node: ScopeNode, m: MoeSchool) {
  const sc = node.school!
  const out: { key: string; label: string; from: string; to: string }[] = []
  for (const f of MOE_FIELDS) {
    if (f.key === 'phone' && sc.phoneBySchool) continue // 電話由學校自行維護，名錄不覆寫
    const from = show(f.key === 'name' ? node.name : sc[f.key as keyof SchoolInfo])
    const to = show(f.key === 'name' ? m.name : m[f.key as keyof MoeSchool])
    if (from !== to && !(f.key !== 'name' && !to && from)) out.push({ key: f.key, label: f.label, from, to })
  }
  return out
}

export type DiffKind = 'new' | 'preparing' | 'activate' | 'recode' | 'changed' | 'status' | 'reopen' | 'missing'
export const DIFF_TEXT: Record<DiffKind, string> = {
  new: '新設校', preparing: '籌備處（未啟用）', activate: '籌備處轉正式', recode: '改制換代碼', changed: '名錄資料異動',
  status: '停招／停辦', reopen: '已廢校代碼再出現', missing: '名錄未列（疑似廢校）',
}
/** apply 套用；skip 本次不處理；closed／closing／keep 用於名錄未列或停招停辦 */
export type ImportDecision = 'apply' | 'skip' | 'closed' | 'closing' | 'keep'
export const DECISION_TEXT: Record<ImportDecision, string> = { apply: '套用', skip: '本次不處理', closed: '設為廢校／停辦', closing: '設為停招', keep: '維持現狀' }

export interface DiffItem {
  key: string
  kind: DiffKind
  code: string
  name: string
  city: string
  schoolId?: string
  currentName?: string
  currentStatus?: SchoolStatus
  fields: { key: string; label: string; from: string; to: string }[]
  /** 統計處異動一覽表的說明 */
  moeNote?: string
  options: ImportDecision[]
  suggestion: ImportDecision
  /** 建議的理由 */
  reason?: string
  students: number
  people: number
  warn?: string
}

export interface ImportPreview {
  year: number | null
  lastYear: number | null
  levels: SchoolLevel[]
  /** 範圍內但本次未提供名錄的學制：沿用前一學年度資料、不判定廢校 */
  carriedLevels: SchoolLevel[]
  files: MoeBatch['files']
  skipped: MoeBatch['skipped']
  warnings: string[]
  items: DiffItem[]
  unchanged: number
  total: number
}

/** 第一階段納入的學制（大專不納入） */
export const IN_SCOPE_LEVELS: SchoolLevel[] = ['幼兒園', '互助教保服務中心', '國小', '國中', '國中小進修部', '高中職', '特殊教育學校', '海外臺校', '實驗教育機構']

/** 名錄比對的對象：各校（母園）；分班隨母園的分班清單處理 */
const schoolsOf = (data: RbacData) => data.scopes.filter((x) => x.type === 'SCHOOL' && x.school && !x.school.branchOf)

function counts(data: RbacData, schoolId: string) {
  return {
    students: data.students.filter((s) => s.schoolId === schoolId).length,
    people: data.identities.filter((i) => i.orgScopeId === schoolId && i.status !== 'ended').length,
  }
}

/** 預覽：比對名錄與系統現況，列出每一項異動與建議處理方式（不改資料） */
export function previewImport(data: RbacData, batch: MoeBatch): ImportPreview {
  const current = schoolsOf(data)
  const byCode = new Map(current.map((n) => [n.school!.code, n]))
  const inBatch = new Map(batch.schools.map((s) => [s.code, s]))
  const notes = new Map<string, string[]>()
  for (const c of batch.changes) {
    for (const code of [c.code, c.oldCode].filter(Boolean) as string[]) notes.set(code, [...(notes.get(code) ?? []), `【${c.kind}】${c.text}`])
  }
  const note = (code: string) => notes.get(code)?.join('；')
  const hint = (code: string) => batch.changes.find((c) => c.code === code && (c.kind === '停辦' || c.kind === '停招'))?.kind
  // 改制換代碼：舊代碼在系統中、且不在本次名錄 → 沿用原學校（帳號、學生不動），改為新代碼。同一舊代碼只對應第一個新代碼
  const recode = new Map<string, string>()
  const usedOld = new Set<string>()
  for (const c of batch.changes) {
    if (!c.oldCode || usedOld.has(c.oldCode) || !inBatch.has(c.code) || byCode.has(c.code)) continue
    if (!byCode.has(c.oldCode) || inBatch.has(c.oldCode)) continue
    recode.set(c.code, c.oldCode); usedOld.add(c.oldCode)
  }
  const items: DiffItem[] = []
  let unchanged = 0
  for (const m of batch.schools) {
    const cur = byCode.get(m.code)
    if (!cur) {
      const old = recode.get(m.code)
      if (old) {
        const node = byCode.get(old)!
        items.push({ key: m.code, kind: 'recode', code: m.code, name: m.name, city: m.city, schoolId: node.id, currentName: node.name, currentStatus: node.school!.status,
          fields: [{ key: 'code', label: '學校代碼', from: old, to: m.code }, ...fieldDiff(node, m)], moeNote: note(m.code),
          options: ['apply', 'skip'], suggestion: 'apply', reason: '統計處異動表列為改制：沿用原學校，帳號、角色與學生資料不變', ...counts(data, node.id) })
        continue
      }
      const kind: DiffKind = m.preparing ? 'preparing' : 'new'
      const old2 = batch.changes.find((c) => c.code === m.code && c.oldCode)?.oldCode
      items.push({ key: m.code, kind, code: m.code, name: m.name, city: m.city, fields: [], moeNote: note(m.code), options: ['apply', 'skip'], suggestion: 'apply',
        reason: kind === 'preparing' ? '有代碼的籌備處匯入為「未啟用」，可先建立帳號' : old2 ? `由 ${old2} 改制分出，建立新學校` : undefined,
        warn: !m.town && m.city !== '海外' ? '無法由地址判斷鄉鎮市區，學校會先掛在縣市下，請補分區' : undefined, students: 0, people: 0 })
      continue
    }
    const sc = cur.school!
    const fields = fieldDiff(cur, m)
    const base = { key: m.code, code: m.code, name: m.name, city: m.city, schoolId: cur.id, currentName: cur.name, currentStatus: sc.status, fields, moeNote: note(m.code), ...counts(data, cur.id) }
    const h = hint(m.code)
    if (sc.status === 'closed') {
      items.push({ ...base, kind: 'reopen', options: ['apply', 'skip'], suggestion: 'apply', reason: '名錄再次列出已廢校的代碼，套用後恢復為使用中', warn: '請確認是否復校' })
    } else if (sc.status === 'preparing' && !m.preparing) {
      items.push({ ...base, kind: 'activate', options: ['apply', 'skip'], suggestion: 'apply', reason: '名錄已不再標示籌備處，啟用為正式學校' })
    } else if (h && !(h === '停招' && sc.status === 'closing')) {
      items.push({ ...base, kind: 'status', options: ['closing', 'closed', 'keep'], suggestion: h === '停辦' ? 'closed' : 'closing',
        reason: h === '停辦' ? '統計處異動表列為停辦' : '統計處異動表列為停招：既有學生畢業前仍可作為本職機構' })
    } else if (fields.length) {
      items.push({ ...base, kind: 'changed', options: ['apply', 'skip'], suggestion: 'apply' })
    } else unchanged++
  }
  const carriedLevels = IN_SCOPE_LEVELS.filter((l) => !batch.levels.includes(l))
  for (const n of current) {
    const sc = n.school!
    if (sc.source !== 'moe' || sc.status === 'closed' || inBatch.has(sc.code) || usedOld.has(sc.code)) continue
    if (!sc.levels.every((l) => batch.levels.includes(l))) continue // 學制本次未提供名錄 → 沿用前一學年度，不判定廢校
    const c = counts(data, n.id)
    const h = hint(sc.code)
    const suggestion: ImportDecision = h === '停辦' ? 'closed' : h === '停招' ? 'closing' : c.students + c.people > 0 ? 'closing' : 'closed'
    // 改制為「系統已有」的另一代碼（例如先以籌備處建立）：原代碼停用，人員與學生需轉到新代碼的學校
    const merged = batch.changes.find((x) => x.oldCode === sc.code && x.code !== sc.code && byCode.has(x.code))
    items.push({ key: sc.code, kind: 'missing', code: sc.code, name: n.name, city: sc.city, schoolId: n.id, currentName: n.name, currentStatus: sc.status, fields: [], moeNote: note(sc.code),
      options: ['closed', 'closing', 'keep'], suggestion,
      reason: merged ? `已改制為 ${merged.code} ${byCode.get(merged.code)!.name}（系統已有此代碼）：原代碼停用${c.students + c.people > 0 ? '，請先將人員與學生轉到新代碼學校' : ''}`
        : h ? `統計處異動表列為${h}` : c.students + c.people > 0 ? `仍有 ${c.students} 名學生、${c.people} 位在職人員，建議先設為停招，待學生畢業後再設為廢校` : '本次名錄未列、且無學生與在職人員', ...c })
  }
  const order: DiffKind[] = ['missing', 'status', 'recode', 'new', 'preparing', 'activate', 'reopen', 'changed']
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.code.localeCompare(b.code))
  const lastYear = Math.max(0, ...data.schoolImports.map((r) => r.year ?? 0)) || null
  return { year: batch.year, lastYear, levels: batch.levels, carriedLevels, files: batch.files, skipped: batch.skipped, warnings: batch.warnings, items, unchanged, total: batch.schools.length }
}

function applyFields(data: RbacData, node: ScopeNode, m: MoeSchool) {
  const sc = node.school!
  if (node.name !== m.name) { sc.oldNames = [...(sc.oldNames ?? []), node.name]; node.name = m.name }
  Object.assign(sc, { levels: [...m.levels], ownership: m.ownership || sc.ownership, city: m.city || sc.city, town: m.town || sc.town, zip: m.zip || sc.zip, address: m.address || sc.address, phone: sc.phoneBySchool ? sc.phone : m.phone || sc.phone, website: m.website || sc.website, branches: m.branches?.length ? m.branches.map((b) => ({ ...b })) : undefined })
  node.stages = schoolStages(sc.levels, node.name)
  const place = placeSchool(data, { ...m, town: sc.town, city: sc.city })
  node.areaId = place.areaId
  node.ntaDirect = place.ntaDirect || undefined
  if (place.parentId !== node.parentId) { node.parentId = place.parentId; node.path = pathOf(data, place.parentId, node.id); repathChildren(data, node) }
}

/** 套用：依每一項的處理方式更新學校主檔，回傳各類件數（稽核用）。未列在 decisions 者採建議值 */
export function applyImport(data: RbacData, batch: MoeBatch, decisions: Record<string, ImportDecision>, by: string, now: string, importId: number) {
  const ctx: ChangeCtx = { year: batch.year, by, now, importId }
  const stamp = (node: ScopeNode) => { node.school!.lastChange = { kind: 'import', importId, year: batch.year, at: now, by } }
  const pv = previewImport(data, batch)
  const inBatch = new Map(batch.schools.map((s) => [s.code, s]))
  const done: Record<string, number> = {}
  const bump = (k: string) => { done[k] = (done[k] ?? 0) + 1 }
  const log = (node: ScopeNode, text: string) => node.school!.history.unshift({ at: now, by, text })
  const setStatus = (node: ScopeNode, st: SchoolStatus, why: string) => {
    if (node.school!.status === st) return
    log(node, `狀態 ${SCHOOL_STATUS_TEXT[node.school!.status]}→${SCHOOL_STATUS_TEXT[st]}（${why}）`)
    node.school!.status = st; node.school!.statusSince = now; node.school!.statusNote = why
    if (st === 'closed') syncBranches(data, node, ctx)
  }
  for (const it of pv.items) {
    const d = decisions[it.key] ?? it.suggestion
    if (!it.options.includes(d)) continue
    if (d === 'skip') { bump('skip'); continue }
    const m = inBatch.get(it.code)
    const node = data.scopes.find((x) => x.id === it.schoolId)
    const yr = `${batch.year ?? ''}學年度名錄`
    if (it.kind === 'new' || it.kind === 'preparing') { createSchoolNode(data, m!, ctx); bump(it.kind); continue }
    if (!node) continue
    if (it.kind === 'missing') {
      if (d === 'keep') { log(node, `${yr}未列，維持${SCHOOL_STATUS_TEXT[node.school!.status]}`); bump('keep'); continue }
      setStatus(node, d === 'closing' ? 'closing' : 'closed', `${yr}未列${it.moeNote ? `；${it.moeNote}` : ''}`); stamp(node); bump(d); continue
    }
    const changed = it.fields.filter((f) => f.key !== 'code').map((f) => `${f.label} ${f.from || '—'}→${f.to || '—'}`)
    if (it.kind === 'recode') {
      const old = node.school!.code
      node.school!.oldCodes = [...(node.school!.oldCodes ?? []), old]
      node.school!.code = it.code
      log(node, `改制換代碼 ${old}→${it.code}${changed.length ? `；${changed.join('；')}` : ''}`)
    } else if (changed.length) log(node, `${yr}：${changed.join('；')}`)
    applyFields(data, node, m!)
    syncBranches(data, node, ctx)
    node.school!.moeYear = batch.year
    // 實際有異動才把「最後異動來源」記為本次匯入（狀態選擇「維持現狀」且欄位無差異者不算）
    if (it.fields.length || ['recode', 'activate', 'reopen'].includes(it.kind) || (it.kind === 'status' && d !== 'keep')) stamp(node)
    if (it.kind === 'activate' || it.kind === 'reopen') setStatus(node, 'active', it.kind === 'activate' ? '籌備處轉為正式學校' : `${yr}再次列出`)
    if (it.kind === 'status' && d !== 'keep') setStatus(node, d === 'closed' ? 'closed' : 'closing', it.moeNote ?? it.reason ?? '')
    bump(it.kind === 'status' ? d : it.kind)
  }
  // 未異動的學校也更新「最近出現於名錄」學年度
  for (const n of schoolsOf(data)) if (inBatch.has(n.school!.code)) { n.school!.moeYear = batch.year; n.school!.importId = importId; if (n.school!.source === 'manual') { n.school!.source = 'moe'; stamp(n) } }
  done.unchanged = pv.unchanged
  return { preview: pv, done }
}
