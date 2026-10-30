import type { Context } from 'hono'
import { Layout } from './views/layout'
import { type Env, type Business, stockOwner } from './db'

export type Role = 'owner' | 'accounting' | 'sales' | 'stock'
export type Vars = {
  businesses: Business[]
  allBusinesses: Business[]
  selected: number | null
  scope: number[]
  stockScope: number[]
  user: { id: number; email: string; name: string } | null
  roles: Set<Role>
}
export type AppEnv = { Bindings: Env; Variables: Vars }
export type Ctx = Context<AppEnv>

export const PAYMENT_LABEL: Record<string, string> = {
  transfer: 'โอน',
  cod: 'COD',
  cash: 'สด',
  installment: 'ผ่อน',
  mixed: 'ผสม',
}

export function page(c: Ctx, title: string, body: any) {
  return c.html(
    <Layout
      title={title}
      businesses={c.get('businesses')}
      selected={c.get('selected')}
      user={c.get('user')}
      flash={c.req.query('ok')}
      error={c.req.query('err')}
    >
      {body}
    </Layout>,
  )
}

export function back(path: string, selected: number | null, params: Record<string, string>) {
  const q = new URLSearchParams(params)
  if (selected) q.set('b', String(selected))
  return `${path}?${q}`
}

export function BusinessSelect(props: { businesses: Business[]; selected: number | null; stock?: boolean }) {
  // หน้าสต็อก/รุ่นสินค้าเลือกได้เฉพาะกิจการแม่ เพราะกิจการย่อยใช้สต็อกร่วม
  const tops = props.businesses.filter((b) => b.parent_id == null)
  const list = props.stock && tops.length ? tops : props.businesses
  const selected = props.stock && tops.length && props.selected != null ? stockOwner(props.businesses, props.selected) : props.selected
  return (
    <label>
      กิจการ
      <select name="business_id" required>
        {list.map((b) => (
          <option value={String(b.id)} selected={selected === b.id}>
            {b.parent_id ? '— ' : ''}
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// วันที่วันนี้ตามเวลาไทย
export function today(): string {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
}
