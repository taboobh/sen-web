import { describe, expect, it } from 'vitest'
import { ACCOUNTS, STUDENTS } from './data'

describe('虛擬學生資料', () => {
  const byGrade = new Map<string, typeof STUDENTS>()
  for (const s of STUDENTS) {
    const k = `${s.schoolId}／${s.stage}／${s.grade}`
    byGrade.set(k, [...(byGrade.get(k) ?? []), s])
  }

  it('每所學校每個年級約 50 名，男生比例 55%–60%', () => {
    expect(byGrade.size).toBeGreaterThan(0)
    for (const [k, list] of byGrade) {
      expect(list.length, k).toBeGreaterThanOrEqual(46)
      expect(list.length, k).toBeLessThanOrEqual(54)
      const male = list.filter((s) => s.gender === '男').length / list.length
      expect(male, k).toBeGreaterThanOrEqual(0.54)
      expect(male, k).toBeLessThanOrEqual(0.61)
    }
  })

  it('學生姓名、編號不重複，且不與帳號姓名相同', () => {
    expect(new Set(STUDENTS.map((s) => s.id)).size).toBe(STUDENTS.length)
    expect(new Set(STUDENTS.map((s) => s.name)).size).toBe(STUDENTS.length)
    const accountNames = new Set(ACCOUNTS.map((a) => a.name))
    expect(STUDENTS.some((s) => accountNames.has(s.name))).toBe(false)
    expect(new Set(ACCOUNTS.map((a) => a.name)).size).toBe(ACCOUNTS.length)
  })
})
