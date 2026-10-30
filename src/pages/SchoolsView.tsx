import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Collapse, Descriptions, Drawer, Form, Input, Modal, Result, Segmented, Select, Space, Spin, Steps, Table, Tabs, Tag, Timeline, Tooltip, Typography, Upload, message,
} from 'antd'
import { CloudDownloadOutlined, InboxOutlined } from '@ant-design/icons'
import DataTable, { type Col } from '../components/DataTable'
import { api, ApiError } from '../api/client'
import { SCHOOL_STATUS_TEXT, type SchoolImportRecord, type SchoolInfo, type SchoolStatus } from '../types'
import { parseMoeWorkbook, SCHOOL_LEVELS, type MoeFile } from '../schools/moe'
import { DECISION_TEXT, DIFF_TEXT, type DiffItem, type DiffKind, type ImportDecision, type ImportPreview } from '../schools/schoolData'

type SchoolRow = Omit<SchoolInfo, 'history'> & {
  id: string; name: string; stages: string[]; ntaDirect: boolean; district: string; students: number; people: number
}
interface ListData { scopeName: string; rows: SchoolRow[]; canManage: boolean; canEditSelf: boolean; lastImport: SchoolImportRecord | null; imports: SchoolImportRecord[] }

const STATUS_COLOR: Record<SchoolStatus, string> = { active: 'green', closing: 'orange', preparing: 'blue', closed: 'default' }
const statusTag = (s: SchoolStatus) => <Tag color={STATUS_COLOR[s]}>{SCHOOL_STATUS_TEXT[s]}</Tag>
const CITIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣']

/** 原型內附的教育部統計處 115 學年度名錄（真實檔案，未修改），供夥伴不必自行下載即可走一次年度匯入 */
const DEMO_115 = ['e1_new.xlsx', 'j1_new.xlsx', 'newcj_new.xlsx', 's2_new.xlsx', 'ac.xlsx', 'aj_new.xlsx', 'high.xlsx', 'high_new.xlsx', 'highA.xlsx', 'highO.xlsx',
  'sp1_new.xlsx', 'school04_new.xls', 'school_exp.xls', '115_BasicChange.xlsx', '115_HighChange.xlsx']

const QUICK: Record<string, (r: SchoolRow) => boolean> = {
  全部: () => true,
  使用中: (r) => r.status === 'active',
  停招: (r) => r.status === 'closing',
  未啟用: (r) => r.status === 'preparing',
  '廢校／停辦': (r) => r.status === 'closed',
  未歸分區: (r) => r.district === '未歸分區' && r.status !== 'closed',
  手動新增: (r) => r.source === 'manual',
}

