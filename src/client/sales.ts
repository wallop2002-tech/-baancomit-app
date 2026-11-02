// ตารางลงยอดขายแบบชีต: พิมพ์ทีละแถว เลื่อนแถวขึ้นลงได้ แล้วกดบันทึกครั้งเดียว
import { toSatang } from '../money'

type Model = { code: string; price: number | null; margin: number | null }
type Row = {
  id: number
  sold_on: string
  name: string
  model: string
  price: number
  house: string
  transfer: number | null
  cod: number | null
  installment: number | null
  key_com: string
  is_ad: boolean
  note: string
  sale_key: string
  real_price: number | null
  margin: number | null
  status: string
  ship_name: string
  address: string
  phone: string
  ship_note: string
}
type Data = { team: { id: number; name: string; code: string | null }; month: string; today: string; rows: Row[]; models: Model[] }

type Field = 'date' | 'name' | 'model' | 'price' | 'house' | 'transfer' | 'cod' | 'installment' | 'key_com' | 'note' | ShipField
type ShipField = 'ship_name' | 'address' | 'phone' | 'ship_note'
type Line = {
  id: number | null
  values: Record<Field, string>
  is_ad: boolean
  status: string
  dirty: boolean
  deleted: boolean
  error: string
  saved?: Row // ค่าจากฐานข้อมูล ใช้แสดงราคาจริง/M ของแถวเดิมที่ยังไม่เปลี่ยนรุ่น
}

const data: Data = JSON.parse(document.getElementById('sales-data')!.textContent!)
const models = new Map(data.models.map((m) => [m.code.toLowerCase(), m]))
const teamCode = data.team.code ?? data.team.name
const year = Number(data.month.slice(0, 4))
const table = document.getElementById('sheet') as HTMLTableElement
const msg = document.getElementById('msg')!
const saveBtn = document.getElementById('save') as HTMLButtonElement

// คอลัมน์ตามชีตจดยอดขายเซลล์
const COLUMNS: { field?: Field; label: string; width: number; num?: boolean; list?: string; calc?: 'team' | 'key' | 'real' | 'margin' | 'status'; check?: boolean }[] = [
  { field: 'date', label: 'วันที่', width: 70 },
  { field: 'name', label: 'ชื่อเฟสบุ๊คลูกค้า', width: 190 },
  { field: 'model', label: 'รุ่นเครื่อง', width: 120, list: 'models' },
  { field: 'price', label: 'ราคา', width: 85, num: true },
  { field: 'house', label: 'บ้านที่', width: 60 },
  { calc: 'team', label: 'ทีม', width: 50 },
  { field: 'transfer', label: 'โอนแล้ว', width: 85, num: true },
  { field: 'cod', label: 'ยอดกปท', width: 85, num: true },
  { field: 'installment', label: 'ผ่อน', width: 85, num: true },
  { field: 'key_com', label: 'คีย์คอม', width: 90 },
  { check: true, label: 'โฆษณา', width: 60 },
  { field: 'note', label: 'หมายเหต', width: 200 },
  { calc: 'key', label: 'KEY', width: 140 },
  { calc: 'real', label: 'ราคาจริง', width: 80, num: true },
  { calc: 'margin', label: 'M', width: 70, num: true },
  { calc: 'status', label: 'สถานะ', width: 70 },
]
// บรรทัดที่ 2 ของรายการ (ข้อมูลจัดส่ง) วางคร่อมคอลัมน์ของบรรทัดบน: [ช่อง, คอลัมน์เริ่ม, จำนวนคอลัมน์]
const SHIP: { field: ShipField; label: string; from: number; span: number; tel?: boolean }[] = [
  { field: 'ship_name', label: 'ชื่อผู้รับ', from: 1, span: 1 },
  { field: 'address', label: 'ที่อยู่จัดส่ง', from: 2, span: 6 },
  { field: 'phone', label: 'เบอร์มือถือ', from: 8, span: 2, tel: true },
  { field: 'ship_note', label: 'หมายเหตุการส่ง', from: 10, span: 6 },
]
const FIELDS: Field[] = [...COLUMNS.filter((c) => c.field).map((c) => c.field!), ...SHIP.map((s) => s.field)]
const STATUS: Record<string, string> = { open: 'รอเงิน', shipped: 'ส่งแล้ว', paid: 'ครบ', returned: 'ตีกลับ' }

