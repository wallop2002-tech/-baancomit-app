import { Hono } from 'hono'
import { audit, placeholders } from '../db'
import { type AppEnv, back, page, today } from '../ui'

export const claims = new Hono<AppEnv>()

const DIRECTION_LABEL: Record<string, string> = { customer: 'ลูกค้าส่งเคลม', supplier: 'ส่งเคลมซัพพลายเออร์' }

claims.get('/claims', async (c) => {
  const stock = c.get('stockScope')
  const show = c.req.query('show') === 'all' ? 'all' : 'open'
  const { results } = await c.env.DB.prepare(
    `SELECT cl.id, cl.direction, cl.symptom, cl.destination, cl.sent_on, cl.sent_tracking, cl.received_back_on, cl.returned_to_customer_on, cl.return_tracking,
            u.serial, p.code, r.serial replacement, cu.facebook_name
     FROM claims cl JOIN serial_units u ON u.id = cl.unit_id JOIN products p ON p.id = u.product_id
     LEFT JOIN serial_units r ON r.id = cl.replacement_unit_id
     LEFT JOIN orders o ON o.id = cl.order_id LEFT JOIN customers cu ON cu.id = o.customer_id
     WHERE u.business_id IN (${placeholders(stock.length)})
       AND (? = 'all' OR (cl.direction = 'customer' AND cl.returned_to_customer_on IS NULL) OR (cl.direction = 'supplier' AND cl.received_back_on IS NULL))
     ORDER BY cl.sent_on DESC LIMIT 300`,
  ).bind(...stock, show).all<any>()
  const sel = c.get('selected')
  const hidden = sel ? <input type="hidden" name="b" value={String(sel)} /> : null

  return page(
    c,
    'เคลม',
    <>
      <div class="card">
        <h3>เปิดเคลมใหม่</h3>
        <form class="inline" method="post" action={sel ? `/claims?b=${sel}` : '/claims'}>
          <label>Serial<input name="serial" required /></label>
          <label>ประเภท
            <select name="direction">
              <option value="customer">ลูกค้าส่งเคลม</option>
              <option value="supplier">ส่งเคลมซัพพลายเออร์</option>
            </select>
          </label>
          <label>อาการ<input name="symptom" required /></label>
          <label>ส่งไปที่<input name="destination" placeholder="iPLAWAN" /></label>
          <label>เลขพัสดุส่งเคลม<input name="sent_tracking" /></label>
          <button>บันทึก</button>
        </form>
      </div>
      <div class="card scroll">
        <form method="get">
          {hidden}
          <select name="show" onchange="this.form.submit()">
            <option value="open" selected={show === 'open'}>เคลมที่ยังไม่จบ</option>
            <option value="all" selected={show === 'all'}>ทั้งหมด</option>
          </select>
        </form>
        <table>
          <tr><th>ส่งเมื่อ</th><th>Serial</th><th>รุ่น</th><th>ประเภท</th><th>ลูกค้า</th><th>อาการ</th><th>ส่งไปที่</th><th>ความคืบหน้า</th></tr>
          {results.map((r) => (
            <tr>
              <td>{String(r.sent_on).slice(0, 10)}</td><td>{r.serial}</td><td>{r.code}</td><td>{DIRECTION_LABEL[r.direction]}</td>
              <td>{r.facebook_name}</td><td>{r.symptom}</td><td>{r.destination} {r.sent_tracking}</td>
              <td>
                {r.received_back_on ? <div>รับคืนจากเคลม {r.received_back_on}</div> : (
                  <form method="post" action={`/claims/${r.id}/received${sel ? `?b=${sel}` : ''}`}><button class="link">รับเครื่องคืนจากเคลมแล้ว</button></form>
                )}
                {r.direction === 'customer' && (r.returned_to_customer_on ? <div>ส่งคืนลูกค้า {r.returned_to_customer_on} {r.return_tracking} {r.replacement && `(เปลี่ยนเป็น ${r.replacement})`}</div> : (
                  <form method="post" action={`/claims/${r.id}/returned${sel ? `?b=${sel}` : ''}`} style="display:flex;gap:4px;flex-wrap:wrap">
                    <input name="return_tracking" placeholder="เลขพัสดุคืนลูกค้า" />
                    <input name="replacement_serial" placeholder="Serial เครื่องทดแทน (ถ้ามี)" />
                    <button class="link">ส่งคืนลูกค้าแล้ว</button>
                  </form>
                ))}
              </td>
            </tr>
          ))}
        </table>
      </div>
    </>,
  )
})

