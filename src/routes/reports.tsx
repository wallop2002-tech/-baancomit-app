import { Hono } from 'hono'
import { baht, placeholders } from '../db'
import { type AppEnv, type Ctx, PAYMENT_LABEL, page, today } from '../ui'

export const reports = new Hono<AppEnv>()

const PAID = `COALESCE((SELECT SUM(p.amount_satang) FROM payments p WHERE p.order_id = o.id AND p.match_status = 'confirmed'), 0)`
const COST = `COALESCE((SELECT SUM(u.cost_satang) FROM order_items i JOIN serial_units u ON u.id = i.unit_id WHERE i.order_id = o.id), 0)`
const HAS_COST = `EXISTS (SELECT 1 FROM order_items i JOIN serial_units u ON u.id = i.unit_id WHERE i.order_id = o.id AND u.cost_satang IS NOT NULL)`

function range(c: Ctx) {
  const t = today()
  const valid = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  return { from: valid(c.req.query('from')) ?? `${t.slice(0, 7)}-01`, to: valid(c.req.query('to')) ?? t }
}

reports.get('/reports', async (c) => {
  const scope = c.get('scope')
  const stock = c.get('stockScope')
  const ph = placeholders(scope.length)
  const { from, to } = range(c)
  const db = c.env.DB
  const inRange = `o.business_id IN (${ph}) AND o.sold_on BETWEEN ? AND ? AND o.status NOT IN ('cancelled', 'returned')`
  const args = [...scope, from, to]

  const [total, byBusiness, byTeam, byDay, byProduct, receivable, codPending, onHand] = await Promise.all([
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(o.price_satang),0) sales, COALESCE(SUM(CASE WHEN ${HAS_COST} THEN o.price_satang - ${COST} END),0) profit, SUM(${HAS_COST}) costed FROM orders o WHERE ${inRange}`).bind(...args).first<any>(),
    db.prepare(`SELECT b.name, COUNT(*) n, SUM(o.price_satang) sales, SUM(CASE WHEN ${HAS_COST} THEN o.price_satang - ${COST} END) profit FROM orders o JOIN businesses b ON b.id = o.business_id WHERE ${inRange} GROUP BY b.id ORDER BY sales DESC`).bind(...args).all<any>(),
    db.prepare(`SELECT b.name business, COALESCE(t.name, '-') team, COUNT(*) n, SUM(o.price_satang) sales FROM orders o JOIN businesses b ON b.id = o.business_id LEFT JOIN teams t ON t.id = o.team_id WHERE ${inRange} GROUP BY b.id, t.id ORDER BY sales DESC`).bind(...args).all<any>(),
    db.prepare(`SELECT o.sold_on d, COUNT(*) n, SUM(o.price_satang) sales FROM orders o WHERE ${inRange} GROUP BY o.sold_on ORDER BY o.sold_on`).bind(...args).all<any>(),
    db.prepare(
      `SELECT p.code, p.spec, COUNT(*) units, SUM(i.price_satang) sales, AVG(CASE WHEN u.cost_satang IS NOT NULL THEN i.price_satang - u.cost_satang END) avg_profit
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id LEFT JOIN serial_units u ON u.id = i.unit_id
       WHERE ${inRange} GROUP BY p.id ORDER BY units DESC LIMIT 50`,
    ).bind(...args).all<any>(),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(o.price_satang - ${PAID}),0) amount FROM orders o WHERE o.business_id IN (${ph}) AND o.status IN ('open','shipped') AND o.price_satang > ${PAID}`).bind(...scope).first<any>(),
    db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(s.cod_satang),0) amount FROM shipments s JOIN orders o ON o.id = s.order_id WHERE o.business_id IN (${ph}) AND s.cod_satang > 0 AND s.status IN ('shipped','delivered')`).bind(...scope).first<any>(),
    db.prepare(
      `SELECT p.code, p.spec, COUNT(*) n, SUM(u.cost_satang) cost FROM serial_units u JOIN products p ON p.id = u.product_id
       WHERE u.business_id IN (${placeholders(stock.length)}) AND u.status IN ('in_stock','reserved') GROUP BY p.id ORDER BY n DESC`,
    ).bind(...stock).all<any>(),
  ])
  const maxDay = Math.max(1, ...byDay.results.map((r) => r.sales))
  const stockUnits = onHand.results.reduce((s, r) => s + r.n, 0)
  const stockCost = onHand.results.reduce((s, r) => s + (r.cost ?? 0), 0)
  const sel = c.get('selected')
  const csv = `/reports/orders.csv?from=${from}&to=${to}${sel ? `&b=${sel}` : ''}`

  return page(
    c,
    'รายงาน',
    <>
      <div class="card">
        <form class="inline" method="get">
          {sel && <input type="hidden" name="b" value={String(sel)} />}
          <label>ตั้งแต่<input type="date" name="from" value={from} /></label>
          <label>ถึง<input type="date" name="to" value={to} /></label>
          <button>ดูรายงาน</button>
          <a href={csv}>ดาวน์โหลดออเดอร์ (CSV)</a>
        </form>
      </div>
      <div class="grid">
        <div class="card stat"><span>ยอดขาย</span><b>{baht(total.sales)}</b><span>{total.n} ออเดอร์</span></div>
        <div class="card stat"><span>กำไรขั้นต้น</span><b>{baht(total.profit)}</b><span>คิดจาก {total.costed ?? 0} ออเดอร์ที่รู้ต้นทุนเครื่อง</span></div>
        <div class="card stat"><span>ยอดค้างรับ (ทั้งหมด)</span><b>{baht(receivable.amount)}</b><span>{receivable.n} ออเดอร์</span></div>
        <div class="card stat"><span>COD รอโอน</span><b>{baht(codPending.amount)}</b><span>{codPending.n} พัสดุ</span></div>
        <div class="card stat"><span>สต็อกคงเหลือ</span><b>{stockUnits}</b><span>ต้นทุน {baht(stockCost)}</span></div>
      </div>
      <div class="card scroll">
        <h3>แยกกิจการ</h3>
        <table>
          <tr><th>กิจการ</th><th>ออเดอร์</th><th>ยอดขาย</th><th>กำไรขั้นต้น</th></tr>
          {byBusiness.results.map((r) => <tr><td>{r.name}</td><td>{r.n}</td><td>{baht(r.sales)}</td><td>{baht(r.profit)}</td></tr>)}
        </table>
      </div>
      <div class="card scroll">
        <h3>แยกทีม</h3>
        <table>
          <tr><th>กิจการ</th><th>ทีม</th><th>ออเดอร์</th><th>ยอดขาย</th></tr>
          {byTeam.results.map((r) => <tr><td>{r.business}</td><td>{r.team}</td><td>{r.n}</td><td>{baht(r.sales)}</td></tr>)}
        </table>
      </div>
      <div class="card scroll">
        <h3>รายวัน</h3>
        <table>
          <tr><th>วันที่</th><th>ออเดอร์</th><th>ยอดขาย</th><th style="width:40%"></th></tr>
          {byDay.results.map((r) => (
            <tr><td>{r.d}</td><td>{r.n}</td><td>{baht(r.sales)}</td><td><div class="bar" style={`width:${(r.sales / maxDay) * 100}%`} /></td></tr>
          ))}
        </table>
      </div>
      <div class="card scroll">
        <h3>รุ่นขายดี</h3>
        <table>
          <tr><th>รุ่น</th><th>สเปค</th><th>เครื่อง</th><th>ยอดขาย</th><th>กำไรเฉลี่ย/เครื่อง</th></tr>
          {byProduct.results.map((r) => <tr><td>{r.code}</td><td>{r.spec}</td><td>{r.units}</td><td>{baht(r.sales)}</td><td>{r.avg_profit == null ? '-' : baht(Math.round(r.avg_profit))}</td></tr>)}
        </table>
      </div>
      <div class="card scroll">
        <h3>สต็อกคงเหลือตามรุ่น</h3>
        <table>
          <tr><th>รุ่น</th><th>สเปค</th><th>เครื่อง</th><th>ต้นทุนรวม</th></tr>
          {onHand.results.map((r) => <tr><td>{r.code}</td><td>{r.spec}</td><td>{r.n}</td><td>{baht(r.cost)}</td></tr>)}
        </table>
      </div>
    </>,
  )
})

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

reports.get('/reports/orders.csv', async (c) => {
  const scope = c.get('scope')
  const { from, to } = range(c)
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.sold_on, b.name business, cu.facebook_name, cu.full_name, cu.phone, t.name team, o.price_satang, o.real_price_satang, o.payment_type, o.status, ${PAID} paid,
       (SELECT group_concat(p.code, ' ') FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) models,
       (SELECT group_concat(u.serial, ' ') FROM order_items i JOIN serial_units u ON u.id = i.unit_id WHERE i.order_id = o.id) serials,
       (SELECT group_concat(s.tracking_no, ' ') FROM shipments s WHERE s.order_id = o.id) tracking, o.note
     FROM orders o JOIN businesses b ON b.id = o.business_id LEFT JOIN customers cu ON cu.id = o.customer_id LEFT JOIN teams t ON t.id = o.team_id
     WHERE o.business_id IN (${placeholders(scope.length)}) AND o.sold_on BETWEEN ? AND ? ORDER BY o.sold_on, o.id`,
  ).bind(...scope, from, to).all<any>()
  const header = ['เลขออเดอร์', 'วันที่', 'กิจการ', 'ชื่อเฟซบุ๊ก', 'ชื่อจริง', 'เบอร์', 'ทีม', 'รุ่น', 'Serial', 'ราคาขาย', 'ราคาจริง', 'ชำระแบบ', 'รับเงินแล้ว', 'สถานะ', 'เลขพัสดุ', 'หมายเหตุ']
  const lines = results.map((r) =>
    [r.id, r.sold_on, r.business, r.facebook_name, r.full_name, r.phone, r.team, r.models, r.serials, r.price_satang / 100, r.real_price_satang == null ? '' : r.real_price_satang / 100, PAYMENT_LABEL[r.payment_type] ?? r.payment_type, r.paid / 100, r.status, r.tracking, r.note].map(csvCell).join(','),
  )
  // BOM ให้ Excel/Google Sheets อ่านภาษาไทยถูก
  return c.body(`﻿${[header.join(','), ...lines].join('\n')}\n`, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="orders-${from}-${to}.csv"`,
  })
})
