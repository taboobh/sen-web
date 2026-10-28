/**
 * 所有後端呼叫都經過這裡。畫面元件不直接寫網址；
 * 之後接真實後端，只需要改這個檔案（例如帶登入憑證）。
 */
export interface Session { accountId: string; identityId: string }

const KEY = 'sen.session'
export function loadSession(): Session | null {
  try { const v = sessionStorage.getItem(KEY); return v ? (JSON.parse(v) as Session) : null } catch { return null }
}
export function saveSession(s: Session | null) {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY) } catch { /* 無痕模式等情況 */ }
}

export class ApiError extends Error {
  constructor(public status: number, public reason: string | undefined, message: string) { super(message) }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const s = loadSession()
  if (s) headers.set('X-Demo-Session', JSON.stringify(s))
  let body = init.body
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json) }
  const res = await fetch(`/api${path}`, { ...init, headers, body })
  if (!res.ok) {
    let reason: string | undefined, message = res.statusText
    try { const j = await res.json(); reason = j.reason; message = j.message ?? message } catch { /* 無內容 */ }
    throw new ApiError(res.status, reason, message)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
