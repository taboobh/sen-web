/**
 * 教育部統計處「各級學校名錄」解析（瀏覽器上傳與建置種子資料共用）。
 * 來源：https://depart.moe.edu.tw/ED4500/News.aspx?n=63F5AB3D02A8BBAC
 * 每個檔案第一列是標題（含學年度與學制），之後有一列欄位名稱（代碼、學校名稱、公/私立、縣市名稱、地址、電話、網址…）。
 * 同一代碼可能出現在多個名錄（例如高中附設國中部、國小部共用代碼），合併時以代碼為準、學制取聯集。
 */

export type SchoolLevel = '幼兒園' | '互助教保服務中心' | '國小' | '國中' | '國中小進修部' | '高中職' | '特殊教育學校' | '海外臺校' | '實驗教育機構'
export const SCHOOL_LEVELS: SchoolLevel[] = ['幼兒園', '互助教保服務中心', '國小', '國中', '國中小進修部', '高中職', '特殊教育學校', '海外臺校', '實驗教育機構']

export interface MoeSchool {
  code: string
  name: string
  ownership: '公立' | '私立' | ''
  city: string
  zip: string
  town: string
  address: string
  phone: string
  website: string
  levels: SchoolLevel[]
  /** 名錄註記為籌備處（匯入為「未啟用」） */
  preparing?: boolean
  /** 名錄註記為新設校 */
  isNew?: boolean
  /** 只出現在「附設國中／國小部」名錄 */
  attachedOnly?: boolean
  /** 分班（幼兒園的分班代碼為「母園代碼-01」）：併入母園，不另成機構 */
  branches?: MoeBranch[]
  note?: string
}

export interface MoeBranch { code: string; name: string; town: string; address: string; phone: string }
export const BRANCH_RE = /^([0-9A-Z]{6})-(\d{2})$/

export type MoeChangeKind = '新設' | '復校' | '改制' | '停辦' | '停招' | '其他'
export interface MoeChange {
  kind: MoeChangeKind
  code: string
  /** 改制換代碼時的原代碼 */
  oldCode?: string
  name: string
  text: string
}

export type MoeFileKind = 'list' | 'newList' | 'change' | 'outOfScope' | 'unknown'
export interface MoeFile {
  fileName: string
  /** 分班列（併入母園） */
  branches?: (MoeBranch & { parent: string })[]
  title: string
  year: number | null
  kind: MoeFileKind
  level?: SchoolLevel
  schools: MoeSchool[]
  changes: MoeChange[]
  skipped: { name: string; reason: string }[]
}

type Cell = string | number | null | undefined
const s = (v: Cell) => (v === null || v === undefined ? '' : String(v)).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

/** 學校代碼：6 碼英數；Excel 可能把 140401 讀成數字或把前導 0 吃掉 */
export function normCode(v: Cell): string {
  const t = s(v).toUpperCase()
  if (/^\d{1,6}$/.test(t)) return t.padStart(6, '0')
  return t
}
export const CODE_RE = /^[0-9A-Z]{6}$/

const CITY_SUFFIX_DISTRICT = /市$/ // 直轄市、省轄市的下一層一律是「區」
/** 由地址取出鄉鎮市區：直轄市／省轄市取到「區」，縣取到第一個「鄉、鎮、市」 */
export function townOf(city: string, address: string): string {
  let a = address.replace(/[\u200b\ufeff]/g, '').replace(/^\[\d+\]/, '').replace(/^\d{3,6}/, '').trim()
  a = a.replace(/^臺灣省|^台灣省/, '')
  const c = city.replace(/^台/, '臺')
  a = a.replace(/^台/, '臺')
  if (c && a.startsWith(c)) a = a.slice(c.length).replace(/^\(市\)/, c.slice(0, 2) + '市')
  else if (!c || !/縣$/.test(c)) return ''   // 縣的地址偶有省略縣名（例：臺東市中華路）
  const m = CITY_SUFFIX_DISTRICT.test(c) ? a.match(/^(.{1,4}?區)/) : a.match(/^(.{1,4}?[鄉鎮市])/)
  return m ? m[1] : ''
}

