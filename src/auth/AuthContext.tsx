import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, loadSession, saveSession } from '../api/client'
import type { Action, LoginMethod, MePermissions } from '../types'

/** 登入後暫時不能進系統的原因：資料未補齊、身分證待核對、尚無可用角色 */
export interface Gate {
  code: 'PROFILE_INCOMPLETE' | 'ID_PENDING' | 'NO_ROLE'
  missing: ('idNumber' | 'contact')[]
  reason?: string
}
export interface AccountStatus {
  account: { id: string; name: string }
  method: LoginMethod
  gate: Gate | null
  identityId: string | null
}

interface AuthState {
  me: MePermissions | null
  /** 帳號狀態：有 gate 時只能使用個人資料頁 */
  status: AccountStatus | null
  loading: boolean
  error: string | null
  login: (accountId: string, method: LoginMethod) => Promise<void>
  switchIdentity: (identityId: string) => Promise<void>
  logout: () => void
  /** 重新向後端取得帳號狀態與「我的權限」（例如角色權限或個人資料被修改後） */
  refresh: () => Promise<void>
  /** 前端顯示用：是否有「模組:動作」。真正的授權在後端。 */
  can: (moduleId: string, action: Action) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MePermissions | null>(null)
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [loading, setLoading] = useState(!!loadSession())
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = await api<AccountStatus>('/me/status')
      setStatus(st)
      if (st.gate) {
        setMe(null)
      } else {
        const sess = loadSession()
        if (sess && st.identityId && sess.identityId !== st.identityId) saveSession({ ...sess, identityId: st.identityId })
        setMe(await api<MePermissions>('/me/permissions'))
      }
      setError(null)
    } catch (e) {
      saveSession(null); setMe(null); setStatus(null)
      setError(e instanceof ApiError ? e.message : '無法取得權限')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (loadSession()) void refresh(); else setLoading(false) }, [refresh])

  const login = useCallback(async (accountId: string, method: LoginMethod) => {
    setLoading(true)
    try {
      const s = await api<{ accountId: string; identityId: string; method: LoginMethod }>('/auth/login', { method: 'POST', json: { accountId, method } })
      saveSession(s)
      await refresh()
    } catch (e) {
      setLoading(false)
      const msg = e instanceof ApiError ? e.message : '登入失敗'
      setError(msg)
      throw e
    }
  }, [refresh])

  const switchIdentity = useCallback(async (identityId: string) => {
    const s = loadSession(); if (!s) return
    saveSession({ ...s, identityId }); await refresh()
  }, [refresh])

  const logout = useCallback(() => { saveSession(null); setMe(null); setStatus(null); setError(null) }, [])

  const can = useCallback((moduleId: string, action: Action) => !!me?.permissions.includes(`${moduleId}:${action}`), [me])

  const value = useMemo(() => ({ me, status, loading, error, login, switchIdentity, logout, refresh, can }), [me, status, loading, error, login, switchIdentity, logout, refresh, can])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return v
}
