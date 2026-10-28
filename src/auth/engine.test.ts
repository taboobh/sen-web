import { describe, expect, it } from 'vitest'
import { createRbacData } from '../mock/data'
import { canEditRoles, diffRole, normalizeGrants, validateRoleEdit, type RoleEdit, assignableScopes, assignmentDenial, authorize, buildMePermissions, delegableRoles, inSessionScope, resolveSession, validateAccounts, validateAssignment, validateDistrictAreas, validateUsername } from './engine'

const NOW = '2026-10-28'
const data = createRbacData()
const S = (accountId: string, identityId: string) => {
  const r = resolveSession(data, accountId, identityId, NOW)
  if ('reason' in r) throw new Error(r.reason)
  return r.session
}

describe('授權引擎', () => {
  it('署管理員可查詢任何學校的學生', () => {
    const d = authorize(data, S('a01', 'i01'), 'students:read', { scopeId: 'sB2' })
    expect(d.allowed).toBe(true)
  })

  it('縣市承辦只能看本縣市，其他縣市 OUT_OF_SCOPE', () => {
    const s = S('a03', 'i03')
    expect(authorize(data, s, 'students:read', { scopeId: 'sA3' }).allowed).toBe(true)
    expect(authorize(data, s, 'students:read', { scopeId: 'sB1' })).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' })
  })

  it('學校管理員沒有刪除權限；有權限也不能越過本校', () => {
    const s = S('a05', 'i05a')
    expect(authorize(data, s, 'students:delete', { scopeId: 'sA1' })).toEqual({ allowed: false, reason: 'NO_PERMISSION' })
    expect(authorize(data, s, 'students:read', { scopeId: 'sA4' })).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' })
    expect(authorize(data, s, 'students:read', { scopeId: 'sA1' }).allowed).toBe(true)
  })

  it('教師只能碰有責任關係的學生', () => {
    const s = S('a06', 'i06')
    const mine = data.students.filter((x) => x.schoolId === 'sA1')
    expect(authorize(data, s, 'students:read', { scopeId: 'sA1', studentId: mine[0].id }).allowed).toBe(true)
    expect(authorize(data, s, 'students:read', { scopeId: 'sA1', studentId: mine[3].id }))
      .toEqual({ allowed: false, reason: 'NO_RELATION' })
  })

  it('高中職鑑定中心受教育階段限制', () => {
    const s = S('a02', 'i02')
    expect(authorize(data, s, 'identify:approve', { scopeId: 'sA3', stage: '高中職' }).allowed).toBe(true)
    expect(authorize(data, s, 'identify:approve', { scopeId: 'sA1', stage: '國小' }))
      .toEqual({ allowed: false, reason: 'STAGE_MISMATCH' })
  })

  it('到期的指派與鎖定的帳號不能建立工作階段', () => {
    expect(resolveSession(data, 'a09', 'i09', NOW)).toEqual({ reason: 'ASSIGNMENT_EXPIRED' })
    expect(resolveSession(data, 'a10', 'i10', NOW)).toEqual({ reason: 'ACCOUNT_INACTIVE' })
  })

  it('多身分帳號可列出身分，各自使用不同角色', () => {
    const me = buildMePermissions(data, 'a05', 'i05b', NOW)
    if ('reason' in me) throw new Error(me.reason)
    expect(me.identities).toHaveLength(2)
    expect(me.active.role.code).toBe('TOUR_TEACHER')
    expect(me.permissions).toContain('tour:create')
    expect(me.permissions).not.toContain('students:read')
  })

  it('角色不可指派到比其最高層級更高的節點', () => {
    const bad = { ...data.assignments[0], id: 'x', roleCode: 'SCHOOL_ADMIN', scopeId: 'nea' }
    expect(validateAssignment(data, bad)).toMatch(/最高只能指派/)
    expect(data.assignments.every((a) => validateAssignment(data, a) === null)).toBe(true)
  })

  it('分區由多個行政區／鄉鎮組成，且每個行政區只屬於一個分區', () => {
    expect(validateDistrictAreas(data)).toEqual([])
    const multi = data.areas.filter((a) => a.districtId === 'cityA-d1')
    expect(multi.length).toBeGreaterThan(1)
    const broken = { ...data, areas: data.areas.map((a) => (a.id === 'arA1' ? { ...a, districtId: 'cityB-d1' } : a)) }
    expect(validateDistrictAreas(broken).length).toBeGreaterThan(0)
  })

  it('登入帳號：英文字母、數字、_、-，且以英文字母開頭', () => {
    for (const ok of ['abc', 'a1', 'Sa1_admin', 'a-b_c9']) expect(validateUsername(ok)).toBeNull()
    for (const bad of ['', '1abc', '_abc', '-abc', '王署管', 'ab c', 'ab.c', 'ab@c']) expect(validateUsername(bad)).not.toBeNull()
    expect(validateAccounts(data)).toEqual([])
    const dup = { ...data, accounts: [...data.accounts, { ...data.accounts[0], id: 'zz', username: data.accounts[0].username.toUpperCase() }] }
    expect(validateAccounts(dup).length).toBeGreaterThan(0)
  })

  it('學校管理員只能瀏覽本校使用者，且只能指派學校層級角色', () => {
    const s = S('a05', 'i05a')
    expect(s.role.name).toBe('學校管理員')
    expect(inSessionScope(data, s, 'sA1')).toBe(true)
    expect(inSessionScope(data, s, 'sA4')).toBe(false)
    expect(inSessionScope(data, s, 'cityA')).toBe(false)
    const mine = data.identities.filter((i) => inSessionScope(data, s, i.orgScopeId)).map((i) => i.accountId)
    expect(mine).toEqual(expect.arrayContaining(['a05', 'a06', 'a07', 'a11']))
    expect(mine).not.toContain('a09')
    expect(mine).not.toContain('a10')
    expect(mine).not.toContain('a03')
    const codes = delegableRoles(data, s).map((r) => r.code).sort()
    expect(codes).toEqual(['AIDE', 'TEACHER'])  // 學校管理員不能指派學校管理員
    expect(authorize(data, s, 'admin:update', { scopeId: 'sA1' }).allowed).toBe(true)
    expect(authorize(data, s, 'admin:update', { scopeId: 'sA4' })).toEqual({ allowed: false, reason: 'OUT_OF_SCOPE' })
  })

  it('署管理員可指派所有角色；縣市承辦層級角色不含署級', () => {
    expect(delegableRoles(data, S('a01', 'i01')).length).toBe(data.roles.length)
    expect(delegableRoles(data, S('a03', 'i03')).map((r) => r.code)).not.toContain('NEA_ADMIN')
  })

  it('縣市承辦登入後有指派角色功能：可指派縣市內角色（含學校管理員），不含署級', () => {
    const s = S('a03', 'i03')
    expect(authorize(data, s, 'admin:update', { scopeId: 'cityA' }).allowed).toBe(true)
    const codes = delegableRoles(data, s).map((r) => r.code)
    expect(codes).toEqual(expect.arrayContaining(['CITY_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']))
    expect(codes).not.toContain('NEA_ADMIN')
    expect(assignableScopes(data, s, 'SCHOOL_ADMIN').length).toBeGreaterThan(0)
  })
})

