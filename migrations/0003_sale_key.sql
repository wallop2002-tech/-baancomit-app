-- คีย์ยอดขายแบบเดียวกับชีตจดยอดขายเซลล์ (ววดด + ทีม + ชื่อ 10 ตัวอักษร)
-- ใช้กันออเดอร์ซ้ำระหว่างสมุดโอนครบกับแท็บเซลล์ทีม
ALTER TABLE orders ADD COLUMN sale_key TEXT;
CREATE INDEX orders_sale_key ON orders(sale_key);
