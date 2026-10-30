import { Hono } from 'hono'
import { audit } from '../db'
import { type AppEnv, page } from '../ui'

export const importer = new Hono<AppEnv>()

// รับเฉพาะคำสั่งที่ตัวแปลงข้อมูลสร้าง ไม่เปิดให้รัน SQL อื่น
const ALLOWED = /^(INSERT OR IGNORE INTO|UPDATE) [a-z_]+ /
const MAX_CHUNK = 500

importer.get('/import', (c) =>
  page(
    c,
    'นำเข้าข้อมูล',
    <>
      <div class="card">
        <h3>นำเข้าข้อมูลปี 2026 จาก Google Sheets</h3>
        <p>เปิดชีตแต่ละไฟล์ แล้วเลือก <b>ไฟล์ → ดาวน์โหลด → Microsoft Excel (.xlsx)</b> ให้ครบ 3 ไฟล์ คือ IT_STOCK_SYSTEM, สมุดโอนครบ และ จดยอดขายเซลล์ แล้วเลือกทั้ง 3 ไฟล์ด้านล่างพร้อมกัน</p>
        <p class="muted">ไฟล์ถูกอ่านในเบราว์เซอร์นี้เท่านั้น นำเข้าซ้ำได้ แถวที่เคยเข้าแล้วจะไม่ซ้ำ</p>
        <input id="files" type="file" accept=".xlsx" multiple />
        <pre id="summary" class="muted" style="white-space:pre-wrap"></pre>
        <button id="run" disabled>นำเข้า</button>
        <div><progress id="progress" value="0" max="1" style="width:100%"></progress></div>
        <pre id="status" style="white-space:pre-wrap"></pre>
      </div>
      <script type="module" src="/static/import.js"></script>
    </>,
  ),
)

importer.post('/import/run', async (c) => {
  if (!c.req.header('content-type')?.includes('application/json')) return c.text('ต้องส่ง JSON', 415)
  const body = await c.req.json<{ statements?: unknown }>().catch(() => null)
  const statements = body?.statements
  if (!Array.isArray(statements) || statements.length === 0 || statements.length > MAX_CHUNK) return c.text('รูปแบบไม่ถูกต้อง', 400)
  const bad = statements.findIndex((s) => typeof s !== 'string' || !ALLOWED.test(s))
  if (bad >= 0) return c.text(`คำสั่งที่ ${bad + 1} ไม่ได้รับอนุญาต`, 400)
  const db = c.env.DB
  try {
    await db.batch((statements as string[]).map((s) => db.prepare(s)))
  } catch (e) {
    return c.text(`ฐานข้อมูลตอบกลับผิดพลาด: ${(e as Error).message}`, 500)
  }
  if (statements.some((s) => (s as string).startsWith('UPDATE orders SET status'))) await audit(db, 'import', 0, 'finish', { user: c.get('user')?.email })
  return c.json({ ok: true, count: statements.length })
})
