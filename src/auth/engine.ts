import type {
  AuthTarget, Decision, MePermissions, RbacData, ReasonCode, Role, RoleAssignment, ScopeNode, ScopeType,
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
  if (RANK[scope.type] < RANK[role.maxScope]) {
    return `「${role.name}」最高只能指派到 ${role.maxScope} 層，不可指派到 ${scope.type}`
  }
  return null
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
  for (const s of data.scopes.filter((x) => x.type === 'SCHOOL')) {
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

export function delegableRoles(data: RbacData, s: ResolvedSession): Role[] {
  const mine = data.scopes.find((x) => x.id === s.assignment.scopeId)
  if (!mine) return []
  return data.roles.filter((r) => RANK[r.maxScope] >= RANK[mine.type])
}

export function isWithinPeriod(a: RoleAssignment, now: string): boolean {
  return a.status === 'active' && a.effectiveFrom <= now && now <= a.effectiveTo
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
}
