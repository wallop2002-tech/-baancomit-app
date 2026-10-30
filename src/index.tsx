import { Hono } from 'hono'
import type { Context } from 'hono'
import { Layout } from './views/layout'
import { type Env, type Business, audit, baht, listBusinesses, placeholders, scopeIds, toSatang } from './db'

type Vars = { businesses: Business[]; selected: number | null; scope: number[] }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()

const PAYMENT_LABEL: Record<string, string> = {
  transfer: 'โอน',
  cod: 'COD',
  cash: 'สด',
  installment: 'ผ่อน',
  mixed: 'ผสม',
}

// โหลดรายชื่อกิจการและขอบเขตที่เลือก (?b=) ให้ทุกหน้า
app.use('*', async (c, next) => {
  const businesses = await listBusinesses(c.env.DB)
  const raw = Number(c.req.query('b'))
  const selected = businesses.some((b) => b.id === raw) ? raw : null
  c.set('businesses', businesses)
  c.set('selected', selected)
  c.set('scope', scopeIds(businesses, selected))
  await next()
})

function page(c: Context<{ Bindings: Env; Variables: Vars }>, title: string, body: any) {
  return c.html(
    <Layout
      title={title}
      businesses={c.get('businesses')}
      selected={c.get('selected')}
      flash={c.req.query('ok')}
      error={c.req.query('err')}
    >
      {body}
    </Layout>,
  )
}

function back(path: string, selected: number | null, params: Record<string, string>) {
  const q = new URLSearchParams(params)
  if (selected) q.set('b', String(selected))
  return `${path}?${q}`
}

function BusinessSelect(props: { businesses: Business[]; selected: number | null }) {
  return (
    <label>
      กิจการ
      <select name="business_id" required>
        {props.businesses.map((b) => (
          <option value={String(b.id)} selected={props.selected === b.id}>
            {b.parent_id ? '— ' : ''}
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------- ภาพรวม ----------
app.get('/', async (c) => {
  const scope = c.get('scope')
  const ph = placeholders(scope.length)
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const db = c.env.DB
  const [todaySales, monthSales, stock, unpaid, byBusiness] = await Promise.all([
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_satang),0) s FROM orders WHERE business_id IN (${ph}) AND sold_on = ? AND status != 'cancelled'`).bind(...scope, today).first<{ n: number; s: number }>(),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(price_satang),0) s FROM orders WHERE business_id IN (${ph}) AND substr(sold_on,1,7) = ? AND status != 'cancelled'`).bind(...scope, month).first<{ n: number; s: number }>(),
    db.prepare(`SELECT COUNT(*) n FROM serial_units WHERE business_id IN (${ph}) AND status = 'in_stock'`).bind(...scope).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) n FROM orders WHERE business_id IN (${ph}) AND status IN ('open','shipped')`).bind(...scope).first<{ n: number }>(),
    db.prepare(`SELECT b.name, COUNT(o.id) n, COALESCE(SUM(o.price_satang),0) s FROM businesses b LEFT JOIN orders o ON o.business_id = b.id AND substr(o.sold_on,1,7) = ? AND o.status != 'cancelled' WHERE b.id IN (${ph}) GROUP BY b.id ORDER BY b.id`).bind(month, ...scope).all<{ name: string; n: number; s: number }>(),
  ])
  return page(
    c,
    'ภาพรวม',
    <>
      <div class="grid">
        <div class="card stat"><span>ยอดขายวันนี้</span><b>{baht(todaySales?.s)}</b><span>{todaySales?.n} ออเดอร์</span></div>
        <div class="card stat"><span>ยอดขายเดือนนี้</span><b>{baht(monthSales?.s)}</b><span>{monthSales?.n} ออเดอร์</span></div>
        <div class="card stat"><span>เครื่องพร้อมขาย</span><b>{stock?.n}</b><span>เครื่อง</span></div>
        <div class="card stat"><span>ออเดอร์รอรับเงิน</span><b>{unpaid?.n}</b><span>ออเดอร์</span></div>
      </div>
      <div class="card">
        <h3>ยอดเดือน {month} แยกกิจการ</h3>
        <table>
          <tr><th>กิจการ</th><th>ออเดอร์</th><th>ยอดขาย (บาท)</th></tr>
          {byBusiness.results.map((r) => (
            <tr><td>{r.name}</td><td>{r.n}</td><td>{baht(r.s)}</td></tr>
          ))}
        </table>
      </div>
    </>,
  )
})

// ---------- รุ่นสินค้า ----------
app.get('/products', async (c) => {
  const scope = c.get('scope')
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.code, p.spec, p.list_price_satang, b.name business,
            (SELECT COUNT(*) FROM serial_units u WHERE u.product_id = p.id AND u.status = 'in_stock') in_stock
     FROM products p JOIN businesses b ON b.id = p.business_id
     WHERE p.business_id IN (${placeholders(scope.length)}) ORDER BY p.code`,
  ).bind(...scope).all<any>()
  return page(
    c,
    'รุ่นสินค้า',
    <>
      <div class="card">
        <h3>เพิ่มรุ่น</h3>
        <form class="inline" method="post" action="/products">
          <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} />
          <label>Product_ID<input name="code" required placeholder="Ti3B35" /></label>
          <label>สเปค<input name="spec" placeholder="Acer P214 Ci5 Gen11 R8 ssd256" /></label>
          <label>ราคาตั้ง (บาท)<input name="list_price" inputmode="decimal" /></label>
          <button>บันทึก</button>
        </form>
      </div>
      <div class="card scroll">
        <table>
          <tr><th>Product_ID</th><th>สเปค</th><th>ราคาตั้ง</th><th>คงเหลือ</th><th>กิจการ</th></tr>
          {results.map((p) => (
            <tr><td>{p.code}</td><td>{p.spec}</td><td>{baht(p.list_price_satang)}</td><td>{p.in_stock}</td><td>{p.business}</td></tr>
          ))}
        </table>
      </div>
    </>,
  )
})

app.post('/products', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  try {
    const r = await c.env.DB.prepare('INSERT INTO products (business_id, code, spec, list_price_satang) VALUES (?, ?, ?, ?)')
      .bind(Number(f.business_id), f.code.trim(), f.spec ?? '', toSatang(f.list_price))
      .run()
    await audit(c.env.DB, 'products', r.meta.last_row_id, 'create', f)
    return c.redirect(back('/products', sel, { ok: `เพิ่มรุ่น ${f.code} แล้ว` }))
  } catch (e) {
    return c.redirect(back('/products', sel, { err: `เพิ่มไม่ได้: ${String(e)}` }))
  }
})