describe('指派角色規則', () => {
  it('署轄學校的學校管理員只有署管理員能指派；其他學校只有縣市管理員能指派', () => {
    const nea = S('a01', 'i01'), city = S('a03', 'i03'), school = S('a05', 'i05a')
    expect(assignableScopes(data, nea, 'SCHOOL_ADMIN').map((x) => x.id)).toEqual(['sN1'])
    expect(assignableScopes(data, city, 'SCHOOL_ADMIN').map((x) => x.id).sort()).toEqual(['sA1', 'sA2', 'sA3', 'sA4'])
    expect(assignmentDenial(data, nea, 'SCHOOL_ADMIN', 'sA1')).toBe('SCHOOL_ADMIN_RULE')
    expect(assignmentDenial(data, city, 'SCHOOL_ADMIN', 'sN1')).toBe('SCHOOL_ADMIN_RULE')
    expect(assignmentDenial(data, school, 'SCHOOL_ADMIN', 'sA1')).toBe('SCHOOL_ADMIN_RULE')
    expect(assignmentDenial(data, city, 'SCHOOL_ADMIN', 'sA1')).toBeNull()
  })

  it('資料範圍隨角色連動：縣市承辦指派教師只能到學校層級', () => {
    const city = S('a03', 'i03')
    expect(assignableScopes(data, city, 'TEACHER').every((x) => x.type === 'SCHOOL')).toBe(true)
    expect(assignableScopes(data, city, 'DISTRICT_ADMIN').map((x) => x.type)).toEqual(expect.arrayContaining(['DISTRICT']))
  })

  it('兼任／借調必須有有效期間；本職無期間且長期有效', () => {
    const base = data.assignments.find((a) => a.id === 'ra06')!
    expect(base.concurrent).toBe(false)
    expect(validateAssignment(data, { ...base, concurrent: true, effectiveFrom: null, effectiveTo: null })).toMatch(/有效期間/)
    expect(validateAssignment(data, { ...base, concurrent: true, effectiveFrom: '2026-08-01', effectiveTo: '2027-07-31' })).toBeNull()
    expect(resolveSession(data, 'a06', 'i06', '2099-01-01')).toHaveProperty('session')
  })
})

