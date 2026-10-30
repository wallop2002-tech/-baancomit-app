-- โครงข้อมูลกลาง ตามเอกสารขั้นที่ 1
-- เงินทุกช่องเก็บเป็นสตางค์ (INTEGER) เพื่อไม่ให้ทศนิยมเพี้ยน
-- วันที่เก็บเป็นข้อความ ISO 8601 (YYYY-MM-DD หรือ YYYY-MM-DDTHH:MM:SS)

PRAGMA foreign_keys = ON;

-- กิจการ และกิจการย่อย (parent_id ชี้กิจการแม่)
CREATE TABLE businesses (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES businesses(id),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- สิทธิ์ของผู้ใช้ในแต่ละกิจการ (สิทธิ์ที่กิจการแม่ครอบคลุมกิจการย่อย)
CREATE TABLE memberships (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'accounting', 'sales', 'stock')),
  PRIMARY KEY (user_id, business_id)
);

-- ทีมและช่องทางขาย เช่น เซลล์ทีม 1-4, ร้าน, ADS, ไลฟ์, เว็บ
CREATE TABLE teams (
  id          INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name        TEXT NOT NULL,
  UNIQUE (business_id, name)
);

-- รุ่นสินค้า (Product_ID เช่น Ti3B35)
CREATE TABLE products (
  id                INTEGER PRIMARY KEY,
  business_id       INTEGER NOT NULL REFERENCES businesses(id),
  code              TEXT NOT NULL,
  spec              TEXT NOT NULL DEFAULT '',
  list_price_satang INTEGER,
  UNIQUE (business_id, code)
);

-- เครื่องทีละตัว ตาม Serial_Full
CREATE TABLE serial_units (
  id           INTEGER PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  serial       TEXT NOT NULL,
  cost_satang  INTEGER,
  supplier     TEXT,
  lot_no       INTEGER,
  status       TEXT NOT NULL DEFAULT 'in_stock'
               CHECK (status IN ('in_stock', 'reserved', 'sold', 'transferred', 'internal', 'claim')),
  received_at  TEXT NOT NULL,
  note         TEXT,
  UNIQUE (business_id, serial)
);

-- ทุกการเคลื่อนไหวของเครื่อง (แทน STOCK_OUT, STOCK_SALE, RESERVED)
CREATE TABLE stock_movements (
  id           INTEGER PRIMARY KEY,
  unit_id      INTEGER NOT NULL REFERENCES serial_units(id),
  kind         TEXT NOT NULL CHECK (kind IN ('in', 'sale', 'transfer', 'internal', 'reserve', 'unreserve', 'return')),
  destination  TEXT,
  order_id     INTEGER REFERENCES orders(id),
  user_id      INTEGER REFERENCES users(id),
  moved_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  facebook_name TEXT,
  full_name     TEXT,
  phone         TEXT,
  address       TEXT
);
CREATE INDEX customers_phone ON customers(phone);

-- ออเดอร์ขาย: แกนกลางที่ทุกอย่างผูกด้วย
CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY,
  business_id        INTEGER NOT NULL REFERENCES businesses(id),
  customer_id        INTEGER REFERENCES customers(id),
  team_id            INTEGER REFERENCES teams(id),
  sold_on            TEXT NOT NULL,
  house_no           TEXT,
  price_satang       INTEGER NOT NULL,
  real_price_satang  INTEGER,
  payment_type       TEXT NOT NULL CHECK (payment_type IN ('transfer', 'cod', 'cash', 'installment', 'mixed')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'shipped', 'paid', 'cancelled', 'returned')),
  note               TEXT,
  legacy_key         TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX orders_business_date ON orders(business_id, sold_on);
CREATE INDEX orders_legacy_key ON orders(legacy_key);

CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  unit_id      INTEGER REFERENCES serial_units(id),
  price_satang INTEGER NOT NULL
);

CREATE TABLE shipments (
  id                 INTEGER PRIMARY KEY,
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  carrier            TEXT NOT NULL,
  tracking_no        TEXT NOT NULL,
  invoice_no         TEXT,
  shipped_on         TEXT,
  cod_satang         INTEGER NOT NULL DEFAULT 0,
  cod_fee_satang     INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'shipped' CHECK (status IN ('shipped', 'delivered', 'returned', 'cod_settled')),
  UNIQUE (carrier, tracking_no)
);
CREATE INDEX shipments_tracking ON shipments(tracking_no);

-- แถวจาก statement ธนาคาร และรอบโอน COD
CREATE TABLE bank_transactions (
  id             INTEGER PRIMARY KEY,
  business_id    INTEGER NOT NULL REFERENCES businesses(id),
  account        TEXT NOT NULL,
  txn_at         TEXT NOT NULL,
  amount_satang  INTEGER NOT NULL,
  channel        TEXT,
  description    TEXT,
  ref_code       TEXT,
  import_batch   TEXT,
  UNIQUE (account, txn_at, amount_satang, description)
);

-- เงินที่ตัดกับออเดอร์ (โอน, โอนเพิ่ม, COD, สด, งวดผ่อน)
CREATE TABLE payments (
  id                  INTEGER PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id),
  kind                TEXT NOT NULL CHECK (kind IN ('transfer', 'extra_transfer', 'cod', 'cash', 'installment')),
  amount_satang       INTEGER NOT NULL,
  paid_on             TEXT NOT NULL,
  bank_txn_id         INTEGER REFERENCES bank_transactions(id),
  shipment_id         INTEGER REFERENCES shipments(id),
  match_status        TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'suggested', 'confirmed')),
  confirmed_by        INTEGER REFERENCES users(id)
);

CREATE TABLE installment_plans (
  id                 INTEGER PRIMARY KEY,
  order_id           INTEGER NOT NULL REFERENCES orders(id),
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  customer_code      TEXT,
  full_price_satang  INTEGER NOT NULL,
  started_on         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'defaulted')),
  closed_on          TEXT
);

-- เคลมลูกค้า และส่งเคลมซัพพลายเออร์
CREATE TABLE claims (
  id                    INTEGER PRIMARY KEY,
  unit_id               INTEGER NOT NULL REFERENCES serial_units(id),
  order_id              INTEGER REFERENCES orders(id),
  direction             TEXT NOT NULL CHECK (direction IN ('customer', 'supplier')),
  symptom               TEXT,
  destination           TEXT,
  sent_on               TEXT NOT NULL,
  sent_tracking         TEXT,
  received_back_on      TEXT,
  returned_to_customer_on TEXT,
  return_tracking       TEXT,
  replacement_unit_id   INTEGER REFERENCES serial_units(id),
  handled_by            INTEGER REFERENCES users(id)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  table_name  TEXT NOT NULL,
  row_id      INTEGER NOT NULL,
  action      TEXT NOT NULL,
  changes     TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- กิจการเริ่มต้น
INSERT INTO businesses (id, parent_id, code, name) VALUES
  (1, NULL, 'BCI', 'บ้านคอมไอที'),
  (2, NULL, 'NAI', 'นายไอที'),
  (3, NULL, 'NICE', 'ไนซ์ไอที'),
  (4, 1, 'WCY', 'วีแคร์ยู'),
  (5, 1, 'NOI', 'คุณหน่อย');
