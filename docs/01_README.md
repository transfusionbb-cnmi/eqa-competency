# เริ่มตรงนี้ — ทำทีละขั้น

ไฟล์ชุดนี้เป็นระบบ CNMI EQA & Competency ฉบับปัจจุบัน กรุณาอ่านเอกสารตามลำดับเพื่อไม่ให้ Run SQL หรืออัปโหลดไฟล์ซ้ำโดยไม่จำเป็น

> **ข้อมูลล่าสุด v2.4.2:** ให้เริ่มจาก `00_README_FIRST.txt`, `SETUP_CHECKLIST_v2.4.2.txt` และ `docs/36_UPDATE_v2.4.2_PROVIDER_FORM_QUESTIONS.md` ข้อความการอัปเดตเวอร์ชันเก่าด้านล่างเก็บไว้เป็นประวัติเท่านั้น

## กรณีติดตั้งระบบใหม่ทั้งหมด

1. เตรียม Supabase Project `cnmi-Operations`
2. อ่าน `docs/02_READMESupabase.md`
3. Run SQL ตามลำดับ `01` ถึง `08`
4. สร้างผู้ดูแลระบบคนแรก
5. Deploy Edge Function `admin-users` ตาม `docs/03_Deploy_Edge_Function.md`
6. ใส่ Supabase URL และ Publishable key ใน `js/config.js`
7. อัปโหลดไฟล์หน้าเว็บขึ้น GitHub Pages ตาม `docs/04_GitHub_Pages_README.md`
8. ทดสอบแต่ละบทบาทก่อนใช้จริง

## กรณีอัปเดตจากระบบที่ใช้งานอยู่แล้ว

ให้อ่าน `docs/00_UPDATE_INSTRUCTIONS.txt` เป็นหลัก

สำหรับการอัปเดตจาก v2.4.1 เป็น v2.4.2:

1. ไม่ต้อง Run SQL
2. อัปโหลดไฟล์หน้าเว็บรุ่นใหม่ทับ GitHub Pages
3. Deploy Edge Function `generate-competency` ใหม่
4. ไม่ต้องแก้ Google Apps Script
5. ข้อมูลรอบเดิมและข้อสอบที่เผยแพร่แล้วไม่ถูกลบ

## ข้อควรระวัง

- ใช้ Project `cnmi-Operations`
- ไม่ใช้ Project `cnmi-duty-hub`
- ตารางทั้งหมดขึ้นต้นด้วย `ec_`
- Storage Bucket ชื่อ `eqa-competency-private` และเป็น Private
- อย่าใส่ Secret key หรือ service_role key ใน `js/config.js`
- รอบใหม่และรอบที่ส่งผลไปแล้วใช้คนละ Workflow อ่าน `docs/09_UPDATE_HISTORICAL_EQA.md` ก่อนทดสอบ


อัปเดตล่าสุด: docs/36_UPDATE_v2.4.2_PROVIDER_FORM_QUESTIONS.md
