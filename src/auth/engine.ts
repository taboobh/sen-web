import type {
  AuthTarget, Decision, EndReason, MePermissions, RbacData, ReasonCode, Role, RoleAssignment, ScopeNode, ScopeType,
} from '../types'
import { ACTION_LETTER } from '../types'

/**
 * 授權引擎（純函式，前後端共用規則）。
 * 有效權限 = 角色的「模組:動作」 ∩ 資料範圍 ∩ 教育階段 ∩ 有效期間 ∩ 學生責任關係。預設拒絕。
 * 前端只用它來「顯示」；真正的判斷必須在後端 API 執行同一套規則。
 */

const RANK: Record<ScopeType, number> = { ROOT: 0, CITY: 1, DISTRICT: 2, SCHOOL: 3 }

export function expandPermissions(role: Role): string[] {
  const out: string[] = []
  for (const [moduleId, letters] of Object.entries(role.grants)) {
    for (const ch of letters) out.push(`${moduleId}:${ACTION_LETTER[ch]}`)
  }
  return out
}

export function scopeContains(scopes: ScopeNode[], ancestorId: string, targetId: string): boolean {
  const a = scopes.find((s) => s.id === ancestorId)
  const t = scopes.find((s) => s.id === targetId)
  if (!a || !t) return false
  return t.path === a.path || t.path.startsWith(a.path + '/')
}

/** 角色範本綁定「可指派的最高層級」：學校管理員不能被指派到全國 */
export function validateAssignment(data: RbacData, a: RoleAssignment): string | null {
  const role = data.roles.find((r) => r.code === a.roleCode)
  const scope = data.scopes.find((s) => s.id === a.scopeId)
  if (!role || !scope) return '角色或範圍不存在'
  if (a.concurrent && (!a.effectiveFrom || !a.effectiveTo)) return '借調必須填寫有效期間'
  if (RANK[scope.type] < RANK[role.maxScope]) {
    return `「${role.name}」最高只能指派到 ${role.maxScope} 層，不可指派到 ${scope.type}`
  }
  return null
}

/**
 * 本職規則：每個帳號只有一個本職機構（主要角色＋同機構的其他角色，長期有效）；
 * 在外部單位（非本職機構）的角色一律為借調（須有效期間），本職機構內不需借調。
 */
export function primaryConflict(data: RbacData, accountId: string, draft: RoleAssignment): string | null {
  const ids = data.identities.filter((i) => i.accountId === accountId)
  const idSet = new Set(ids.map((i) => i.id))
  const orgOf = (identityId: string) => ids.find((i) => i.id === identityId)?.orgScopeId
  const homeOrgs = new Set(data.assignments.filter((a) => idSet.has(a.identityId) && !a.concurrent && a.status === 'active' && a.id !== draft.id).map((a) => orgOf(a.identityId)))
  const org = orgOf(draft.identityId)
  if (homeOrgs.size === 0) return null
  if (draft.concurrent) return homeOrgs.has(org) ? '本職機構內的角色不需借調（長期有效）' : null
  return homeOrgs.has(org) ? null : '此帳號的本職只有一個機構；在其他（外部）單位的角色請指派為借調並填寫有效期間'
}

/** 分區組成檢查：行政區／鄉鎮必須屬於同縣市的某個分區；學校所在行政區須屬於其上層分區 */
export function validateDistrictAreas(data: RbacData): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const a of data.areas) {
    if (seen.has(a.id)) problems.push(`${a.name} 重複`)
    seen.add(a.id)
    const d = data.scopes.find((s) => s.id === a.districtId)
    if (!d || d.type !== 'DISTRICT') problems.push(`${a.name} 未歸屬任何分區`)
    else if (d.parentId !== a.cityId) problems.push(`${a.name} 所屬分區不在同一縣市`)
  }
  for (const d of data.scopes.filter((s) => s.type === 'DISTRICT')) {
    if (!data.areas.some((a) => a.districtId === d.id)) problems.push(`${d.name} 沒有任何行政區／鄉鎮`)
  }
  for (const s of data.scopes.filter((x) => x.type === 'SCHOOL' && !x.ntaDirect)) {
    const a = data.areas.find((x) => x.id === s.areaId)
    if (!a) problems.push(`${s.name} 未指定行政區／鄉鎮`)
    else if (a.districtId !== s.parentId) problems.push(`${s.name} 的行政區不屬於其上層分區`)
  }
  return problems
}