claims.post('/claims', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const stock = c.get('stockScope')
  const db = c.env.DB
  const unit = await db.prepare(`SELECT id, status FROM serial_units WHERE serial = ? AND business_id IN (${placeholders(stock.length)})`)
    .bind(f.serial.trim(), ...stock)
    .first<{ id: number; status: string }>()
  if (!unit) return c.redirect(back('/claims', sel, { err: `ไม่พบ Serial ${f.serial}` }))
  if (unit.status === 'claim') return c.redirect(back('/claims', sel, { err: `Serial ${f.serial} อยู่ระหว่างเคลมแล้ว` }))
  const order = await db.prepare('SELECT order_id FROM order_items WHERE unit_id = ? ORDER BY id DESC LIMIT 1').bind(unit.id).first<{ order_id: number }>()
  const direction = f.direction === 'supplier' ? 'supplier' : 'customer'
  const res = await db.prepare(
    'INSERT INTO claims (unit_id, order_id, direction, symptom, destination, sent_on, sent_tracking, prior_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(unit.id, order?.order_id ?? null, direction, f.symptom, f.destination || null, today(), f.sent_tracking || null, unit.status).run()
  await db.prepare("UPDATE serial_units SET status = 'claim' WHERE id = ?").bind(unit.id).run()
  await audit(db, 'claims', res.meta.last_row_id, 'create', f)
  return c.redirect(back('/claims', sel, { ok: `เปิดเคลม ${f.serial} แล้ว` }))
})

async function loadClaim(db: D1Database, id: number, stock: number[]) {
  return db.prepare(
    `SELECT cl.id, cl.unit_id, cl.direction, cl.prior_status, cl.received_back_on FROM claims cl JOIN serial_units u ON u.id = cl.unit_id
     WHERE cl.id = ? AND u.business_id IN (${placeholders(stock.length)})`,
  ).bind(id, ...stock).first<{ id: number; unit_id: number; direction: string; prior_status: string | null; received_back_on: string | null }>()
}

claims.post('/claims/:id/received', async (c) => {
  const sel = c.get('selected')
  const db = c.env.DB
  const claim = await loadClaim(db, Number(c.req.param('id')), c.get('stockScope'))
  if (!claim) return c.redirect(back('/claims', sel, { err: 'ไม่พบเคลมนี้' }))
  const stmts = [db.prepare('UPDATE claims SET received_back_on = ? WHERE id = ?').bind(today(), claim.id)]
  // เคลมกับซัพพลายเออร์จบที่รับเครื่องคืน: เครื่องกลับไปสถานะเดิม
  if (claim.direction === 'supplier') stmts.push(db.prepare('UPDATE serial_units SET status = ? WHERE id = ?').bind(claim.prior_status ?? 'in_stock', claim.unit_id))
  await db.batch(stmts)
  return c.redirect(back('/claims', sel, { ok: 'บันทึกรับเครื่องคืนแล้ว' }))
})

claims.post('/claims/:id/returned', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const stock = c.get('stockScope')
  const db = c.env.DB
  const claim = await loadClaim(db, Number(c.req.param('id')), stock)
  if (!claim || claim.direction !== 'customer') return c.redirect(back('/claims', sel, { err: 'ไม่พบเคลมลูกค้านี้' }))
  const stmts = []
  let replacementId: number | null = null
  if (f.replacement_serial?.trim()) {
    const r = await db.prepare(`SELECT id, status FROM serial_units WHERE serial = ? AND business_id IN (${placeholders(stock.length)})`)
      .bind(f.replacement_serial.trim(), ...stock)
      .first<{ id: number; status: string }>()
    if (!r || r.status !== 'in_stock') return c.redirect(back('/claims', sel, { err: `เครื่องทดแทน ${f.replacement_serial} ไม่อยู่ในสต็อก` }))
    replacementId = r.id
    // ลูกค้าได้เครื่องใหม่ เครื่องเดิมกลับเข้าสต็อกหลังซ่อม
    stmts.push(db.prepare("UPDATE serial_units SET status = 'sold' WHERE id = ?").bind(r.id))
    stmts.push(db.prepare("INSERT INTO stock_movements (unit_id, kind, destination) VALUES (?, 'sale', 'เปลี่ยนเครื่องจากเคลม')").bind(r.id))
    stmts.push(db.prepare("UPDATE serial_units SET status = 'in_stock' WHERE id = ?").bind(claim.unit_id))
  } else {
    stmts.push(db.prepare('UPDATE serial_units SET status = ? WHERE id = ?').bind(claim.prior_status ?? 'sold', claim.unit_id))
  }
  stmts.push(
    db.prepare('UPDATE claims SET returned_to_customer_on = ?, return_tracking = ?, replacement_unit_id = ?, received_back_on = COALESCE(received_back_on, ?) WHERE id = ?')
      .bind(today(), f.return_tracking || null, replacementId, today(), claim.id),
  )
  await db.batch(stmts)
  return c.redirect(back('/claims', sel, { ok: 'ปิดเคลมแล้ว' }))
})
