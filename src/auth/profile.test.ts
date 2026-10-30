import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRbacData } from '../mock/data'
import { sha256Hex } from './hash'
import { DEFAULT_PROFILE_SETTINGS, guidOf, idHash, makeTestId, maskId, profileGate, validateContact, validateNationalId, validateProfileSettings } from './profile'
import type { Account, ProfileSettings } from '../types'

const S = (o: Partial<ProfileSettings> = {}): ProfileSettings => ({ ...DEFAULT_PROFILE_SETTINGS, contactFields: [...DEFAULT_PROFILE_SETTINGS.contactFields], ...o })
const acc = (o: Partial<Account> = {}): Account => ({ id: 'x', username: 'x', name: 'x', email: '', status: 'active', ...o })

describe('sha256', () => {
  it('與 Node crypto 結果一致（含中文與長字串）', () => {
    for (const s of ['', 'abc', 'A123456789', '中文測試', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)])
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'))
  })
  it('guid＝身分證大寫字串 SHA256 大寫十六進位', () => {
    expect(guidOf('a123456789')).toBe(createHash('sha256').update('A123456789').digest('hex').toUpperCase())
  })
  it('本系統雜湊與 guid 不同（不直接保存可對照的單純雜湊）', () => {
    expect(idHash('A123456789')).not.toBe(guidOf('A123456789').toLowerCase())
  })
})

describe('身分證／居留證格式', () => {
  it('標準範例通過、檢查碼錯誤被擋', () => {
    expect(validateNationalId('A123456789')).toBeNull()
    expect(validateNationalId(' a123456789 ')).toBeNull()
    expect(validateNationalId('A123456788')).toMatch(/檢查碼/)
  })
  it('新式居留證（8／9）依檢查碼；舊式兩碼英文只看格式', () => {
    expect(validateNationalId(makeTestId('B', 1, '1234567'))).toBeNull()
    const arc = makeTestId('C', 8, '7654321')
    expect(validateNationalId(arc)).toBeNull()
    expect(validateNationalId(arc.slice(0, 9) + String((Number(arc[9]) + 1) % 10))).toMatch(/檢查碼/)
    expect(validateNationalId(makeTestId('D', 9, '1111111'))).toBeNull()
    expect(validateNationalId('AB12345678')).toBeNull()
  })
  it('格式錯誤', () => {
    expect(validateNationalId('')).toMatch(/請輸入/)
    expect(validateNationalId('12345')).toMatch(/格式/)
    expect(validateNationalId('A323456789')).toMatch(/格式/)
  })
  it('寬鬆模式（訓練站虛擬資料）只看格式，不看檢查碼', () => {
    expect(validateNationalId('A123456788', false)).toBeNull()
    expect(validateNationalId('A12345', false)).toMatch(/格式/)
  })
  it('遮罩只顯示首碼與末三碼', () => { expect(maskId('A123456789')).toBe('A******789') })
})

describe('聯絡方式格式', () => {
  it('空白視為未填', () => { expect(validateContact('email', '  ')).toBeNull() })
  it('電子郵件、手機、市話', () => {
    expect(validateContact('email', 'a@b.tw')).toBeNull()
    expect(validateContact('email', 'ab')).toMatch(/格式/)
    expect(validateContact('mobile', '0912345678')).toBeNull()
    expect(validateContact('mobile', '0812345678')).toMatch(/09/)
    expect(validateContact('phone', '02-12345678')).toBeNull()
    expect(validateContact('phone', '12')).toMatch(/格式/)
  })
})

describe('補資料導向規則 profileGate', () => {
  it('缺身分證與聯絡方式 → PROFILE_INCOMPLETE', () => {
    expect(profileGate(S(), acc())).toEqual({ code: 'PROFILE_INCOMPLETE', missing: ['idNumber', 'contact'] })
  })
  it('要求驗證時：只填未驗證的電子郵件不算', () => {
    const a = acc({ idHash: 'h', idStatus: 'verified', email: 'a@b.tw' })
    expect(profileGate(S(), a).missing).toEqual(['contact'])
    expect(profileGate(S(), { ...a, contactVerified: { email: true } }).code).toBeNull()
  })
  it('市話無法驗證：要求驗證時單獨填市話不算；關閉驗證才算', () => {
    const a = acc({ idHash: 'h', idStatus: 'verified', phone: '02-12345678' })
    expect(profileGate(S(), a).missing).toEqual(['contact'])
    expect(profileGate(S({ verifyContact: false }), a).code).toBeNull()
  })
  it('不在可填清單內的聯絡方式不算', () => {
    const a = acc({ idHash: 'h', idStatus: 'verified', mobile: '0912345678', contactVerified: { mobile: true } })
    expect(profileGate(S({ contactFields: ['email'] }), a).missing).toEqual(['contact'])
  })
  it('身分證可設為非必填、聯絡方式最少 0 項', () => {
    expect(profileGate(S({ idRequired: false, contactMin: 0 }), acc()).code).toBeNull()
  })
  it('身分證自填未驗證 → ID_PENDING；關閉身分證驗證後直接通過', () => {
    const a = acc({ idHash: 'h', idStatus: 'unverified', email: 'a@b.tw', contactVerified: { email: true } })
    expect(profileGate(S(), a).code).toBe('ID_PENDING')
    expect(profileGate(S({ verifyIdNumber: false }), a).code).toBeNull()
  })
  it('示範資料：a11、a12 要補資料，其餘帳號直接通過', () => {
    const d = createRbacData()
    for (const a of d.accounts) expect(profileGate(d.profileSettings, a).code).toBe(a.id === 'a11' || a.id === 'a12' ? 'PROFILE_INCOMPLETE' : null)
    expect(d.accounts.every((a) => !('idNumber' in a))).toBe(true)
  })
})

describe('設定檢查', () => {
  it('預設可用', () => { expect(validateProfileSettings(S())).toBeNull() })
  it('最少項數不可超過可填數量', () => { expect(validateProfileSettings(S({ contactFields: ['email'], contactMin: 2 }))).toMatch(/超過/) })
  it('啟用驗證時，只剩市話可填會讓所有人卡死，必須擋下', () => {
    expect(validateProfileSettings(S({ contactFields: ['phone'], contactMin: 1 }))).toMatch(/無法驗證/)
    expect(validateProfileSettings(S({ contactFields: ['phone'], contactMin: 1, verifyContact: false }))).toBeNull()
  })
  it('欄位重複或不存在', () => {
    expect(validateProfileSettings(S({ contactFields: ['email', 'email'] }))).toMatch(/重複/)
    expect(validateProfileSettings(S({ contactFields: ['fax' as never] }))).toMatch(/不正確/)
  })
})