const fmt = (satang: number | null | undefined) => (satang == null ? '' : (satang / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const pad = (n: number) => String(n).padStart(2, '0')

// "1/12" หรือ "1/12/2026" หรือ "2026-12-01" → YYYY-MM-DD
function parseDate(s: string): string | null {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t)
  if (!m) return null
  let y = m[3] ? Number(m[3]) : year
  if (y < 100) y += 2000
  if (y > 2400) y -= 543 // ปี พ.ศ.
  const d = Number(m[1])
  const mo = Number(m[2])
  const iso = `${y}-${pad(mo)}-${pad(d)}`
  const check = new Date(`${iso}T00:00:00Z`)
  return check.getUTCDate() === d && check.getUTCMonth() + 1 === mo ? iso : null
}
const showDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return y === year ? `${d}/${m}` : `${d}/${m}/${y}`
}
const saleKey = (iso: string, name: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${teamCode}${[...name.replace(/\s+/g, '')].slice(0, 10).join('')}`

const fromRow = (r: Row): Line => ({
  id: r.id,
  values: {
    date: showDate(r.sold_on),
    name: r.name,
    model: r.model,
    price: fmt(r.price),
    house: r.house,
    transfer: fmt(r.transfer),
    cod: fmt(r.cod),
    installment: fmt(r.installment),
    key_com: r.key_com,
    note: r.note,
    ship_name: r.ship_name,
    address: r.address,
    phone: r.phone,
    ship_note: r.ship_note,
  },
  is_ad: r.is_ad,
  status: r.status,
  dirty: false,
  deleted: false,
  error: '',
  saved: r,
})
const blank = (): Line => ({
  id: null,
  values: Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<Field, string>,
  is_ad: false,
  status: '',
  dirty: false,
  deleted: false,
  error: '',
})
const isBlank = (l: Line) => l.id == null && FIELDS.every((f) => !l.values[f].trim()) && !l.is_ad

let lines: Line[] = data.rows.map(fromRow)
let orderChanged = false
const ensureBlankRows = () => {
  let empty = 0
  for (let i = lines.length - 1; i >= 0 && isBlank(lines[i]); i--) empty++
  for (; empty < 3; empty++) lines.push(blank())
}
ensureBlankRows()

function calc(l: Line, kind: string): string {
  if (kind === 'team') return isBlank(l) ? '' : teamCode
  if (kind === 'status') return l.deleted ? 'ลบ' : STATUS[l.status] ?? ''
  if (kind === 'key') {
    const iso = parseDate(l.values.date)
    return iso && l.values.name.trim() ? saleKey(iso, l.values.name) : ''
  }
  // ราคาจริงและ M: แถวเดิมที่ไม่ได้เปลี่ยนรุ่นใช้ค่าที่บันทึกไว้ นอกนั้นดึงจากตารางรุ่น
  const keep = l.saved && l.saved.model.toLowerCase() === l.values.model.trim().toLowerCase()
  const m = models.get(l.values.model.trim().toLowerCase())
  if (kind === 'real') return fmt(keep ? l.saved!.real_price : m?.price)
  if (kind === 'margin') return fmt(keep ? l.saved!.margin : m?.margin)
  return ''
}

function invalid(l: Line, f: Field): boolean {
  const v = l.values[f].trim()
  if (isBlank(l) || l.deleted) return false
  if (f === 'date') return !parseDate(v)
  if (f === 'name') return !v
  if (f === 'model') return !models.has(v.toLowerCase())
  if (f === 'price') return toSatang(v) == null
  if (f === 'transfer' || f === 'cod' || f === 'installment') return !!v && toSatang(v) == null
  return false
}

function render(focus?: { row: number; field: Field | 'ad' }) {
  const head = `<thead><tr><th style="width:36px"></th>${COLUMNS.map((c) => `<th style="width:${c.width}px">${c.label}</th>`).join('')}<th style="width:96px"></th></tr></thead>`
  table.innerHTML = head
  const body = document.createElement('tbody')
  lines.forEach((l, i) => {
    const tr = document.createElement('tr')
    tr.className = [l.dirty ? 'dirty' : '', l.error ? 'bad' : '', l.deleted ? 'deleted' : ''].join(' ')
    if (l.error) tr.title = l.error
    const num = document.createElement('td')
    num.className = 'rownum'
    num.rowSpan = 2
    num.textContent = String(i + 1)
    tr.append(num)
    for (const col of COLUMNS) {
      const td = document.createElement('td')
      if (col.field) {
        const input = document.createElement('input')
        input.value = l.values[col.field]
        input.dataset.row = String(i)
        input.dataset.field = col.field
        if (col.num) { input.className = 'num'; input.inputMode = 'decimal' }
        if (col.list) input.setAttribute('list', col.list)
        if (col.field === 'date') input.placeholder = isBlank(l) ? '' : 'วว/ดด'
        if (invalid(l, col.field)) input.classList.add('invalid')
        input.disabled = l.deleted
        td.append(input)
      } else if (col.check) {
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.checked = l.is_ad
        box.dataset.row = String(i)
        box.dataset.field = 'ad'
        box.disabled = l.deleted
        td.append(box)
      } else {
        td.className = `calc${col.num ? ' num' : ''}`
        td.dataset.calc = col.calc
        td.textContent = calc(l, col.calc!)
      }
      tr.append(td)
    }
    const tools = document.createElement('td')
    tools.style.whiteSpace = 'nowrap'
    tools.rowSpan = 2
    if (!isBlank(l)) {
      tools.innerHTML = `<button type="button" class="del" data-move="-1" data-row="${i}" title="เลื่อนขึ้น">▲</button><button type="button" class="del" data-move="1" data-row="${i}" title="เลื่อนลง">▼</button><button type="button" class="del" data-del="${i}" title="${l.deleted ? 'เอาคืน' : 'ลบแถว'}">${l.deleted ? '↺' : '✕'}</button>`
    }
    tr.append(tools)
    body.append(tr)
    // บรรทัดที่ 2: ข้อมูลจัดส่ง
    const ship = document.createElement('tr')
    ship.className = `ship ${tr.className}`
    const lbl = document.createElement('td')
    lbl.className = 'lbl'
    lbl.textContent = 'จัดส่ง'
    ship.append(lbl)
    for (const sf of SHIP) {
      const td = document.createElement('td')
      td.colSpan = sf.span
      const input = document.createElement('input')
      input.value = l.values[sf.field]
      input.placeholder = sf.label
      input.dataset.row = String(i)
      input.dataset.field = sf.field
      if (sf.tel) input.inputMode = 'tel'
      input.disabled = l.deleted
      td.append(input)
      ship.append(td)
    }
    body.append(ship)
  })
  table.append(body)
  table.append(footer())
  if (focus) cell(focus.row, focus.field)?.focus()
}

function footer(): HTMLElement {
  const live = lines.filter((l) => !l.deleted && !isBlank(l))
  const sum = (f: Field) => live.reduce((s, l) => s + (toSatang(l.values[f]) ?? 0), 0)
  const sumCalc = (k: 'real' | 'margin') => live.reduce((s, l) => s + (toSatang(calc(l, k)) ?? 0), 0)
  const foot = document.createElement('tfoot')
  const cells: Record<string, string> = {
    name: `${live.length} รายการ`,
    price: fmt(sum('price') || null),
    transfer: fmt(sum('transfer') || null),
    cod: fmt(sum('cod') || null),
    installment: fmt(sum('installment') || null),
    real: fmt(sumCalc('real') || null),
    margin: fmt(sumCalc('margin') || null),
  }
  foot.innerHTML = `<tr><td></td>${COLUMNS.map((c) => `<td style="${c.num ? 'text-align:right' : ''}">${cells[c.field ?? c.calc ?? ''] ?? ''}</td>`).join('')}<td></td></tr>`
  return foot
}

const cell = (row: number, field: Field | 'ad') => table.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-field="${field}"]`)