/** 登入帳號格式：英文字母、數字、_、-；開頭必須是英文字母 */
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
export function validateUsername(u: string): string | null {
  if (!u) return '請輸入帳號'
  if (!/^[A-Za-z]/.test(u)) return '帳號必須以英文字母開頭'
  if (!USERNAME_RE.test(u)) return '帳號只能使用英文字母、數字、_、-'
  return null
}

/** 帳號資料檢查：格式正確、不重複（不分大小寫） */
export function validateAccounts(data: RbacData): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const a of data.accounts) {
    const bad = validateUsername(a.username)
    if (bad) problems.push(`${a.name}（${a.username || '空白'}）：${bad}`)
    const k = a.username.toLowerCase()
    if (seen.has(k)) problems.push(`${a.name}：帳號 ${a.username} 重複`)
    seen.add(k)
  }
  return problems
}

/**
 * 委派規則（學校管理員只能管本校）：
 * 1. 可瀏覽的使用者＝所屬單位在自己「資料範圍」之內者；
 * 2. 可指派的角色＝層級不高於自己的角色（角色最高層級 ≥ 自己的指派層級），例如學校管理員只能指派學校層級角色；
 * 3. 指派的資料範圍必須在自己的資料範圍之內。
 */
export function inSessionScope(data: RbacData, s: ResolvedSession, scopeId: string): boolean {
  return scopeContains(data.scopes, s.assignment.scopeId, scopeId)
}

function delegableByLevel(data: RbacData, s: ResolvedSession): Role[] {
  const mine = data.scopes.find((x) => x.id === s.assignment.scopeId)
  if (!mine) return []
  return data.roles.filter((r) => RANK[r.maxScope] >= RANK[mine.type])
}

/**
 * 學校管理員的指派權責：署轄學校由署端管理員（NEA_ADMIN）指派；其餘學校由縣市管理員（CITY_ADMIN）指派，
 * 且該校須在其縣市之內。學校管理員不能再指派學校管理員。
 */
function schoolAdminAllowed(data: RbacData, s: ResolvedSession, school: ScopeNode): boolean {
  if (school.type !== 'SCHOOL') return false
  if (school.ntaDirect) return s.role.code === 'NEA_ADMIN'
  return s.role.code === 'CITY_ADMIN' && scopeContains(data.scopes, s.assignment.scopeId, school.id)
}

/** 指派畫面「資料範圍」選項：隨角色連動（層級不得高於角色最高層級、須在自己範圍內、學校管理員另有權責規則） */
export function assignableScopes(data: RbacData, s: ResolvedSession, roleCode: string): ScopeNode[] {
  const role = data.roles.find((r) => r.code === roleCode)
  if (!role || !delegableByLevel(data, s).some((r) => r.code === roleCode)) return []
  return data.scopes.filter((x) =>
    inSessionScope(data, s, x.id) && RANK[x.type] >= RANK[role.maxScope] &&
    (roleCode !== 'SCHOOL_ADMIN' || schoolAdminAllowed(data, s, x)))
}

/** 可指派的角色＝至少有一個可指派的資料範圍 */
export function delegableRoles(data: RbacData, s: ResolvedSession): Role[] {
  return delegableByLevel(data, s).filter((r) => assignableScopes(data, s, r.code).length > 0)
}