export default function SchoolsView() {
  const [data, setData] = useState<ListData | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [n, setN] = useState(0)
  const [quick, setQuick] = useState('使用中')
  const [detail, setDetail] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  useEffect(() => { api<ListData>('/schools').then(setData).catch((e) => setErr(e)) }, [n])
  const reload = () => setN((x) => x + 1)
  if (err) return <Result status="403" title="後端拒絕" subTitle={err.message} />
  if (!data) return <Spin />

  const columns: Col<SchoolRow>[] = [
    { key: 'code', title: '學校代碼', width: 100, value: (r) => r.code, render: (r) => <Typography.Text code>{r.code}</Typography.Text>, filter: false },
    { key: 'name', title: '學校名稱', width: 240, value: (r) => r.name, filter: false,
      render: (r) => <a onClick={() => setDetail(r.id)}>{r.name}</a> },
    { key: 'levels', title: '學制', width: 150, value: (r) => r.levels.join('、'), values: (r) => r.levels },
    { key: 'ownership', title: '公私立', width: 80, value: (r) => r.ownership },
    { key: 'city', title: '縣市', width: 90, value: (r) => r.city },
    { key: 'town', title: '鄉鎮市區', width: 100, value: (r) => r.town },
    { key: 'district', title: '分區', width: 170, value: (r) => r.district,
      render: (r) => r.district === '未歸分區' ? <Tooltip title="地址無法判斷鄉鎮市區，學校先掛在縣市下"><Tag color="orange">未歸分區</Tag></Tooltip> : r.district === '署轄' ? <Tag color="purple">署轄</Tag> : r.district },
    { key: 'status', title: '狀態', width: 130, value: (r) => SCHOOL_STATUS_TEXT[r.status], render: (r) => statusTag(r.status) },
    { key: 'moeYear', title: '名錄學年度', width: 100, value: (r) => r.moeYear ?? '手動新增',
      render: (r) => r.source === 'manual' ? <Tag color="gold">手動新增</Tag> : r.moeYear },
    { key: 'principal', title: '校長', width: 100, value: (r) => r.principal ?? '' },
    { key: 'contact', title: '發言人（聯絡人）', width: 200, value: (r) => [r.contact?.name, r.contact?.title, r.contact?.phone].filter(Boolean).join(' ') },
    { key: 'address', title: '地址', width: 260, value: (r) => r.address, filter: false },
    { key: 'phone', title: '電話', width: 150, value: (r) => r.phone, filter: false,
      render: (r) => <>{r.phone}{r.phoneBySchool && <Tooltip title="電話已由學校自行維護，名錄匯入不覆寫"><Tag style={{ marginLeft: 4 }}>校</Tag></Tooltip>}</> },
  ]
  const rows = data.rows.filter(QUICK[quick] ?? QUICK['全部'])
  const last = data.lastImport

  return (
    <Card title={`學校基本資料（${data.scopeName}）`} extra={
      <Space wrap>
        {data.canManage && <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setImporting(true)}>年度名錄匯入</Button>}
        {data.canManage && <Button onClick={() => setAdding(true)}>手動新增學校</Button>}
      </Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={<>學校資料來自<b>教育部統計處各級學校名錄</b>（真實學校代碼）{last ? `，最近一次匯入：${last.year ?? ''} 學年度（${last.at}，${last.by}）` : ''}。</>}
        description={<>
          <div>狀態：<b>使用中</b>；<b>停招</b>＝既有學生畢業前仍可選為本職機構，不能新增學生；<b>未啟用</b>＝有代碼的籌備處，可先建立帳號；<b>廢校／停辦</b>＝不能再選為任職機構或指派角色。沒有代碼的籌備處不匯入。</div>
          <div><b>署管理員</b>可新增學校、修改全部欄位與狀態，並每年匯入統計處名錄；<b>學校</b>只能修改本校的<b>電話、校長、發言人（聯絡人）</b>（學校改過電話後，名錄匯入不再覆寫電話）；縣市、分區僅能瀏覽。大專校院不納入；統計處未提供學前（幼兒園）名錄，學前沿用前一學年度資料。</div>
        </>} />
      <Segmented style={{ marginBottom: 12 }} value={quick} onChange={(v) => setQuick(String(v))}
        options={Object.keys(QUICK).map((k) => ({ value: k, label: `${k}（${data.rows.filter(QUICK[k]).length}）` }))} />
      <DataTable<SchoolRow> rows={rows} columns={columns} rowKey={(r) => r.id} exportName="學校基本資料" scrollX={1700} pageSize={20} />
      {data.canManage && data.imports.length > 0 && (
        <Collapse style={{ marginTop: 16 }} items={[{ key: 'h', label: `名錄匯入紀錄（${data.imports.length}）`, children: (
          <Table<SchoolImportRecord> size="small" rowKey="id" pagination={false} dataSource={data.imports} columns={[
            { title: '時間', dataIndex: 'at' }, { title: '執行者', dataIndex: 'by' }, { title: '學年度', dataIndex: 'year' },
            { title: '學制', render: (_, r) => r.levels.join('、') },
            { title: '結果', render: (_, r) => Object.entries(r.summary).map(([k, v]) => <Tag key={k}>{(DIFF_TEXT as Record<string, string>)[k] ?? (DECISION_TEXT as Record<string, string>)[k] ?? (k === 'unchanged' ? '無異動' : k)} {v}</Tag>) },
          ]} />) }]} />
      )}
      <SchoolDrawer id={detail} onClose={() => setDetail(null)} onSaved={reload} />
      <ImportModal open={importing} lastYear={last?.year ?? null} onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload() }} />
      <AddSchoolModal open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />
    </Card>
  )
}