function detect(title: string): { kind: MoeFileKind; level?: SchoolLevel } {
  if (/異動一覽表/.test(title)) return { kind: 'change' }
  if (/新設校/.test(title) || /籌備處/.test(title)) return { kind: 'newList', level: /高級中等/.test(title) ? '高中職' : undefined }
  if (/大專校院|宗教研修|空大|附設進修學校|軍警大專/.test(title)) return { kind: 'outOfScope' }
  // 學前教保服務機構（統計處 k1 幼兒園、k2 互助教保服務中心）
  if (/互助教保服務中心/.test(title)) return { kind: 'list', level: '互助教保服務中心' }
  if (/幼兒園/.test(title)) return { kind: 'list', level: '幼兒園' }
  if (/國民中小學進修部/.test(title)) return { kind: 'list', level: '國中小進修部' }
  if (/國民小學/.test(title)) return { kind: 'list', level: '國小' }
  if (/國民中學/.test(title)) return { kind: 'list', level: '國中' }
  if (/特殊教育學校/.test(title)) return { kind: 'list', level: '特殊教育學校' }
  if (/臺商子弟|海外臺灣學校/.test(title)) return { kind: 'list', level: '海外臺校' }
  if (/實驗教育機構/.test(title)) return { kind: 'list', level: '實驗教育機構' }
  if (/高級中等學校|高職部|矯正學校/.test(title)) return { kind: 'list', level: '高中職' }
  return { kind: 'unknown' }
}

const HEADERS: Record<string, string[]> = {
  code: ['代碼', '學校代碼'],
  name: ['學校名稱', '機構名稱'],
  ownership: ['公/私立', '公私立'],
  city: ['縣市名稱', '縣市'],
  town: ['鄉鎮市區名稱'],
  address: ['地址', '學校地址'],
  phone: ['電話'],
  website: ['網址'],
  note: ['備註'],
  oldCode: ['原學校代碼'],
  desc: ['說明'],
}

function headerMap(row: Cell[]): Record<string, number> {
  const m: Record<string, number> = {}
  row.forEach((c, i) => {
    const t = s(c).replace(/\s/g, '')
    for (const [k, names] of Object.entries(HEADERS)) if (m[k] === undefined && names.includes(t)) m[k] = i
  })
  return m
}

const levelFromName = (name: string): SchoolLevel | undefined =>
  /國小|國民小學/.test(name) ? '國小' : /國中|國民中學/.test(name) ? '國中' : /高中|高級中等|高工|高商|高職/.test(name) ? '高中職' : undefined