describe('角色與權限設定（修改角色範本）', () => {
  const MODS = ['students', 'base', 'identify', 'aide', 'pro', 'tour', 'transport', 'access', 'material', 'grant', 'report', 'news', 'admin']
  const d = createRbacData()
  const R = (accountId: string, identityId: string) => {
    const r = resolveSession(d, accountId, identityId, NOW)
    if ('reason' in r) throw new Error(r.reason)
    return r.session
  }
  const edit = (code: string, patch: Partial<RoleEdit> = {}): RoleEdit => {
    const role = d.roles.find((r) => r.code === code)!
    return { name: role.name, maxScope: role.maxScope, relationLimited: !!role.relationLimited, grants: { ...role.grants }, ...patch }
  }

  it('只有全國層的署管理員可以修改；縣市、學校管理員只能瀏覽', () => {
    expect(canEditRoles(d, R('a01', 'i01'))).toBe(true)
    expect(canEditRoles(d, R('a03', 'i03'))).toBe(false)
    expect(canEditRoles(d, R('a05', 'i05a'))).toBe(false)
    expect(canEditRoles(d, R('a02', 'i02'))).toBe(false)
  })

  it('署管理員不能拿掉自己「帳號與權限」的查詢／修改，也不能降級', () => {
    expect(validateRoleEdit(d, 'NEA_ADMIN', edit('NEA_ADMIN', { grants: { ...d.roles[0].grants, admin: 'CR' } }), MODS)).toMatch(/保留/)
    expect(validateRoleEdit(d, 'NEA_ADMIN', edit('NEA_ADMIN', { maxScope: 'CITY' }), MODS)).toMatch(/ROOT/)
  })

  it('既有指派高於新的最高層級時不可儲存；錯誤動作字母、重複名稱會被擋', () => {
    expect(validateRoleEdit(d, 'CITY_ADMIN', edit('CITY_ADMIN', { maxScope: 'SCHOOL' }), MODS)).toMatch(/指派高於/)
    expect(validateRoleEdit(d, 'AIDE', edit('AIDE', { grants: { aide: 'CRX' } }), MODS)).toMatch(/動作不正確/)
    expect(validateRoleEdit(d, 'AIDE', edit('AIDE', { name: '特教教師' }), MODS)).toMatch(/已被使用/)
    expect(validateRoleEdit(d, 'AIDE', edit('AIDE', { grants: { nope: 'R' } }), MODS)).toMatch(/不存在/)
  })

  it('正常修改通過；字母自動排序去重；差異可寫入稽核', () => {
    const e = edit('AIDE', { grants: { aide: 'URCU', students: 'R' } })
    expect(validateRoleEdit(d, 'AIDE', e, MODS)).toBeNull()
    expect(normalizeGrants(e.grants)).toEqual({ aide: 'CRU', students: 'R' })
    expect(diffRole(d.roles.find((r) => r.code === 'AIDE')!, e)).toEqual(['identify R→—', 'news R→—', 'admin C→—', 'students —→R'])
  })

  it('每份資料各自複製角色，修改不影響其他資料', () => {
    const other = createRbacData()
    other.roles[0].grants.news = 'R'
    expect(d.roles[0].grants.news).toBe('CRUDA')
  })
})
