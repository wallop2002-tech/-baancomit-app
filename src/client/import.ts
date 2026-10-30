// หน้า "นำเข้าข้อมูล": อ่านไฟล์ .xlsx ที่ดาวน์โหลดจาก Google Sheets ในเบราว์เซอร์
// แปลงเป็นคำสั่ง SQL ด้วยตัวแปลงเดียวกับสคริปต์ แล้วส่งเข้าแอปทีละชุด
// ข้อมูลลูกค้าไม่ถูกเก็บไว้ที่ไหนนอกจากฐานข้อมูลของแอป

import * as XLSX from 'xlsx'
import { SOURCE_SIGNATURE, SOURCE_TABS, buildSql } from '../importer'

const CHUNK = 200
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const files = $<HTMLInputElement>('files')
const summary = $('summary')
const run = $<HTMLButtonElement>('run')
const progress = $<HTMLProgressElement>('progress')
const status = $('status')

let statements: string[] = []

// เหมือนไฟล์ CSV ที่ Google Sheets ส่งออก: วันที่ใช้ข้อความตามที่แสดง ตัวเลขใช้ค่าจริง (ไม่มี ฿ หรือคอมมา)
function sheetRows(ws: any): string[][] {
  if (!ws['!ref']) return []
  const range = XLSX.utils.decode_range(ws['!ref'])
  const rows: string[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = []
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell) row.push('')
      else if (cell.t === 'n' && !(cell.z && XLSX.SSF.is_date(cell.z))) row.push(String(cell.v))
      else row.push(cell.w ?? String(cell.v ?? ''))
    }
    rows.push(row)
  }
  // แถวว่างกลางตารางต้องคงไว้ เพราะเลขแถวใช้เป็นรหัสกันนำเข้าซ้ำ เหมือนไฟล์ CSV
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
  return rows
}

files.addEventListener('change', async () => {
  run.disabled = true
  statements = []
  summary.textContent = 'กำลังอ่านไฟล์...'
  const tabs = new Map<string, string[][]>()
  const found: string[] = []
  const unknown: string[] = []
  const wanted = Object.values(SOURCE_TABS).flat()
  for (const file of Array.from(files.files ?? [])) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', sheets: wanted, cellDates: false })
    const source = Object.keys(SOURCE_SIGNATURE).find((s) => wb.Sheets[SOURCE_SIGNATURE[s]])
    if (!source) { unknown.push(file.name); continue }
    found.push(source)
    for (const tab of SOURCE_TABS[source]) {
      const ws = wb.Sheets[tab]
      if (!ws) continue
      tabs.set(`${source} - ${tab}`, sheetRows(ws))
    }
  }
  const missing = Object.keys(SOURCE_TABS).filter((s) => !found.includes(s))
  const built = buildSql((name) => tabs.get(name) ?? null)
  statements = built.statements
  const lines = [
    `พบชีต: ${found.join(', ') || '-'}`,
    missing.length ? `ยังไม่ได้เลือกไฟล์: ${missing.join(', ')} (นำเข้าเฉพาะที่มีได้ ค่อยนำเข้าที่เหลือภายหลัง)` : '',
    unknown.length ? `ไม่รู้จักไฟล์: ${unknown.join(', ')}` : '',
    '',
    ...Object.entries(built.counts).map(([k, n]) => `${k}: ${n.toLocaleString()}`),
    '',
    `รวม ${statements.length.toLocaleString()} คำสั่ง`,
  ]
  summary.textContent = lines.filter((l, i) => l || i > 2).join('\n')
  run.disabled = statements.length === 0
})

run.addEventListener('click', async () => {
  run.disabled = true
  files.disabled = true
  progress.max = statements.length
  progress.value = 0
  for (let i = 0; i < statements.length; i += CHUNK) {
    const chunk = statements.slice(i, i + CHUNK)
    let res: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch('/import/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statements: chunk }) }).catch(() => null)
      if (res?.ok) break
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
    if (!res?.ok) {
      const msg = res ? await res.text() : 'เชื่อมต่อไม่ได้'
      status.textContent = `หยุดที่คำสั่งที่ ${i + 1}: ${msg}\nกดนำเข้าใหม่ได้ แถวที่เข้าแล้วจะไม่ซ้ำ`
      run.disabled = false
      files.disabled = false
      return
    }
    progress.value = i + chunk.length
    status.textContent = `นำเข้าแล้ว ${progress.value.toLocaleString()} / ${statements.length.toLocaleString()} คำสั่ง`
  }
  status.textContent = 'นำเข้าเสร็จแล้ว ✓ ไปดูที่หน้าภาพรวม ออเดอร์ หรือสต็อกได้เลย'
  files.disabled = false
})
