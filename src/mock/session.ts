import { HttpResponse } from 'msw'
import type { Account, LoginMethod, ReasonCode } from '../types'
import { REASON_TEXT, resolveSession } from '../auth/engine'
import { profileGate } from '../auth/profile'
import { db } from './state'

/** 假後端共用：工作階段（X-Demo-Session）、回應、「資料未補齊就擋下」的授權前置檢查 */
export const today = () => new Date().toISOString().slice(0, 10)

export interface Sess { accountId: string; identityId: string; method: LoginMethod }

export function readSession(req: Request): Sess | null {
  try {
    const raw = req.headers.get('X-Demo-Session')
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Sess>
    return { accountId: String(s.accountId ?? ''), identityId: String(s.identityId ?? ''), method: s.method === 'moe_oidc' ? 'moe_oidc' : 'local' }
  } catch { return null }
}

export const unauthorized = (reason: ReasonCode = 'ACCOUNT_INACTIVE') =>
  HttpResponse.json({ error: 'unauthorized', reason, message: REASON_TEXT[reason] }, { status: 401 })
export const forbidden = (reason: ReasonCode) =>
  HttpResponse.json({ error: 'forbidden', reason, message: REASON_TEXT[reason] }, { status: 403 })
export const badRequest = (message: string, reason?: string) =>
  HttpResponse.json({ error: 'invalid', reason, message }, { status: 400 })

/**
 * 每個需要授權的請求都先過這裡：帳號缺少必填資料（身分證／聯絡方式）或身分證尚待核對時，
 * 不論用哪種方式登入，後端一律拒絕（PROFILE_INCOMPLETE／ID_PENDING），前端只能進個人資料頁。
 */
export function resolveGated(s: Sess) {
  const acc = db.accounts.find((a) => a.id === s.accountId)
  if (acc && acc.status === 'active') {
    const g = profileGate(db.profileSettings, acc)
    if (g.code) return { reason: g.code as ReasonCode }
  }
  return resolveSession(db, s.accountId, s.identityId, today())
}

/** 回給前端的帳號資料：不含身分證雜湊與重複帳號線索 */
export function publicAccount(a: Account): Account {
  return { ...a, idHash: undefined, idConflictWith: undefined }
}