/** 解析一個工作表（二維陣列，第一列起含標題） */
export function parseMoeSheet(rows: Cell[][], fileName = ''): MoeFile {
  const nonEmpty = rows.filter((r) => r.some((c) => s(c)))
  const title = s(nonEmpty.find((r) => r.some((c) => /名錄|名單|一覽表/.test(s(c))))?.find((c) => /名錄|名單|一覽表/.test(s(c))))
  const ym = title.match(/(\d{3})\s*學年/)
  const out: MoeFile = { fileName, title, year: ym ? Number(ym[1]) : null, ...detect(title), schools: [], changes: [], skipped: [] }
  if (out.kind === 'outOfScope' || out.kind === 'unknown') return out
  const hIdx = nonEmpty.findIndex((r) => { const h = headerMap(r); return h.code !== undefined && (h.name !== undefined || out.kind === 'change') })
  if (hIdx < 0) { out.kind = 'unknown'; return out }
  const h = headerMap(nonEmpty[hIdx])
  if (out.kind === 'change' && h.name === undefined) h.name = 1
  const get = (r: Cell[], k: string) => (h[k] === undefined ? '' : s(r[h[k]]))

  if (out.kind === 'change') {
    let section: MoeChangeKind = '其他'
    for (const r of nonEmpty.slice(hIdx + 1)) {
      const first = s(r[0])
      if (first.startsWith('※')) {
        const t = first.slice(1)
        section = (['新設', '復校', '停辦', '停招'] as MoeChangeKind[]).find((k) => t.includes(k)) ?? (t.includes('改制') || t.includes('改隸') || t.includes('裁併') ? '改制' : '其他')
        continue
      }
      if (/^說明|^\d+\./.test(first)) break
      const name = get(r, 'name'), code = normCode(get(r, 'code')), desc = get(r, 'desc')
      // 國中小異動表的改制列：「原X(011314)→Y(011504)」
      const arrow = name.match(/\((\w{6})\)\s*→.*\((\w{6})\)/)
      if (arrow) { out.changes.push({ kind: '改制', code: arrow[2], oldCode: arrow[1], name: name.replace(/^原/, ''), text: name }); continue }
      if (!CODE_RE.test(code)) continue
      const old = normCode(get(r, 'oldCode'))
      // 高中異動表「停招」區也列停辦學校；依說明文字判斷
      const kind: MoeChangeKind = section === '停招' && /停辦/.test(desc) && !/停止招收/.test(desc) ? '停辦' : section
      out.changes.push({ kind, code, oldCode: CODE_RE.test(old) && old !== code ? old : undefined, name, text: desc || name })
    }
    return out
  }

  const seen = new Map<string, MoeSchool>()
  for (const r of nonEmpty.slice(hIdx + 1)) {
    const name = get(r, 'name')
    if (!name) continue
    const code = normCode(get(r, 'code'))
    if (out.kind === 'newList' && /^「|擬奉核可/.test(s(r[0]) || name)) continue
    const br = code.match(BRANCH_RE)
    if (br) {
      const city = get(r, 'city').replace(/^\[\w+\]/, '').replace(/^台/, '臺')
      const address = get(r, 'address').replace(/^\[\d+\]/, '').trim()
      ;(out.branches ??= []).push({ parent: br[1], code, name, address, phone: get(r, 'phone'), town: get(r, 'town').replace(/\s/g, '') || townOf(city, address) })
      continue
    }
    if (!CODE_RE.test(code)) {
      out.skipped.push({ name, reason: /籌備處/.test(name) ? '籌備處尚無學校代碼，不匯入' : `學校代碼「${code || '空白'}」格式不正確` })
      continue
    }
    const rawCity = get(r, 'city')
    const city = (rawCity.replace(/^\[\w+\]/, '') || (out.level === '海外臺校' ? '海外' : '')).replace(/^台/, '臺')
    const rawAddr = get(r, 'address')
    const zip = rawAddr.match(/^\[(\d+)\]/)?.[1] ?? ''
    const address = rawAddr.replace(/^\[\d+\]/, '').trim()
    let level = out.level
    const preparing = /籌備處/.test(name)
    if (out.kind === 'newList') level = level ?? levelFromName(name)
    if (!level) { out.skipped.push({ name, reason: '無法判斷學制' }); continue }
    const own = get(r, 'ownership')
    const school: MoeSchool = {
      code,
      name: out.kind === 'newList' ? name.replace(/\((新設校|籌備處)\)$/, (_m, x: string) => (x === '籌備處' ? '籌備處' : '')) : name,
      ownership: own === '公立' || own === '私立' ? own : /^(國立|市立|縣立)/.test(name) || /^(國立|市立|縣立)/.test(name.replace(/^.{2,3}[市縣]/, '')) ? '公立' : /私立/.test(name) ? '私立' : '',
      city, zip, address, town: get(r, 'town').replace(/\s/g, '') || townOf(city, address),
      phone: get(r, 'phone'), website: get(r, 'website'),
      levels: [level],
      ...(preparing ? { preparing } : {}),
      ...(out.kind === 'newList' && /新設校/.test(name) ? { isNew: true } : {}),
      ...(/附設國民(中|小)學|附設國(中|小)部?$/.test(title + name) && /附設/.test(name) ? { attachedOnly: true } : {}),
      ...(get(r, 'note') ? { note: get(r, 'note') } : {}),
    }
    const dup = seen.get(code)
    if (dup) { if (dup.name !== school.name) out.skipped.push({ name, reason: `代碼 ${code} 在同一檔案重複（${dup.name}）` }); continue }
    seen.set(code, school)
    out.schools.push(school)
  }
  return out
}

export interface MoeBatch {
  year: number | null
  schools: MoeSchool[]
  changes: MoeChange[]
  /** 本次有提供名錄的學制；未提供的學制沿用前一學年度資料、不判定廢校 */
  levels: SchoolLevel[]
  files: { fileName: string; title: string; kind: MoeFileKind; count: number }[]
  skipped: { name: string; reason: string }[]
  warnings: string[]
}

