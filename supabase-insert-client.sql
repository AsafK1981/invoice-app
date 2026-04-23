-- Insert your real client (Tim Teddy Ltd) into all your businesses
-- Run this once in SQL Editor

INSERT INTO clients (business_id, name, tax_id, phone, email, notes)
SELECT
  id,
  'טים טדי בע"מ',
  '516933652',
  '0505113322',
  'avi@myteam.co.il',
  'אימייל נוסף: amit@myteam.co.il | מס׳ לקוח חיצוני: 5285819 | תנאי תשלום: שוטף+30'
FROM businesses;
