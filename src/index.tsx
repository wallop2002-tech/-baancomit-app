import { Hono } from 'hono'
import { parseBankPaste, parseCodPaste } from './reconcile'
import { audit, baht, placeholders, stockOwner, toSatang } from './db'
import { type AppEnv, BusinessSelect, PAYMENT_LABEL, back, page } from './ui'
import { access } from './auth'
import { reports } from './routes/reports'
import { claims } from './routes/claims'
import { installments } from './routes/installments'
import { users } from './routes/users'
import { importer } from './routes/import'
import { api } from './routes/api'

const app = new Hono<AppEnv>()

// API สำหรับระบบภายนอกใช้ token ของตัวเอง ไม่ผ่านล็อกอินพนักงาน
app.route('/api', api)

// ล็อกอิน สิทธิ์ และขอบเขตกิจการที่เลือก (?b=) ให้ทุกหน้า
app.use('*', access)


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
  const scope = c.get('stockScope')
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
          <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} stock />
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
      .bind(stockOwner(c.get('allBusinesses'), Number(f.business_id)), f.code.trim(), f.spec ?? '', toSatang(f.list_price))
      .run()
    await audit(c.env.DB, 'products', r.meta.last_row_id, 'create', f)
    return c.redirect(back('/products', sel, { ok: `เพิ่มรุ่น ${f.code} แล้ว` }))
  } catch (e) {
    return c.redirect(back('/products', sel, { err: `เพิ่มไม่ได้: ${String(e)}` }))
  }
})

