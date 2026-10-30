// API สำหรับระบบภายนอก (ธนาคาร, ขนส่ง, ระบบอื่นของร้าน)
// ทุกคำขอต้องมี header: Authorization: Bearer <API_TOKEN>
// เงินส่งเป็นบาท (ตัวเลข) และตอบกลับเป็นบาท

import { Hono } from 'hono'
import { listBusinesses, scopeIds, stockOwner, toSatang } from '../db'
import type { AppEnv } from '../ui'

export const api = new Hono<AppEnv>()

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

api.use('*', async (c, next) => {
  if (!c.env.API_TOKEN) return c.json({ error: 'ยังไม่ได้ตั้ง API_TOKEN' }, 503)
  const given = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!sameToken(given, c.env.API_TOKEN)) return c.json({ error: 'unauthorized' }, 401)
  await next()
})

async function businessByCode(db: D1Database, code: string | undefined) {
  const all = await listBusinesses(db)
  const b = all.find((x) => x.code === (code ?? '').toUpperCase())
  return b ? { business: b, all } : null
}

const bahtOf = (satang: number | null) => (satang == null ? null : satang / 100)

// สถานะเครื่องตาม Serial
api.get('/serials/:serial', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.serial, u.status, p.code product, p.spec, b.code business FROM serial_units u
     JOIN products p ON p.id = u.product_id JOIN businesses b ON b.id = u.business_id WHERE u.serial = ?`,
  ).bind(c.req.param('serial')).all()
  return c.json(results)
})

// สต็อกพร้อมขายตามรุ่น: GET /api/stock?business=BCI (กิจการย่อยจะได้สต็อกของกิจการแม่)
api.get('/stock', async (c) => {
  const found = await businessByCode(c.env.DB, c.req.query('business'))
  if (!found) return c.json({ error: 'ไม่พบกิจการ ระบุ ?business=<code>' }, 400)
  const owner = stockOwner(found.all, found.business.id)
  const { results } = await c.env.DB.prepare(
    `SELECT p.code product, p.spec, p.list_price_satang, COUNT(u.id) available FROM products p
     LEFT JOIN serial_units u ON u.product_id = p.id AND u.status = 'in_stock'
     WHERE p.business_id = ? GROUP BY p.id HAVING available > 0 ORDER BY p.code`,
  ).bind(owner).all<any>()
  return c.json(results.map((r) => ({ product: r.product, spec: r.spec, list_price: bahtOf(r.list_price_satang), available: r.available })))
})

// ออเดอร์ตามช่วงวันที่: GET /api/orders?business=WCY&from=2026-10-01&to=2026-10-31
api.get('/orders', async (c) => {
  const found = await businessByCode(c.env.DB, c.req.query('business'))
  if (!found) return c.json({ error: 'ไม่พบกิจการ ระบุ ?business=<code>' }, 400)
  const ids = scopeIds(found.all, found.business.id)
  const from = c.req.query('from') ?? '0000-01-01'
  const to = c.req.query('to') ?? '9999-12-31'
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.sold_on, b.code business, o.price_satang, o.payment_type, o.status,
            (SELECT group_concat(s.tracking_no, ' ') FROM shipments s WHERE s.order_id = o.id) tracking
     FROM orders o JOIN businesses b ON b.id = o.business_id
     WHERE o.business_id IN (${ids.map(() => '?').join(',')}) AND o.sold_on BETWEEN ? AND ? ORDER BY o.sold_on, o.id LIMIT 1000`,
  ).bind(...ids, from, to).all<any>()
  return c.json(results.map((r) => ({ ...r, price: bahtOf(r.price_satang), price_satang: undefined })))
})

// เงินเข้าจากธนาคาร (webhook หรือระบบอ่านสลิป)
// POST /api/bank-transactions {business, account, txn_at: "2026-10-30T14:05:00", amount: 1590, description, ref_code}
api.post('/bank-transactions', async (c) => {
  const body = await c.req.json<Record<string, any>>().catch(() => null)
  if (!body) return c.json({ error: 'ต้องส่ง JSON' }, 400)
  const found = await businessByCode(c.env.DB, body.business)
  const amount = toSatang(String(body.amount ?? ''))
  if (!found || !body.account || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.txn_at ?? '') || !amount || amount <= 0) {
    return c.json({ error: 'ต้องมี business, account, txn_at (ISO), amount > 0' }, 400)
  }
  const res = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO bank_transactions (business_id, account, txn_at, amount_satang, description, ref_code, import_batch) VALUES (?, ?, ?, ?, ?, ?, 'api')",
  ).bind(found.business.id, body.account, body.txn_at, amount, body.description ?? null, body.ref_code ?? null).run()
  // รายการนี้จะไปขึ้นในหน้าจับคู่ยอดเงินพร้อมออเดอร์ที่น่าจะใช่ ให้บัญชีกดยืนยัน
  return c.json({ created: res.meta.changes === 1, duplicate: res.meta.changes === 0 }, res.meta.changes ? 201 : 200)
})

// สถานะพัสดุจากขนส่ง (webhook)
// POST /api/shipments/status {tracking_no, status: delivered|returned|cod_settled, cod_amount?, fee?, settled_on?}
api.post('/shipments/status', async (c) => {
  const body = await c.req.json<Record<string, any>>().catch(() => null)
  const status = body?.status
  if (!body?.tracking_no || !['delivered', 'returned', 'cod_settled'].includes(status)) {
    return c.json({ error: 'ต้องมี tracking_no และ status เป็น delivered, returned หรือ cod_settled' }, 400)
  }
  const db = c.env.DB
  const ship = await db.prepare('SELECT id, order_id, cod_satang, status FROM shipments WHERE tracking_no = ?').bind(body.tracking_no).first<any>()
  if (!ship) return c.json({ error: 'ไม่พบเลขพัสดุ' }, 404)
  if (ship.status === 'cod_settled') return c.json({ ok: true, unchanged: true })
  const stmts = [db.prepare('UPDATE shipments SET status = ?, cod_fee_satang = COALESCE(?, cod_fee_satang) WHERE id = ?').bind(status, toSatang(String(body.fee ?? '')), ship.id)]
  if (status === 'returned') stmts.push(db.prepare("UPDATE orders SET status = 'returned' WHERE id = ?").bind(ship.order_id))
  if (status === 'cod_settled') {
    const amount = toSatang(String(body.cod_amount ?? '')) ?? ship.cod_satang
    const on = /^\d{4}-\d{2}-\d{2}/.test(body.settled_on ?? '') ? body.settled_on.slice(0, 10) : new Date().toISOString().slice(0, 10)
    stmts.push(
      db.prepare("INSERT INTO payments (order_id, kind, amount_satang, paid_on, shipment_id, match_status) SELECT ?, 'cod', ?, ?, ?, 'confirmed' WHERE NOT EXISTS (SELECT 1 FROM payments WHERE shipment_id = ? AND kind = 'cod')")
        .bind(ship.order_id, amount, on, ship.id, ship.id),
    )
    stmts.push(
      db.prepare(
        "UPDATE orders SET status = 'paid' WHERE id = ? AND status IN ('open','shipped') AND price_satang <= (SELECT COALESCE(SUM(amount_satang),0) FROM payments WHERE order_id = ? AND match_status = 'confirmed')",
      ).bind(ship.order_id, ship.order_id),
    )
  }
  await db.batch(stmts)
  return c.json({ ok: true })
})
