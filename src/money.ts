// แปลงข้อความจำนวนเงิน (บาท) เป็นสตางค์ ใช้ได้ทั้งในเซิร์ฟเวอร์และเบราว์เซอร์
export function toSatang(input: string | undefined | null): number | null {
  if (input == null) return null
  const cleaned = String(input).replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}