/** 指派的最終檢查（後端用）：回傳拒絕原因或 null */
export function assignmentDenial(data: RbacData, s: ResolvedSession, roleCode: string, scopeId: string): ReasonCode | null {
  if (!delegableByLevel(data, s).some((r) => r.code === roleCode)) return 'ROLE_NOT_DELEGABLE'
  if (roleCode === 'SCHOOL_ADMIN') {
    const sc = data.scopes.find((x) => x.id === scopeId)
    if (sc && sc.type === 'SCHOOL' && !schoolAdminAllowed(data, s, sc)) return 'SCHOOL_ADMIN_RULE'
  }
  return null
}

/**
 * 角色與權限設定：只有「在全國層（ROOT）被指派、且有帳號與權限模組修改權」的署管理員可修改角色範本。
 * 其他角色（含縣市、學校管理員）只能瀏覽。
 */
export function canEditRoles(data: RbacData, s: ResolvedSession): boolean {
  const scope = data.scopes.find((x) => x.id === s.assignment.scopeId)
  return s.role.code === 'NEA_ADMIN' && scope?.type === 'ROOT' && authorize(data, s, 'admin:update').allowed
}

export interface RoleEdit { name: string; maxScope: ScopeType; relationLimited: boolean; grants: Record<string, string> }
const ACTION_ORDER = 'CRUDAE'

/** 動作字母依 C R U D A E 排序並去除重複、空模組 */
export function normalizeGrants(grants: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [m, letters] of Object.entries(grants)) {
    const v = [...ACTION_ORDER].filter((c) => letters.includes(c)).join('')
    if (v) out[m] = v
  }
  return out
}

/** 修改角色範本的檢查（後端用）：回傳錯誤訊息或 null */
export function validateRoleEdit(data: RbacData, code: string, edit: RoleEdit, moduleIds: string[]): string | null {
  const role = data.roles.find((r) => r.code === code)
  if (!role) return '角色不存在'
  const name = (edit.name ?? '').trim()
  if (!name) return '請輸入角色名稱'
  if (data.roles.some((r) => r.code !== code && r.name === name)) return `角色名稱「${name}」已被使用`
  if (!(edit.maxScope in RANK)) return '最高層級不正確'
  for (const [m, letters] of Object.entries(edit.grants ?? {})) {
    if (!moduleIds.includes(m)) return `模組 ${m} 不存在`
    if ([...letters].some((c) => !ACTION_ORDER.includes(c))) return `模組 ${m} 的動作不正確（只能用 C R U D A E）`
  }
  const grants = normalizeGrants(edit.grants ?? {})
  // 防止鎖死：署管理員必須保留全國層級，以及「帳號與權限」的查詢與修改
  if (code === 'NEA_ADMIN') {
    if (edit.maxScope !== 'ROOT') return '署管理員的最高層級必須維持全國（ROOT）'
    if (!(grants.admin ?? '').includes('R') || !(grants.admin ?? '').includes('U')) return '署管理員必須保留「帳號與權限」的查詢與修改，否則將無人能再修改角色'
  }
  // 調高最低可指派層級前，既有指派不得因此失效
  const conflicts = data.assignments.filter((a) => {
    const sc = data.scopes.find((x) => x.id === a.scopeId)
    return a.roleCode === code && a.status === 'active' && sc && RANK[sc.type] < RANK[edit.maxScope]
  })
  if (conflicts.length) return `已有 ${conflicts.length} 筆「${role.name}」的指派高於新的最高層級，請先調整或撤銷這些指派`
  return null
}

/** 修改前後差異（稽核用） */
export function diffRole(before: Role, after: RoleEdit): string[] {
  const out: string[] = []
  if (before.name !== after.name.trim()) out.push(`名稱 ${before.name}→${after.name.trim()}`)
  if (before.maxScope !== after.maxScope) out.push(`最高層級 ${before.maxScope}→${after.maxScope}`)
  if (!!before.relationLimited !== !!after.relationLimited) out.push(`責任關係限制 ${before.relationLimited ? '是' : '否'}→${after.relationLimited ? '是' : '否'}`)
  const g = normalizeGrants(after.grants)
  for (const m of new Set([...Object.keys(before.grants), ...Object.keys(g)])) {
    const a = before.grants[m] ?? '', b = g[m] ?? ''
    if (a !== b) out.push(`${m} ${a || '—'}→${b || '—'}`)
  }
  return out
}