type Detail = SchoolRow & { history: SchoolInfo['history']; canEditSelf: boolean; canManage: boolean }
function SchoolDrawer({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Detail | null>(null)
  const [n, setN] = useState(0)
  const [local] = Form.useForm()
  const [moe] = Form.useForm()
  const [msg, ctx] = message.useMessage()
  const status: SchoolStatus | undefined = Form.useWatch('status', moe)
  useEffect(() => {
    if (!id) { setS(null); return }
    api<Detail>(`/schools/${id}`).then((d) => {
      setS(d)
      local.setFieldsValue({ phone: d.phone, principal: d.principal, contactName: d.contact?.name, contactTitle: d.contact?.title, contactPhone: d.contact?.phone, contactEmail: d.contact?.email })
      moe.setFieldsValue({ name: d.name, levels: d.levels, ownership: d.ownership, city: d.city, zip: d.zip, address: d.address, website: d.website, status: d.status, statusNote: '' })
    }).catch((e) => msg.error(e instanceof ApiError ? e.message : '載入失敗'))
  }, [id, n]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (path: string, body: unknown, ok: string) => {
    try { await api(path, { method: 'PUT', json: body }); msg.success(ok); setN((x) => x + 1); onSaved() }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '儲存失敗') }
  }
  return (
    <Drawer open={!!id} width={720} onClose={onClose} title={s ? `${s.name}（${s.code}）` : '學校'} destroyOnClose>
      {ctx}
      {!s ? <Spin /> : (
        <Tabs items={[
          { key: 'info', label: '基本資料', children: (
            <>
              <Descriptions size="small" column={1} bordered items={[
                { label: '學校代碼', children: <>{s.code}{s.oldCodes?.length ? <Typography.Text type="secondary">（舊代碼：{s.oldCodes.join('、')}）</Typography.Text> : null}</> },
                { label: '校名', children: <>{s.name}{s.oldNames?.length ? <Typography.Text type="secondary">（曾用名：{s.oldNames.join('、')}）</Typography.Text> : null}</> },
                { label: '狀態', children: <>{statusTag(s.status)}{s.statusSince && <Typography.Text type="secondary">自 {s.statusSince}</Typography.Text>}{s.statusNote && <div>{s.statusNote}</div>}</> },
                { label: '學制', children: s.levels.join('、') },
                { label: 'SEN 教育階段', children: s.stages.join('、') || '-' },
                { label: '公私立', children: s.ownership || '-' },
                { label: '縣市／鄉鎮市區', children: `${s.city} ${s.town || '（無法由地址判斷）'}` },
                { label: '分區', children: s.district },
                { label: '地址', children: `${s.zip ? `[${s.zip}]` : ''}${s.address}` },
                { label: '電話', children: <>{s.phone || '-'}{s.phoneBySchool && <Typography.Text type="secondary">（學校自行維護，名錄匯入不覆寫）</Typography.Text>}</> },
                { label: '校長', children: s.principal || '-' },
                { label: '發言人（聯絡人）', children: s.contact?.name ? [s.contact.name, s.contact.title, s.contact.phone, s.contact.email].filter(Boolean).join('　') : '-' },
                { label: '網址', children: s.website ? <a href={s.website} target="_blank" rel="noreferrer">{s.website}</a> : '-' },
                { label: '來源', children: s.source === 'manual' ? '手動新增（待名錄確認）' : `教育部統計處名錄（最近出現：${s.moeYear} 學年度）` },
                { label: '學生／在職人員（示範）', children: `${s.students} 名學生、${s.people} 位在職人員` },
              ]} />
              <Typography.Title level={5} style={{ marginTop: 16 }}>學校自行維護：電話、校長、發言人（聯絡人）</Typography.Title>
              {!s.canEditSelf && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="唯讀：只有本校（學校層級的管理員）與署管理員可以修改。" />}
              <Form form={local} layout="vertical" disabled={!s.canEditSelf}>
                <Space wrap align="start">
                  <Form.Item name="phone" label="學校電話" rules={[{ required: true, whitespace: true, message: '請填寫學校電話' }]}><Input style={{ width: 200 }} /></Form.Item>
                  <Form.Item name="principal" label="校長"><Input style={{ width: 160 }} /></Form.Item>
                </Space>
                <div style={{ marginBottom: 8 }}><Typography.Text strong>發言人（聯絡人）</Typography.Text></div>
                <Space wrap align="start">
                  <Form.Item name="contactName" label="姓名"><Input style={{ width: 140 }} /></Form.Item>
                  <Form.Item name="contactTitle" label="職稱"><Input style={{ width: 140 }} placeholder="例：學務主任" /></Form.Item>
                  <Form.Item name="contactPhone" label="電話"><Input style={{ width: 180 }} /></Form.Item>
                  <Form.Item name="contactEmail" label="電子郵件"><Input style={{ width: 220 }} /></Form.Item>
                </Space>
                <div><Button type="primary" disabled={!s.canEditSelf} onClick={() => { void local.validateFields().then((v) => save(`/schools/${s.id}/self`, v, '已更新')) }}>儲存</Button></div>
              </Form>
            </>) },
          ...(s.canManage ? [{ key: 'moe', label: '名錄欄位與狀態（署管理員）', children: (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="名錄欄位以統計處名錄為準，下次年度匯入時會依名錄覆寫；手動修正只用於名錄有誤或尚未公告的情況。電話、校長、發言人請在「基本資料」頁修改。" />
              <Form form={moe} layout="vertical">
                <Form.Item name="name" label="校名" rules={[{ required: true, whitespace: true, message: '請輸入校名' }]}><Input /></Form.Item>
                <Form.Item name="levels" label="學制" rules={[{ required: true, message: '請選擇學制' }]}><Select mode="multiple" options={SCHOOL_LEVELS.map((l) => ({ value: l, label: l }))} /></Form.Item>
                <Space wrap align="start">
                  <Form.Item name="ownership" label="公私立"><Select style={{ width: 100 }} options={['公立', '私立'].map((x) => ({ value: x, label: x }))} /></Form.Item>
                  <Form.Item name="city" label="縣市"><Select style={{ width: 120 }} options={CITIES.map((x) => ({ value: x, label: x }))} /></Form.Item>
                  <Form.Item name="zip" label="郵遞區號"><Input style={{ width: 90 }} /></Form.Item>
                </Space>
                <Form.Item name="address" label="地址" extra="鄉鎮市區由地址判斷，並決定學校所屬分區"><Input /></Form.Item>
                <Form.Item name="website" label="網址"><Input /></Form.Item>
                <Space wrap align="start">
                  <Form.Item name="status" label="狀態"><Select style={{ width: 180 }} options={(Object.keys(SCHOOL_STATUS_TEXT) as SchoolStatus[]).map((k) => ({ value: k, label: SCHOOL_STATUS_TEXT[k] }))} /></Form.Item>
                  <Form.Item name="statusNote" label="狀態變更原因（公文字號等）" rules={[{ required: status !== s.status, message: '變更狀態請填寫原因' }]}><Input style={{ width: 360 }} disabled={status === s.status} /></Form.Item>
                </Space>
                <Button type="primary" onClick={() => { void moe.validateFields().then((v) => save(`/schools/${s.id}`, v, '已更新名錄欄位')) }}>儲存</Button>
              </Form>
            </>) }] : []),
          { key: 'history', label: `異動紀錄（${s.history.length}）`, children: (
            <Timeline items={s.history.map((h) => ({ children: <><Typography.Text type="secondary">{h.at}・{h.by}</Typography.Text><div>{h.text}</div></> }))} />) },
        ]} />
      )}
    </Drawer>
  )
}

