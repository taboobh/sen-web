import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Select, Space, Typography } from 'antd'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MODULES } from '../mock/modules'
import { ACTION_LABEL, type Action, type Student } from '../types'

interface Result { allowed: boolean; reason: string; message: string }
interface School { id: string; name: string }

const SCHOOLS: School[] = [
  { id: 'sA1', name: '甲市光明國小' }, { id: 'sA2', name: '甲市和平國中' }, { id: 'sA3', name: '甲市文華高職' },
  { id: 'sA4', name: '甲市青山國小' }, { id: 'sB1', name: '乙縣海岸國小' }, { id: 'sB2', name: '乙縣山林國中' }, { id: 'sC1', name: '丙市河畔國小' },
]

/** 權限模擬：選功能與目標，詢問後端「目前身分能不能做」並看到原因，方便夥伴驗證規則。 */
export default function Simulator() {
  const { me } = useAuth()
  const [permission, setPermission] = useState('students:read')
  const [schoolId, setSchoolId] = useState('sA1')
  const [studentId, setStudentId] = useState<string | undefined>()
  const [res, setRes] = useState<Result | null>(null)
  const [students, setStudents] = useState<Student[]>([])

  // 只為了列出學生選項；這份清單是靠該身分自己的權限取得，看不到範圍外的學生
  useEffect(() => { api<Student[]>('/students').then(setStudents).catch(() => setStudents([])) }, [me?.active.assignmentId])

  const options = useMemo(() => MODULES.flatMap((m) =>
    (Object.keys(ACTION_LABEL) as Action[]).map((a) => ({ value: `${m.id}:${a}`, label: `${m.name}：${ACTION_LABEL[a]}` }))), [])

  const check = async () => setRes(await api<Result>('/authz/check', { method: 'POST', json: { permission, schoolId, studentId } }))

  return (
    <Card title="權限模擬" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Paragraph type="secondary">
        以目前身分（{me?.active.role.name}・{me?.active.scope.name}）詢問後端：能不能對某所學校（或某位學生）做某個動作？每次詢問都會寫入稽核紀錄。
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="功能與動作"><Select showSearch optionFilterProp="label" value={permission} onChange={setPermission} options={options} /></Form.Item>
        <Form.Item label="目標學校"><Select value={schoolId} onChange={(v) => { setSchoolId(v); setStudentId(undefined) }} options={SCHOOLS.map((s) => ({ value: s.id, label: s.name }))} /></Form.Item>
        <Form.Item label="目標學生（選填，用來測試責任關係）">
          <Select allowClear placeholder="不指定" value={studentId} onChange={setStudentId}
            options={students.filter((s) => s.schoolId === schoolId).map((s) => ({ value: s.id, label: `${s.name}（${s.grade}）` }))} />
        </Form.Item>
        <Space><Button type="primary" onClick={check}>判斷</Button></Space>
      </Form>
      {res && <Alert style={{ marginTop: 16 }} showIcon type={res.allowed ? 'success' : 'error'} message={res.allowed ? '允許' : '拒絕'} description={res.message} />}
    </Card>
  )
}