/**
 * 離任（調職、退休、離職，或教育雲端學校代碼異動）：清空該身分的所有角色指派，並標記為已離任。
 * 帳號本身與個人資料保留。回傳被清空的角色名稱，供稽核紀錄使用。
 */
export function endIdentity(data: RbacData, identityId: string, reason: EndReason, now: string): string[] {
  const identity = data.identities.find((i) => i.id === identityId)
  if (!identity || identity.status === 'ended') return []
  const mine = data.assignments.filter((a) => a.identityId === identityId)
  const names = mine.map((a) => data.roles.find((r) => r.code === a.roleCode)?.name ?? a.roleCode)
  data.assignments = data.assignments.filter((a) => a.identityId !== identityId)
  identity.status = 'ended'
  identity.endReason = reason
  identity.endedAt = now
  return names
}

export interface AffiliationChange {
  kind: 'ended' | 'created'
  identityId: string
  orgScopeId: string
  clearedRoles: string[]
}

/**
 * 教育雲端登入時同步任職機構（教育雲端一定帶學校代碼）：
 * 1. 首次登入的新使用者（還沒有該校的在職身分）→ 建立該校的身分，預設不指派角色；
 * 2. 系統記錄的在職學校不在教育雲端回傳的學校代碼內 → 清空原學校身分的角色並標記離任，新學校建立身分、無角色；
 * 3. 縣市、署等非學校的身分不受影響；學校代碼為空或不存在時不做任何變更。
 */
export function syncSsoAffiliation(data: RbacData, accountId: string, schoolIds: string[], now: string, jobTitle = '待確認'): AffiliationChange[] {
  const valid = schoolIds.filter((id) => data.scopes.some((s) => s.id === id && s.type === 'SCHOOL'))
  if (valid.length === 0) return []
  const out: AffiliationChange[] = []
  const isSchool = (orgId: string) => data.scopes.find((s) => s.id === orgId)?.type === 'SCHOOL'
  for (const i of data.identities.filter((x) => x.accountId === accountId && x.status !== 'ended' && isSchool(x.orgScopeId))) {
    if (valid.includes(i.orgScopeId)) continue
    out.push({ kind: 'ended', identityId: i.id, orgScopeId: i.orgScopeId, clearedRoles: endIdentity(data, i.id, 'school_changed', now) })
  }
  for (const sid of valid) {
    if (data.identities.some((x) => x.accountId === accountId && x.orgScopeId === sid && x.status !== 'ended')) continue
    const identity = { id: `i${String(data.identities.length + 1).padStart(2, '0')}s`, accountId, orgScopeId: sid, jobTitle }
    data.identities.push(identity)
    out.push({ kind: 'created', identityId: identity.id, orgScopeId: sid, clearedRoles: [] })
  }
  return out
}

export function isWithinPeriod(a: RoleAssignment, now: string): boolean {
  return a.status === 'active' && (!a.effectiveFrom || a.effectiveFrom <= now) && (!a.effectiveTo || now <= a.effectiveTo)
}

/** 身分目前可用的角色指派（第一筆有效者），沒有則回傳原因 */
export function pickAssignment(data: RbacData, identityId: string, now: string):
  { assignment: RoleAssignment } | { reason: ReasonCode } {
  const list = data.assignments.filter((a) => a.identityId === identityId)
  if (list.length === 0) return { reason: 'NO_ASSIGNMENT' }
  const ok = list.find((a) => isWithinPeriod(a, now))
  return ok ? { assignment: ok } : { reason: 'ASSIGNMENT_EXPIRED' }
}

export interface ResolvedSession {
  accountId: string
  accountName: string
  assignment: RoleAssignment
  role: Role
  permissions: Set<string>
}

