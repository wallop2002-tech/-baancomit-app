// สร้างไฟล์ SQL สำหรับย้ายข้อมูลปี 2026 จาก 3 ชีตเดิมเข้า D1
//
// ใช้: npx tsx scripts/import.ts <โฟลเดอร์ CSV> <ไฟล์ SQL ที่จะสร้าง>
// แล้ว: npx wrangler d1 execute baancomit-db --remote --file <ไฟล์ SQL>
// (หรือใช้หน้า "นำเข้าข้อมูล" ในแอป อัปโหลดไฟล์ .xlsx ได้เลย ไม่ต้องรันสคริปต์นี้)
//
// CSV ได้จาก Google Sheets: เปิดแท็บ > ไฟล์ > ดาวน์โหลด > CSV (ชื่อไฟล์จะเป็น "<ชื่อชีต> - <ชื่อแท็บ>.csv")
//
// ห้าม commit ไฟล์ CSV หรือ SQL ที่สร้างออกมา เพราะมีข้อมูลลูกค้าจริง

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSql, parseCsv } from '../src/importer'

function csvReader(dir: string) {
  const want = (s: string) => s.normalize('NFC')
  const files = readdirSync(dir)
  return (name: string) => {
    const file = files.find((f) => want(f) === want(`${name}.csv`))
    if (!file) { console.warn(`ไม่พบไฟล์ ${name}.csv ข้าม`); return null }
    return parseCsv(readFileSync(join(dir, file), 'utf8').replace(/^\uFEFF/, ''))
  }
}

if (process.argv[1]?.endsWith('import.ts')) {
  const [dir, outFile] = process.argv.slice(2)
  if (!dir || !outFile) {
    console.error('ใช้: npx tsx scripts/import.ts <โฟลเดอร์ CSV> <ไฟล์ SQL>')
    process.exit(1)
  }
  const { sql, counts } = buildSql(csvReader(dir))
  writeFileSync(outFile, sql)
  console.table(counts)
  console.log(`เขียน ${outFile} แล้ว`)
}
