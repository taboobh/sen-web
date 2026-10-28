import type {
  AdminArea, Account, Identity, RbacData, Responsibility, Role, RoleAssignment, ScopeNode, Stage, Student,
} from '../types'

/* 全部為合成資料：組織、學校、人名皆為虛構，不含任何真實帳號或個資。 */

const sc = (id: string, parentId: string | null, type: ScopeNode['type'], name: string, path: string, stages?: Stage[], areaId?: string): ScopeNode =>
  ({ id, parentId, type, name, path, stages, areaId })

export const SCOPES: ScopeNode[] = [
  sc('nea', null, 'ROOT', '國教署', '/nea'),
  sc('cityA', 'nea', 'CITY', '甲市教育局', '/nea/cityA'),
  sc('cityA-d1', 'cityA', 'DISTRICT', '甲市第一分區', '/nea/cityA/cityA-d1'),
  sc('cityA-d2', 'cityA', 'DISTRICT', '甲市第二分區', '/nea/cityA/cityA-d2'),
  sc('sA1', 'cityA-d1', 'SCHOOL', '甲市光明國小', '/nea/cityA/cityA-d1/sA1', ['國小'], 'arA1'),
  sc('sA2', 'cityA-d1', 'SCHOOL', '甲市和平國中', '/nea/cityA/cityA-d1/sA2', ['國中'], 'arA2'),
  sc('sA3', 'cityA-d2', 'SCHOOL', '甲市文華高職', '/nea/cityA/cityA-d2/sA3', ['高中職'], 'arA3'),
  sc('sA4', 'cityA-d2', 'SCHOOL', '甲市青山國小', '/nea/cityA/cityA-d2/sA4', ['國小'], 'arA4'),
  sc('cityB', 'nea', 'CITY', '乙縣教育處', '/nea/cityB'),
  sc('cityB-d1', 'cityB', 'DISTRICT', '乙縣第一分區', '/nea/cityB/cityB-d1'),
  sc('sB1', 'cityB-d1', 'SCHOOL', '乙縣海岸國小', '/nea/cityB/cityB-d1/sB1', ['國小'], 'arB1'),
  sc('sB2', 'cityB-d1', 'SCHOOL', '乙縣山林國中', '/nea/cityB/cityB-d1/sB2', ['國中'], 'arB2'),
  sc('cityC', 'nea', 'CITY', '丙市教育局', '/nea/cityC'),
  sc('cityC-d1', 'cityC', 'DISTRICT', '丙市第一分區', '/nea/cityC/cityC-d1'),
  sc('sC1', 'cityC-d1', 'SCHOOL', '丙市河畔國小', '/nea/cityC/cityC-d1/sC1', ['國小'], 'arC1'),
]

/** 分區 = 多個行政區／鄉鎮；同一縣市內，一個行政區／鄉鎮只能屬於一個分區 */
export const AREAS: AdminArea[] = [
  { id: 'arA1', name: '甲市東區', cityId: 'cityA', districtId: 'cityA-d1' },
  { id: 'arA2', name: '甲市北區', cityId: 'cityA', districtId: 'cityA-d1' },
  { id: 'arA3', name: '甲市南區', cityId: 'cityA', districtId: 'cityA-d2' },
  { id: 'arA4', name: '甲市西區', cityId: 'cityA', districtId: 'cityA-d2' },
  { id: 'arB1', name: '乙縣海岸鄉', cityId: 'cityB', districtId: 'cityB-d1' },
  { id: 'arB2', name: '乙縣山林鎮', cityId: 'cityB', districtId: 'cityB-d1' },
  { id: 'arC1', name: '丙市河畔區', cityId: 'cityC', districtId: 'cityC-d1' },
]

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
      transport: 'R', access: 'CRUAE', material: 'CRUAE', grant: 'CRUAE', report: 'RE', news: 'CRU', admin: 'RA',
    },
  },
  {
    code: 'DISTRICT_ADMIN', name: '分區管理員', maxScope: 'DISTRICT',
    grants: { students: 'R', base: 'RU', identify: 'R', pro: 'RA', report: 'R', news: 'R', admin: 'R' },
  },
  {
    code: 'SCHOOL_ADMIN', name: '學校學務', maxScope: 'SCHOOL',
    grants: {
      students: 'CRUE', base: 'CRU', identify: 'CRU', aide: 'CRU', pro: 'CR', tour: 'CR', transport: 'CRU',
      material: 'CRU', grant: 'CR', report: 'R', news: 'R', admin: 'CR',
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

export const ACCOUNTS: Account[] = [
  { id: 'a01', name: '王署管', email: 'a01@example.test', status: 'active' },
  { id: 'a02', name: '林鑑定', email: 'a02@example.test', status: 'active' },
  { id: 'a03', name: '陳局處', email: 'a03@example.test', status: 'active' },
  { id: 'a04', name: '黃分區', email: 'a04@example.test', status: 'active' },
  { id: 'a05', name: '張組長', email: 'a05@example.test', status: 'active', note: '多身分：學校學務＋巡迴輔導教師' },
  { id: 'a06', name: '李老師', email: 'a06@example.test', status: 'active' },
  { id: 'a07', name: '吳助理', email: 'a07@example.test', status: 'active' },
  { id: 'a08', name: '示範出版社', email: 'a08@example.test', status: 'active' },
  { id: 'a09', name: '周學務', email: 'a09@example.test', status: 'active', note: '角色指派已到期' },
  { id: 'a10', name: '鄭停用', email: 'a10@example.test', status: 'locked', note: '帳號已鎖定' },
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
]

const FROM = '2026-08-01'
const TO = '2027-07-31'
const ra = (id: string, identityId: string, roleCode: string, scopeId: string, stages: Stage[] = [], to = TO): RoleAssignment =>
  ({ id, identityId, roleCode, scopeId, stages, effectiveFrom: FROM, effectiveTo: to, status: 'active' })

export const ASSIGNMENTS: RoleAssignment[] = [
  ra('ra01', 'i01', 'NEA_ADMIN', 'nea'),
  ra('ra02', 'i02', 'IDENT_CENTER', 'nea', ['高中職']),
  ra('ra03', 'i03', 'CITY_ADMIN', 'cityA'),
  ra('ra04', 'i04', 'DISTRICT_ADMIN', 'cityA-d1'),
  ra('ra05a', 'i05a', 'SCHOOL_ADMIN', 'sA1', ['國小']),
  ra('ra05b', 'i05b', 'TOUR_TEACHER', 'cityA'),
  ra('ra06', 'i06', 'TEACHER', 'sA1', ['國小']),
  ra('ra07', 'i07', 'AIDE', 'sA1', ['國小']),
  ra('ra08', 'i08', 'PUBLISHER', 'nea'),
  ra('ra09', 'i09', 'SCHOOL_ADMIN', 'sA2', ['國中'], '2026-06-30'),
  ra('ra10', 'i10', 'SCHOOL_ADMIN', 'sB1', ['國小']),
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
  for (const s of SCOPES.filter((x) => x.type === 'SCHOOL')) {
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

export function createRbacData(): RbacData {
  return {
    scopes: SCOPES,
    areas: AREAS,
    roles: ROLES,
    accounts: ACCOUNTS,
    identities: IDENTITIES,
    assignments: ASSIGNMENTS,
    students: STUDENTS.map((s) => ({ ...s })),
    responsibilities: RESPONSIBILITIES,
  }
}
