import { Hono } from 'hono'
import { audit, placeholders } from '../db'
import { type AppEnv, BusinessSelect, back, page } from '../ui'

export const users = new Hono<AppEnv>()

const ROLE_LABEL: Record<string, string> = { owner: 'เจ้าของ', accounting: 'บัญชี', sales: 'เซลล์', stock: 'สต็อก/ช่าง' }

users.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, m.business_id, m.role, b.name business FROM users u
     LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN businesses b ON b.id = m.business_id ORDER BY u.name, b.id`,
  ).all<any>()
  const sel = c.get('selected')
  const q = sel ? `?b=${sel}` : ''
  const ids = c.get('businesses').map((b) => b.id)
  const { results: teams } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.code, b.name business,
            (SELECT group_concat(u.name || '|' || u.id, ',') FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = t.id) members
     FROM teams t JOIN businesses b ON b.id = t.business_id WHERE t.business_id IN (${placeholders(ids.length)}) ORDER BY t.business_id, t.name`,
  ).bind(...ids).all<{ id: number; name: string; code: string | null; business: string; members: string | null }>()
  const people = [...new Map(results.map((r) => [r.id, r])).values()]
  return page(
    c,
    'ผู้ใช้',
    <>
      <div class="card">
        <h3>เพิ่มผู้ใช้หรือสิทธิ์</h3>
        <p class="muted">ผู้ใช้ล็อกอินด้วยอีเมลผ่าน Cloudflare Access สิทธิ์ในกิจการแม่ครอบคลุมกิจการย่อย คนแรกที่เพิ่มควรเป็นเจ้าของ</p>
        <p><a href="/import">นำเข้าข้อมูลจาก Google Sheets</a></p>
        <form class="inline" method="post" action={`/users${q}`}>
          <label>อีเมล<input type="email" name="email" required /></label>
          <label>ชื่อ<input name="name" required /></label>
          <BusinessSelect businesses={c.get('businesses')} selected={sel} />
          <label>บทบาท
            <select name="role">{Object.entries(ROLE_LABEL).map(([v, l]) => <option value={v}>{l}</option>)}</select>
          </label>
          <button>บันทึก</button>
        </form>
      </div>
      <div class="card">
        <h3>ทีมขาย</h3>
        <p class="muted">เซลล์ลงยอดได้เฉพาะทีมที่สังกัด (ต้องมีบทบาทเซลล์ในกิจการนั้นด้วย) เจ้าของและบัญชีเห็นทุกทีม รหัสทีมคือค่าในคอลัมน์ "ทีม" ของชีต เช่น 1 หรือ X ใช้สร้าง KEY</p>
        <form class="inline" method="post" action={`/users/team-members${q}`}>
          <label>ผู้ใช้
            <select name="user_id" required>{people.map((p) => <option value={String(p.id)}>{p.name} ({p.email})</option>)}</select>
          </label>
          <label>ทีม
            <select name="team_id" required>{teams.map((t) => <option value={String(t.id)}>{t.business} · {t.name}</option>)}</select>
          </label>
          <button>เพิ่มเข้าทีม</button>
        </form>
        <table style="margin-top:12px">
          <tr><th>กิจการ</th><th>ทีม</th><th>รหัส</th><th>สมาชิก</th></tr>
          {teams.map((t) => (
            <tr>
              <td>{t.business}</td><td>{t.name}</td><td>{t.code ?? '-'}</td>
              <td>
                {(t.members ? t.members.split(',') : []).map((m) => {
                  const [name, id] = m.split('|')
                  return (
                    <form method="post" action={`/users/team-members/remove${q}`} style="display:inline-block;margin-right:12px">
                      <input type="hidden" name="user_id" value={id} />
                      <input type="hidden" name="team_id" value={String(t.id)} />
                      {name} <button class="link" title="เอาออกจากทีม">✕</button>
                    </form>
                  )
                })}
              </td>
            </tr>
          ))}
        </table>
        <h4>เพิ่มทีมใหม่</h4>
        <form class="inline" method="post" action={`/users/teams${q}`}>
          <BusinessSelect businesses={c.get('businesses')} selected={sel} />
          <label>ชื่อทีม<input name="name" required placeholder="ทีม 6" /></label>
          <label>รหัสทีม<input name="code" required placeholder="6" maxlength={5} /></label>
          <button>เพิ่มทีม</button>
        </form>
      </div>
      <div class="card scroll">
        <table>
          <tr><th>ชื่อ</th><th>อีเมล</th><th>กิจการ</th><th>บทบาท</th><th></th></tr>
          {results.map((r) => (
            <tr>
              <td>{r.name}</td><td>{r.email}</td><td>{r.business ?? '-'}</td><td>{ROLE_LABEL[r.role] ?? '-'}</td>
              <td>
                {r.business_id && (
                  <form method="post" action={`/users/${r.id}/remove${q}`}>
                    <input type="hidden" name="membership_business" value={String(r.business_id)} />
                    <button class="link">ถอนสิทธิ์</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </table>
      </div>
    </>,
  )
})

users.post('/users', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const email = f.email.trim().toLowerCase()
  if (!ROLE_LABEL[f.role]) return c.redirect(back('/users', sel, { err: 'บทบาทไม่ถูกต้อง' }))
  const db = c.env.DB
  // ผู้ใช้คนแรกทำให้ระบบเริ่มบังคับล็อกอิน ถ้ายังไม่ได้ตั้ง Access ไว้จะเข้าระบบไม่ได้อีก
  const count = (await db.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>())!.n
  if (count === 0) {
    const ready = (c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) || c.env.DEV_TRUST_EMAIL_HEADER === '1'
    if (!ready) return c.redirect(back('/users', sel, { err: 'ตั้งค่า Cloudflare Access (ACCESS_TEAM_DOMAIN, ACCESS_AUD) ก่อนเพิ่มผู้ใช้คนแรก ไม่อย่างนั้นจะเข้าระบบไม่ได้' }))
    if (f.role !== 'owner') return c.redirect(back('/users', sel, { err: 'ผู้ใช้คนแรกต้องเป็นเจ้าของ' }))
  }
  await db.prepare('INSERT INTO users (email, name) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name').bind(email, f.name.trim()).run()
  const user = (await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>())!
  await db.prepare('INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, ?) ON CONFLICT(user_id, business_id) DO UPDATE SET role = excluded.role')
    .bind(user.id, Number(f.business_id), f.role)
    .run()
  await audit(db, 'memberships', user.id, 'grant', { email, business_id: f.business_id, role: f.role })
  return c.redirect(back('/users', sel, { ok: `ให้สิทธิ์ ${email} แล้ว` }))
})

users.post('/users/:id/remove', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const db = c.env.DB
  const userId = Number(c.req.param('id'))
  const businessId = Number(f.membership_business)
  if (!c.get('businesses').some((b) => b.id === businessId)) return c.redirect(back('/users', sel, { err: 'ไม่มีสิทธิ์ในกิจการนี้' }))
  // กันไม่ให้ถอนเจ้าของคนสุดท้าย แล้วทุกคนเข้าระบบไม่ได้
  const owners = await db.prepare("SELECT COUNT(*) n FROM memberships WHERE role = 'owner' AND NOT (user_id = ? AND business_id = ?)").bind(userId, businessId).first<{ n: number }>()
  if (!owners?.n) return c.redirect(back('/users', sel, { err: 'ต้องมีเจ้าของอย่างน้อย 1 คน' }))
  await db.prepare('DELETE FROM memberships WHERE user_id = ? AND business_id = ?').bind(userId, businessId).run()
  await audit(db, 'memberships', userId, 'revoke', { business_id: businessId })
  return c.redirect(back('/users', sel, { ok: 'ถอนสิทธิ์แล้ว' }))
})

// ทีมต้องอยู่ในกิจการที่ผู้ใช้มีสิทธิ์
async function teamInScope(c: any, teamId: number): Promise<boolean> {
  const ids: number[] = c.get('businesses').map((b: { id: number }) => b.id)
  const t = await c.env.DB.prepare('SELECT business_id FROM teams WHERE id = ?').bind(teamId).first()
  return !!t && ids.includes(t.business_id)
}

users.post('/users/teams', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const name = (f.name ?? '').trim()
  const code = (f.code ?? '').trim()
  if (!name || !code) return c.redirect(back('/users', sel, { err: 'ใส่ชื่อทีมและรหัสทีม' }))
  await c.env.DB.prepare('INSERT INTO teams (business_id, name, code) VALUES (?, ?, ?) ON CONFLICT(business_id, name) DO UPDATE SET code = excluded.code')
    .bind(Number(f.business_id), name, code)
    .run()
  await audit(c.env.DB, 'teams', 0, 'upsert', f)
  return c.redirect(back('/users', sel, { ok: `บันทึกทีม ${name} แล้ว` }))
})

users.post('/users/team-members', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const teamId = Number(f.team_id)
  if (!(await teamInScope(c, teamId))) return c.redirect(back('/users', sel, { err: 'ไม่มีสิทธิ์ในทีมนี้' }))
  await c.env.DB.prepare('INSERT OR IGNORE INTO team_members (user_id, team_id) VALUES (?, ?)').bind(Number(f.user_id), teamId).run()
  await audit(c.env.DB, 'team_members', teamId, 'add', f)
  return c.redirect(back('/users', sel, { ok: 'เพิ่มเข้าทีมแล้ว' }))
})

users.post('/users/team-members/remove', async (c) => {
  const f = await c.req.parseBody<Record<string, string>>()
  const sel = c.get('selected')
  const teamId = Number(f.team_id)
  if (!(await teamInScope(c, teamId))) return c.redirect(back('/users', sel, { err: 'ไม่มีสิทธิ์ในทีมนี้' }))
  await c.env.DB.prepare('DELETE FROM team_members WHERE user_id = ? AND team_id = ?').bind(Number(f.user_id), teamId).run()
  await audit(c.env.DB, 'team_members', teamId, 'remove', f)
  return c.redirect(back('/users', sel, { ok: 'เอาออกจากทีมแล้ว' }))
})