const KIND_COLOR: Record<DiffKind, string> = { missing: 'red', status: 'orange', recode: 'purple', new: 'green', preparing: 'blue', activate: 'cyan', reopen: 'magenta', changed: 'default' }
const FILE_KIND: Record<MoeFile['kind'], string> = { list: '名錄', newList: '新設校／籌備處名單', change: '異動一覽表', outOfScope: '不在範圍（略過）', unknown: '無法辨識' }

function ImportModal({ open, lastYear, onClose, onDone }: { open: boolean; lastYear: number | null; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<MoeFile[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [pv, setPv] = useState<ImportPreview | null>(null)
  const [dec, setDec] = useState<Record<string, ImportDecision>>({})
  const [result, setResult] = useState<SchoolImportRecord | null>(null)
  const [msg, ctx] = message.useMessage()
  const step = result ? 2 : pv ? 1 : 0
  const reset = () => { setFiles([]); setPv(null); setDec({}); setResult(null) }

  const addBuffers = async (list: { name: string; buf: ArrayBuffer }[]) => {
    const XLSX = await import('xlsx')
    const parsed = list.map((f) => { try { return parseMoeWorkbook(XLSX, f.buf, f.name) } catch { return { fileName: f.name, title: '', year: null, kind: 'unknown', schools: [], changes: [], skipped: [] } as MoeFile } })
    setFiles((cur) => [...cur.filter((c) => !parsed.some((p) => p.fileName === c.fileName)), ...parsed])
  }
  const loadDemo = async () => {
    setBusy('讀取 115 學年度名錄…')
    try {
      const bufs = await Promise.all(DEMO_115.map(async (name) => {
        const r = await fetch(`${import.meta.env.BASE_URL}moe/115/${name}`)
        if (!r.ok) throw new Error(name)
        return { name, buf: await r.arrayBuffer() }
      }))
      await addBuffers(bufs)
    } catch (e) { msg.error(`無法讀取內附名錄：${e instanceof Error ? e.message : ''}`) } finally { setBusy(null) }
  }
  const preview = async () => {
    setBusy('比對中…')
    try { const p = await api<ImportPreview>('/schools/import/preview', { method: 'POST', json: { files } }); setPv(p); setDec(Object.fromEntries(p.items.map((i) => [i.key, i.suggestion]))) }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '比對失敗') } finally { setBusy(null) }
  }
  const apply = async () => {
    setBusy('套用中…')
    try { setResult(await api<SchoolImportRecord>('/schools/import/apply', { method: 'POST', json: { files, decisions: dec } })) }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '套用失敗') } finally { setBusy(null) }
  }

  const byKind = useMemo(() => {
    const m = new Map<DiffKind, DiffItem[]>()
    for (const it of pv?.items ?? []) m.set(it.kind, [...(m.get(it.kind) ?? []), it])
    return m
  }, [pv])

  const itemCols = (kind: DiffKind) => [
    { title: '代碼', width: 90, render: (_: unknown, it: DiffItem) => <Typography.Text code>{it.code}</Typography.Text> },
    { title: '學校', width: 230, render: (_: unknown, it: DiffItem) => <>{it.name}<div><Typography.Text type="secondary">{it.city}{it.currentStatus ? `・現況 ${SCHOOL_STATUS_TEXT[it.currentStatus]}` : ''}</Typography.Text></div></> },
    { title: kind === 'missing' ? '說明' : '異動內容', render: (_: unknown, it: DiffItem) => (
      <>
        {it.fields.map((f) => <div key={f.key}><Typography.Text type="secondary">{f.label}：</Typography.Text><Typography.Text delete type="secondary">{f.from || '（空白）'}</Typography.Text> → {f.to || '（空白）'}</div>)}
        {it.moeNote && <div><Tag color="geekblue">統計處</Tag>{it.moeNote}</div>}
        {it.reason && <div><Typography.Text type="secondary">{it.reason}</Typography.Text></div>}
        {it.warn && <div><Typography.Text type="warning">{it.warn}</Typography.Text></div>}
      </>) },
    ...(['missing', 'status', 'recode'].includes(kind) ? [{ title: '學生／人員', width: 100, render: (_: unknown, it: DiffItem) => `${it.students}／${it.people}` }] : []),
    { title: '處理方式', width: 170, render: (_: unknown, it: DiffItem) => (
      <Select size="small" style={{ width: 160 }} value={dec[it.key]} onChange={(v) => setDec((d) => ({ ...d, [it.key]: v }))}
        options={it.options.map((o) => ({ value: o, label: `${DECISION_TEXT[o]}${o === it.suggestion ? '（建議）' : ''}` }))} />) },
  ]
  const order: DiffKind[] = ['missing', 'status', 'recode', 'new', 'preparing', 'activate', 'reopen', 'changed']
  const changedFromSuggestion = pv?.items.filter((i) => dec[i.key] !== i.suggestion).length ?? 0

  return (
    <Modal open={open} width={1180} title="年度名錄匯入（教育部統計處各級學校名錄）" footer={null} onCancel={() => { reset(); onClose() }} destroyOnClose>
      {ctx}
      <Steps size="small" current={step} style={{ marginBottom: 16 }} items={[{ title: '選擇名錄檔' }, { title: '預覽差異、決定處理方式' }, { title: '完成' }]} />
      <Spin spinning={!!busy} tip={busy ?? undefined}>
        {step === 0 && (
          <>
            <Typography.Paragraph type="secondary">
              到統計處「各級學校名錄及異動一覽表」下載當學年度的檔案（xlsx／xls／ods），可一次選多個。系統依檔案標題自動辨識學制；新設校／籌備處名單與異動一覽表會用來判斷改制換代碼、停招與停辦。大專校院檔案會略過。
            </Typography.Paragraph>
            <Upload.Dragger multiple accept=".xlsx,.xls,.ods,.csv" showUploadList={false}
              beforeUpload={(f, list) => { if (f === list[list.length - 1]) { setBusy('解析中…'); void Promise.all(list.map(async (x) => ({ name: x.name, buf: await x.arrayBuffer() }))).then(addBuffers).finally(() => setBusy(null)) } return false }}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">點選或拖曳名錄檔到這裡</p>
            </Upload.Dragger>
            <Space style={{ margin: '12px 0' }} wrap>
              <Button onClick={() => { void loadDemo() }}>使用原型內附的 115 學年度名錄（統計處 115.08 公告，共 {DEMO_115.length} 檔）</Button>
              {files.length > 0 && <Button onClick={() => setFiles([])}>清除</Button>}
            </Space>
            {files.length > 0 && (
              <Table<MoeFile> size="small" rowKey="fileName" pagination={false} dataSource={files} columns={[
                { title: '檔名', dataIndex: 'fileName' },
                { title: '標題', dataIndex: 'title' },
                { title: '辨識結果', render: (_, f) => <Tag color={f.kind === 'unknown' ? 'red' : f.kind === 'outOfScope' ? 'default' : 'blue'}>{FILE_KIND[f.kind]}{f.level ? `：${f.level}` : ''}</Tag> },
                { title: '學年度', render: (_, f) => f.year ?? '-' },
                { title: '筆數', render: (_, f) => f.kind === 'change' ? `${f.changes.length} 項異動` : `${f.schools.length} 校${f.skipped.length ? `（略過 ${f.skipped.length}）` : ''}` },
                { title: '', width: 60, render: (_, f) => <Button size="small" type="link" danger onClick={() => setFiles((c) => c.filter((x) => x !== f))}>移除</Button> },
              ]} />
            )}
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <Button type="primary" disabled={!files.some((f) => f.kind === 'list')} onClick={() => { void preview() }}>產生差異預覽</Button>
            </div>
          </>
        )}
        {step === 1 && pv && (
          <>
            {pv.year !== null && lastYear !== null && pv.year <= lastYear && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`系統目前已是 ${lastYear} 學年度名錄，本次為 ${pv.year} 學年度：只會更新有差異的學校。`} />)}
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }} items={[
              { label: '名錄學年度', children: pv.year ?? '無法判斷' },
              { label: '名錄學校數', children: `${pv.total} 校（無異動 ${pv.unchanged} 校）` },
              { label: '本次提供的學制', children: pv.levels.join('、') },
              { label: '沿用前一學年度', children: pv.carriedLevels.length ? <>{pv.carriedLevels.join('、')}<Typography.Text type="secondary">（未提供名錄，不判定廢校）</Typography.Text></> : '無' },
            ]} />
            <Space wrap style={{ marginBottom: 12 }}>
              {order.filter((k) => byKind.get(k)?.length).map((k) => <Tag key={k} color={KIND_COLOR[k]}>{DIFF_TEXT[k]} {byKind.get(k)!.length}</Tag>)}
            </Space>
            {(pv.skipped.length > 0 || pv.warnings.length > 0) && (
              <Collapse size="small" style={{ marginBottom: 12 }} items={[
                ...(pv.skipped.length ? [{ key: 's', label: `略過 ${pv.skipped.length} 筆`, children: pv.skipped.map((x, i) => <div key={i}>{x.name}：{x.reason}</div>) }] : []),
                ...(pv.warnings.length ? [{ key: 'w', label: `提醒 ${pv.warnings.length} 筆`, children: pv.warnings.map((x, i) => <div key={i}>{x}</div>) }] : []),
              ]} />)}
            <Tabs items={order.filter((k) => byKind.get(k)?.length).map((k) => ({
              key: k, label: `${DIFF_TEXT[k]}（${byKind.get(k)!.length}）`,
              children: <Table<DiffItem> size="small" rowKey="key" dataSource={byKind.get(k)} columns={itemCols(k)} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 900 }} />,
            }))} />
            <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 12 }} wrap>
              <Space>
                <Button onClick={() => setPv(null)}>上一步</Button>
                <Button disabled={!changedFromSuggestion} onClick={() => setDec(Object.fromEntries(pv.items.map((i) => [i.key, i.suggestion])))}>全部改回建議（已調整 {changedFromSuggestion} 項）</Button>
              </Space>
              <Button type="primary" onClick={() => Modal.confirm({ title: `確認套用 ${pv.year ?? ''} 學年度名錄？`, content: '學校主檔會依各項處理方式更新並寫入異動與稽核紀錄；帳號、角色與學生資料不會刪除。', okText: '套用', cancelText: '取消', onOk: apply })}>確認套用</Button>
            </Space>
          </>
        )}
        {step === 2 && result && (
          <Result status="success" title={`已套用 ${result.year ?? ''} 學年度名錄`}
            subTitle={Object.entries(result.summary).map(([k, v]) => `${(DIFF_TEXT as Record<string, string>)[k] ?? (DECISION_TEXT as Record<string, string>)[k] ?? (k === 'unchanged' ? '無異動' : k)} ${v}`).join('、')}
            extra={<Button type="primary" onClick={() => { reset(); onDone() }}>回到學校清單</Button>} />
        )}
      </Spin>
    </Modal>
  )
}

function AddSchoolModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [msg, ctx] = message.useMessage()
  const submit = async () => {
    const v = await form.validateFields()
    setSaving(true)
    try { await api('/schools', { method: 'POST', json: v }); msg.success('已新增'); onDone() }
    catch (e) { msg.error(e instanceof ApiError ? e.message : '新增失敗') } finally { setSaving(false) }
  }
  return (
    <Modal open={open} title="手動新增學校" okText="新增" cancelText="取消" confirmLoading={saving} onOk={() => { void submit() }} onCancel={onClose} destroyOnClose afterOpenChange={(o) => { if (o) form.resetFields() }}>
      {ctx}
      <Typography.Paragraph type="secondary">用於統計處名錄尚未公告、但已取得學校代碼的新設校或籌備處。下次年度匯入時，名錄出現同代碼即改以名錄為準。</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ status: 'preparing' }}>
        <Space wrap align="start">
          <Form.Item name="code" label="學校代碼" rules={[{ required: true, pattern: /^[0-9A-Za-z]{6}$/, message: '6 碼英數字' }]}><Input style={{ width: 120 }} /></Form.Item>
          <Form.Item name="status" label="狀態"><Select style={{ width: 160 }} options={[{ value: 'preparing', label: '未啟用（籌備處）' }, { value: 'active', label: '使用中' }]} /></Form.Item>
        </Space>
        <Form.Item name="name" label="校名" rules={[{ required: true, whitespace: true, message: '請輸入校名' }]}><Input /></Form.Item>
        <Form.Item name="levels" label="學制" rules={[{ required: true, message: '請選擇學制' }]}><Select mode="multiple" options={SCHOOL_LEVELS.map((l) => ({ value: l, label: l }))} /></Form.Item>
        <Space wrap align="start">
          <Form.Item name="ownership" label="公私立"><Select style={{ width: 100 }} options={['公立', '私立'].map((x) => ({ value: x, label: x }))} /></Form.Item>
          <Form.Item name="city" label="縣市" rules={[{ required: true, message: '請選擇縣市' }]}><Select style={{ width: 120 }} options={CITIES.map((x) => ({ value: x, label: x }))} /></Form.Item>
          <Form.Item name="phone" label="電話"><Input style={{ width: 160 }} /></Form.Item>
        </Space>
        <Form.Item name="address" label="地址" extra="含縣市與鄉鎮市區，用來決定所屬分區"><Input /></Form.Item>
      </Form>
    </Modal>
  )
}