// อัปเดตเฉพาะแถวที่แก้ ไม่วาดใหม่ทั้งตาราง เพื่อไม่ให้เคอร์เซอร์หลุด
function refreshRow(i: number) {
  const l = lines[i]
  const tr = cell(i, 'name')!.closest('tr')!
  tr.className = [l.dirty ? 'dirty' : '', l.error ? 'bad' : '', l.deleted ? 'deleted' : ''].join(' ')
  cell(i, 'address')!.closest('tr')!.className = `ship ${tr.className}`
  tr.querySelectorAll<HTMLTableCellElement>('td[data-calc]').forEach((td) => (td.textContent = calc(l, td.dataset.calc!)))
  for (const f of FIELDS) cell(i, f)?.classList.toggle('invalid', invalid(l, f))
  table.querySelector('tfoot')?.replaceWith(footer())
}

function touch(i: number) {
  const l = lines[i]
  l.dirty = true
  l.error = ''
  // เริ่มพิมพ์แถวใหม่: ใส่วันที่ให้ตามแถวก่อนหน้า หรือวันนี้
  if (!l.values.date.trim()) {
    const prev = lines.slice(0, i).reverse().find((x) => !isBlank(x) && parseDate(x.values.date))
    l.values.date = prev ? prev.values.date : data.today.startsWith(data.month) ? showDate(data.today) : ''
    const d = cell(i, 'date')
    if (d) d.value = l.values.date
  }
  const before = lines.length
  ensureBlankRows()
  if (lines.length !== before) {
    const active = document.activeElement as HTMLInputElement | null
    render(active?.dataset.row ? { row: Number(active.dataset.row), field: active.dataset.field as Field } : undefined)
  } else refreshRow(i)
  updateMsg()
}

