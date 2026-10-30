import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Descriptions, Form, Input, Space, Spin, Tag, Typography, message } from 'antd'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CONTACT_LABEL, VERIFIABLE } from '../auth/profile'
import type { ContactField, IdStatus, LoginMethod, ProfileSettings } from '../types'

interface ProfileData {
  username: string; name: string; method: LoginMethod
  email: string; mobile: string; phone: string
  contactVerified: Partial<Record<ContactField, boolean>>
  idMasked: string; idStatus: IdStatus; idLocked: boolean; ssoGuid: boolean
  settings: ProfileSettings
  gate: { code: string | null; missing: ('idNumber' | 'contact')[] }
}

const METHOD_LABEL: Record<LoginMethod, string> = { moe_oidc: '教育雲端帳號登入', local: '本機帳號登入' }
const PLACEHOLDER: Record<ContactField, string> = { email: 'name@example.com', mobile: '0912345678', phone: '02-12345678' }

/** 個人資料：身分證／居留證號（帳號綁定）與聯絡方式。必填欄位、是否驗證由國教署管理員在「帳號資料欄位設定」決定。 */
export default function ProfileView() {
  const { refresh } = useAuth()
  const [p, setP] = useState<ProfileData | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()

  const load = useCallback(async () => {
    const d = await api<ProfileData>('/me/profile')
    setP(d)
    form.setFieldsValue({ idNumber: '', email: d.email, mobile: d.mobile, phone: d.phone })
  }, [form])
  useEffect(() => { void load() }, [load])

  if (!p) return <Spin />
  const st = p.settings
  const missingText = p.gate.missing.map((m) => m === 'idNumber' ? '身分證／居留證號' : `聯絡方式（至少 ${st.contactMin} 項${st.verifyContact ? '且需驗證' : ''}）`).join('、')

  const save = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (String(v.idNumber ?? '').trim()) body.idNumber = String(v.idNumber)
      for (const f of st.contactFields) body[f] = String(v[f] ?? '')
      const r = await api<{ message: string }>('/me/profile', { method: 'PUT', json: body })
      msg.success(r.message)
      await load()
      await refresh() // 資料補齊後，立即重新判斷能不能進系統
    } catch (e) { msg.error(e instanceof ApiError ? e.message : '儲存失敗') } finally { setSaving(false) }
  }

  const idTag = p.idStatus === 'verified' ? <Tag color="green">已驗證</Tag>
    : p.idStatus === 'unverified' ? <Tag color="orange">待管理員核對</Tag> : <Tag>尚未填寫</Tag>

  const idHint = !st.verifyIdNumber ? '目前系統未啟用身分證驗證（訓練模式），格式正確即可。'
    : p.method === 'moe_oidc' && p.ssoGuid ? '您以教育雲端帳號登入：填寫後會與教育雲端回傳的資料比對，一致即自動驗證；不一致會被拒絕。'
      : p.method === 'moe_oidc' ? '教育雲端沒有提供身分證比對資料：送出後需由所屬單位管理員核對。'
        : '以本機帳號登入無法自動比對：送出後需由所屬單位管理員核對。'

  return (
    <Card title="個人資料">
      {ctx}
      {p.gate.code === 'PROFILE_INCOMPLETE' && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="請先補齊個人資料，才能使用系統"
          description={`尚缺：${missingText}。不論用哪種方式登入，都需要完成此步驟。`} />)}
      {p.gate.code === 'ID_PENDING' && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="身分證已送出，等待管理員核對"
          description="核准前無法使用系統。若填錯，可以重新輸入更正；也可以洽所屬單位的管理員。" />)}
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}
        items={[
          { key: 'n', label: '姓名', children: p.name },
          { key: 'u', label: '登入帳號', children: <Typography.Text code>{p.username}</Typography.Text> },
          { key: 'm', label: '本次登入方式', children: METHOD_LABEL[p.method] },
        ]} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label={<>身分證／居留證號{st.idRequired && <span style={{ color: '#cf1322' }}> *</span>}　{idTag}</>}
          extra={<>{idHint}　系統只保存加密後的資料，畫面只顯示遮罩。{p.idMasked && <>已填寫：<Typography.Text code>{p.idMasked}</Typography.Text></>}</>}
          name="idNumber" rules={[{ max: 12, message: '長度過長' }]}>
          <Input autoComplete="off" disabled={p.idLocked} maxLength={12} style={{ maxWidth: 280 }}
            placeholder={p.idLocked ? '已驗證，不可自行修改（請洽管理員）' : p.idMasked ? '如需更正，請重新輸入' : '例：A123456789'} />
        </Form.Item>

        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          聯絡方式{st.contactMin > 0 && <span style={{ color: '#cf1322' }}> *</span>}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {st.contactMin > 0 ? `${st.contactFields.map((f) => CONTACT_LABEL[f]).join('、')} 至少填 ${st.contactMin} 項` : '選填'}
          {st.verifyContact && `；需通過驗證碼驗證（${st.contactFields.includes('phone') ? '市話無法驗證，不計入' : ''}）`}
        </Typography.Paragraph>
        {st.contactFields.map((f) => (
          <ContactRow key={f} field={f} p={p} form={form} onVerified={async () => { await load(); await refresh() }} />
        ))}
        <Space>
          <Button type="primary" loading={saving} onClick={() => { void save() }}>儲存</Button>
        </Space>
      </Form>
    </Card>
  )
}