// ---------- สต็อก ----------
app.get('/stock', async (c) => {
  const scope = c.get('stockScope')
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
          <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} stock />
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
  const businessId = stockOwner(c.get('allBusinesses'), Number(f.business_id))
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
  const scope = c.get('stockScope')
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

  // ขายในนามกิจการย่อย แต่ตัดจากสต็อกของกิจการแม่
  const owner = stockOwner(c.get('allBusinesses'), businessId)
  const product = await db.prepare('SELECT id FROM products WHERE business_id = ? AND code = ?')
    .bind(owner, f.product_code.trim())
    .first<{ id: number }>()
  if (!product) return c.redirect(back('/orders', sel, { err: `ไม่พบรุ่น ${f.product_code} ในกิจการนี้` }))

  let unit: { id: number; status: string } | null = null
  if (f.serial?.trim()) {
    unit = await db.prepare('SELECT id, status FROM serial_units WHERE business_id = ? AND serial = ? AND product_id = ?')
      .bind(owner, f.serial.trim(), product.id)
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

// ---------- จับคู่ยอดเงิน ----------
// ยอดที่ยังค้างของออเดอร์ = ราคาขาย - เงินที่ยืนยันแล้ว
const OUTSTANDING = `o.price_satang - COALESCE((SELECT SUM(p.amount_satang) FROM payments p WHERE p.order_id = o.id AND p.match_status = 'confirmed'), 0)`

async function markPaidIfComplete(db: D1Database, orderId: number) {
  await db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ? AND (${OUTSTANDING.replaceAll('o.', 'orders.')}) <= 0`).bind(orderId).run()
}

app.get('/reconcile', async (c) => {
  const scope = c.get('scope')
  const ph = placeholders(scope.length)
  const db = c.env.DB
  const { results: txns } = await db.prepare(
    `SELECT t.id, t.txn_at, t.amount_satang, t.description, t.account, b.name business
     FROM bank_transactions t JOIN businesses b ON b.id = t.business_id
     WHERE t.business_id IN (${ph}) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.bank_txn_id = t.id)
     ORDER BY t.txn_at DESC LIMIT 200`,
  ).bind(...scope).all<any>()

  // หาออเดอร์โอนที่ยอดค้างตรงกับเงินเข้า และขายภายใน 10 วันก่อนถึง 2 วันหลังวันโอน
  const suggestions = await Promise.all(
    txns.map((t) =>
      db.prepare(
        `SELECT o.id, o.sold_on, o.price_satang, c.facebook_name, c.full_name
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.business_id IN (${ph}) AND o.payment_type IN ('transfer', 'mixed') AND o.status NOT IN ('paid', 'cancelled')
           AND (${OUTSTANDING}) = ? AND o.sold_on BETWEEN date(?, '-10 days') AND date(?, '+2 days')
         ORDER BY abs(julianday(o.sold_on) - julianday(?)) LIMIT 3`,
      ).bind(...scope, t.amount_satang, t.txn_at, t.txn_at, t.txn_at).all<any>().then((r) => r.results),
    ),
  )
  const { results: openCod } = await db.prepare(
    `SELECT s.tracking_no, s.carrier, s.cod_satang, o.sold_on, c.facebook_name FROM shipments s
     JOIN orders o ON o.id = s.order_id LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.business_id IN (${ph}) AND s.cod_satang > 0 AND s.status != 'cod_settled'
     ORDER BY o.sold_on LIMIT 200`,
  ).bind(...scope).all<any>()

  return page(
    c,
    'จับคู่ยอดเงิน',
    <>
      <div class="card">
        <h3>นำเข้า statement ธนาคาร</h3>
        <p>คัดลอกแถวจาก statement หรือแท็บกสิกร/BankNoi แล้ววางทั้งก้อน แถวที่เคยนำเข้าแล้วจะถูกข้าม</p>
        <form method="post" action="/reconcile/bank">
          <div class="inline">
            <BusinessSelect businesses={c.get('businesses')} selected={c.get('selected')} />
            <label>บัญชี<input name="account" placeholder="กสิกร x1234" required /></label>
          </div>
          <textarea name="paste" rows={6} style="width:100%;margin:8px 0" required></textarea>
          <button>นำเข้า</button>
        </form>
      </div>
      <div class="card">
        <h3>นำเข้ารอบโอน COD</h3>
        <p>วางแถวจากไฟล์ COD ของ iship/Flash/Kerry (ต้องมีเลขพัสดุและยอด COD) ระบบจับคู่ด้วยเลขพัสดุให้ทันที</p>
        <form method="post" action="/reconcile/cod">
          <textarea name="paste" rows={6} style="width:100%;margin:8px 0" required></textarea>
          <button>นำเข้า</button>
        </form>
      </div>
      <div class="card scroll">
        <h3>เงินเข้าที่ยังไม่ได้จับคู่ ({txns.length})</h3>
        <table>
          <tr><th>เวลา</th><th>ยอด</th><th>รายละเอียด</th><th>ออเดอร์ที่น่าจะใช่</th></tr>
          {txns.map((t, i) => (
            <tr>
              <td>{t.txn_at.replace('T', ' ').slice(0, 16)}</td>
              <td>{baht(t.amount_satang)}</td>
              <td>{t.description}</td>
              <td>
                {suggestions[i].length === 0
                  ? 'ไม่พบ'
                  : suggestions[i].map((o: any) => (
                      <form method="post" action="/reconcile/confirm" style="display:inline-block;margin:2px">
                        <input type="hidden" name="txn_id" value={String(t.id)} />
                        <input type="hidden" name="order_id" value={String(o.id)} />
                        <button>#{o.id} {o.facebook_name ?? o.full_name} ({o.sold_on})</button>
                      </form>
                    ))}
              </td>
            </tr>
          ))}
        </table>
      </div>
      <div class="card scroll">
        <h3>พัสดุ COD ที่ยังไม่ได้รับเงิน ({openCod.length})</h3>
        <table>
          <tr><th>วันที่ขาย</th><th>เลขพัสดุ</th><th>ขนส่ง</th><th>ยอด COD</th><th>ลูกค้า</th></tr>
          {openCod.map((s) => (
            <tr><td>{s.sold_on}</td><td>{s.tracking_no}</td><td>{s.carrier}</td><td>{baht(s.cod_satang)}</td><td>{s.facebook_name}</td></tr>
          ))}
        </table>
      </div>
    </>,
  )
})

app.post('/reconcile/bank', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const rows = parseBankPaste(f.paste ?? '')
  if (rows.length === 0) return c.redirect(back('/reconcile', sel, { err: 'อ่านแถวเงินเข้าไม่ได้ ต้องมีวันที่ (วว/ดด/ปปปป) และยอดเงิน' }))
  const batch = new Date().toISOString()
  const res = await c.env.DB.batch(
    rows.map((r) =>
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO bank_transactions (business_id, account, txn_at, amount_satang, description, ref_code, import_batch) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(Number(f.business_id), f.account.trim(), r.txnAt, r.amount, r.description, r.refCode, batch),
    ),
  )
  const added = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
  return c.redirect(back('/reconcile', sel, { ok: `นำเข้า ${added} แถว (ข้ามแถวซ้ำ ${rows.length - added})` }))
})

app.post('/reconcile/cod', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const db = c.env.DB
  const rows = parseCodPaste(f.paste ?? '')
  if (rows.length === 0) return c.redirect(back('/reconcile', sel, { err: 'อ่านแถว COD ไม่ได้ ต้องมีเลขพัสดุและยอดเงิน' }))
  let matched = 0
  const missing: string[] = []
  for (const r of rows) {
    const ship = await db.prepare('SELECT id, order_id, status FROM shipments WHERE tracking_no = ?').bind(r.tracking).first<{ id: number; order_id: number; status: string }>()
    if (!ship) { missing.push(r.tracking); continue }
    if (ship.status === 'cod_settled') continue
    await db.batch([
      db.prepare("UPDATE shipments SET status = 'cod_settled', cod_fee_satang = ? WHERE id = ?").bind(r.fee, ship.id),
      db.prepare("INSERT INTO payments (order_id, kind, amount_satang, paid_on, shipment_id, match_status) VALUES (?, 'cod', ?, ?, ?, 'confirmed')")
        .bind(ship.order_id, r.cod, r.depositOn ?? new Date().toISOString().slice(0, 10), ship.id),
    ])
    await markPaidIfComplete(db, ship.order_id)
    matched++
  }
  const msg = `จับคู่ COD ได้ ${matched} พัสดุ` + (missing.length ? ` · ไม่พบในระบบ ${missing.length}: ${missing.slice(0, 10).join(', ')}` : '')
  return c.redirect(back('/reconcile', sel, missing.length ? { err: msg } : { ok: msg }))
})

app.post('/reconcile/confirm', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const db = c.env.DB
  const txn = await db.prepare('SELECT id, txn_at, amount_satang FROM bank_transactions WHERE id = ?').bind(Number(f.txn_id)).first<{ id: number; txn_at: string; amount_satang: number }>()
  if (!txn) return c.redirect(back('/reconcile', sel, { err: 'ไม่พบรายการเงินเข้า' }))
  const used = await db.prepare('SELECT 1 FROM payments WHERE bank_txn_id = ?').bind(txn.id).first()
  if (used) return c.redirect(back('/reconcile', sel, { err: 'รายการนี้จับคู่ไปแล้ว' }))
  const orderId = Number(f.order_id)
  await db.prepare("INSERT INTO payments (order_id, kind, amount_satang, paid_on, bank_txn_id, match_status) VALUES (?, 'transfer', ?, ?, ?, 'confirmed')")
    .bind(orderId, txn.amount_satang, txn.txn_at.slice(0, 10), txn.id)
    .run()
  await markPaidIfComplete(db, orderId)
  await audit(db, 'payments', txn.id, 'match', { order_id: orderId })
  return c.redirect(back('/reconcile', sel, { ok: `จับคู่เงิน ${baht(txn.amount_satang)} กับออเดอร์ #${orderId} แล้ว` }))
})

app.route('/', reports)
app.route('/', claims)
app.route('/', installments)
app.route('/', users)
app.route('/', importer)

export default app
