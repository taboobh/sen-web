import type {
  AdminArea, Account, Identity, RbacData, Responsibility, Role, RoleAssignment, ScopeNode, Stage, Student,
} from '../types'
import { DEFAULT_PROFILE_SETTINGS, guidOf, idHash, makeTestId, maskId } from '../auth/profile'

/* 全部為合成資料：組織、學校、人名皆為虛構，不含任何真實帳號或個資。 */

import seed from './moeSeed.json'
import type { SchoolLevel } from '../schools/moe'
import { createSchoolNode } from '../schools/schoolData'

/*
 * 學校、縣市、鄉鎮市區：教育部統計處 114 學年度各級學校名錄（真實學校代碼與資料，見 moeSeed.json）。
 * 人員、帳號、學生：全部為合成資料，不含任何真實帳號或個資。
 * 分區的實際組成尚未取得：新北市、臺中市各示範兩個分區，其餘縣市先以「全區」一個分區呈現。
 */

const DIRECT = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市']
const BUREAU = (c: string) => `${c}政府${DIRECT.includes(c) ? '教育局' : '教育處'}`
/** 示範用的縣市 id（沿用原型既有 id，測試與示範帳號以此為準） */
const CITY_ID: Record<string, string> = { 新北市: 'cityA', 臺中市: 'cityB', 臺北市: 'cityC' }
/** 示範分區（待各縣市提供實際組成）：未列出的鄉鎮市區歸入該縣市最後一個分區 */
const DEMO_DISTRICTS: Record<string, { id: string; name: string; towns: string[] }[]> = {
  新北市: [
    { id: 'cityA-d1', name: '新北市第一分區（示範）', towns: ['板橋區', '中和區', '永和區', '土城區', '樹林區', '三峽區', '鶯歌區', '新店區', '深坑區', '石碇區', '坪林區', '烏來區'] },
    { id: 'cityA-d2', name: '新北市第二分區（示範）', towns: [] },
  ],
  臺中市: [
    { id: 'cityB-d1', name: '臺中市第一分區（示範）', towns: ['中區', '東區', '南區', '西區', '北區', '西屯區', '南屯區', '北屯區'] },
    { id: 'cityB-d2', name: '臺中市第二分區（示範）', towns: [] },
  ],
}
/** 示範帳號、學生所在的學校（真實學校代碼）→ 原型既有 id */
export const DEMO_SCHOOL_IDS: Record<string, string> = {
  '014601': 'sA1', // 新北市板橋區 市立板橋國小（第一分區）
  '014518': 'sA2', // 新北市中和區 市立中和國中（第一分區）
  '014311': 'sA3', // 新北市三重區 市立三重高中（第二分區）
  '014754': 'sA4', // 新北市三重區 市立三重國小（第二分區）
  '010301': 'sN1', // 國立華僑高級中等學校（署轄）
  '193610': 'sB1', // 臺中市西區 市立大同國小
  '193502': 'sB2', // 臺中市北區 市立雙十國中
  '353601': 'sC1', // 臺北市中正區 市立螢橋國小
}

type SeedRow = [string, string, string, string, string, string, string, string, string, string, number]
const SEED = seed as unknown as { year: number; rows: SeedRow[] }
export const SEED_YEAR = SEED.year