function ContactRow({ field, p, form, onVerified }: { field: ContactField; p: ProfileData; form: ReturnType<typeof Form.useForm>[0]; onVerified: () => Promise<void> }) {
  const [sent, setSent] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, ctx] = message.useMessage()
  const current: string = Form.useWatch(field, form) ?? ''
  const saved = p[field]
  const verifiable = p.settings.verifyContact && VERIFIABLE.includes(field)
  const verified = !!p.contactVerified[field]
  const dirty = current.trim() !== saved.trim()

  const send = async () => {
    setBusy(true)
    try { const r = await api<{ message: string; demoCode: string }>('/me/contact/code', { method: 'POST', json: { field } }); setSent(r.demoCode); msg.success(r.message) }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '寄送失敗') } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true)
    try { await api('/me/contact/verify', { method: 'POST', json: { field, code } }); msg.success('已驗證'); setSent(null); setCode(''); await onVerified() }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '驗證失敗') } finally { setBusy(false) }
  }
  const tag = !saved.trim() ? null
    : !p.settings.verifyContact ? null
      : !verifiable ? <Tag>無法驗證</Tag>
        : verified ? <Tag color="green">已驗證</Tag> : <Tag color="orange">未驗證</Tag>

  return (
    <Form.Item label={<>{CONTACT_LABEL[field]}　{tag}</>} style={{ marginBottom: 12 }}>
      {ctx}
      <Space wrap align="start">
        <Form.Item name={field} noStyle><Input style={{ width: 280 }} placeholder={PLACEHOLDER[field]} autoComplete="off" /></Form.Item>
        {verifiable && saved.trim() && !verified && !dirty && (
          sent === null
            ? <Button loading={busy} onClick={() => { void send() }}>寄送驗證碼</Button>
            : <Space wrap>
                <Input style={{ width: 120 }} placeholder="驗證碼" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
                <Button type="primary" loading={busy} disabled={!code} onClick={() => { void verify() }}>驗證</Button>
                <Typography.Text type="secondary">示範：驗證碼為 {sent}（正式版只會寄到您的{CONTACT_LABEL[field]}）</Typography.Text>
              </Space>
        )}
        {verifiable && dirty && current.trim() && <Typography.Text type="secondary">請先按「儲存」，再驗證</Typography.Text>}
      </Space>
    </Form.Item>
  )
}
