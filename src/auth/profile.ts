import type { Account, ContactField, ProfileSettings } from '../types'
import { sha256Hex } from './hash'

/**
 * 個人資料規則（純函式，前後端共用）：
 * - 身分證／居留證號是帳號的綁定資料；不論用教育雲端或本機帳號登入，缺少必填資料就只能進「個人資料」頁。
 * - 身分證只存雜湊與遮罩，不存明文。
 * - 欄位是否必填、聯絡方式是否要驗證、身分證是否要驗證，都由國教署管理員在設定頁決定（見 ProfileSettings）。
 */

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  idRequired: true,
  contactFields: ['email', 'mobile', 'phone'],
  contactMin: 1,
  verifyContact: true,
  verifyIdNumber: true,
}

export const CONTACT_LABEL: Record<ContactField, string> = { email: '電子郵件', mobile: '手機', phone: '市話' }
/** 可用驗證碼驗證的聯絡方式；市話無法收驗證碼 */
export const VERIFIABLE: ContactField[] = ['email', 'mobile']
export const ALL_CONTACTS: ContactField[] = ['email', 'mobile', 'phone']
/** 示範用固定驗證碼；正式版由後端產生並以 email／簡訊送出 */
export const DEMO_CONTACT_CODE = '123456'

const LETTER_VALUE: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
  N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
}
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1, 1]

export const normalizeId = (v: string) => v.replace(/\s+/g, '').toUpperCase()

function checksumOk(id: string): boolean {
  const n = LETTER_VALUE[id[0]]
  if (!n) return false
  let sum = Math.floor(n / 10) + (n % 10) * 9
  for (let i = 0; i < 9; i++) sum += Number(id[i + 1]) * WEIGHTS[i]
  return sum % 10 === 0
}

/**
 * 身分證（英文字母＋1/2＋8碼）與新式居留證（英文字母＋8/9＋8碼）檢查碼；
 * 舊式居留證（兩碼英文＋8碼數字）只檢查格式。strict=false（訓練模式）只檢查寬鬆格式，讓虛擬資料可通過。
 */
export function validateNationalId(raw: string, strict = true): string | null {
  const id = normalizeId(raw)
  if (!id) return '請輸入身分證／居留證號'
  if (!strict) return /^[A-Z][A-Z0-9]\d{8}$/.test(id) ? null : '格式不正確：須為 10 碼，英文字母開頭'
  if (/^[A-Z][1289]\d{8}$/.test(id)) return checksumOk(id) ? null : '檢查碼不正確，請確認是否輸入錯誤'
  if (/^[A-Z]{2}\d{8}$/.test(id)) return null
  return '格式不正確：身分證為英文字母＋1或2＋8碼數字；居留證為英文字母＋8或9＋8碼數字，或兩碼英文字母＋8碼數字'
}

/** 產生通過檢查碼的合成號碼（僅供示範資料與測試） */
export function makeTestId(letter: string, sex: 1 | 2 | 8 | 9, serial7: string): string {
  for (let c = 0; c < 10; c++) {
    const id = `${letter}${sex}${serial7}${c}`
    if (checksumOk(id)) return id
  }
  throw new Error('無法產生檢查碼')
}

export const maskId = (id: string) => `${id[0]}******${id.slice(-3)}`

/** 本系統儲存／比對用的雜湊。正式版：HMAC-SHA256＋伺服器祕密金鑰（單純 SHA256 因號碼空間小，容易被暴力還原）。 */
export const idHash = (id: string) => sha256Hex(`SEN-DEMO-KEY|${normalizeId(id)}`)
/** 教育雲端 guid 規格：身分證大寫字串的 SHA256，十六進位大寫 */
export const guidOf = (id: string) => sha256Hex(normalizeId(id)).toUpperCase()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validateContact(field: ContactField, value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (field === 'email') return EMAIL_RE.test(v) ? null : '電子郵件格式不正確'
  if (field === 'mobile') return /^09\d{8}$/.test(v) ? null : '手機須為 10 碼，09 開頭'
  return /^0\d{1,2}-?\d{6,8}(#\d+)?$/.test(v) ? null : '市話格式不正確（例：02-12345678）'
}

export type GateCode = 'PROFILE_INCOMPLETE' | 'ID_PENDING'
export interface GateResult { code: GateCode | null; missing: ('idNumber' | 'contact')[] }

/** 這個聯絡方式是否算「有效」：有填；若要求驗證，則須是可驗證方式且已通過驗證 */
export function contactCounts(s: ProfileSettings, a: Account, f: ContactField): boolean {
  if (!s.contactFields.includes(f)) return false
  if (!(a[f] ?? '').trim()) return false
  if (!s.verifyContact) return true
  return VERIFIABLE.includes(f) && !!a.contactVerified?.[f]
}

export function profileGate(s: ProfileSettings, a: Account): GateResult {
  const missing: GateResult['missing'] = []
  if (s.idRequired && !a.idHash) missing.push('idNumber')
  if (s.contactFields.filter((f) => contactCounts(s, a, f)).length < s.contactMin) missing.push('contact')
  if (missing.length) return { code: 'PROFILE_INCOMPLETE', missing }
  if (s.verifyIdNumber && a.idHash && a.idStatus !== 'verified') return { code: 'ID_PENDING', missing }
  return { code: null, missing }
}

/** 設定本身要能被滿足，否則所有人都會被擋在個人資料頁 */
export function validateProfileSettings(s: ProfileSettings): string | null {
  if (!Array.isArray(s.contactFields) || s.contactFields.some((f) => !ALL_CONTACTS.includes(f))) return '聯絡方式欄位不正確'
  if (new Set(s.contactFields).size !== s.contactFields.length) return '聯絡方式欄位重複'
  if (!Number.isInteger(s.contactMin) || s.contactMin < 0) return '聯絡方式最少項數不正確'
  if (s.contactMin > s.contactFields.length) return `最少項數（${s.contactMin}）不可超過可填的聯絡方式數量（${s.contactFields.length}）`
  if (s.verifyContact) {
    const n = s.contactFields.filter((f) => VERIFIABLE.includes(f)).length
    if (s.contactMin > n) return `啟用聯絡方式驗證時，市話無法驗證；可驗證的方式只有 ${n} 項，少於最少項數 ${s.contactMin}`
  }
  return null
}
