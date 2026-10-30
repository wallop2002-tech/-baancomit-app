// สร้างไฟล์ SQL สำหรับย้ายข้อมูลปี 2026 จาก 3 ชีตเดิมเข้า D1
//
// ใช้: npx tsx scripts/import.ts <โฟลเดอร์ CSV> <ไฟล์ SQL ที่จะสร้าง>
// แล้ว: npx wrangler d1 execute baancomit-db --remote --file <ไฟล์ SQL>
//
// CSV ได้จาก Google Sheets: เปิดแท็บ > ไฟล์ > ดาวน์โหลด > CSV (ชื่อไฟล์จะเป็น "<ชื่อชีต> - <ชื่อแท็บ>.csv")
// รันซ้ำได้: ทุกแถวมี legacy_key และใช้ INSERT OR IGNORE
//
// ห้าม commit ไฟล์ CSV หรือ SQL ที่สร้างออกมา เพราะมีข้อมูลลูกค้าจริง

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toSatang } from '../src/db'
import { parseBankPaste, parseCodPaste } from '../src/reconcile'

const YEAR = 2026
const BCI = 1 // บ้านคอมไอที เจ้าของสต็อก
const ORDER_TABS = [
  { file: 'สมุดโอนครบ - วีแคร์ยู', business: 4, code: 'WCY' },
  { file: 'สมุดโอนครบ - KhunNoi', business: 5, code: 'NOI' },
]
const BANK_TABS = [
  { file: 'สมุดโอนครบ - กสิกร', business: 4, account: 'KBANK-WCY', keyCol: 20 },
  { file: 'สมุดโอนครบ - BankNoi', business: 5, account: 'BANK-NOI', keyCol: 16 },
]
const COD_TABS = ['สมุดโอนครบ - COD_WCY', 'สมุดโอนครบ - COD_Noi']
const OUR_BUSINESSES = new Set(['ไนซ์ไอที', 'นายไอที', 'บ้านคอมไอที', 'BAANCOMIT'])

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function readTab(dir: string, name: string): string[][] | null {
  const want = (s: string) => s.normalize('NFC')
  const file = readdirSync(dir).find((f) => want(f) === want(`${name}.csv`))
  if (!file) { console.warn(`ไม่พบไฟล์ ${name}.csv ข้าม`); return null }
  return parseCsv(readFileSync(join(dir, file), 'utf8').replace(/^﻿/, ''))
}

// ---------- ค่า ----------
const q = (v: string | number | null | undefined) =>
  v == null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
const money = (s: string | undefined) => toSatang(s) ?? 0
const pad = (n: number | string) => String(n).padStart(2, '0')

// "27/7" หรือ "27/7, 15:49" หรือ "6/2/2026, 11:00:44" → YYYY-MM-DD
export function dayMonth(s: string | undefined, year: number): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.exec((s ?? '').trim())
  if (!m) return null
  return `${m[3] ?? year}-${pad(m[2])}-${pad(m[1])}`
}

