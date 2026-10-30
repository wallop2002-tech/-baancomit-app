-- คีย์อ้างอิงแถวในชีตเดิม ใช้ให้สคริปต์นำเข้ารันซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
ALTER TABLE customers ADD COLUMN legacy_key TEXT;
ALTER TABLE order_items ADD COLUMN legacy_key TEXT;
ALTER TABLE payments ADD COLUMN legacy_key TEXT;
ALTER TABLE stock_movements ADD COLUMN legacy_key TEXT;
ALTER TABLE claims ADD COLUMN legacy_key TEXT;

DROP INDEX orders_legacy_key;
CREATE UNIQUE INDEX orders_legacy_key ON orders(legacy_key);
CREATE UNIQUE INDEX customers_legacy_key ON customers(legacy_key);
CREATE UNIQUE INDEX order_items_legacy_key ON order_items(legacy_key);
CREATE UNIQUE INDEX payments_legacy_key ON payments(legacy_key);
CREATE UNIQUE INDEX stock_movements_legacy_key ON stock_movements(legacy_key);
CREATE UNIQUE INDEX claims_legacy_key ON claims(legacy_key);
