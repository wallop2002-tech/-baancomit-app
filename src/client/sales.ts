// ตารางลงยอดขาย: รายการละแถวเดียว เพิ่ม/แก้ไข/ลบ/เลื่อนลำดับได้ แล้วกดบันทึกครั้งเดียว
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

// ช่องที่แสดงบนจอ (ช่องอื่นของชีต เช่น ผ่อน คีย์คอม โฆษณา เก็บค่าเดิมไว้ตอนบันทึก)
type Field = 'date' | 'name' | 'model' | 'price' | 'house' | 'transfer' | 'cod' | 'ship_name' | 'address' | 'phone' | 'note'
type Line = {
  id: number | null
  values: Record<Field, string>
  hidden: { installment: string; key_com: string; is_ad: boolean; ship_note: string }
  status: string
  editing: boolean
  dirty: boolean
  deleted: boolean
  error: string
  saved?: Line['values']
}

const data: Data = JSON.parse(document.getElementById('sales-data')!.textContent!)
const models = new Map(data.models.map((m) => [m.code.toLowerCase(), m]))
const teamCode = data.team.code ?? data.team.name
const year = Number(data.month.slice(0, 4))
const table = document.getElementById('sheet') as HTMLTableElement
const msg = document.getElementById('msg')!
const saveBtn = document.getElementById('save') as HTMLButtonElement

const COLUMNS: { field?: Field; label: string; width: number; num?: boolean; list?: string; tel?: boolean; team?: boolean }[] = [
  { field: 'date', label: 'วันที่', width: 70 },
  { field: 'name', label: 'ชื่อเฟสบุ๊คลูกค้า', width: 180 },
  { field: 'model', label: 'รุ่นเครื่อง', width: 115, list: 'models' },
  { field: 'price', label: 'ราคา', width: 80, num: true },
  { field: 'house', label: 'บ้านที่', width: 55 },
  { team: true, label: 'ทีม', width: 45 },
  { field: 'transfer', label: 'โอนแล้ว', width: 80, num: true },
  { field: 'cod', label: 'ยอดกปท', width: 80, num: true },
  { field: 'ship_name', label: 'ชื่อผู้รับ', width: 160 },
  { field: 'address', label: 'ที่อยู่', width: 300 },
  { field: 'phone', label: 'เบอร์มือถือ', width: 105, tel: true },
  { field: 'note', label: 'หมายเหต', width: 200 },
]
const FIELDS = COLUMNS.filter((c) => c.field).map((c) => c.field!)
const MONEY: Field[] = ['price', 'transfer', 'cod']

