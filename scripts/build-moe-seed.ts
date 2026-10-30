/**
 * 由教育部統計處名錄（xlsx／xls）產生原型的學校種子資料：
 *   npx vite-node scripts/build-moe-seed.ts <114學年度名錄資料夾>
 * 輸出 src/mock/moeSeed.json（壓縮欄位）。
 */
import * as XLSX from 'xlsx'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { parseMoeWorkbook, mergeMoe } from '../src/schools/moe'
const dir = process.argv[2]
const files = readdirSync(dir).sort().map((f) => parseMoeWorkbook(XLSX, readFileSync(`${dir}/${f}`), f))
const b = mergeMoe(files)
const rows = b.schools.map((s) => [s.code, s.name, s.ownership, s.city, s.town, s.zip, s.address, s.phone, s.website, s.levels.join(','), s.preparing ? 1 : 0, s.branches?.length ? s.branches.map((b) => [b.code, b.name, b.town, b.address, b.phone]) : 0])
writeFileSync('src/mock/moeSeed.json', JSON.stringify({ year: b.year, levels: b.levels, source: '教育部統計處各級學校名錄', files: b.files.map((f) => f.fileName), rows }))
console.log('schools', rows.length, 'year', b.year, 'bytes', JSON.stringify(rows).length)
