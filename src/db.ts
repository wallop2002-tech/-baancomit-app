export type Env = {
  DB: D1Database
  // Cloudflare Access: โดเมนทีม (เช่น baancomit.cloudflareaccess.com) และ Application Audience (AUD) tag
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  // token สำหรับระบบภายนอกที่เรียก /api
  API_TOKEN?: string
  DEV_TRUST_EMAIL_HEADER?: string
}

export type Business = { id: number; parent_id: number | null; code: string; name: string }

// รับเงินบาทจากฟอร์ม ("4,490" หรือ "4490.50") แล้วคืนเป็นสตางค์
export function toSatang(input: string | undefined | null): number | null {
  if (input == null) return null
  const cleaned = String(input).replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function baht(satang: number | null | undefined): string {
  if (satang == null) return '-'
  return (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export async function listBusinesses(db: D1Database): Promise<Business[]> {
  const { results } = await db.prepare('SELECT id, parent_id, code, name FROM businesses ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, id').all<Business>()
  return results
}

// กิจการที่เลือก รวมกิจการย่อยทั้งหมดของมัน
export function scopeIds(all: Business[], selected: number | null): number[] {
  if (selected == null) return all.map((b) => b.id)
  const ids = [selected]
  for (let i = 0; i < ids.length; i++) {
    for (const b of all) if (b.parent_id === ids[i]) ids.push(b.id)
  }
  return ids
}

// สต็อกและรุ่นสินค้าเป็นของกิจการแม่ กิจการย่อยทุกตัวใช้กองเดียวกัน
export function stockOwner(all: Business[], id: number): number {
  let cur = all.find((b) => b.id === id)
  while (cur?.parent_id != null) cur = all.find((b) => b.id === cur!.parent_id)
  return cur?.id ?? id
}

export function stockScope(all: Business[], selected: number | null): number[] {
  return selected == null ? all.map((b) => b.id) : scopeIds(all, stockOwner(all, selected))
}

export function placeholders(n: number): string {
  return Array(n).fill('?').join(',')
}

export async function audit(db: D1Database, table: string, rowId: number, action: string, changes: unknown) {
  await db
    .prepare('INSERT INTO audit_log (table_name, row_id, action, changes) VALUES (?, ?, ?, ?)')
    .bind(table, rowId, action, JSON.stringify(changes))
    .run()
}
