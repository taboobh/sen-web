export type ScopeType = 'ROOT' | 'CITY' | 'DISTRICT' | 'SCHOOL'
export type Stage = '學前' | '國小' | '國中' | '高中職' | '大專'

export interface ScopeNode {
  id: string
  parentId: string | null
  type: ScopeType
  name: string
  /** 祖先路徑，例如 /nea/cityA/cityA-d1；用來判斷「在不在某節點之下」 */
  path: string
  /** 學校的教育階段 */
  stages?: Stage[]
  /** 學校所在的行政區／鄉鎮；學校屬於哪個分區由此決定 */
  areaId?: string
}

export interface Role {
  code: string
  name: string
  /** 可指派的最高層級（含以下）：學校管理員只能指派在 SCHOOL */
  maxScope: ScopeType
  /** 需要「與學生有責任關係」才可操作學生資料 */
  relationLimited?: boolean
  /** 模組 id → 動作字母。C 新增 R 查詢 U 修改 D 刪除 A 審核 E 匯出 */
  grants: Record<string, string>
}

export interface Account {
  id: string
  /** 登入帳號：英文字母、數字、_、-，且以英文字母開頭 */
  username: string
  /** 使用者姓名（顯示用，不是登入帳號） */
  name: string
  email: string
  status: 'active' | 'locked' | 'disabled'
  note?: string
}

export interface Identity {
  id: string
  accountId: string
  orgScopeId: string
  jobTitle: string
}

export interface RoleAssignment {
  id: string
  identityId: string
  roleCode: string
  scopeId: string
  stages: Stage[]
  effectiveFrom: string
  effectiveTo: string
  status: 'active' | 'revoked'
}

export interface Student {
  id: string
  name: string
  schoolId: string
  stage: Stage
  grade: string
  category: string
}

export interface Responsibility {
  assignmentId: string
  studentId: string
}

/** 行政區／鄉鎮：多個行政區或鄉鎮組成一個「分區」 */
export interface AdminArea {
  id: string
  name: string
  cityId: string
  districtId: string
}

export interface RbacData {
  scopes: ScopeNode[]
  areas: AdminArea[]
  roles: Role[]
  accounts: Account[]
  identities: Identity[]
  assignments: RoleAssignment[]
  students: Student[]
  responsibilities: Responsibility[]
}

export interface MenuItem { id: string; title: string }
export interface MenuGroup { title: string; items: MenuItem[] }
export interface ModuleDef { id: string; name: string; desc: string; menu: MenuGroup[] }

export type Action = 'create' | 'read' | 'update' | 'delete' | 'approve' | 'export'
export const ACTION_LETTER: Record<string, Action> = {
  C: 'create', R: 'read', U: 'update', D: 'delete', A: 'approve', E: 'export',
}
export const ACTION_LABEL: Record<Action, string> = {
  create: '新增', read: '查詢', update: '修改', delete: '刪除', approve: '審核', export: '匯出',
}

export type ReasonCode =
  | 'OK'
  | 'ACCOUNT_INACTIVE'
  | 'NO_ASSIGNMENT'
  | 'ASSIGNMENT_EXPIRED'
  | 'NO_PERMISSION'
  | 'OUT_OF_SCOPE'
  | 'STAGE_MISMATCH'
  | 'NO_RELATION'
  | 'ROLE_NOT_DELEGABLE'

export interface Decision { allowed: boolean; reason: ReasonCode }

export interface AuthTarget {
  scopeId?: string
  stage?: Stage
  studentId?: string
}

/** 後端回給前端的「我的權限」 */
export interface MePermissions {
  account: { id: string; name: string }
  identities: { id: string; label: string; usable: boolean; reason?: ReasonCode }[]
  active: {
    identityId: string
    assignmentId: string
    role: { code: string; name: string }
    scope: { type: ScopeType; id: string; name: string }
    stages: Stage[]
    expiresAt: string
    relationLimited: boolean
  }
  permissions: string[]
}

export interface AuditEntry {
  id: number
  at: string
  accountName: string
  roleName: string
  permission: string
  target: string
  decision: 'ALLOW' | 'DENY'
  reason: ReasonCode
  /** 操作者當時的資料範圍；稽核紀錄依此限制可瀏覽範圍 */
  scopeId?: string
}
