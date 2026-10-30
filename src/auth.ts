import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { MiddlewareHandler } from 'hono'
import { listBusinesses, scopeIds, stockScope } from './db'
import type { AppEnv, Role } from './ui'

const ALL_ROLES: Role[] = ['owner', 'accounting', 'sales', 'stock']

// บทบาทที่เข้าแต่ละหน้าได้ (owner เข้าได้ทุกหน้า) หน้าที่ไม่อยู่ในรายการ ทุกบทบาทดูได้
const RULES: { method?: string; prefix: string; roles: Role[] }[] = [
  { prefix: '/users', roles: ['owner'] },
  { prefix: '/import', roles: ['owner'] },
  { prefix: '/reconcile', roles: ['accounting'] },
  { prefix: '/reports', roles: ['accounting'] },
  { method: 'POST', prefix: '/stock', roles: ['stock'] },
  { method: 'POST', prefix: '/products', roles: ['stock'] },
  { method: 'POST', prefix: '/claims', roles: ['stock'] },
  { method: 'POST', prefix: '/orders', roles: ['sales', 'accounting'] },
  { method: 'POST', prefix: '/installments', roles: ['sales', 'accounting'] },
]

export function canAccess(method: string, path: string, roles: Set<Role>): boolean {
  if (roles.has('owner')) return true
  const rule = RULES.find((r) => (!r.method || r.method === method) && (path === r.prefix || path.startsWith(`${r.prefix}/`)))
  return !rule || rule.roles.some((r) => roles.has(r))
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

// อีเมลผู้ใช้จาก Cloudflare Access ตรวจลายเซ็น JWT เสมอเมื่อตั้งค่าไว้
async function accessEmail(req: Request, env: AppEnv['Bindings']): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = req.headers.get('Cf-Access-Jwt-Assertion')
    if (!token) return null
    const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!jwks.has(team)) jwks.set(team, createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)))
    try {
      const { payload } = await jwtVerify(token, jwks.get(team)!, { issuer: `https://${team}`, audience: env.ACCESS_AUD })
      return typeof payload.email === 'string' ? payload.email.toLowerCase() : null
    } catch {
      return null
    }
  }
  // ใช้เฉพาะตอนรันบนเครื่อง (ตั้ง DEV_TRUST_EMAIL_HEADER=1 ใน .dev.vars)
  if (env.DEV_TRUST_EMAIL_HEADER === '1') return req.headers.get('Cf-Access-Authenticated-User-Email')?.toLowerCase() ?? null
  return null
}

function deny(c: Parameters<MiddlewareHandler<AppEnv>>[0], status: 401 | 403, message: string) {
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:24px"><h2>เข้าไม่ได้</h2><p>${message}</p>`, status)
}

export const access: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = c.env.DB
  const all = await listBusinesses(db)
  const userCount = (await db.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>())!.n

  let user: AppEnv['Variables']['user'] = null
  let roles = new Set<Role>(ALL_ROLES)
  let allowed = all.map((b) => b.id)
  let memberships: { business_id: number; role: Role }[] = []

  // ยังไม่มีผู้ใช้ในระบบ = โหมดตั้งค่าครั้งแรก เข้าได้ทุกหน้าเพื่อเพิ่มเจ้าของ
  if (userCount > 0) {
    const email = await accessEmail(c.req.raw, c.env)
    if (!email) return deny(c, 401, 'ต้องล็อกอินผ่าน Cloudflare Access ก่อน')
    const row = await db.prepare('SELECT id, email, name FROM users WHERE lower(email) = ?').bind(email).first<{ id: number; email: string; name: string }>()
    if (!row) return deny(c, 403, `อีเมล ${email} ยังไม่ได้รับสิทธิ์ ติดต่อเจ้าของระบบ`)
    user = row
    memberships = (await db.prepare('SELECT business_id, role FROM memberships WHERE user_id = ?').bind(row.id).all<{ business_id: number; role: Role }>()).results
    roles = new Set(memberships.map((m) => m.role))
    allowed = [...new Set(memberships.flatMap((m) => scopeIds(all, m.business_id)))]
  }

  if (!canAccess(c.req.method, c.req.path, roles)) return deny(c, 403, 'บทบาทของคุณเข้าหน้านี้ไม่ได้')

  // ฟอร์มที่ส่ง business_id มา ต้องเป็นกิจการที่มีสิทธิ์
  if (c.req.method === 'POST' && c.req.header('content-type')?.includes('form')) {
    const body = await c.req.parseBody<Record<string, string>>()
    if (body.business_id && !allowed.includes(Number(body.business_id))) return deny(c, 403, 'ไม่มีสิทธิ์ในกิจการนี้')
  }

  const visible = all.filter((b) => allowed.includes(b.id))
  const raw = Number(c.req.query('b'))
  const selected = visible.some((b) => b.id === raw) ? raw : null
  c.set('user', user)
  c.set('roles', roles)
  c.set('businesses', visible)
  c.set('allBusinesses', all)
  c.set('selected', selected)
  c.set('scope', selected ? scopeIds(all, selected) : allowed)
  // สต็อกเป็นของกิจการแม่ ผู้ใช้ของกิจการย่อยจึงเห็นสต็อกของกิจการแม่ด้วย
  c.set(
    'stockScope',
    selected
      ? stockScope(all, selected)
      : userCount > 0
        ? [...new Set(memberships.flatMap((m) => stockScope(all, m.business_id)))]
        : all.map((b) => b.id),
  )
  await next()
}