// ---------- สต็อก ----------
app.get('/stock', async (c) => {
  const scope = c.get('scope')
  const status = c.req.query('status') ?? 'in_stock'
  const { results } = await c.env.DB.prepare(
    `SELECT u.serial, u.status, u.received_at, u.supplier, u.cost_satang, p.code, p.spec, b.name business
     FROM serial_units u JOIN products p ON p.id = u.product_id JOIN businesses b ON b.id = u.business_id
     WHERE u.business_id IN (${placeholders(scope.length)}) AND (? = 'all' OR u.status = ?)
     ORDER BY u.received_at DESC LIMIT 500`,
  ).bind(...scope, status, status).all<any>()
  return page(
    c,
    'สต็อก',
    <>
      <div class="card">
        <h3>รับเครื่องเข้า</h3>
        <form class="inline" method="post" action="/stock/in">
          <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} />
          <label>Product_ID<input name="product_code" required /></label>
          <label>Serial (คั่นด้วยเว้นวรรคหรือขึ้นบรรทัด)<input name="serials" required /></label>
          <label>ต้นทุน/เครื่อง (บาท)<input name="cost" inputmode="decimal" /></label>
          <label>ซัพพลายเออร์<input name="supplier" /></label>
          <button>รับเข้า</button>
        </form>
      </div>
      <div class="card">
        <h3>นำเครื่องออก (โอน/ใช้เอง)</h3>
        <form class="inline" method="post" action="/stock/out">
          <label>Serial<input name="serial" required /></label>
          <label>ประเภท
            <select name="kind"><option value="transfer">โอน</option><option value="internal">ใช้เอง</option></select>
          </label>
          <label>ปลายทาง<input name="destination" placeholder="ไนซ์ไอที" /></label>
          <button>นำออก</button>
        </form>
      </div>
      <div class="card scroll">
        <form method="get">
          {c.get('selected') && <input type="hidden" name="b" value={String(c.get('selected'))} />}
          <select name="status" onchange="this.form.submit()">
            {['in_stock', 'reserved', 'sold', 'transferred', 'internal', 'claim', 'all'].map((s) => (
              <option value={s} selected={s === status}>{s}</option>
            ))}
          </select>
        </form>
        <table>
          <tr><th>Serial</th><th>รุ่น</th><th>สเปค</th><th>สถานะ</th><th>รับเข้า</th><th>ต้นทุน</th><th>กิจการ</th></tr>
          {results.map((u) => (
            <tr><td>{u.serial}</td><td>{u.code}</td><td>{u.spec}</td><td>{u.status}</td><td>{u.received_at}</td><td>{baht(u.cost_satang)}</td><td>{u.business}</td></tr>
          ))}
        </table>
      </div>
    </>,
  )
})

