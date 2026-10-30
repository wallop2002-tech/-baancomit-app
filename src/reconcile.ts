// อ่านข้อความที่วางจากชีตหรือไฟล์ธนาคาร/ขนส่ง (คั่นด้วย tab) แล้วแปลงเป็นแถวข้อมูล
// ไม่ยึดตำแหน่งคอลัมน์ตายตัว เพราะไฟล์แต่ละแหล่งเรียงไม่เหมือนกัน

import { toSatang } from './db'

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/
const MONEY = /^-?[\d,]+(\.\d+)?$/
const TRACKING = /^([A-Z]{2}[A-Z0-9]{8,}|\d{12,})$/

export function thaiDate(cell: string): string | null {
  const m = DATE.exec(cell.trim())
  if (!m) return null
  let year = Number(m[3])
  if (year > 2400) year -= 543
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export type BankRow = { txnAt: string; amount: number; description: string; refCode: string | null }

export function parseBankPaste(text: string): BankRow[] {
  const rows: BankRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t').map((s) => s.trim())
    const dateIdx = cells.findIndex((s) => DATE.test(s))
    if (dateIdx < 0) continue
    const date = thaiDate(cells[dateIdx])!
    const timeCell = cells.slice(dateIdx + 1).find((s) => TIME.test(s))
    const time = timeCell ? timeCell.slice(0, 5).padStart(5, '0') : '00:00'
    // ยอดเงิน = ตัวเลขตัวแรกหลังวันที่ที่มีจุดทศนิยมหรือคอมมา (ตัวถัดไปมักเป็นยอดคงเหลือ)
    const amountCell = cells.slice(dateIdx + 1).find((s) => MONEY.test(s) && /[.,]/.test(s))
    const amount = toSatang(amountCell)
    if (amount == null || amount <= 0) continue
    const texts = cells.filter((s) => s && !MONEY.test(s) && !DATE.test(s) && !TIME.test(s))
    const description = texts.sort((a, b) => b.length - a.length)[0] ?? ''
    rows.push({ txnAt: `${date}T${time}:00`, amount, description, refCode: cells[0] && !DATE.test(cells[0]) ? cells[0] : null })
  }
  return rows
}

export type CodRow = { tracking: string; cod: number; fee: number; depositOn: string | null }

export function parseCodPaste(text: string): CodRow[] {
  const rows: CodRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t').map((s) => s.trim())
    const trackIdx = cells.findIndex((s) => TRACKING.test(s))
    if (trackIdx < 0) continue
    const money = cells.slice(trackIdx + 1).filter((s) => MONEY.test(s) && /[.,]/.test(s)).map((s) => toSatang(s)!)
    if (money.length === 0) continue
    // รูปแบบ COD_WCY: ยอด COD, ค่าธรรมเนียม, ยอดโอนจริง
    const cod = money[0]
    const fee = money.length >= 3 && money[0] - money[1] === money[2] ? money[1] : 0
    const dateCell = cells.find((s) => DATE.test(s))
    rows.push({ tracking: cells[trackIdx], cod, fee, depositOn: dateCell ? thaiDate(dateCell) : null })
  }
  return rows
}
