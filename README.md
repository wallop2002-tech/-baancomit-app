# ระบบรวมงานร้าน (บ้านคอมไอที · นายไอที · ไนซ์ไอที)

แอปเดียวแทนชีต สมุดโอนครบ, จดยอดขายเซลล์ และ IT_STOCK_SYSTEM
รันบน Cloudflare Workers ฐานข้อมูล Cloudflare D1

โครงข้อมูลอยู่ใน `migrations/0001_init.sql` เงินทุกช่องเก็บเป็นสตางค์

## ตอนนี้ทำอะไรได้

- เลือกดูทีละกิจการ หรือกิจการแม่รวมกิจการย่อย (วีแคร์ยู, คุณหน่อย อยู่ใต้บ้านคอมไอที)
- สต็อกและรุ่นสินค้าเป็นของกิจการแม่ กิจการย่อยขายจากกองเดียวกัน
- เพิ่มรุ่นสินค้า (Product_ID)
- รับเครื่องเข้าตาม Serial ทีละหลายเครื่อง, นำออกแบบโอน/ใช้เอง
- บันทึกการขาย ผูกลูกค้า ทีม Serial เลขพัสดุ และยอด COD ในครั้งเดียว ขายแล้วตัดสต็อกอัตโนมัติ
- หน้าภาพรวม ยอดวันนี้ ยอดเดือน แยกกิจการ
- หน้าจับคู่ยอดเงิน: วาง statement ธนาคาร (ข้ามแถวซ้ำ) แล้วระบบเสนอออเดอร์ที่ยอดค้างตรงกัน กดยืนยันทีเดียว, วางไฟล์ COD แล้วจับคู่ด้วยเลขพัสดุอัตโนมัติ ออเดอร์ที่รับเงินครบเปลี่ยนเป็น paid
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

## ย้ายข้อมูลปี 2026 จากชีตเดิม

1. ดาวน์โหลดแท็บเหล่านี้เป็น CSV (เปิดแท็บ > ไฟล์ > ดาวน์โหลด > CSV) ไว้ในโฟลเดอร์ `import-data/` ไม่ต้องเปลี่ยนชื่อไฟล์
    - IT_STOCK_SYSTEM: `MASTER_STOCK`, `STOCK_OUT`, `CLAIM_CUST`, `CLAIM_OUT`
    - สมุดโอนครบ: `วีแคร์ยู`, `KhunNoi`, `กสิกร`, `BankNoi`, `COD_WCY`, `COD_Noi`
2. `npm run import -- import-data data.import.sql` (สรุปจำนวนแถวที่อ่านได้จะแสดงเป็นตาราง)
3. `npx wrangler d1 execute baancomit-db --remote --file data.import.sql`

รันซ้ำได้ แถวที่เคยนำเข้าแล้วจะไม่ซ้ำ ไฟล์ CSV และ SQL มีข้อมูลลูกค้าจริง ถูก ignore ไว้แล้ว ห้าม commit

สิ่งที่ทำ: นำเข้ารุ่นและเครื่องทุก Serial, ออเดอร์ปี 2026 ของวีแคร์ยูและคุณหน่อย พร้อมเลขพัสดุ ยอดโอน โอนเพิ่ม สด และ COD, ผูกเงินโอนกับแถว statement ด้วย Keyเช็คโอน, ค่าธรรมเนียม COD จากไฟล์ COD, และเคลม
ยังไม่นำเข้า: แท็บเซลล์ทีมและผ่อนในจดยอดขายเซลล์ (ข้อมูลออเดอร์ส่วนใหญ่มีในสมุดโอนครบแล้ว)

## รันบนเครื่อง

```
npm run db:migrate:local
npm run dev
```

## ยังไม่ได้ทำ

- เคลม, แผนผ่อน
- นำเข้าแผนผ่อนและยอดขายหน้าร้านที่ไม่ได้ส่งของ
- สิทธิ์ผู้ใช้ตามบทบาท
