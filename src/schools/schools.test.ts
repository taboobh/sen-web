import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readdirSync, readFileSync } from 'node:fs'
import { createRbacData } from '../mock/data'
import { mergeMoe, parseMoeWorkbook, townOf, normCode } from './moe'
import { applyImport, previewImport } from './schoolData'
import { orgSelectable, syncSsoAffiliation } from '../auth/engine'

/** 以教育部統計處 115 學年度真實名錄（public/moe/115）對 114 學年度種子資料做年度匯入 */
const DIR = 'public/moe/115'
const PARSED = readdirSync(DIR).sort().map((f) => parseMoeWorkbook(XLSX, readFileSync(`${DIR}/${f}`), f))
const files115 = () => structuredClone(PARSED)
const NOW = '2026-08-05'

describe('統計處名錄解析', () => {
  it('辨識每個檔案的學制、新設籌備處名單、異動一覽表', () => {
    const fs = files115()
    const kind = (name: string) => fs.find((f) => f.fileName === name)!
    expect(kind('e1_new.xlsx')).toMatchObject({ kind: 'list', level: '國小', year: 115 })
    expect(kind('j1_new.xlsx')).toMatchObject({ kind: 'list', level: '國中' })
    expect(kind('high.xlsx')).toMatchObject({ kind: 'list', level: '高中職' })
    expect(kind('sp1_new.xlsx').level).toBe('特殊教育學校')
    expect(kind('school04_new.xls').level).toBe('海外臺校')
    expect(kind('school_exp.xls').level).toBe('實驗教育機構')
    expect(kind('newcj_new.xlsx').kind).toBe('newList')
    expect(kind('115_BasicChange.xlsx').kind).toBe('change')
    expect(kind('e1_new.xlsx').schools.length).toBeGreaterThan(2500)
  })

  it('沒有代碼的籌備處不匯入；有代碼的籌備處標示 preparing', () => {
    const b = mergeMoe(files115())
    expect(b.skipped.some((x) => x.name.includes('五福國小') && x.reason.includes('籌備處'))).toBe(true)
    expect(b.schools.find((s) => s.code === '033605')).toMatchObject({ preparing: true })
  })

  it('同代碼的附設國中、國小部合併學制；校名以高中名錄為準', () => {
    const b = mergeMoe(files115())
    const s = b.schools.find((x) => x.code === '011301')!   // 私立淡江高中
    expect(s.levels).toEqual(['國小', '國中', '高中職'])
    expect(s.name).toBe('私立淡江高中')
  })

  it('由地址取得鄉鎮市區', () => {
    expect(townOf('新北市', '新北市板橋區大觀路一段32號')).toBe('板橋區')
    expect(townOf('臺南市', '臺南市新市區中興街1號')).toBe('新市區')
    expect(townOf('桃園市', '桃園市平鎮區中豐路')).toBe('平鎮區')
    expect(townOf('屏東縣', '屏東縣三地門鄉中正路')).toBe('三地門鄉')
    expect(townOf('臺東縣', '950臺東市中華路一段684號')).toBe('臺東市')
    expect(townOf('臺北市', '臺北市忠孝東路五段790巷27號')).toBe('')
    expect(normCode(140401)).toBe('140401')
    expect(normCode(10301)).toBe('010301')
  })

  it('解析異動一覽表：改制換代碼、停辦、停招', () => {
    const b = mergeMoe(files115())
    expect(b.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: '改制', code: '141502', oldCode: '141307' }),
      expect.objectContaining({ kind: '停辦', code: '084514' }),
      expect.objectContaining({ kind: '停辦', code: '171405' }),
      expect.objectContaining({ kind: '停招', code: '111419' }),
    ]))
  })
})

describe('114 → 115 學年度年度匯入', () => {
  it('預覽列出新設、籌備處、改制換代碼、停辦與名錄未列', () => {
    const data = createRbacData()
    const pv = previewImport(data, mergeMoe(files115()))
    const of = (code: string) => pv.items.find((i) => i.code === code)
    expect(pv.year).toBe(115)
    expect(pv.carriedLevels).toEqual(['學前'])                 // 統計處未提供學前名錄 → 沿用、不判定廢校
    expect(of('013605')).toMatchObject({ kind: 'new' })        // 新北市立力行國小（新設校）
    expect(of('183301')).toMatchObject({ kind: 'preparing' })  // 新竹市立建華高中籌備處
    expect(of('141502')).toMatchObject({ kind: 'recode', suggestion: 'apply' })  // 育仁高中 141307 → 育仁國中 141502
    expect(of('084514')).toMatchObject({ kind: 'missing', suggestion: 'closed' })   // 南投縣立瑞竹國中（停辦）
    expect(of('111419')).toMatchObject({ kind: 'status', suggestion: 'closing' })    // 私立陽明工商（停招，尚有在學學生）
    expect(of('141307')).toBeUndefined()                       // 已由改制處理，不另列名錄未列
    expect(pv.items.filter((i) => i.kind === 'changed').length).toBeGreaterThan(50)
  })

  it('套用後：改制沿用原學校、停辦設為廢校、新設校建立並掛到正確分區', () => {
    const data = createRbacData()
    const before = data.scopes.find((x) => x.school?.code === '141307')!
    const { done } = applyImport(data, mergeMoe(files115()), {}, '王署管', NOW)
    expect(done.recode).toBeGreaterThan(0)
    const after = data.scopes.find((x) => x.school?.code === '141502')!
    expect(after.id).toBe(before.id)                           // 同一節點：帳號、角色、學生不受影響
    expect(after.school!.oldCodes).toEqual(['141307'])
    expect(data.scopes.find((x) => x.school?.code === '084514')!.school!.status).toBe('closed')
    const lixing = data.scopes.find((x) => x.school?.code === '013605')!
    expect(lixing.school!.status).toBe('active')
    expect(data.scopes.find((x) => x.school?.code === '183301')!.school!.status).toBe('preparing')
    // 名錄的國教署節點路徑仍正確
    for (const n of data.scopes.filter((x) => x.type === 'SCHOOL')) expect(n.path.endsWith('/' + n.id)).toBe(true)
  })

  it('仍有學生的學校名錄未列時建議停招，不直接廢校', () => {
    const data = createRbacData()
    const batch = mergeMoe(files115())
    batch.schools = batch.schools.filter((s) => s.code !== '014601')   // 假設板橋國小（示範學生所在）未列
    const it = previewImport(data, batch).items.find((i) => i.code === '014601')!
    expect(it).toMatchObject({ kind: 'missing', suggestion: 'closing' })
    expect(it.students).toBeGreaterThan(0)
  })

  it('廢校不能再選為任職機構，停招與未啟用仍可', () => {
    const data = createRbacData()
    applyImport(data, mergeMoe(files115()), {}, '王署管', NOW)
    const closed = data.scopes.find((x) => x.school?.code === '084514')!
    const prep = data.scopes.find((x) => x.school?.code === '183301')!
    expect(orgSelectable(closed)).toBe(false)
    expect(orgSelectable(prep)).toBe(true)
    // 教育雲端回傳已廢校的學校代碼 → 不變更任職機構
    expect(syncSsoAffiliation(data, 'a14', [closed.id], NOW)).toEqual([])
  })

  it('同一份名錄重複匯入不會再產生異動', () => {
    const data = createRbacData()
    const batch = mergeMoe(files115())
    applyImport(data, batch, {}, '王署管', NOW)
    const again = previewImport(data, batch)
    expect(again.items.filter((i) => i.kind !== 'missing' && i.kind !== 'status')).toEqual([])
  })
})
