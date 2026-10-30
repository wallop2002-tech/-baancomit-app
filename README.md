# ระบบรวมงานร้าน (บ้านคอมไอที · นายไอที · ไนซ์ไอที)

แอปเดียวแทนชีต สมุดโอนครบ, จดยอดขายเซลล์ และ IT_STOCK_SYSTEM
รันบน Cloudflare Workers ฐานข้อมูล Cloudflare D1

โครงข้อมูลอยู่ใน `migrations/0001_init.sql` เงินทุกช่องเก็บเป็นสตางค์

## ตอนนี้ทำอะไรได้

- เลือกดูทีละกิจการ หรือกิจการแม่รวมกิจการย่อย (วีแคร์ยู, คุณหน่อย อยู่ใต้บ้านคอมไอที)
- เพิ่มรุ่นสินค้า (Product_ID)
- รับเครื่องเข้าตาม Serial ทีละหลายเครื่อง, นำออกแบบโอน/ใช้เอง
- บันทึกการขาย ผูกลูกค้า ทีม Serial เลขพัสดุ และยอด COD ในครั้งเดียว ขายแล้วตัดสต็อกอัตโนมัติ
- หน้าภาพรวม ยอดวันนี้ ยอดเดือน แยกกิจการ
- API `GET /api/serials/:serial` สำหรับระบบอื่นเช็คสถานะเครื่อง

## ติดตั้งครั้งแรก (ทำครั้งเดียว)

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create baancomit-db` แล้วเอา `database_id` ที่ได้ไปใส่ใน `wrangler.toml`
4. `npm run db:migrate:remote`
5. `npm run deploy`

### ให้ deploy เองทุกครั้งที่ push เข้า main

ใน GitHub repo นี้ ไปที่ Settings → Secrets and variables → Actions แล้วตั้ง

- Secret `CLOUDFLARE_API_TOKEN` สร้างที่ Cloudflare dashboard → My Profile → API Tokens (template "Edit Cloudflare Workers" แล้วเพิ่มสิทธิ์ D1 Edit)
- Secret `CLOUDFLARE_ACCOUNT_ID`
- Variable `DEPLOY_ENABLED` = `true`

### ล็อกอิน

แนะนำเปิด Cloudflare Access (Zero Trust) ครอบโดเมนของแอป ให้เข้าได้เฉพาะอีเมลพนักงาน สิทธิ์รายบทบาทในตัวแอปยังไม่ได้ทำ

## รันบนเครื่อง

```
npm run db:migrate:local
npm run dev
```

## ยังไม่ได้ทำ

- นำเข้า statement ธนาคารและไฟล์ COD แล้วจับคู่ยอดอัตโนมัติ
- เคลม, แผนผ่อน
- ย้ายข้อมูลเก่าจาก 3 ชีต
- สิทธิ์ผู้ใช้ตามบทบาท
