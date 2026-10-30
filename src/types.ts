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
  /** 署轄學校（國教署直接管轄）：學校管理員由署端管理員指派；其餘學校由縣市管理員指派 */
  ntaDirect?: boolean
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
  /** 手機、市話：與電子郵件三選一以上（由國教署管理員設定最少項數） */
  mobile?: string
  phone?: string
  /** 已通過驗證碼驗證的聯絡方式（變更內容後會重置） */
  contactVerified?: Partial<Record<ContactField, boolean>>
  /** 身分證／居留證：只存雜湊（正式版為 HMAC＋金鑰）與遮罩顯示，不保存明文 */
  idHash?: string
  idMasked?: string
  /** none 未填；unverified 自填、待核對；verified 已驗證（教育雲端 guid 比對一致，或管理員核准） */
  idStatus?: IdStatus
  /** 與其他帳號身分證相同時記錄對方帳號（只給管理員處理，不告知使用者） */
  idConflictWith?: string
  status: 'active' | 'locked' | 'disabled'
  note?: string
}

export type ContactField = 'email' | 'mobile' | 'phone'
export type IdStatus = 'none' | 'unverified' | 'verified'
export type LoginMethod = 'moe_oidc' | 'local'

/** 個人資料規則：國教署管理員可在「帳號資料欄位設定」調整 */
export interface ProfileSettings {
  /** 身分證／居留證號是否必填 */
  idRequired: boolean
  /** 可填的聯絡方式 */
  contactFields: ContactField[]
  /** 聯絡方式至少要有幾項有效（0＝不要求） */
  contactMin: number
  /** 聯絡方式是否須通過驗證碼驗證（市話無法驗證） */
  verifyContact: boolean
  /** 是否驗證身分證：檢查碼＋教育雲端 guid 比對＋自填者須管理員核對。關閉時（訓練站虛擬資料）寬鬆格式即通過 */
  verifyIdNumber: boolean
}

export interface Identity {
  id: string
  accountId: string
  orgScopeId: string
  jobTitle: string
  /** 任職狀態；未填＝在職。離任時該身分的角色指派已全數清空 */
  status?: 'active' | 'ended'
  endReason?: EndReason
  endedAt?: string
}

/** 離任原因：調職、退休、離職，或教育雲端回傳的學校代碼與系統記錄不同（換校） */
export type EndReason = 'transfer' | 'retire' | 'resign' | 'school_changed'
export const END_REASON_TEXT: Record<EndReason, string> = {
  transfer: '調職', retire: '退休', resign: '離職', school_changed: '教育雲端學校代碼異動',
}

export interface RoleAssignment {
  id: string
  identityId: string
  roleCode: string
  scopeId: string
  stages: Stage[]
  /** 借調（外部單位）：才需要有效期間；本職機構內為長期有效，期間為 null */
  concurrent: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
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
  profileSettings: ProfileSettings
  /** 模擬教育雲端 IdP 回傳的 guid（帳號 id → guid）；沒有項目＝該帳號未取得 guid */
  ssoGuids: Record<string, string>
  /** 模擬教育雲端回傳的任職學校代碼（titles[].schoolid）與職稱；教育雲端登入時用來同步任職機構 */
  ssoProfiles: Record<string, { schoolIds: string[]; jobTitle?: string }>
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
  | 'SCHOOL_ADMIN_RULE'
  | 'PROFILE_INCOMPLETE'
  | 'ID_PENDING'

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
    expiresAt: string | null
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