app.post('/stock/in', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const businessId = Number(f.business_id)
  const product = await c.env.DB.prepare('SELECT id FROM products WHERE business_id = ? AND code = ?')
    .bind(businessId, f.product_code.trim())
    .first<{ id: number }>()
  if (!product) return c.redirect(back('/stock', sel, { err: `ไม่พบรุ่น ${f.product_code} ในกิจการนี้ เพิ่มที่หน้ารุ่นสินค้าก่อน` }))
  const serials = f.serials.split(/[\s,]+/).filter(Boolean)
  const now = new Date().toISOString().slice(0, 19)
  const stmts = serials.flatMap((s) => [
    c.env.DB.prepare('INSERT INTO serial_units (business_id, product_id, serial, cost_satang, supplier, received_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(businessId, product.id, s, toSatang(f.cost), f.supplier || null, now),
    c.env.DB.prepare("INSERT INTO stock_movements (unit_id, kind) VALUES (last_insert_rowid(), 'in')"),
  ])
  try {
    await c.env.DB.batch(stmts)
    return c.redirect(back('/stock', sel, { ok: `รับเข้า ${serials.length} เครื่อง` }))
  } catch (e) {
    return c.redirect(back('/stock', sel, { err: `รับเข้าไม่ได้ (Serial ซ้ำ?): ${String(e)}` }))
  }
})

app.post('/stock/out', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const scope = c.get('scope')
  const unit = await c.env.DB.prepare(`SELECT id, status FROM serial_units WHERE serial = ? AND business_id IN (${placeholders(scope.length)})`)
    .bind(f.serial.trim(), ...scope)
    .first<{ id: number; status: string }>()
  if (!unit) return c.redirect(back('/stock', sel, { err: `ไม่พบ Serial ${f.serial}` }))
  if (unit.status !== 'in_stock') return c.redirect(back('/stock', sel, { err: `Serial ${f.serial} สถานะ ${unit.status} นำออกไม่ได้` }))
  const status = f.kind === 'transfer' ? 'transferred' : 'internal'
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE serial_units SET status = ? WHERE id = ?').bind(status, unit.id),
    c.env.DB.prepare('INSERT INTO stock_movements (unit_id, kind, destination) VALUES (?, ?, ?)').bind(unit.id, f.kind, f.destination || null),
  ])
  return c.redirect(back('/stock', sel, { ok: `นำ ${f.serial} ออกแล้ว` }))
})

// ---------- ออเดอร์ขาย ----------
app.get('/orders', async (c) => {
  const scope = c.get('scope')
  const db = c.env.DB
  const [orders, teams] = await Promise.all([
    db.prepare(
      `SELECT o.id, o.sold_on, o.price_satang, o.payment_type, o.status, o.house_no,
              c.facebook_name, t.name team, b.name business,
              (SELECT group_concat(p.code, ', ') FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) models,
              (SELECT group_concat(s.tracking_no, ', ') FROM shipments s WHERE s.order_id = o.id) tracking
       FROM orders o JOIN businesses b ON b.id = o.business_id
       LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN teams t ON t.id = o.team_id
       WHERE o.business_id IN (${placeholders(scope.length)})
       ORDER BY o.sold_on DESC, o.id DESC LIMIT 300`,
    ).bind(...scope).all<any>(),
    db.prepare(`SELECT DISTINCT name FROM teams WHERE business_id IN (${placeholders(scope.length)}) ORDER BY name`).bind(...scope).all<{ name: string }>(),
  ])
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  return page(
    c,
    'ออเดอร์ขาย',
    <>
      <div class="card">
        <h3>บันทึกการขาย</h3>
        <form class="inline" method="post" action="/orders">
          <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} />
          <label>วันที่ขาย<input type="date" name="sold_on" value={today} required /></label>
          <label>ทีม/ช่องทาง<input name="team" list="teams" placeholder="ทีม 1" /></label>
          <datalist id="teams">{teams.results.map((t) => <option value={t.name} />)}</datalist>
          <label>ชื่อเฟซบุ๊ก<input name="facebook_name" /></label>
          <label>ชื่อจริง<input name="full_name" /></label>
          <label>เบอร์โทร<input name="phone" inputmode="tel" /></label>
          <label>บ้านที่<input name="house_no" /></label>
          <label>Product_ID<input name="product_code" required /></label>
          <label>Serial (ถ้ามี)<input name="serial" /></label>
          <label>ราคาขาย (บาท)<input name="price" inputmode="decimal" required /></label>
          <label>ราคาจริง (บาท)<input name="real_price" inputmode="decimal" /></label>
          <label>ชำระแบบ
            <select name="payment_type">
              {Object.entries(PAYMENT_LABEL).map(([v, l]) => <option value={v}>{l}</option>)}
            </select>
          </label>
          <label>ขนส่ง<input name="carrier" list="carriers" placeholder="Flash" /></label>
          <datalist id="carriers"><option value="Flash" /><option value="Kerry" /><option value="iship" /><option value="ไปรษณีย์" /></datalist>
          <label>เลขพัสดุ<input name="tracking_no" /></label>
          <label>หมายเหตุ<input name="note" /></label>
          <button>บันทึก</button>
        </form>
      </div>
      <div class="card scroll">
        <table>
          <tr><th>วันที่</th><th>ลูกค้า</th><th>รุ่น</th><th>ราคา</th><th>ชำระ</th><th>เลขพัสดุ</th><th>ทีม</th><th>สถานะ</th><th>กิจการ</th></tr>
          {orders.results.map((o) => (
            <tr>
              <td>{o.sold_on}</td><td>{o.facebook_name}</td><td>{o.models}</td><td>{baht(o.price_satang)}</td>
              <td>{PAYMENT_LABEL[o.payment_type] ?? o.payment_type}</td><td>{o.tracking}</td><td>{o.team}</td><td>{o.status}</td><td>{o.business}</td>
            </tr>
          ))}
        </table>
      </div>
    </>,
  )
})