table.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  const i = Number(input.dataset.row)
  const field = input.dataset.field as Field | 'ad'
  if (Number.isNaN(i) || !field) return
  if (field === 'ad') lines[i].is_ad = input.checked
  else lines[i].values[field] = input.value
  touch(i)
})

// จัดรูปแบบตัวเลขและวันที่ตอนออกจากช่อง
table.addEventListener('focusout', (e) => {
  const input = e.target as HTMLInputElement
  const i = Number(input.dataset.row)
  const field = input.dataset.field as Field
  if (Number.isNaN(i) || !field || field === ('ad' as Field)) return
  const l = lines[i]
  const v = input.value.trim()
  let next = v
  if (['price', 'transfer', 'cod', 'installment'].includes(field) && v && toSatang(v) != null) next = fmt(toSatang(v))
  if (field === 'date' && parseDate(v)) next = showDate(parseDate(v)!)
  if (field === 'model') next = models.get(v.toLowerCase())?.code ?? v
  if (next !== input.value) {
    input.value = next
    l.values[field] = next
    refreshRow(i)
  }
})

// Enter / ลูกศรขึ้นลง เลื่อนไปช่องเดียวกันของแถวอื่น เหมือนในชีต
table.addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement
  const i = Number(input.dataset.row)
  const field = input.dataset.field as Field
  if (Number.isNaN(i) || !field) return
  const down = e.key === 'Enter' || (e.key === 'ArrowDown' && !input.list)
  const up = e.key === 'ArrowUp' && !input.list
  if (!down && !up) return
  // บรรทัดบน ↔ บรรทัดจัดส่ง ของรายการเดียวกัน แล้วต่อไปรายการถัดไป เหมือนเลื่อนลงทีละแถวในชีต
  const ship = SHIP.find((sf) => sf.field === field)
  const col = ship ? ship.from : COLUMNS.findIndex((c) => c.field === field)
  const shipAt = SHIP.find((sf) => col >= sf.from && col < sf.from + sf.span) ?? SHIP[0]
  const topAt = (COLUMNS[col]?.field ?? 'name') as Field
  let to: [number, Field]
  if (down) to = ship ? [i + 1, topAt] : [i, shipAt.field]
  else to = ship ? [i, topAt] : [i - 1, shipAt.field]
  if (to[0] < 0 || to[0] >= lines.length) return
  e.preventDefault()
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  cell(to[0], to[1])?.focus()
})

