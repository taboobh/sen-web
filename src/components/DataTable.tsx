import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react'
import { Button, Checkbox, Input, Popover, Space, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import type { SorterResult } from 'antd/es/table/interface'
import { DownloadOutlined, SettingOutlined } from '@ant-design/icons'

/**
 * SEN-WEB 全站列表規則：凡是列表一律具備「查詢、篩選、排序、匯出 Excel」；
 * 匯出的是「目前畫面上篩選＋查詢＋排序後」的資料，不是全部；只匯出畫面上顯示的欄位。
 * 欄位可由「顯示欄位」切換；查詢仍涵蓋隱藏的欄位（例如隱藏全銜仍可用全銜查詢）。
 */
export interface Col<T> {
  key: string
  title: string
  /** 畫面標題若需要多行／標註，另給節點；匯出一律用 title */
  titleNode?: ReactNode
  /** 供查詢、篩選、排序、匯出使用的純文字／數字值 */
  value: (r: T) => string | number | null | undefined
  /** 一格有多個值（例如多個角色）：篩選以單一值為選項、列內符合任一即顯示 */
  values?: (r: T) => string[]
  render?: (r: T) => ReactNode
  /** false＝不提供欄位篩選（例如操作欄） */
  filter?: boolean
  /** true＝不納入匯出與查詢（例如操作欄） */
  noExport?: boolean
  width?: number
  fixed?: 'left' | 'right'
  /** true＝預設不顯示，使用者可從「顯示欄位」打開 */
  hidden?: boolean
}

interface Props<T> {
  rows: T[]
  columns: Col<T>[]
  rowKey: (r: T) => string
  /** 匯出檔名（不含副檔名） */
  exportName: string
  loading?: boolean
  pageSize?: number
  pagination?: false
  scrollX?: number
  /** false＝不可匯出（例如角色沒有匯出權限）；exportTip 說明原因 */
  canExport?: boolean
  exportTip?: string
  /** 匯出前的掛鉤（例如寫稽核） */
  onExport?: (count: number) => void
  extra?: ReactNode
  /** 展開列：例如帳號列展開後看每一筆角色指派明細 */
  expandedRowRender?: (r: T) => ReactNode
  /** 匯出時額外的工作表（例如帳號彙總＋每筆指派明細），依目前篩選後的列產生 */
  extraSheets?: (view: T[]) => { name: string; rows: Record<string, unknown>[] }[]
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const collator = new Intl.Collator('zh-Hant-TW', { numeric: true })
const LS = (name: string) => `sen-web:cols:${name}`
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

export default function DataTable<T>(p: Props<T>) {
  const { rows, columns, rowKey } = p
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, Key[] | null>>({})
  const [sort, setSort] = useState<{ key: string; order: 'ascend' | 'descend' } | null>(null)
  const defaultHidden = useMemo(() => columns.filter((c) => c.hidden).map((c) => c.key), [columns])
  const [hidden, setHidden] = useState<string[]>(() => {
    try { const v = localStorage.getItem(LS(p.exportName)); if (v) return JSON.parse(v) as string[] } catch { /* 無法使用瀏覽器儲存時用預設 */ }
    return defaultHidden
  })
  useEffect(() => { try { localStorage.setItem(LS(p.exportName), JSON.stringify(hidden)) } catch { /* 忽略 */ } }, [hidden, p.exportName])
  const shown = columns.filter((c) => !hidden.includes(c.key))
  const toggleCol = (key: string, on: boolean) => {
    setHidden((h) => on ? h.filter((k) => k !== key) : [...h, key])
    if (!on) { setFilters((f) => ({ ...f, [key]: null })); if (sort?.key === key) setSort(null) }
  }

  const view = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let out = rows.filter((r) => !kw || columns.some((c) => !c.noExport && str(c.value(r)).toLowerCase().includes(kw)))
    for (const c of columns) {
      const sel = filters[c.key]
      if (sel && sel.length) out = out.filter((r) => c.values ? c.values(r).some((v) => sel.includes(v)) : sel.includes(str(c.value(r))))
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)
      if (c) {
        const dir = sort.order === 'ascend' ? 1 : -1
        out = [...out].sort((a, b) => {
          const x = c.value(a), y = c.value(b)
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
          return collator.compare(str(x), str(y)) * dir
        })
      }
    }
    return out
  }, [rows, columns, q, filters, sort])

  const antCols: ColumnsType<T> = shown.map((c) => {
    const distinct = [...new Set(rows.flatMap((r) => c.values ? c.values(r) : [str(c.value(r))]))].filter((v) => v !== '').sort(collator.compare)
    const canFilter = c.filter !== false && !c.noExport && distinct.length > 0
    return {
      key: c.key, title: c.titleNode ?? c.title, width: c.width, fixed: c.fixed,
      render: (_: unknown, r: T) => (c.render ? c.render(r) : str(c.value(r)) || '-'),
      sorter: c.noExport ? undefined : true,
      sortOrder: sort?.key === c.key ? sort.order : null,
      ...(canFilter ? {
        filters: distinct.map((v) => ({ text: v, value: v })),
        filteredValue: filters[c.key] ?? null,
        filterSearch: true,
      } : {}),
    }
  })

  const hasCond = !!q || Object.values(filters).some((v) => v && v.length) || !!sort
  const exportable = p.canExport !== false

  const doExport = async () => {
    const cols = shown.filter((c) => !c.noExport)
    const data = view.map((r) => Object.fromEntries(cols.map((c) => [c.title, c.value(r) ?? ''])))
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(data, { header: cols.map((c) => c.title) })
    ws['!cols'] = cols.map((c) => ({ wch: Math.max(c.title.length * 2, ...view.slice(0, 200).map((r) => str(c.value(r)).length * 2), 8) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, p.extraSheets ? '帳號彙總' : '資料')
    for (const sh of p.extraSheets?.(view) ?? []) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sh.rows), sh.name)
    XLSX.writeFile(wb, `${p.exportName}_${stamp()}.xlsx`)
    p.onExport?.(view.length)
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Input.Search allowClear placeholder="查詢（任一欄位）" style={{ width: 240 }} value={q}
            onChange={(e) => setQ(e.target.value)} onSearch={setQ} />
          <Button disabled={!hasCond} onClick={() => { setQ(''); setFilters({}); setSort(null) }}>清除查詢／篩選／排序</Button>
          <Typography.Text type="secondary">顯示 {view.length} / 共 {rows.length} 筆</Typography.Text>
        </Space>
        <Space wrap>
          {p.extra}
          <Popover trigger="click" placement="bottomRight" title="顯示欄位" content={
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {columns.map((c) => <div key={c.key}><Checkbox checked={!hidden.includes(c.key)} disabled={!hidden.includes(c.key) && shown.length <= 1}
                onChange={(e) => toggleCol(c.key, e.target.checked)}>{c.title}</Checkbox></div>)}
              <Button size="small" type="link" style={{ padding: 0, marginTop: 4 }} onClick={() => setHidden(defaultHidden)}>恢復預設</Button>
            </div>}>
            <Button icon={<SettingOutlined />}>顯示欄位{hidden.length ? `（隱藏 ${hidden.length}）` : ''}</Button>
          </Popover>
          <Tooltip title={exportable ? (hasCond ? '只匯出目前篩選後的資料' : '') : p.exportTip}>
            <Button icon={<DownloadOutlined />} disabled={!exportable || view.length === 0} onClick={() => { void doExport() }}>匯出 Excel</Button>
          </Tooltip>
        </Space>
      </Space>
      <Table<T>
        size="small" loading={p.loading} rowKey={rowKey} dataSource={view} columns={antCols}
        scroll={{ x: hidden.length ? Math.max(600, shown.reduce((s, c) => s + (c.width ?? 150), 0)) : p.scrollX ?? 800 }}
        expandable={p.expandedRowRender ? { expandedRowRender: p.expandedRowRender } : undefined}
        pagination={p.pagination === false ? false : { pageSize: p.pageSize ?? 10, showSizeChanger: true, hideOnSinglePage: false } as TablePaginationConfig}
        onChange={(_pg, f, s) => {
          const next: Record<string, Key[] | null> = {}
          for (const [k, v] of Object.entries(f)) next[k] = v ? (v as Key[]) : null
          setFilters(next)
          const one = (Array.isArray(s) ? s[0] : s) as SorterResult<T> | undefined
          setSort(one?.order && one.columnKey ? { key: String(one.columnKey), order: one.order } : null)
        }}
      />
    </>
  )
}
