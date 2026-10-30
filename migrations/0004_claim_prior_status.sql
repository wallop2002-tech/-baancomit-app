-- สถานะเครื่องก่อนส่งเคลม เพื่อคืนสถานะเดิมเมื่อเคลมเสร็จ (ขายแล้ว หรือ อยู่ในสต็อก)
ALTER TABLE claims ADD COLUMN prior_status TEXT;