export function resolveSession(data: RbacData, accountId: string, identityId: string, now: string):
  { session: ResolvedSession } | { reason: ReasonCode } {
  const account = data.accounts.find((x) => x.id === accountId)
  if (!account || account.status !== 'active') return { reason: 'ACCOUNT_INACTIVE' }
  const identity = data.identities.find((i) => i.id === identityId && i.accountId === accountId)
  if (!identity) return { reason: 'NO_ASSIGNMENT' }
  const picked = pickAssignment(data, identityId, now)
  if ('reason' in picked) return { reason: picked.reason }
  const role = data.roles.find((r) => r.code === picked.assignment.roleCode)!
  return {
    session: {
      accountId, accountName: account.name, assignment: picked.assignment, role,
      permissions: new Set(expandPermissions(role)),
    },
  }
}

export function authorize(data: RbacData, s: ResolvedSession, permission: string, target: AuthTarget = {}): Decision {
  const deny = (reason: ReasonCode): Decision => ({ allowed: false, reason })
  if (!s.permissions.has(permission)) return deny('NO_PERMISSION')
  if (target.scopeId && !scopeContains(data.scopes, s.assignment.scopeId, target.scopeId)) return deny('OUT_OF_SCOPE')
  if (target.stage && s.assignment.stages.length > 0 && !s.assignment.stages.includes(target.stage)) {
    return deny('STAGE_MISMATCH')
  }
  if (s.role.relationLimited && target.studentId) {
    const hit = data.responsibilities.some((r) => r.assignmentId === s.assignment.id && r.studentId === target.studentId)
    if (!hit) return deny('NO_RELATION')
  }
  return { allowed: true, reason: 'OK' }
}

export function buildMePermissions(data: RbacData, accountId: string, identityId: string, now: string): MePermissions | { reason: ReasonCode } {
  const r = resolveSession(data, accountId, identityId, now)
  if ('reason' in r) return r
  const { session } = r
  const scope = data.scopes.find((x) => x.id === session.assignment.scopeId)!
  const identities = data.identities.filter((i) => i.accountId === accountId).map((i) => {
    const org = data.scopes.find((x) => x.id === i.orgScopeId)?.name ?? ''
    const p = pickAssignment(data, i.id, now)
    return { id: i.id, label: `${org} ${i.jobTitle}`, usable: 'assignment' in p, reason: 'reason' in p ? p.reason : undefined }
  })
  return {
    account: { id: accountId, name: session.accountName },
    identities,
    active: {
      identityId,
      assignmentId: session.assignment.id,
      role: { code: session.role.code, name: session.role.name },
      scope: { type: scope.type, id: scope.id, name: scope.name },
      stages: session.assignment.stages,
      expiresAt: session.assignment.effectiveTo,
      relationLimited: !!session.role.relationLimited,
    },
    permissions: [...session.permissions],
  }
}

export const REASON_TEXT: Record<ReasonCode, string> = {
  OK: '允許',
  ACCOUNT_INACTIVE: '帳號已鎖定或停用',
  NO_ASSIGNMENT: '此身分沒有角色指派',
  ASSIGNMENT_EXPIRED: '角色指派已到期或已撤銷',
  NO_PERMISSION: '角色沒有此功能的此動作權限',
  OUT_OF_SCOPE: '目標資料不在指派的資料範圍內',
  STAGE_MISMATCH: '目標資料的教育階段不在指派範圍內',
  NO_RELATION: '與該學生沒有責任關係',
  ROLE_NOT_DELEGABLE: '此角色層級高於您的角色，不可由您指派',
  SCHOOL_ADMIN_RULE: '學校管理員：署轄學校由署端管理員指派，其餘學校由縣市管理員指派',
  PROFILE_INCOMPLETE: '個人資料未補齊（身分證或聯絡方式），請先到個人資料頁完成',
  ID_PENDING: '身分證已送出，等待管理員核對後才能使用',
}