function dateTime(s: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((s ?? '').trim())
  if (!m) return dayMonth(s, YEAR)
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] ?? '00'}`
}

// Keyเช็คโอน = yymmddHHMM + ยอดเงิน เช่น 260727194315900 → ปี 2026
export function keyYear(key: string | undefined): number | null {
  return /^\d{11,}$/.test(key ?? '') ? 2000 + Number(key!.slice(0, 2)) : null
}

export function carrierOf(tracking: string): string {
  if (/^[A-Z]{2}\d{9}TH$/.test(tracking)) return 'ไปรษณีย์'
  if (/^SHP|^KER/i.test(tracking)) return 'Kerry'
  return 'Flash'
}

// ---------- สร้าง SQL ----------
export function buildSql(dir: string): { sql: string; counts: Record<string, number> } {
  const out: string[] = []
  const counts: Record<string, number> = {}
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
  const unit = (serial: string) => `(SELECT id FROM serial_units WHERE business_id = ${BCI} AND serial = ${q(serial)})`
  const order = (key: string) => `(SELECT id FROM orders WHERE legacy_key = ${q(key)})`

  // สต็อก: รุ่นและเครื่องทีละ Serial
  const stockOut = new Map<string, { kind: string; dest: string; at: string | null; row: number }>()
  for (const [i, r] of (readTab(dir, 'IT_STOCK_SYSTEM - STOCK_OUT') ?? []).slice(1).entries()) {
    if (r[1]) stockOut.set(r[1].trim(), { kind: r[4] ?? '', dest: r[5] ?? '', at: dateTime(r[0]), row: i + 2 })
  }
  const products = new Set<string>()
  for (const r of (readTab(dir, 'IT_STOCK_SYSTEM - MASTER_STOCK') ?? []).slice(1)) {
    const [code, spec, cost, price, supplier, , serial, status, dateIn, note, lot] = r.map((s) => (s ?? '').trim())
    if (!code || !serial) continue
    if (!products.has(code)) {
      products.add(code)
      out.push(`INSERT OR IGNORE INTO products (business_id, code, spec, list_price_satang) VALUES (${BCI}, ${q(code)}, ${q(spec)}, ${q(toSatang(price))});`)
      bump('products')
    }
    const so = stockOut.get(serial)
    let st = { IN: 'in_stock', RESERVED: 'reserved', CLAIMING: 'claim', RETURNED: 'transferred' }[status] ?? 'sold'
    if (status === 'OUT' && so) {
      if (so.kind === 'ขาย' && !OUR_BUSINESSES.has(so.dest)) st = 'sold'
      else if (so.kind === 'ขาย') st = 'transferred'
      else if (so.kind.startsWith('คืน')) st = 'transferred'
      else st = 'internal'
    }
    const noteText = [note, status === 'RETURNED' ? 'คืนซัพพลายเออร์' : ''].filter(Boolean).join(' · ')
    out.push(
      `INSERT OR IGNORE INTO serial_units (business_id, product_id, serial, cost_satang, supplier, lot_no, status, received_at, note) VALUES (${BCI}, (SELECT id FROM products WHERE business_id = ${BCI} AND code = ${q(code)}), ${q(serial)}, ${q(toSatang(cost))}, ${q(supplier)}, ${q(Number(lot) || null)}, '${st}', ${q(dateTime(dateIn) ?? `${YEAR}-01-01`)}, ${q(noteText)});`,
    )
    bump('serial_units')
    if (so) {
      const kind = so.kind === 'ขาย' && !OUR_BUSINESSES.has(so.dest) ? 'sale' : so.kind.startsWith('คืน') ? 'return' : so.kind === 'ขาย' ? 'transfer' : 'internal'
      out.push(`INSERT OR IGNORE INTO stock_movements (unit_id, kind, destination, moved_at, legacy_key) VALUES (${unit(serial)}, '${kind}', ${q(so.dest)}, ${q(so.at)}, ${q(`STOCK_OUT:${so.row}`)});`)
      bump('stock_movements')
    }
  }

  // ออเดอร์จากสมุดโอนครบ (แถวที่ 1-2 เป็นหัวตาราง)
  for (const tab of ORDER_TABS) {
    const rows = readTab(dir, tab.file)
    if (!rows) continue
    const header = rows[1] ?? []
    if (header[2] !== 'เลขFlash' || header[33] !== 'Product_ID') throw new Error(`หัวตาราง ${tab.file} ไม่ตรงรูปแบบที่คาด`)
    const hasRealName = header[6] === 'ชื่อจริง'
    for (const [i, r0] of rows.slice(2).entries()) {
      const r = r0.map((s) => (s ?? '').trim())
      const model = r[33] || r[0]
      if (!model || !r[5]) continue
      const year = keyYear(r[9]) ?? keyYear(r[15]) ?? YEAR
      if (year !== YEAR) { bump('ข้ามแถวปีอื่น'); continue }
      const soldOn = dayMonth(r[4], year) ?? dayMonth(r[12], year)
      if (!soldOn) { bump('ข้ามแถวไม่มีวันที่'); continue }
      const key = `${tab.code}:${i + 3}`
      const transfer = money(r[11]), extra = money(r[17]), cod = money(r[13]), cash = money(r[21])
      const total = money(r[20]) || transfer + extra + cod + cash || money(r[27])
      const paymentType = cod && (transfer || extra) ? 'mixed' : cod ? 'cod' : cash && !transfer ? 'cash' : 'transfer'
      const codPaid = cod > 0 && !!r[14]
      const paid = (codPaid ? cod : 0) + transfer + extra + cash
      const status = /ไม่รับ|ตีกลับ|ยกเลิก/.test(r[19]) ? 'returned' : total > 0 && paid >= total ? 'paid' : r[2] ? 'shipped' : 'open'

      out.push(`INSERT OR IGNORE INTO customers (facebook_name, full_name, legacy_key) VALUES (${q(r[5])}, ${q(hasRealName ? r[6] : null)}, ${q(key)});`)
      if (r[8]) out.push(`INSERT OR IGNORE INTO teams (business_id, name) VALUES (${tab.business}, ${q(`ทีม ${r[8]}`)});`)
      out.push(
        `INSERT OR IGNORE INTO orders (business_id, customer_id, team_id, sold_on, house_no, price_satang, real_price_satang, payment_type, status, note, legacy_key) VALUES (${tab.business}, (SELECT id FROM customers WHERE legacy_key = ${q(key)}), ${r[8] ? `(SELECT id FROM teams WHERE business_id = ${tab.business} AND name = ${q(`ทีม ${r[8]}`)})` : 'NULL'}, '${soldOn}', ${q(r[7])}, ${total}, ${q(toSatang(r[25]))}, '${paymentType}', '${status}', ${q([r[19], r[29]].filter(Boolean).join(' · '))}, ${q(key)});`,
      )
      bump(`orders ${tab.code}`)

      out.push(`INSERT OR IGNORE INTO products (business_id, code) VALUES (${BCI}, ${q(model)});`)
      const serial = r[31]
      out.push(
        `INSERT OR IGNORE INTO order_items (order_id, product_id, unit_id, price_satang, legacy_key) VALUES (${order(key)}, (SELECT id FROM products WHERE business_id = ${BCI} AND code = ${q(model)}), ${serial ? unit(serial) : 'NULL'}, ${total}, ${q(key)});`,
      )
      if (serial) {
        out.push(`UPDATE serial_units SET status = 'sold' WHERE id = ${unit(serial)} AND status IN ('in_stock', 'reserved');`)
        out.push(`INSERT OR IGNORE INTO stock_movements (unit_id, kind, order_id, moved_at, legacy_key) SELECT ${unit(serial)}, 'sale', ${order(key)}, ${q(dateTime(r[32]) ?? soldOn)}, ${q(`sale:${key}`)} WHERE ${unit(serial)} IS NOT NULL;`)
      }

      if (/^([A-Z]{2}[A-Z0-9]{8,}|\d{12,})$/.test(r[2])) {
        out.push(`INSERT OR IGNORE INTO shipments (order_id, carrier, tracking_no, invoice_no, shipped_on, cod_satang, status) VALUES (${order(key)}, '${carrierOf(r[2])}', ${q(r[2])}, ${q(r[3])}, '${soldOn}', ${cod}, '${codPaid ? 'cod_settled' : status === 'returned' ? 'returned' : 'shipped'}');`)
        bump('shipments')
      }

      // เงินเข้า: Keyเช็คโอน ตรงกับ Keyโอน ของ statement จึงผูกกับแถวธนาคารได้ทันที
      const pay = (kind: string, amount: number, on: string | null, bankKey: string | null, suffix: string) => {
        if (!amount) return
        out.push(
          `INSERT OR IGNORE INTO payments (order_id, kind, amount_satang, paid_on, match_status, legacy_key) VALUES (${order(key)}, '${kind}', ${amount}, '${on ?? soldOn}', 'confirmed', ${q(`${key}:${suffix}`)});`,
        )
        if (bankKey) out.push(`UPDATE payments SET bank_txn_id = (SELECT id FROM bank_transactions WHERE ref_code = ${q(bankKey)} LIMIT 1) WHERE legacy_key = ${q(`${key}:${suffix}`)};`)
        bump('payments')
      }
      pay('transfer', transfer, dayMonth(r[12], year), r[9] || null, 'transfer')
      pay('extra_transfer', extra, dayMonth(r[18], year), r[15] || null, 'extra')
      pay('cash', cash, soldOn, null, 'cash')
      if (codPaid) pay('cod', cod, dayMonth(r[14], year), null, 'cod')
    }
  }

  // statement ธนาคาร: ใช้ตัวอ่านเดียวกับหน้าจับคู่ยอดเงิน แล้วเก็บ Keyโอน ไว้ใน ref_code
  const bankSql: string[] = []
  for (const tab of BANK_TABS) {
    for (const r of readTab(dir, tab.file) ?? []) {
      const [row] = parseBankPaste(r.join('\t'))
      if (!row || !row.txnAt.startsWith(String(YEAR))) continue
      const key = r[tab.keyCol]?.trim() || `${row.txnAt.slice(2, 4)}${row.txnAt.slice(5, 7)}${row.txnAt.slice(8, 10)}${row.txnAt.slice(11, 13)}${row.txnAt.slice(14, 16)}${Math.floor(row.amount / 100)}`
      bankSql.push(`INSERT OR IGNORE INTO bank_transactions (business_id, account, txn_at, amount_satang, description, ref_code, import_batch) VALUES (${tab.business}, '${tab.account}', '${row.txnAt}', ${row.amount}, ${q(row.description)}, ${q(key)}, 'import-${YEAR}');`)
      bump('bank_transactions')
    }
  }

  // รอบโอน COD: บันทึกค่าธรรมเนียม และปิดพัสดุที่สมุดยังไม่ได้ลงวันจ่าย
  const codSql: string[] = []
  for (const file of COD_TABS) {
    for (const r of readTab(dir, file) ?? []) {
      const [row] = parseCodPaste(r.join('\t'))
      if (!row || (row.depositOn && !row.depositOn.startsWith(String(YEAR)))) continue
      codSql.push(`UPDATE shipments SET cod_fee_satang = ${row.fee}, status = 'cod_settled' WHERE tracking_no = ${q(row.tracking)};`)
      codSql.push(
        `INSERT OR IGNORE INTO payments (order_id, kind, amount_satang, paid_on, shipment_id, match_status, legacy_key) SELECT s.order_id, 'cod', ${row.cod}, ${q(row.depositOn)}, s.id, 'confirmed', ${q(`cod:${row.tracking}`)} FROM shipments s WHERE s.tracking_no = ${q(row.tracking)} AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = s.order_id AND p.kind = 'cod');`,
      )
      bump('cod rows')
    }
  }

  // เคลม
  for (const [i, r0] of (readTab(dir, 'IT_STOCK_SYSTEM - CLAIM_CUST') ?? []).slice(1).entries()) {
    const r = r0.map((s) => (s ?? '').trim())
    if (!r[1]) continue
    out.push(
      `INSERT OR IGNORE INTO claims (unit_id, direction, symptom, destination, sent_on, sent_tracking, received_back_on, returned_to_customer_on, return_tracking, legacy_key) SELECT ${unit(r[1])}, 'customer', ${q(r[4])}, ${q(r[5])}, ${q(dateTime(r[0]))}, ${q(r[7])}, ${q(dayMonth(r[12], YEAR))}, ${q(dayMonth(r[13], YEAR))}, ${q(r[14])}, ${q(`CLAIM_CUST:${i + 2}`)} WHERE ${unit(r[1])} IS NOT NULL;`,
    )
    bump('claims')
  }
  for (const [i, r0] of (readTab(dir, 'IT_STOCK_SYSTEM - CLAIM_OUT') ?? []).slice(1).entries()) {
    const r = r0.map((s) => (s ?? '').trim())
    if (!r[1]) continue
    out.push(
      `INSERT OR IGNORE INTO claims (unit_id, direction, symptom, destination, sent_on, legacy_key) SELECT ${unit(r[1])}, 'supplier', ${q(r[4])}, ${q(r[5])}, ${q(dateTime(r[0]))}, ${q(`CLAIM_OUT:${i + 2}`)} WHERE ${unit(r[1])} IS NOT NULL;`,
    )
    bump('claims')
  }

  // ธนาคารต้องเข้าก่อนออเดอร์ เพื่อให้การผูก Keyโอน หาแถวเจอ ส่วน COD ต้องตามหลังพัสดุ
  const stockEnd = out.findIndex((s) => s.startsWith('INSERT OR IGNORE INTO customers'))
  const ordered = stockEnd < 0 ? [...bankSql, ...out, ...codSql] : [...out.slice(0, stockEnd), ...bankSql, ...out.slice(stockEnd), ...codSql]
  // ออเดอร์ที่ได้เงินครบหลังรวม COD แล้ว
  ordered.push(
    `UPDATE orders SET status = 'paid' WHERE legacy_key IS NOT NULL AND status IN ('open', 'shipped') AND price_satang > 0 AND price_satang <= (SELECT COALESCE(SUM(amount_satang), 0) FROM payments p WHERE p.order_id = orders.id AND p.match_status = 'confirmed');`,
  )
  return { sql: ordered.join('\n') + '\n', counts }
}

if (process.argv[1]?.endsWith('import.ts')) {
  const [dir, outFile] = process.argv.slice(2)
  if (!dir || !outFile) {
    console.error('ใช้: npx tsx scripts/import.ts <โฟลเดอร์ CSV> <ไฟล์ SQL>')
    process.exit(1)
  }
  const { sql, counts } = buildSql(dir)
  writeFileSync(outFile, sql)
  console.table(counts)
  console.log(`เขียน ${outFile} แล้ว`)
}