/** 依名錄建立：國教署 › 縣市 › 分區（＋鄉鎮市區）› 學校 */
export function buildSchoolTree(): { scopes: ScopeNode[]; areas: AdminArea[] } {
  const scopes: ScopeNode[] = [{ id: 'nea', parentId: null, type: 'ROOT', name: '國教署', path: '/nea' }]
  const areas: AdminArea[] = []
  const rows = SEED.rows
  const cities = [...new Set(rows.map((r) => r[3]).filter((c) => c && c !== '海外'))]
  for (const c of cities) {
    const id = CITY_ID[c] ?? `city-${c}`
    scopes.push({ id, parentId: 'nea', type: 'CITY', name: BUREAU(c), path: `/nea/${id}`, cityName: c })
    const towns = [...new Set(rows.filter((r) => r[3] === c && r[4]).map((r) => r[4]))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    const ds = DEMO_DISTRICTS[c] ?? [{ id: `${id}-d0`, name: `${c}全區`, towns: [] }]
    for (const d of ds) scopes.push({ id: d.id, parentId: id, type: 'DISTRICT', name: d.name, path: `/nea/${id}/${d.id}` })
    for (const t of towns) {
      const d = ds.find((x) => x.towns.includes(t)) ?? ds[ds.length - 1]
      areas.push({ id: `ar-${c}-${t}`, name: `${c}${t}`, cityId: id, districtId: d.id })
    }
  }
  const tmp = { scopes, areas, schoolImports: [] } as unknown as RbacData
  for (const r of rows) {
    const [code, name, ownership, city, town, zip, address, phone, website, levels, preparing] = r
    createSchoolNode(tmp, { code, name, ownership: ownership as '公立' | '私立' | '', city, town, zip, address, phone, website, levels: levels.split(',') as SchoolLevel[], ...(preparing ? { preparing: true } : {}) },
      SEED.year, '系統初始化', '2025-08-01', DEMO_SCHOOL_IDS[code])
  }
  return { scopes, areas }
}

const TREE = buildSchoolTree()
export const SCOPES: ScopeNode[] = TREE.scopes
export const AREAS: AdminArea[] = TREE.areas
const cloneScope = (x: ScopeNode): ScopeNode => ({ ...x, stages: x.stages ? [...x.stages] : undefined,
  school: x.school ? { ...x.school, levels: [...x.school.levels], history: [...x.school.history], contact: x.school.contact ? { ...x.school.contact } : undefined } : undefined })

/** 動作字母：C 新增 R 查詢 U 修改 D 刪除 A 審核 E 匯出。權限＝模組 × 動作，示範值待業務核准。 */
export const ROLES: Role[] = [
  {
    code: 'NEA_ADMIN', name: '署管理員', maxScope: 'ROOT',
    grants: {
      students: 'CRUDAE', base: 'CRUDAE', identify: 'CRUDAE', aide: 'CRUDAE', pro: 'CRUDAE', tour: 'CRUDAE',
      transport: 'CRUDAE', access: 'CRUDAE', material: 'CRUDAE', grant: 'CRUDAE', report: 'CRUDAE',
      news: 'CRUDA', admin: 'CRUDAE',
    },
  },
  {
    code: 'IDENT_CENTER', name: '高中職鑑定中心', maxScope: 'ROOT',
    grants: { identify: 'CRUA', students: 'R', news: 'R', admin: 'C' },
  },
  {
    code: 'CITY_ADMIN', name: '縣市教育局處承辦', maxScope: 'CITY',
    grants: {
      students: 'CRUDAE', base: 'CRUE', identify: 'CRUAE', aide: 'CRUAE', pro: 'CRUAE', tour: 'CRUAE',
      transport: 'R', access: 'CRUAE', material: 'CRUAE', grant: 'CRUAE', report: 'RE', news: 'CRU', admin: 'RUA',
    },
  },
  {
    code: 'DISTRICT_ADMIN', name: '分區管理員', maxScope: 'DISTRICT',
    grants: { students: 'R', base: 'RU', identify: 'R', pro: 'RA', report: 'R', news: 'R', admin: 'R' },
  },
  {
    code: 'SCHOOL_ADMIN', name: '學校管理員', maxScope: 'SCHOOL',
    grants: {
      students: 'CRUE', base: 'CRU', identify: 'CRU', aide: 'CRU', pro: 'CR', tour: 'CR', transport: 'CRU',
      material: 'CRU', grant: 'CR', report: 'R', news: 'R', admin: 'CRU',
    },
  },
  {
    code: 'TEACHER', name: '特教教師', maxScope: 'SCHOOL', relationLimited: true,
    grants: { students: 'RU', identify: 'CR', news: 'R', admin: 'C' },
  },
  {
    code: 'AIDE', name: '助理人員', maxScope: 'SCHOOL',
    grants: { identify: 'R', aide: 'CRU', news: 'R', admin: 'C' },
  },
  {
    code: 'TOUR_TEACHER', name: '巡迴輔導教師', maxScope: 'CITY',
    grants: { tour: 'CRU', news: 'R', admin: 'C' },
  },
  {
    code: 'PUBLISHER', name: '出版商', maxScope: 'ROOT', relationLimited: true,
    grants: { material: 'RU', news: 'R', admin: 'C' },
  },
]

/** 合成號碼（通過檢查碼的虛構資料），僅供示範；a11 的教育雲端 guid 會對應此號碼 */
export const DEMO_ID_A11 = makeTestId('Y', 2, '0000011')

export const ACCOUNTS: Account[] = [
  { id: 'a01', username: 'nea_admin', name: '王署管', email: 'a01@example.test', status: 'active' },
  { id: 'a02', username: 'ident_center01', name: '林鑑定', email: 'a02@example.test', status: 'active' },
  { id: 'a03', username: 'citya_staff', name: '陳局處', email: 'a03@example.test', status: 'active' },
  { id: 'a04', username: 'citya_d1', name: '黃分區', email: 'a04@example.test', status: 'active' },
  { id: 'a05', username: 'sa1_admin', name: '張組長', email: 'a05@example.test', status: 'active', note: '多身分：學校管理員＋巡迴輔導教師' },
  { id: 'a06', username: 'sa1_teacher01', name: '李老師', email: 'a06@example.test', status: 'active' },
  { id: 'a07', username: 'sa1_aide01', name: '吳助理', email: 'a07@example.test', status: 'active' },
  { id: 'a08', username: 'publisher01', name: '趙出版', email: 'a08@example.test', status: 'active' },
  { id: 'a09', username: 'sa2_admin', name: '周校管', email: 'a09@example.test', status: 'active', note: '角色指派已到期' },
  { id: 'a10', username: 'sb1_admin', name: '鄭停用', email: 'a10@example.test', status: 'locked', note: '帳號已鎖定' },
  { id: 'a12', username: 'sn1_staff', name: '謝署轄', email: 'a12@example.test', status: 'active', note: '署轄學校新進人員，尚未指派學校管理員。示範：教育雲端未提供 guid，自填身分證需管理員核對' },
  { id: 'a13', username: 'multi_teacher', name: '蔡兼課', email: 'a13@example.test', status: 'active', note: '示範：本職為新北市板橋國小特教教師；同校另有學校管理員角色（長期有效）；借調新北市中和國中特教教師（外部單位，有效期間）' },
  { id: 'a14', username: 'sso_new_teacher', name: '孫首登', email: 'a14@example.test', status: 'active', note: '示範（教育雲端登入）：首次登入的新使用者，教育雲端帶學校代碼（新北市板橋國小），系統建立任職機構，預設不指派角色' },
  { id: 'a15', username: 'sso_moved_teacher', name: '何調校', email: 'a15@example.test', status: 'active', note: '示範（教育雲端登入）：系統記錄任職於新北市中和國中並有教師角色，但教育雲端回傳學校代碼為新北市三重高中 → 清空原角色，改任三重高中、無角色' },
  { id: 'a11', username: 'sa1_teacher02', name: '許新進', email: 'a11@example.test', status: 'active', note: `新進教師，尚未指派角色。示範：教育雲端會回傳 guid，對應身分證 ${DEMO_ID_A11}；填其他號碼會被擋下` },
]

export const IDENTITIES: Identity[] = [
  { id: 'i01', accountId: 'a01', orgScopeId: 'nea', jobTitle: '通報網管理員' },
  { id: 'i02', accountId: 'a02', orgScopeId: 'nea', jobTitle: '鑑定中心承辦' },
  { id: 'i03', accountId: 'a03', orgScopeId: 'cityA', jobTitle: '特教承辦' },
  { id: 'i04', accountId: 'a04', orgScopeId: 'cityA-d1', jobTitle: '分區管理員' },
  { id: 'i05a', accountId: 'a05', orgScopeId: 'sA1', jobTitle: '特教組長' },
  { id: 'i05b', accountId: 'a05', orgScopeId: 'cityA', jobTitle: '巡迴輔導教師' },
  { id: 'i06', accountId: 'a06', orgScopeId: 'sA1', jobTitle: '特教教師' },
  { id: 'i07', accountId: 'a07', orgScopeId: 'sA1', jobTitle: '教師助理員' },
  { id: 'i08', accountId: 'a08', orgScopeId: 'nea', jobTitle: '出版業者' },
  { id: 'i09', accountId: 'a09', orgScopeId: 'sA2', jobTitle: '特教組長' },
  { id: 'i10', accountId: 'a10', orgScopeId: 'sB1', jobTitle: '特教組長' },
  { id: 'i12', accountId: 'a12', orgScopeId: 'sN1', jobTitle: '特教組長' },
  { id: 'i13a', accountId: 'a13', orgScopeId: 'sA1', jobTitle: '特教教師' },
  { id: 'i13b', accountId: 'a13', orgScopeId: 'sA2', jobTitle: '特教教師' },
  { id: 'i15', accountId: 'a15', orgScopeId: 'sA2', jobTitle: '特教教師' },
  { id: 'i11', accountId: 'a11', orgScopeId: 'sA1', jobTitle: '特教教師' },
]

const FROM = '2026-08-01'
const TO = '2027-07-31'
/** 本職：長期有效（無期間）。借調（外部單位）：必須有有效期間。 */
const ra = (id: string, identityId: string, roleCode: string, scopeId: string, stages: Stage[] = []): RoleAssignment =>
  ({ id, identityId, roleCode, scopeId, stages, concurrent: false, effectiveFrom: null, effectiveTo: null, status: 'active' })
const rc = (id: string, identityId: string, roleCode: string, scopeId: string, stages: Stage[] = [], to = TO): RoleAssignment =>
  ({ id, identityId, roleCode, scopeId, stages, concurrent: true, effectiveFrom: FROM, effectiveTo: to, status: 'active' })

export const ASSIGNMENTS: RoleAssignment[] = [
  ra('ra01', 'i01', 'NEA_ADMIN', 'nea'),
  ra('ra02', 'i02', 'IDENT_CENTER', 'nea', ['高中職']),
  ra('ra03', 'i03', 'CITY_ADMIN', 'cityA'),
  ra('ra04', 'i04', 'DISTRICT_ADMIN', 'cityA-d1'),
  ra('ra05a', 'i05a', 'SCHOOL_ADMIN', 'sA1', ['國小']),
  rc('ra05b', 'i05b', 'TOUR_TEACHER', 'cityA'),
  ra('ra06', 'i06', 'TEACHER', 'sA1', ['國小']),
  ra('ra07', 'i07', 'AIDE', 'sA1', ['國小']),
  ra('ra08', 'i08', 'PUBLISHER', 'nea'),
  rc('ra09', 'i09', 'SCHOOL_ADMIN', 'sA2', ['國中'], '2026-06-30'),
  ra('ra10', 'i10', 'SCHOOL_ADMIN', 'sB1', ['國小']),
  ra('ra15', 'i15', 'TEACHER', 'sA2', ['國中']),
  ra('ra13a', 'i13a', 'TEACHER', 'sA1', ['國小']),
  ra('ra13b', 'i13a', 'SCHOOL_ADMIN', 'sA1', ['國小']),
  rc('ra13c', 'i13b', 'TEACHER', 'sA2', ['國中']),
]

const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊']
const GIVEN = ['小明', '小華', '小美', '小安', '小宇', '小晴', '小恩', '小翔']
const CATEGORIES = ['智能障礙', '自閉症', '學習障礙', '聽覺障礙', '肢體障礙', '情緒行為障礙', '資賦優異']
const GRADES: Record<Stage, string[]> = {
  學前: ['大班'], 國小: ['一年級', '三年級', '五年級'], 國中: ['七年級', '八年級', '九年級'], 高中職: ['十年級', '十一年級'], 大專: ['一年級'],
}

function buildStudents(): Student[] {
  const out: Student[] = []
  let n = 0
  // 只為示範帳號所在的學校產生合成學生
  for (const s of Object.values(DEMO_SCHOOL_IDS).map((id) => SCOPES.find((x) => x.id === id)!)) {
    const stage = s.stages![0]
    for (let k = 0; k < 4; k++, n++) {
      out.push({
        id: `st${String(n + 1).padStart(3, '0')}`,
        name: SURNAMES[n % SURNAMES.length] + GIVEN[(n * 3) % GIVEN.length],
        schoolId: s.id,
        stage,
        grade: GRADES[stage][k % GRADES[stage].length],
        category: CATEGORIES[(n * 2) % CATEGORIES.length],
      })
    }
  }
  return out
}

export const STUDENTS: Student[] = buildStudents()

/** 教師 ra06 只負責光明國小的前兩位學生 */
export const RESPONSIBILITIES: Responsibility[] = STUDENTS.filter((s) => s.schoolId === 'sA1')
  .slice(0, 2)
  .map((s) => ({ assignmentId: 'ra06', studentId: s.id }))

/** 示範帳號：除 a11、a12 兩位新進人員外，其餘都已有「已驗證」的合成身分證與已驗證電子郵件 */
function seedAccount(a: Account, idx: number): Account {
  if (a.id === 'a11' || a.id === 'a12') return { ...a, idStatus: 'none', contactVerified: {} }
  const id = makeTestId('Z', 1, String(1000100 + idx))
  return { ...a, idHash: idHash(id), idMasked: maskId(id), idStatus: 'verified', contactVerified: { email: true } }
}

export function createRbacData(): RbacData {
  return {
    scopes: SCOPES.map(cloneScope),
    areas: AREAS.map((a) => ({ ...a })),
    // 角色範本可被署管理員修改：每份資料各自複製，避免改到常數
    roles: ROLES.map((r) => ({ ...r, grants: { ...r.grants } })),
    accounts: ACCOUNTS.map(seedAccount),
    identities: IDENTITIES.map((i) => ({ ...i })),
    assignments: ASSIGNMENTS.map((a) => ({ ...a, stages: [...a.stages] })),
    students: STUDENTS.map((s) => ({ ...s })),
    responsibilities: RESPONSIBILITIES,
    profileSettings: { ...DEFAULT_PROFILE_SETTINGS, contactFields: [...DEFAULT_PROFILE_SETTINGS.contactFields] },
    ssoGuids: { a11: guidOf(DEMO_ID_A11) },
    schoolImports: [{ id: 1, at: '2025-08-01', by: '系統初始化', year: SEED_YEAR, levels: [...new Set(SEED.rows.flatMap((r) => r[9].split(',')))] as SchoolLevel[], files: ['教育部統計處 114 學年度各級學校名錄'], summary: { new: SEED.rows.length } }],
    ssoProfiles: { a14: { schoolIds: ['sA1'], jobTitle: '特教教師' }, a15: { schoolIds: ['sA3'], jobTitle: '特教教師' } },
  }
}
