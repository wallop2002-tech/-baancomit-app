import { Hono } from 'hono'
import { audit, baht, placeholders, toSatang } from '../db'
import { type AppEnv, back, page, today } from '../ui'

export const installments = new Hono<AppEnv>()

const PAID = `COALESCE((SELECT SUM(p.amount_satang) FROM payments p WHERE p.order_id = ip.order_id AND p.match_status = 'confirmed'), 0)`

installments.get('/installments', async (c) => {
  const scope = c.get('scope')
  const ph = placeholders(scope.length)
  const show = c.req.query('show') === 'all' ? 'all' : 'active'
  const db = c.env.DB
  const [plans, candidates] = await Promise.all([
    db.prepare(
      `SELECT ip.id, ip.customer_code, ip.full_price_satang, ip.started_on, ip.status, ip.closed_on, ${PAID} paid,
              cu.facebook_name, cu.full_name, cu.phone, o.id order_id,
              (SELECT group_concat(pr.code, ' ') FROM order_items i JOIN products pr ON pr.id = i.product_id WHERE i.order_id = o.id) models,
              (SELECT MAX(paid_on) FROM payments p WHERE p.order_id = o.id) last_paid
       FROM installment_plans ip JOIN orders o ON o.id = ip.order_id JOIN customers cu ON cu.id = ip.customer_id
       WHERE o.business_id IN (${ph}) AND (? = 'all' OR ip.status = 'active')
       ORDER BY ip.started_on DESC LIMIT 300`,
    ).bind(...scope, show).all<any>(),
    db.prepare(
      `SELECT o.id, o.sold_on, o.price_satang, cu.facebook_name FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
       WHERE o.business_id IN (${ph}) AND o.payment_type = 'installment' AND NOT EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.order_id = o.id)
       ORDER BY o.sold_on DESC LIMIT 100`,
    ).bind(...scope).all<any>(),
  ])
  const sel = c.get('selected')
  const q = sel ? `?b=${sel}` : ''

  return page(
    c,
    'ผ่อน',
    <>
      <div class="card">
        <h3>เปิดแผนผ่อนจากออเดอร์</h3>
        {candidates.results.length === 0 ? (
          <p class="muted">ยังไม่มีออเดอร์ที่ชำระแบบผ่อนซึ่งยังไม่มีแผน บันทึกขายโดยเลือก "ผ่อน" ที่หน้าออเดอร์ก่อน</p>
        ) : (
          <form class="inline" method="post" action={`/installments${q}`}>
            <label>ออเดอร์
              <select name="order_id">
                {candidates.results.map((o) => <option value={String(o.id)}>#{o.id} {o.sold_on} {o.facebook_name} {baht(o.price_satang)}</option>)}
              </select>
            </label>
            <label>รหัสลูกค้า (เบอร์)<input name="customer_code" /></label>
            <button>เปิดแผน</button>
          </form>
        )}
      </div>
      <div class="card scroll">
        <form method="get">
          {sel && <input type="hidden" name="b" value={String(sel)} />}
          <select name="show" onchange="this.form.submit()">
            <option value="active" selected={show === 'active'}>กำลังผ่อน</option>
            <option value="all" selected={show === 'all'}>ทั้งหมด</option>
          </select>
        </form>
        <table>
          <tr><th>เริ่ม</th><th>ลูกค้า</th><th>รหัส</th><th>รุ่น</th><th>ยอดเต็ม</th><th>จ่ายแล้ว</th><th>คงเหลือ</th><th>จ่ายล่าสุด</th><th>รับงวด</th></tr>
          {plans.results.map((p) => (
            <tr>
              <td>{p.started_on}</td><td>{p.facebook_name ?? p.full_name} {p.phone}</td><td>{p.customer_code}</td><td>{p.models}</td>
              <td>{baht(p.full_price_satang)}</td><td>{baht(p.paid)}</td><td>{baht(Math.max(0, p.full_price_satang - p.paid))}</td><td>{p.last_paid}</td>
              <td>
                {p.status === 'active' ? (
                  <form method="post" action={`/installments/${p.id}/pay${q}`} style="display:flex;gap:4px">
                    <input name="amount" inputmode="decimal" placeholder="บาท" size={6} required />
                    <input type="date" name="paid_on" value={today()} />
                    <button class="link">บันทึก</button>
                  </form>
                ) : `ปิดแล้ว ${p.closed_on ?? ''}`}
              </td>
            </tr>
          ))}
        </table>
      </div>
    </>,
  )
})

installments.post('/installments', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const scope = c.get('scope')
  const db = c.env.DB
  const order = await db.prepare(`SELECT id, customer_id, sold_on, price_satang FROM orders WHERE id = ? AND business_id IN (${placeholders(scope.length)})`)
    .bind(Number(f.order_id), ...scope)
    .first<{ id: number; customer_id: number | null; sold_on: string; price_satang: number }>()
  if (!order || !order.customer_id) return c.redirect(back('/installments', sel, { err: 'ไม่พบออเดอร์หรือออเดอร์ไม่มีลูกค้า' }))
  const res = await db.prepare('INSERT INTO installment_plans (order_id, customer_id, customer_code, full_price_satang, started_on) VALUES (?, ?, ?, ?, ?)')
    .bind(order.id, order.customer_id, f.customer_code || null, order.price_satang, order.sold_on)
    .run()
  await audit(db, 'installment_plans', res.meta.last_row_id, 'create', f)
  return c.redirect(back('/installments', sel, { ok: `เปิดแผนผ่อนออเดอร์ #${order.id} แล้ว` }))
})

installments.post('/installments/:id/pay', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const scope = c.get('scope')
  const db = c.env.DB
  const amount = toSatang(f.amount)
  if (!amount || amount <= 0) return c.redirect(back('/installments', sel, { err: 'ยอดเงินไม่ถูกต้อง' }))
  const plan = await db.prepare(
    `SELECT ip.id, ip.order_id, ip.full_price_satang, ${PAID} paid FROM installment_plans ip JOIN orders o ON o.id = ip.order_id
     WHERE ip.id = ? AND ip.status = 'active' AND o.business_id IN (${placeholders(scope.length)})`,
  ).bind(Number(c.req.param('id')), ...scope).first<{ id: number; order_id: number; full_price_satang: number; paid: number }>()
  if (!plan) return c.redirect(back('/installments', sel, { err: 'ไม่พบแผนผ่อนที่ยังเปิดอยู่' }))
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(f.paid_on ?? '') ? f.paid_on : today()
  const stmts = [
    db.prepare("INSERT INTO payments (order_id, kind, amount_satang, paid_on, match_status) VALUES (?, 'installment', ?, ?, 'confirmed')").bind(plan.order_id, amount, paidOn),
  ]
  const closed = plan.paid + amount >= plan.full_price_satang
  if (closed) {
    stmts.push(db.prepare("UPDATE installment_plans SET status = 'closed', closed_on = ? WHERE id = ?").bind(paidOn, plan.id))
    stmts.push(db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").bind(plan.order_id))
  }
  await db.batch(stmts)
  return c.redirect(back('/installments', sel, { ok: closed ? 'รับงวดสุดท้ายแล้ว ปิดแผนผ่อน' : `รับงวด ${baht(amount)} แล้ว` }))
})