app.post('/orders', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const db = c.env.DB
  const businessId = Number(f.business_id)
  const price = toSatang(f.price)
  if (price == null) return c.redirect(back('/orders', sel, { err: 'ราคาขายไม่ถูกต้อง' }))

  const product = await db.prepare('SELECT id FROM products WHERE business_id = ? AND code = ?')
    .bind(businessId, f.product_code.trim())
    .first<{ id: number }>()
  if (!product) return c.redirect(back('/orders', sel, { err: `ไม่พบรุ่น ${f.product_code} ในกิจการนี้` }))

  let unit: { id: number; status: string } | null = null
  if (f.serial?.trim()) {
    unit = await db.prepare('SELECT id, status FROM serial_units WHERE business_id = ? AND serial = ? AND product_id = ?')
      .bind(businessId, f.serial.trim(), product.id)
      .first()
    if (!unit) return c.redirect(back('/orders', sel, { err: `ไม่พบ Serial ${f.serial} ของรุ่นนี้` }))
    if (unit.status !== 'in_stock' && unit.status !== 'reserved') return c.redirect(back('/orders', sel, { err: `Serial ${f.serial} สถานะ ${unit.status} ขายไม่ได้` }))
  }

  let teamId: number | null = null
  if (f.team?.trim()) {
    await db.prepare('INSERT OR IGNORE INTO teams (business_id, name) VALUES (?, ?)').bind(businessId, f.team.trim()).run()
    teamId = (await db.prepare('SELECT id FROM teams WHERE business_id = ? AND name = ?').bind(businessId, f.team.trim()).first<{ id: number }>())!.id
  }

  const customer = await db.prepare('INSERT INTO customers (facebook_name, full_name, phone) VALUES (?, ?, ?)')
    .bind(f.facebook_name || null, f.full_name || null, f.phone || null)
    .run()
  const order = await db.prepare(
    'INSERT INTO orders (business_id, customer_id, team_id, sold_on, house_no, price_satang, real_price_satang, payment_type, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(businessId, customer.meta.last_row_id, teamId, f.sold_on, f.house_no || null, price, toSatang(f.real_price), f.payment_type, f.note || null).run()
  const orderId = order.meta.last_row_id

  const stmts = [db.prepare('INSERT INTO order_items (order_id, product_id, unit_id, price_satang) VALUES (?, ?, ?, ?)').bind(orderId, product.id, unit?.id ?? null, price)]
  if (unit) {
    stmts.push(db.prepare("UPDATE serial_units SET status = 'sold' WHERE id = ?").bind(unit.id))
    stmts.push(db.prepare("INSERT INTO stock_movements (unit_id, kind, order_id) VALUES (?, 'sale', ?)").bind(unit.id, orderId))
  }
  if (f.tracking_no?.trim()) {
    const cod = f.payment_type === 'cod' ? price : 0
    stmts.push(
      db.prepare('INSERT INTO shipments (order_id, carrier, tracking_no, shipped_on, cod_satang) VALUES (?, ?, ?, ?, ?)')
        .bind(orderId, f.carrier || 'ไม่ระบุ', f.tracking_no.trim(), f.sold_on, cod),
    )
    stmts.push(db.prepare("UPDATE orders SET status = 'shipped' WHERE id = ?").bind(orderId))
  }
  await db.batch(stmts)
  await audit(db, 'orders', orderId, 'create', f)
  return c.redirect(back('/orders', sel, { ok: `บันทึกออเดอร์ #${orderId} แล้ว` }))
})

// ---------- API สำหรับระบบอื่น ----------
app.get('/api/serials/:serial', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT u.serial, u.status, p.code product, p.spec, b.code business FROM serial_units u
     JOIN products p ON p.id = u.product_id JOIN businesses b ON b.id = u.business_id WHERE u.serial = ?`,
  ).bind(c.req.param('serial')).all()
  return c.json(row.results)
})

export default app
