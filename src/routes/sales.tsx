import { Hono } from 'hono'
import { raw } from 'hono/html'
import { audit, placeholders, stockOwner, toSatang } from '../db'
import { saleKey } from '../importer'
import { type AppEnv, type Ctx, asset, page, today } from '../ui'

// หน้าลงยอดขายแบบชีต "จดยอดขายเซลล์": เซลล์ลงยอดของทีมตัวเองทีละแถว แล้วกดบันทึก
export const sales = new Hono<AppEnv>()

export type SalesTeam = { id: number; name: string; code: string | null; business_id: number; business: string }
export type SalesModel = { code: string; price: number | null; margin: number | null }
export type SalesRow = {
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

// ทีมที่ผู้ใช้ลงยอดได้: เจ้าของและบัญชีเห็นทุกทีมในกิจการที่มีสิทธิ์ เซลล์เห็นเฉพาะทีมที่สังกัด
export async function salesTeams(c: Ctx): Promise<SalesTeam[]> {
  const scope = c.get('scope')
  const user = c.get('user')
  const roles = c.get('roles')
  const seeAll = !user || roles.has('owner') || roles.has('accounting')
  const sql = `SELECT t.id, t.name, t.code, t.business_id, b.name business FROM teams t JOIN businesses b ON b.id = t.business_id
     WHERE t.business_id IN (${placeholders(scope.length)}) ${seeAll ? '' : 'AND t.id IN (SELECT team_id FROM team_members WHERE user_id = ?)'}
     ORDER BY t.business_id, t.name`
  const stmt = c.env.DB.prepare(sql)
  const { results } = await (seeAll ? stmt.bind(...scope) : stmt.bind(...scope, user!.id)).all<SalesTeam>()
  return results
}

async function loadRows(db: D1Database, teamId: number, month: string): Promise<SalesRow[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.sold_on, COALESCE(c.facebook_name, '') name,
              COALESCE((SELECT p.code FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id ORDER BY i.id LIMIT 1), '') model,
              o.price_satang price, COALESCE(o.house_no, '') house, o.transfer_satang transfer, o.cod_satang cod, o.installment_satang installment,
              COALESCE(o.key_com, '') key_com, o.is_ad, COALESCE(o.note, '') note, COALESCE(o.sale_key, '') sale_key,
              o.real_price_satang real_price, o.margin_satang margin, o.status,
              COALESCE(c.full_name, '') ship_name, COALESCE(c.address, '') address, COALESCE(c.phone, '') phone, COALESCE(o.ship_note, '') ship_note
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.team_id = ? AND substr(o.sold_on, 1, 7) = ? AND o.status != 'cancelled'
       ORDER BY o.sheet_pos IS NULL, o.sheet_pos, o.sold_on, o.id`,
    )
    .bind(teamId, month)
    .all<Omit<SalesRow, 'is_ad'> & { is_ad: number }>()
  return results.map((r) => ({ ...r, is_ad: !!r.is_ad }))
}

async function loadModels(db: D1Database, ownerId: number): Promise<SalesModel[]> {
  const { results } = await db
    .prepare('SELECT code, list_price_satang price, margin_satang margin FROM products WHERE business_id = ? ORDER BY code')
    .bind(ownerId)
    .all<SalesModel>()
  return results
}

// JSON ที่ฝังในหน้า ต้องกัน </script> ปิดแท็กก่อนเวลา
const embed = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

const css = `
main { max-width:none; }
.sheet-bar { display:flex; flex-wrap:wrap; gap:8px; align-items:end; margin-bottom:12px; }
.sheet-bar .spacer { flex:1; }
.sheet-wrap { overflow:auto; max-height:calc(100vh - 220px); border:1px solid var(--line); border-radius:6px; background:var(--card); }
table.sheet { border-collapse:collapse; table-layout:fixed; width:max-content; }
table.sheet th, table.sheet td { border:1px solid var(--line); padding:0; font-size:14px; }
table.sheet th { position:sticky; top:0; z-index:1; background:#e8f0e3; color:#1d1d1b; padding:6px 6px; white-space:nowrap; }
@media (prefers-color-scheme: dark) { table.sheet th { background:#2c3a28; color:#ecebe6; } }
table.sheet td.rownum { color:var(--muted); text-align:right; padding:0 6px; font-size:12px; background:var(--bg); }
table.sheet input { border:none; border-radius:0; width:100%; padding:5px 6px; background:transparent; }
table.sheet input:focus { outline:2px solid var(--accent); outline-offset:-2px; background:var(--card); }
table.sheet input.num { text-align:right; }
table.sheet input[type=checkbox] { width:auto; margin:0 auto; display:block; }
table.sheet td.calc { padding:5px 6px; color:var(--muted); white-space:nowrap; }
table.sheet td.calc.num { text-align:right; }
table.sheet tr.dirty td.rownum { background:#fff3c4; color:#1d1d1b; }
table.sheet tr.bad td { background:#fbebeb; }
table.sheet tr.deleted td { text-decoration:line-through; opacity:.5; }
table.sheet input.invalid { background:#fbd5d5; color:#1d1d1b; }
table.sheet td.view { padding:5px 6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
table.sheet td.view.num { text-align:right; }
table.sheet tr.editing td { background:#eef4ff; }
@media (prefers-color-scheme: dark) { table.sheet tr.editing td { background:#1e2a3d; } }
table.sheet td.tools { white-space:nowrap; padding:0 4px; }
table.sheet td.tools button { background:none; color:var(--accent); padding:2px 6px; }
table.sheet td.tools button.danger { color:#c0392b; }
table.sheet tfoot td { padding:5px 6px; font-weight:600; background:var(--bg); white-space:nowrap; }
table.sheet button.del { background:none; color:var(--muted); padding:2px 8px; }
#msg { min-height:1.4em; }
#msg.err { color:#c0392b; }
`

sales.get('/sales', async (c) => {
  const teams = await salesTeams(c)
  if (!teams.length) {
    return page(
      c,
      'ลงยอดขาย',
      <div class="card">
        <h3>ยังไม่ได้สังกัดทีมขาย</h3>
        <p>ให้เจ้าของเพิ่มคุณเข้าทีมที่หน้า <a href="/users">ผู้ใช้</a> ก่อน แล้วจะลงยอดขายของทีมได้</p>
      </div>,
    )
  }
  const team = teams.find((t) => t.id === Number(c.req.query('team'))) ?? teams[0]
  const monthQ = c.req.query('month') ?? ''
  const month = /^\d{4}-\d{2}$/.test(monthQ) ? monthQ : today().slice(0, 7)
  const db = c.env.DB
  const owner = stockOwner(c.get('allBusinesses'), team.business_id)
  const [rows, models] = await Promise.all([loadRows(db, team.id, month), loadModels(db, owner)])
  const sel = c.get('selected')
  const data = { team, month, today: today(), rows, models }
  return page(
    c,
    'ลงยอดขาย',
    <>
      <style>{css}</style>
      <form class="sheet-bar" method="get" action="/sales">
        {sel && <input type="hidden" name="b" value={String(sel)} />}
        <label>
          ทีม
          <select name="team" onchange="this.form.submit()">
            {teams.map((t) => (
              <option value={String(t.id)} selected={t.id === team.id}>
                {t.business} · {t.name}
                {t.code ? ` (${t.code})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          เดือน
          <input type="month" name="month" value={month} onchange="this.form.submit()" />
        </label>
      </form>
      <div class="sheet-bar">
        <button type="button" id="add">+ เพิ่ม</button>
        <button type="button" id="save">บันทึก</button>
        <span id="msg" class="muted"></span>
      </div>
      <p class="muted" style="margin-top:0">
        กด <b>+ เพิ่ม</b> เพื่อลงรายการใหม่ หรือกด <b>แก้ไข</b> ที่แถวเดิม แล้วกด <b>บันทึก</b> (หรือ Ctrl+S) วันที่พิมพ์แบบ 1/12 ได้ รุ่นเครื่องเลือกจาก<a href="/products">ตารางรุ่น</a> กด ▲▼ เพื่อเลื่อนลำดับแถว
      </p>
      <div class="sheet-wrap">
        <table class="sheet" id="sheet"></table>
      </div>
      <datalist id="models">
        {models.map((m) => (
          <option value={m.code} />
        ))}
      </datalist>
      <script type="application/json" id="sales-data">{raw(embed(data))}</script>
      <script type="module" src={asset(c, '/static/sales.js')}></script>
    </>,
  )
})

type InRow = {
  id?: number | null
  delete?: boolean
  sold_on?: string
  name?: string
  model?: string
  price?: string
  house?: string
  transfer?: string
  cod?: string
  installment?: string
  key_com?: string
  is_ad?: boolean
  note?: string
  ship_name?: string
  address?: string
  phone?: string
  ship_note?: string
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const amount = (v: unknown): number | null | 'bad' => {
  const s = text(v)
  if (!s) return null
  const n = toSatang(s)
  return n == null || n < 0 ? 'bad' : n
}

sales.post('/sales/save', async (c) => {
  if (!c.req.header('content-type')?.includes('application/json')) return c.json({ error: 'ต้องส่ง JSON' }, 415)
  const body = await c.req.json<{ team_id?: number; month?: string; rows?: InRow[]; order?: (number | string)[] }>().catch(() => null)
  if (!body || !Array.isArray(body.rows) || body.rows.length > 500) return c.json({ error: 'รูปแบบไม่ถูกต้อง' }, 400)
  const team = (await salesTeams(c)).find((t) => t.id === Number(body.team_id))
  if (!team) return c.json({ error: 'ไม่มีสิทธิ์ลงยอดของทีมนี้' }, 403)
  const db = c.env.DB
  const user = c.get('user')
  const owner = stockOwner(c.get('allBusinesses'), team.business_id)
  const models = new Map((await loadModels(db, owner)).map((m) => [m.code.toLowerCase(), m]))
  const teamCode = team.code ?? team.name

  // แถวเดิมต้องเป็นของทีมนี้เท่านั้น
  const ids = body.rows.map((r) => Number(r.id)).filter((n) => n > 0)
  const existing = new Map<number, { id: number; customer_id: number | null; product: string | null; status: string }>()
  if (ids.length) {
    const { results } = await db
      .prepare(
        `SELECT o.id, o.customer_id, o.status, (SELECT p.code FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id ORDER BY i.id LIMIT 1) product
         FROM orders o WHERE o.team_id = ? AND o.id IN (${placeholders(ids.length)})`,
      )
      .bind(team.id, ...ids)
      .all<{ id: number; customer_id: number | null; product: string | null; status: string }>()
    for (const r of results) existing.set(r.id, r)
  }

  // ตรวจทุกแถวก่อน ถ้ามีแถวผิดจะไม่บันทึกเลย เพื่อไม่ให้ข้อมูลครึ่ง ๆ กลาง ๆ
  const errors: { index: number; message: string }[] = []
  const plans: (() => Promise<void>)[] = []
  const newIds = new Map<number, number>()
  let deleted = 0
  let saved = 0
  body.rows.forEach((r, index) => {
    const id = Number(r.id) > 0 ? Number(r.id) : null
    const prev = id ? existing.get(id) : undefined
    if (id && !prev) return errors.push({ index, message: 'ไม่พบแถวนี้ในทีม (อาจถูกลบไปแล้ว)' })
    if (r.delete) {
      if (!prev) return
      deleted++
      plans.push(async () => {
        await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(prev.id).run()
        await audit(db, 'orders', prev.id, 'sales-cancel', { by: user?.email })
      })
      return
    }
    const soldOn = text(r.sold_on)
    const name = text(r.name)
    const modelCode = text(r.model)
    const price = amount(r.price)
    const transfer = amount(r.transfer)
    const cod = amount(r.cod)
    const installment = amount(r.installment)
    const problems: string[] = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || Number.isNaN(Date.parse(soldOn))) problems.push('วันที่')
    if (!name) problems.push('ชื่อลูกค้า')
    const model = models.get(modelCode.toLowerCase())
    if (!model) problems.push(modelCode ? `ไม่มีรุ่น ${modelCode} ในตารางรุ่น` : 'รุ่นเครื่อง')
    if (price == null || price === 'bad') problems.push('ราคา')
    if (transfer === 'bad') problems.push('โอนแล้ว')
    if (cod === 'bad') problems.push('ยอดกปท')
    if (installment === 'bad') problems.push('ผ่อน')
    if (problems.length) return errors.push({ index, message: `ตรวจ: ${problems.join(', ')}` })

    const p = price as number
    const t = transfer as number | null
    const d = cod as number | null
    const n = installment as number | null
    const kinds = [t, d, n].filter((v) => v)
    const paymentType = kinds.length > 1 ? 'mixed' : d ? 'cod' : n ? 'installment' : 'transfer'
    const key = saleKey(soldOn, teamCode, name)
    const fields = [soldOn, text(r.house, 20) || null, p, t, d, n, text(r.key_com, 50) || null, r.is_ad ? 1 : 0, text(r.note, 500) || null, key, paymentType, text(r.ship_note, 500) || null]
    const ship = [text(r.ship_name) || null, text(r.address, 500) || null, text(r.phone, 30) || null]
    saved++
    plans.push(async () => {
      if (prev) {
        // เปลี่ยนรุ่นแล้วจึงดึงราคาจริงและ M ใหม่ ไม่อย่างนั้นคงค่าตอนลงไว้
        const modelChanged = prev.product?.toLowerCase() !== model!.code.toLowerCase()
        await db.batch([
          db
            .prepare(
              `UPDATE orders SET sold_on = ?, house_no = ?, price_satang = ?, transfer_satang = ?, cod_satang = ?, installment_satang = ?, key_com = ?, is_ad = ?, note = ?, sale_key = ?, payment_type = ?, ship_note = ?
               ${modelChanged ? ', real_price_satang = ?, margin_satang = ?' : ''} WHERE id = ?`,
            )
            .bind(...fields, ...(modelChanged ? [model!.price, model!.margin] : []), prev.id),
          prev.customer_id
            ? db.prepare('UPDATE customers SET facebook_name = ?, full_name = ?, address = ?, phone = ? WHERE id = ?').bind(name, ...ship, prev.customer_id)
            : db.prepare('SELECT 1'),
          db
            .prepare('UPDATE order_items SET product_id = (SELECT id FROM products WHERE business_id = ? AND code = ?), price_satang = ? WHERE id = (SELECT id FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1)')
            .bind(owner, model!.code, p, prev.id),
          db
            .prepare('INSERT INTO order_items (order_id, product_id, price_satang) SELECT ?, (SELECT id FROM products WHERE business_id = ? AND code = ?), ? WHERE NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ?)')
            .bind(prev.id, owner, model!.code, p, prev.id),
        ])
        await audit(db, 'orders', prev.id, 'sales-update', { by: user?.email, row: r })
      } else {
        const customer = await db.prepare('INSERT INTO customers (facebook_name, full_name, address, phone) VALUES (?, ?, ?, ?)').bind(name, ...ship).run()
        const order = await db
          .prepare(
            `INSERT INTO orders (sold_on, house_no, price_satang, transfer_satang, cod_satang, installment_satang, key_com, is_ad, note, sale_key, payment_type, ship_note,
               real_price_satang, margin_satang, business_id, team_id, customer_id, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
          )
          .bind(...fields, model!.price, model!.margin, team.business_id, team.id, customer.meta.last_row_id, user?.id ?? null)
          .run()
        const orderId = order.meta.last_row_id
        newIds.set(index, orderId)
        await db
          .prepare('INSERT INTO order_items (order_id, product_id, price_satang) VALUES (?, (SELECT id FROM products WHERE business_id = ? AND code = ?), ?)')
          .bind(orderId, owner, model!.code, p)
          .run()
        await audit(db, 'orders', orderId, 'sales-create', { by: user?.email, row: r })
      }
    })
  })
  if (errors.length) return c.json({ error: `มี ${errors.length} แถวที่ต้องแก้ ยังไม่ได้บันทึก`, errors }, 422)
  for (const run of plans) await run()

  // ลำดับแถวตามที่เห็นบนจอ: ตัวเลข = id แถวเดิม, "new:<ลำดับใน rows>" = แถวที่เพิ่งเพิ่ม
  if (Array.isArray(body.order) && body.order.length <= 1000) {
    const ordered = body.order
      .map((ref) => (typeof ref === 'string' && ref.startsWith('new:') ? newIds.get(Number(ref.slice(4))) : Number(ref)))
      .filter((id): id is number => !!id && id > 0)
    if (ordered.length) {
      await db.batch(ordered.map((id, pos) => db.prepare('UPDATE orders SET sheet_pos = ? WHERE id = ? AND team_id = ?').bind(pos + 1, id, team.id)))
    }
  }

  const month = /^\d{4}-\d{2}$/.test(body.month ?? '') ? body.month! : today().slice(0, 7)
  return c.json({ ok: true, saved, deleted, rows: await loadRows(db, team.id, month) })
})
