import type { AuditEntry, ReasonCode } from '../types'
import { createRbacData } from './data'

/** 假後端的記憶體狀態；重新整理頁面即還原 */
export const db = createRbacData()
export const audit: AuditEntry[] = []
let seq = 1

export function logAudit(e: Omit<AuditEntry, 'id' | 'at'>) {
  audit.unshift({ id: seq++, at: new Date().toLocaleString('zh-TW', { hour12: false }), ...e })
  if (audit.length > 200) audit.pop()
}

export type { ReasonCode }
