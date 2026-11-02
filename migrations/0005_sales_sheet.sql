-- หน้าลงยอดขายแบบชีต "จดยอดขายเซลล์"
-- ช่องตามคอลัมน์ในชีต: โอนแล้ว, ยอดกปท (COD), ผ่อน, คีย์คอม, โฆษณา, M
ALTER TABLE orders ADD COLUMN transfer_satang INTEGER;
ALTER TABLE orders ADD COLUMN cod_satang INTEGER;
ALTER TABLE orders ADD COLUMN installment_satang INTEGER;
ALTER TABLE orders ADD COLUMN key_com TEXT;
ALTER TABLE orders ADD COLUMN is_ad INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN margin_satang INTEGER;
CREATE INDEX orders_team_date ON orders(team_id, sold_on);

-- ตารางรุ่น: ราคาเครื่อง (list_price_satang) และ Margin ตามแท็บ "รุ่นและราคา"
ALTER TABLE products ADD COLUMN margin_satang INTEGER;

-- รหัสทีมที่ใช้ในคอลัมน์ "ทีม" และใน KEY ของชีต เช่น 1, 2, 5, X
ALTER TABLE teams ADD COLUMN code TEXT;
INSERT OR IGNORE INTO teams (business_id, name) VALUES
  (4, 'ทีม 1'), (4, 'ทีม 2'), (4, 'ทีม 3'), (4, 'ทีม 4'), (4, 'ทีม 5'), (5, 'หน้าร้าน');
UPDATE teams SET code = trim(substr(name, 4)) WHERE code IS NULL AND name LIKE 'ทีม %';
UPDATE teams SET code = 'X' WHERE code IS NULL AND name = 'หน้าร้าน';

-- เซลล์สังกัดทีมไหน ลงและแก้ยอดได้เฉพาะทีมนั้น
CREATE TABLE team_members (
  user_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  PRIMARY KEY (user_id, team_id)
);

-- ยอดเดิมที่นำเข้าแล้ว: เติมช่องโอนแล้ว/ยอดกปท จากการชำระเงินและพัสดุ
UPDATE orders SET transfer_satang = (SELECT SUM(amount_satang) FROM payments p WHERE p.order_id = orders.id AND p.kind IN ('transfer', 'extra_transfer'))
  WHERE transfer_satang IS NULL;
UPDATE orders SET cod_satang = (SELECT SUM(cod_satang) FROM shipments s WHERE s.order_id = orders.id AND s.cod_satang > 0)
  WHERE cod_satang IS NULL;

-- ลำดับแถวในหน้าลงยอด (เลื่อนขึ้นลงได้) ว่างไว้ = เรียงตามวันที่
ALTER TABLE orders ADD COLUMN sheet_pos INTEGER;

-- บรรทัดที่ 2 ของแต่ละรายการ: ข้อมูลจัดส่ง (ชื่อ ที่อยู่ เบอร์มือถือ อยู่ที่ customers) และหมายเหตุการส่ง
ALTER TABLE orders ADD COLUMN ship_note TEXT;