/** 合併多個名錄檔：同代碼學制取聯集；校名以非「附設」名錄為準 */
export function mergeMoe(files: MoeFile[]): MoeBatch {
  const byCode = new Map<string, MoeSchool>()
  const warnings: string[] = []
  const years = [...new Set(files.filter((f) => f.kind === 'list' && f.year).map((f) => f.year!))]
  if (years.length > 1) warnings.push(`名錄學年度不一致：${years.join('、')}，以最大者為準`)
  const lists = files.filter((f) => f.kind === 'list')
  // 正式名錄先、新設校籌備處名單後（名單只補正式名錄沒有的代碼）
  for (const f of [...lists, ...files.filter((x) => x.kind === 'newList')]) {
    for (const sc of f.schools) {
      const cur = byCode.get(sc.code)
      if (!cur) { byCode.set(sc.code, { ...sc, levels: [...sc.levels] }); continue }
      if (f.kind === 'newList') { if (sc.preparing && !cur.preparing && cur.levels.length === 0) cur.preparing = true; continue }
      for (const l of sc.levels) if (!cur.levels.includes(l)) cur.levels.push(l)
      if (cur.attachedOnly && !sc.attachedOnly) Object.assign(cur, { ...sc, levels: cur.levels, attachedOnly: undefined })
      for (const k of ['address', 'phone', 'website', 'town', 'zip', 'city', 'ownership'] as const) if (!cur[k] && sc[k]) cur[k] = sc[k] as never
    }
  }
  // 分班併入母園
  for (const b of files.flatMap((f) => f.branches ?? [])) {
    const p = byCode.get(b.parent)
    if (!p) { warnings.push(`分班 ${b.code} ${b.name}：找不到母園 ${b.parent}，未匯入`); continue }
    const { parent: _p, ...rest } = b
    ;(p.branches ??= []).push(rest)
  }
  for (const sc of byCode.values()) sc.branches?.sort((a, b) => a.code.localeCompare(b.code))
  for (const f of files) if (f.kind === 'unknown') warnings.push(`無法辨識的檔案：${f.fileName || f.title || '(無標題)'}，未匯入`)
  for (const sc of byCode.values()) {
    sc.levels.sort((a, b) => SCHOOL_LEVELS.indexOf(a) - SCHOOL_LEVELS.indexOf(b))
    if (sc.city && sc.city !== '海外' && !sc.town) warnings.push(`${sc.code} ${sc.name}：無法由地址判斷鄉鎮市區（${sc.address || '無地址'}）`)
  }
  return {
    year: years.length ? Math.max(...years) : files.find((f) => f.year)?.year ?? null,
    schools: [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    changes: files.flatMap((f) => f.changes),
    levels: [...new Set(lists.map((f) => f.level!))].sort((a, b) => SCHOOL_LEVELS.indexOf(a) - SCHOOL_LEVELS.indexOf(b)),
    files: files.map((f) => ({ fileName: f.fileName, title: f.title, kind: f.kind, count: f.kind === 'change' ? f.changes.length : f.schools.length })),
    skipped: files.flatMap((f) => f.kind === 'outOfScope' ? [{ name: f.title || f.fileName, reason: '不在第一階段範圍（大專校院等），整份略過' }] : f.skipped),
    warnings,
  }
}

/** SEN 的教育階段（授權用）由學制推得 */
export function stagesOf(levels: SchoolLevel[]): ('學前' | '國小' | '國中' | '高中職')[] {
  const out = new Set<'學前' | '國小' | '國中' | '高中職'>()
  for (const l of levels) {
    if (l === '幼兒園' || l === '互助教保服務中心') out.add('學前')
    if (l === '國小') out.add('國小')
    if (l === '國中' || l === '國中小進修部') out.add('國中')
    if (l === '高中職') out.add('高中職')
    if (l === '特殊教育學校' || l === '海外臺校' || l === '實驗教育機構') { out.add('國小'); out.add('國中'); out.add('高中職') }
  }
  return ['學前', '國小', '國中', '高中職'].filter((x) => out.has(x as never)) as never
}

/**
 * 工作表 → 二維陣列。統計處部分檔案（如高級中等學校名錄）宣告的範圍達 65536 列 × 數百欄，
 * 直接轉換會非常慢；先依實際有值的儲存格重新計算範圍。xlsx 模組由呼叫端傳入（瀏覽器端延遲載入）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sheetRows(XLSX: any, ws: Record<string, any>): Cell[][] {
  let maxR = 0, maxC = 0
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue
    const v = ws[k]?.v
    if (v === undefined || v === null || String(v).trim() === '') continue
    const a = XLSX.utils.decode_cell(k)
    if (a.r > maxR) maxR = a.r
    if (a.c > maxC) maxC = a.c
  }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', range: { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } } }) as Cell[][]
}

/** 讀取一個名錄檔（xlsx／xls／ods／csv）的第一個工作表並解析 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMoeWorkbook(XLSX: any, data: ArrayBuffer | Uint8Array, fileName: string): MoeFile {
  const wb = XLSX.read(data, { type: 'array' })
  return parseMoeSheet(sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]]), fileName)
}