table.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  const i = Number(btn.dataset.row ?? btn.dataset.del)
  if (btn.dataset.del != null) {
    const l = lines[i]
    if (l.id == null) lines.splice(i, 1)
    else { l.deleted = !l.deleted; l.dirty = true; l.error = '' }
    ensureBlankRows()
    render()
  } else if (btn.dataset.move) {
    const j = i + Number(btn.dataset.move)
    if (j < 0 || j >= lines.length || isBlank(lines[j])) return
    ;[lines[i], lines[j]] = [lines[j], lines[i]]
    orderChanged = true
    render()
    table.querySelector<HTMLButtonElement>(`button[data-move="${btn.dataset.move}"][data-row="${j}"]`)?.focus()
  }
  updateMsg()
})

document.getElementById('add')!.addEventListener('click', () => {
  // แทรกแถวว่างต่อจากแถวสุดท้ายที่มีข้อมูล
  const lastFilled = lines.map(isBlank).lastIndexOf(false)
  lines.splice(lastFilled + 1, 0, blank())
  ensureBlankRows()
  render({ row: lastFilled + 1, field: 'date' })
})

const pending = () => lines.filter((l) => l.dirty && !isBlank(l)).length + (orderChanged ? 1 : 0)
function updateMsg(text?: string, error = false) {
  msg.className = error ? 'err' : 'muted'
  const n = lines.filter((l) => l.dirty && !isBlank(l)).length
  msg.textContent = text ?? (n ? `ยังไม่ได้บันทึก ${n} แถว` : orderChanged ? 'ลำดับแถวยังไม่ได้บันทึก' : '')
}

async function save() {
  if (!pending()) return updateMsg('ไม่มีอะไรเปลี่ยน')
  const filled = lines.filter((l) => !isBlank(l))
  const toSend = filled.filter((l) => l.dirty)
  const rows = toSend.map((l) => ({
    id: l.id,
    delete: l.deleted || undefined,
    sold_on: parseDate(l.values.date) ?? l.values.date,
    name: l.values.name,
    model: l.values.model,
    price: l.values.price,
    house: l.values.house,
    transfer: l.values.transfer,
    cod: l.values.cod,
    installment: l.values.installment,
    key_com: l.values.key_com,
    is_ad: l.is_ad,
    note: l.values.note,
    ship_name: l.values.ship_name,
    address: l.values.address,
    phone: l.values.phone,
    ship_note: l.values.ship_note,
  }))
  // ลำดับทั้งหมดบนจอ: แถวเดิมส่ง id แถวใหม่ส่งตำแหน่งใน rows
  const order = filled.filter((l) => !l.deleted).map((l) => (l.id != null ? l.id : `new:${toSend.indexOf(l)}`))
  saveBtn.disabled = true
  updateMsg('กำลังบันทึก…')
  try {
    const res = await fetch(`/sales/save${location.search.includes('b=') ? `?b=${new URLSearchParams(location.search).get('b')}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team_id: data.team.id, month: data.month, rows, order }),
    })
    const out = await res.json().catch(() => ({ error: `บันทึกไม่ได้ (${res.status})` }))
    if (!res.ok) {
      for (const err of out.errors ?? []) toSend[err.index].error = err.message
      render()
      return updateMsg(out.error ?? 'บันทึกไม่ได้', true)
    }
    const reordered = orderChanged
    lines = (out.rows as Row[]).map(fromRow)
    orderChanged = false
    ensureBlankRows()
    render()
    const outside = toSend.filter((l) => !l.deleted && !(parseDate(l.values.date) ?? '').startsWith(data.month)).length
    if (!out.saved && !out.deleted && reordered) return updateMsg('บันทึกลำดับแถวแล้ว')
    updateMsg(`บันทึกแล้ว ${out.saved} แถว${out.deleted ? ` ลบ ${out.deleted} แถว` : ''}${outside ? ` (${outside} แถวอยู่เดือนอื่น)` : ''}`)
  } catch (e) {
    updateMsg(`บันทึกไม่ได้: ${(e as Error).message}`, true)
  } finally {
    saveBtn.disabled = false
  }
}

saveBtn.addEventListener('click', save)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  }
})
window.addEventListener('beforeunload', (e) => {
  if (pending()) e.preventDefault()
})

render()