const fmt = (satang: number | null | undefined) => (satang == null ? '' : (satang / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

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

const fromRow = (r: Row): Line => {
  const values = {
    date: showDate(r.sold_on),
    name: r.name,
    model: r.model,
    price: fmt(r.price),
    house: r.house,
    transfer: fmt(r.transfer),
    cod: fmt(r.cod),
    ship_name: r.ship_name,
    address: r.address,
    phone: r.phone,
    note: r.note,
  }
  return {
    id: r.id,
    values,
    hidden: { installment: fmt(r.installment), key_com: r.key_com, is_ad: r.is_ad, ship_note: r.ship_note },
    status: r.status,
    editing: false,
    dirty: false,
    deleted: false,
    error: '',
    saved: { ...values },
  }
}

let lines: Line[] = data.rows.map(fromRow)
let orderChanged = false

function invalid(l: Line, f: Field): boolean {
  if (l.deleted) return false
  const v = l.values[f].trim()
  if (f === 'date') return !parseDate(v)
  if (f === 'name') return !v
  if (f === 'model') return !models.has(v.toLowerCase())
  if (f === 'price') return toSatang(v) == null
  if (f === 'transfer' || f === 'cod') return !!v && toSatang(v) == null
  return false
}

const rowClass = (l: Line) => [l.editing ? 'editing' : '', l.dirty ? 'dirty' : '', l.error ? 'bad' : '', l.deleted ? 'deleted' : ''].join(' ')

function render(focus?: { row: number; field: Field }) {
  table.innerHTML = `<thead><tr><th style="width:36px"></th><th style="width:150px"></th>${COLUMNS.map((c) => `<th style="width:${c.width}px">${c.label}</th>`).join('')}</tr></thead>`
  const body = document.createElement('tbody')
  lines.forEach((l, i) => {
    const tr = document.createElement('tr')
    tr.className = rowClass(l)
    if (l.error) tr.title = l.error
    let html = `<td class="rownum">${i + 1}</td>`
    const tools = l.deleted
      ? `<button type="button" data-act="undo" data-row="${i}">เอาคืน</button>`
      : `<button type="button" data-act="up" data-row="${i}" title="เลื่อนขึ้น">▲</button><button type="button" data-act="down" data-row="${i}" title="เลื่อนลง">▼</button>` +
        (l.editing
          ? l.id != null ? `<button type="button" data-act="cancel" data-row="${i}">ยกเลิก</button>` : ''
          : `<button type="button" data-act="edit" data-row="${i}">แก้ไข</button>`) +
        `<button type="button" class="danger" data-act="del" data-row="${i}">ลบ</button>`
    html += `<td class="tools">${tools}</td>`
    for (const col of COLUMNS) {
      if (col.team) html += `<td class="view">${esc(teamCode)}</td>`
      else if (l.editing && !l.deleted) {
        const f = col.field!
        html += `<td><input data-row="${i}" data-field="${f}" value="${esc(l.values[f])}"${col.num ? ' class="num" inputmode="decimal"' : ''}${col.tel ? ' inputmode="tel"' : ''}${col.list ? ` list="${col.list}"` : ''}${f === 'date' ? ' placeholder="วว/ดด"' : ''}></td>`
      } else html += `<td class="view${col.num ? ' num' : ''}" title="${esc(l.values[col.field!])}">${esc(l.values[col.field!])}</td>`
    }
    tr.innerHTML = html
    for (const f of FIELDS) tr.querySelector(`input[data-field="${f}"]`)?.classList.toggle('invalid', invalid(l, f))
    body.append(tr)
  })
  if (!lines.length) body.innerHTML = `<tr><td colspan="${COLUMNS.length + 2}" class="view muted">ยังไม่มีรายการในเดือนนี้ กด + เพิ่ม เพื่อลงยอด</td></tr>`
  table.append(body, footer())
  if (focus) cell(focus.row, focus.field)?.focus()
}

function footer(): HTMLElement {
  const live = lines.filter((l) => !l.deleted)
  const sum = (f: Field) => fmt(live.reduce((s, l) => s + (toSatang(l.values[f]) ?? 0), 0) || null)
  const cells: Partial<Record<Field, string>> = { name: `${live.length} รายการ`, price: sum('price'), transfer: sum('transfer'), cod: sum('cod') }
  const foot = document.createElement('tfoot')
  foot.innerHTML = `<tr><td></td><td></td>${COLUMNS.map((c) => `<td style="${c.num ? 'text-align:right' : ''}">${(c.field && cells[c.field]) ?? ''}</td>`).join('')}</tr>`
  return foot
}

const cell = (row: number, field: Field) => table.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-field="${field}"]`)

table.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  const i = Number(input.dataset.row)
  const field = input.dataset.field as Field
  if (Number.isNaN(i) || !field) return
  const l = lines[i]
  l.values[field] = input.value
  l.dirty = true
  l.error = ''
  input.closest('tr')!.className = rowClass(l)
  for (const f of FIELDS) cell(i, f)?.classList.toggle('invalid', invalid(l, f))
  table.querySelector('tfoot')?.replaceWith(footer())
  updateMsg()
})

// จัดรูปแบบตัวเลข วันที่ และชื่อรุ่น ตอนออกจากช่อง
table.addEventListener('focusout', (e) => {
  const input = e.target as HTMLInputElement
  const i = Number(input.dataset.row)
  const field = input.dataset.field as Field
  if (Number.isNaN(i) || !field) return
  const v = input.value.trim()
  let next = v
  if (MONEY.includes(field) && v && toSatang(v) != null) next = fmt(toSatang(v))
  if (field === 'date' && parseDate(v)) next = showDate(parseDate(v)!)
  if (field === 'model') next = models.get(v.toLowerCase())?.code ?? v
  if (next !== input.value) {
    input.value = next
    lines[i].values[field] = next
    input.classList.toggle('invalid', invalid(lines[i], field))
  }
})

// Enter ไปช่องเดียวกันของแถวถัดไปที่กำลังแก้ไข
table.addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement
  if (e.key !== 'Enter' || !input.dataset.field) return
  e.preventDefault()
  const i = Number(input.dataset.row)
  const next = lines.findIndex((l, j) => j > i && l.editing && !l.deleted)
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  if (next >= 0) cell(next, input.dataset.field as Field)?.focus()
})

table.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
  if (!btn) return
  const i = Number(btn.dataset.row)
  const l = lines[i]
  const act = btn.dataset.act
  let focus: { row: number; field: Field } | undefined
  if (act === 'edit') {
    l.editing = true
    focus = { row: i, field: 'name' }
  } else if (act === 'cancel') {
    l.values = { ...l.saved! }
    l.editing = l.dirty = false
    l.error = ''
  } else if (act === 'del') {
    if (l.id == null) lines.splice(i, 1)
    else if (confirm(`ลบรายการของ ${l.values.name || 'แถวนี้'}? (จะลบจริงเมื่อกดบันทึก)`)) {
      l.deleted = l.dirty = true
      l.error = ''
    }
  } else if (act === 'undo') {
    l.deleted = false
    l.dirty = l.editing || JSON.stringify(l.values) !== JSON.stringify(l.saved)
  } else if (act === 'up' || act === 'down') {
    const j = i + (act === 'up' ? -1 : 1)
    if (j < 0 || j >= lines.length) return
    ;[lines[i], lines[j]] = [lines[j], lines[i]]
    orderChanged = true
    render()
    table.querySelector<HTMLButtonElement>(`button[data-act="${act}"][data-row="${j}"]`)?.focus()
    return updateMsg()
  }
  render(focus)
  updateMsg()
})

document.getElementById('add')!.addEventListener('click', () => {
  // วันที่ตั้งต้นตามรายการล่าสุด หรือวันนี้ถ้าอยู่เดือนที่เปิดดู
  const last = [...lines].reverse().find((l) => parseDate(l.values.date))
  const date = last ? last.values.date : data.today.startsWith(data.month) ? showDate(data.today) : ''
  lines.push({
    id: null,
    values: { date, name: '', model: '', price: '', house: '', transfer: '', cod: '', ship_name: '', address: '', phone: '', note: '' },
    hidden: { installment: '', key_com: '', is_ad: false, ship_note: '' },
    status: '',
    editing: true,
    dirty: true,
    deleted: false,
    error: '',
  })
  render({ row: lines.length - 1, field: date ? 'name' : 'date' })
  table.parentElement!.scrollTop = table.parentElement!.scrollHeight
  updateMsg()
})

const pendingRows = () => lines.filter((l) => l.dirty).length
function updateMsg(text?: string, error = false) {
  msg.className = error ? 'err' : 'muted'
  const n = pendingRows()
  msg.textContent = text ?? (n ? `ยังไม่ได้บันทึก ${n} แถว` : orderChanged ? 'ลำดับแถวยังไม่ได้บันทึก' : '')
}

async function save() {
  if (!pendingRows() && !orderChanged) return updateMsg('ไม่มีอะไรเปลี่ยน')
  const toSend = lines.filter((l) => l.dirty)
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
    note: l.values.note,
    ship_name: l.values.ship_name,
    address: l.values.address,
    phone: l.values.phone,
    ...l.hidden,
  }))
  // ลำดับทั้งหมดบนจอ: แถวเดิมส่ง id แถวใหม่ส่งตำแหน่งใน rows
  const order = lines.filter((l) => !l.deleted).map((l) => (l.id != null ? l.id : `new:${toSend.indexOf(l)}`))
  saveBtn.disabled = true
  updateMsg('กำลังบันทึก…')
  try {
    const b = new URLSearchParams(location.search).get('b')
    const res = await fetch(`/sales/save${b ? `?b=${b}` : ''}`, {
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
    const outside = toSend.filter((l) => !l.deleted && !(parseDate(l.values.date) ?? '').startsWith(data.month)).length
    lines = (out.rows as Row[]).map(fromRow)
    orderChanged = false
    render()
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
  if (pendingRows() || orderChanged) e.preventDefault()
})

render()
