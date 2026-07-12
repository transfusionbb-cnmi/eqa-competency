# CNMI EQA & Competency Management System

ระบบบริหารผลทดสอบความชำนาญ (EQA) และการประเมินสมรรถนะบุคลากร สำหรับหน่วยเวชศาสตร์บริการโลหิต

โดเมนที่เตรียมไว้: `eqa-competency.cnmiblood.com`

## ขอบเขตรุ่นนี้

- โมดูล EQA ครบ 10 ขั้นในรอบเดียว
- ผู้ปฏิบัติจริง 2 คน บันทึกผลแยกกัน
- ไม่เห็นคำตอบของอีกคนจนกว่าทั้งคู่ส่ง
- ผู้ปฏิบัติทั้งสองร่วมสร้างผลกลางของห้อง
- ผู้ทบทวนตรวจผลก่อน จากนั้น QM อนุมัติ และส่งแพทย์อนุมัติขั้นสุดท้าย
- เก็บหลักฐานการส่ง ผลประเมิน CAP และ Corrective Action
- Competency แบบ Practical สำหรับผู้ปฏิบัติจริง และ Quiz สำหรับบุคลากรที่เหลือ
- ผ่านเมื่อได้ 100% และ Critical ต้องถูก
- Reflection เมื่อมีคำตอบผิดหรือ Practical มีหัวข้อไม่ผ่าน พร้อมส่งให้ผู้ทบทวนตรวจ
- Audit Log และ Result Version History
- Private Storage สำหรับ PDF/ภาพ Gel card
- รหัสเริ่มต้นและรหัสหลัง Admin รีเซ็ต = `CNMI@รหัสพนักงาน`
- ผู้ใช้เปลี่ยนรหัสผ่านเองได้ ขั้นต่ำ 8 ตัวอักษร
- เปลี่ยนชื่อ/อีเมลต้องส่งคำขอให้ Admin อนุมัติ
- รองรับ Role ซ้อน เช่น QM มีทั้ง `staff`, `reviewer`, `qm`
- พิมพ์รายงานด้วย Browser Print → Save as PDF
- แจ้งเตือน EQA, Competency, Reviewer, QM และ Reflection ผ่าน Email / Google Chat
- สร้าง PDF และเก็บ Google Drive พร้อมทะเบียนไฟล์และเลขเวอร์ชัน

## เริ่มตรงนี้

เปิด `docs/01_README.md`

## ลำดับ SQL

1. `sql/01_schema_rls.sql`
2. `sql/02_storage_private.sql`
3. สร้างผู้ใช้คนแรกใน Supabase Authentication
4. แก้อีเมลใน `sql/04_make_first_admin.sql` แล้ว Run
5. แก้อีเมลใน `sql/03_seed_cap_jb_2026.sql` แล้ว Run
6. `sql/05_fix_user_creation_audit_trigger.sql`
7. `sql/06_fix_security_advisor_views.sql`
8. `sql/07_workflow_reviewer_roles_receiving.sql`
9. `sql/08_historical_eqa_competency.sql`
10. `sql/09_fix_delete_round_rpc.sql` เฉพาะระบบที่เคยใช้ v2.0.7
11. `sql/10_hard_delete_eqa_round.sql`
12. `sql/11_document_edit_delete_competency_images.sql`
13. `sql/12_ai_competency_generation_and_deadline.sql`
14. `sql/13_auto_lab_summary_reviewer_qm_physician_ack.sql`
15. `sql/14_cap_j_je_dynamic_result_schema.sql`
16. `sql/15_document_driven_form_and_role_audit.sql`
17. `sql/16_competency_answer_release_after_submit.sql`
18. `sql/17_notifications_drive_archive_and_reflection.sql`
19. `sql/18_multi_test_dynamic_result_fields.sql`
20. `sql/19_participant_summary_document_category.sql`
21. `sql/20_ai_document_extraction_and_antibody_panel.sql`
22. `sql/21_v2.3.1_FILENAME_SUBMISSION_EDUCATIONAL.sql`
23. `sql/22_v2.3.2_CAP_SUMMARY_SIDEBAR_ANSWER_KEYS.sql`

## สิ่งที่ห้ามใส่ใน GitHub

- Supabase Secret key
- service_role key
- รหัสผ่านผู้ใช้
- PDF/ภาพ EQA จริง
- รายชื่อบุคลากรในไฟล์ JavaScript
- Google Drive token หรือ Webhook secret

GitHub ใส่ได้เฉพาะ Supabase Project URL และ Publishable key ใน `js/config.js` เมื่อเปิด RLS แล้ว


## v2.0.1
- แก้ปัญหา `Database error creating new user` จาก Audit Trigger ของ `ec_user_roles`
- ผู้ติดตั้ง v2.0.0 ที่ Run SQL แล้ว ให้ Run `sql/05_fix_user_creation_audit_trigger.sql` เพิ่ม 1 ครั้ง


## v2.0.2
- เพิ่ม Security Advisor hotfix สำหรับ Views ใน `sql/06_fix_security_advisor_views.sql`

## v2.0.3
- แก้โครงสร้างหน้าเว็บที่ทำให้พื้นที่เนื้อหาถูกบีบเป็นคอลัมน์แคบทางซ้าย
- ปรับ Responsive สำหรับคอมพิวเตอร์ แท็บเล็ต และโทรศัพท์
- เพิ่มเมนูเลือก **โหมดการทำงาน** จาก Role ที่ผู้ใช้ได้รับ เช่น Staff, Reviewer, QM และ Admin
- การเลือกโหมดมีผลต่อปุ่มและหน้าที่ที่ใช้งานในหน้าเว็บ แต่ไม่เปลี่ยนสิทธิ์จริงในฐานข้อมูล
- ปรับหน้า **ผู้ใช้งานและสิทธิ์** ให้เลือก Role แบบหลายรายการ และเลือกสถานะเปิด/ปิดบัญชีในหน้าต่างเดียว
- เพิ่มสถานะเริ่มต้นตอนสร้างบัญชี และป้องกัน Admin ปิดบัญชีตัวเองจากหน้าจอ
- เพิ่ม cache version ให้ Browser โหลด CSS/JavaScript รุ่นใหม่ทันที

### การอัปเดตจาก v2.0.2 เป็น v2.0.3
รุ่นนี้ไม่ต้อง Run SQL เพิ่ม ให้แทนที่ไฟล์หน้าเว็บทั้งหมดบน GitHub แล้วรอ GitHub Pages Deploy สำเร็จ

## การนำเข้ารอบ EQA ที่ส่งผลไปแล้ว

ระบบแยก `รอบใหม่` ออกจาก `ข้อมูลย้อนหลัง` อย่างชัดเจน

- Admin/QM เป็นผู้กรอกจากหลักฐานเดิมแทนผู้ปฏิบัติจริง
- รอบที่สร้างไว้แล้วแต่ยังไม่เริ่มกรอกผล สามารถเปลี่ยนเป็นข้อมูลย้อนหลังได้โดยไม่ต้องสร้างรายการซ้ำ
- ระบบเก็บชื่อผู้ปฏิบัติจริงและผู้กรอกแทนแยกกัน
- ผู้ปฏิบัติทั้ง 2 คนต้องตรวจและยืนยันข้อมูลของตน
- ผู้ทบทวนตรวจข้อมูลก่อน QM รับรอง
- QM รับรองแล้วจึงเปิด Competency
- ผู้ปฏิบัติจริงได้ Practical ส่วน Staff คนอื่นได้ Quiz
- Physician ไม่ถูกสร้าง Competency

อ่านรายละเอียดที่ `docs/09_UPDATE_HISTORICAL_EQA.md`

### การอัปเดตระบบเดิม

Run เพิ่มเฉพาะ `sql/08_historical_eqa_competency.sql` แล้วอัปโหลดทับ `index.html` และ `js/app.js`


## v2.0.7

แก้ปุ่มลบรอบ EQA ที่ถูก Supabase Row Level Security ปฏิเสธ โดยเพิ่ม RPC สำหรับผู้ดูแลระบบ ดู `11_UPDATE_v2.0.7_FIX_DELETE_PERMISSION.md`


## v2.0.8

เปลี่ยนปุ่มลบรอบ EQA ให้ลบข้อมูลจริงแบบถาวร ไม่ใช่การตั้ง `archived_at` และลบข้อมูลลูกทั้งหมดตาม Foreign Key รวมถึง Audit ที่ผูกกับรอบนั้น หน้าเว็บจะลบไฟล์ใน Private Storage เพิ่มเติม หลังลบสามารถสร้าง Provider + Round + Year เดิมใหม่ได้

ผู้ที่อัปเดตจาก v2.0.7 ให้ Run เฉพาะ `sql/10_hard_delete_eqa_round.sql` แล้วอัปโหลดทับ `index.html`, `js/app.js`, `js/config.js` รายละเอียดอยู่ที่ `docs/12_UPDATE_v2.0.8_HARD_DELETE_ROUND.md`

## v2.0.9

เพิ่มปุ่มแก้ไขและลบถาวรในหัวข้อเอกสาร/ภาพ รองรับการเปลี่ยนไฟล์โดยไม่ต้องสร้างรายการใหม่ และเชื่อมภาพที่อัปโหลดไว้เป็นรูปประกอบข้อสอบ Competency ภาพจะแสดงแก่ผู้ทำแบบทดสอบและผู้ทบทวนโดยใช้ Signed URL จาก Private Storage

ผู้ที่อัปเดตจาก v2.0.8 ให้ Run เฉพาะ `sql/11_document_edit_delete_competency_images.sql` แล้วอัปโหลดทับ `index.html`, `js/app.js`, `js/config.js` รายละเอียดอยู่ที่ `docs/13_UPDATE_v2.0.9_DOCUMENTS_AND_QUIZ_IMAGES.md`

## v2.1.1

- แก้ SQL 12 ที่ Error `record variable cannot be part of multiple-item INTO list`
- สร้างสรุปผลห้องปฏิบัติการอัตโนมัติเมื่อผู้ปฏิบัติ 2 คนส่งผลครบ
- ผู้ทบทวนตรวจค่าที่ต่างกันและส่งให้ QM
- QM รับรอง และแพทย์รับทราบ
- ผู้ปฏิบัติไม่ต้องจัดทำผลกลางซ้ำ

ดู `docs/15_UPDATE_v2.1.1_AUTO_LAB_SUMMARY.md`

## v2.1.0

เพิ่มการสร้างข้อสอบ Competency อัตโนมัติจาก `ภาพผลทดสอบดิบ`, `คู่มือหรือคำแนะนำ` และ `เอกสารต้นฉบับจากผู้ให้บริการ` พร้อมสร้างเฉลยและสรุปเมื่ออัปโหลด `รายงานผลประเมินอย่างเป็นทางการ` รวมถึงกำหนดวันเปิด–ปิด Competency สำหรับรอบปกติและรอบย้อนหลัง

ผู้ที่อัปเดตจาก v2.0.9 ให้ Run เฉพาะ `sql/12_ai_competency_generation_and_deadline.sql`, ตั้งค่า `OPENAI_API_KEY`, Deploy Edge Function `generate-competency` แล้วอัปโหลดทับ `index.html`, `js/app.js`, `js/config.js` รายละเอียดอยู่ที่ `docs/14_UPDATE_v2.1.0_AI_COMPETENCY.md`

## v2.1.2
- เพิ่มคู่มือการใช้งานในระบบ
- ลดคำอธิบายบนหน้าปฏิบัติงาน
- เปิดการตั้งค่า MFA ให้ผู้ใช้งานทุกคน

ดู `docs/16_UPDATE_v2.1.2_HELP_AND_MFA.md`

## v2.1.3
- แก้แบบกรอกผล CAP J-A / JE-A 2026 ให้ตรงกับ J-01–J-05, JE-07 และ donor J-06R
- เพิ่ม ABO subgroup, antibody identification, crossmatch type/strength และ antigen typing
- ปรับระบบสรุปผลอัตโนมัติให้เทียบช่องใหม่ได้ครบ

ดู `docs/17_UPDATE_v2.1.3_CAP_J_JE_RESULT_FORM.md`


## v2.2.0

- เพิ่มระบบแจ้งเตือน EQA และ Competency ก่อนครบกำหนดและเมื่อเลยกำหนด
- เตือน Reviewer, QM และ Reflection ตามขั้นตอน
- ส่ง Email และ Google Chat พร้อมป้องกันการแจ้งซ้ำ
- เพิ่ม Reflection สำหรับ Practical ที่มีหัวข้อไม่ผ่าน
- สร้าง PDF และเก็บ Google Drive อัตโนมัติพร้อมเลขเวอร์ชัน
- เพิ่มเมนูตั้งค่า ทดสอบ ดูประวัติ และเปิดไฟล์ Drive

ผู้ที่อัปเดตจาก v2.1.5 ให้ Run `sql/17_notifications_drive_archive_and_reflection.sql`, ติดตั้ง Apps Script, Deploy Edge Function `eqa-automation` และอัปโหลดทับ 4 ไฟล์หน้าเว็บ

ดู `docs/20_UPDATE_v2.2.0_NOTIFICATIONS_DRIVE_REFLECTION.md`


## v2.2.1

- รองรับหนึ่งตัวอย่างมีหลายการทดสอบ
- แยกกลุ่ม ABO/Rh, Screen, Ab ID, Eluate ID, DAT, CBC, WBC count, Titer และ Antigen typing ตามฟอร์มจริง
- ช่องผลจากเอกสารไม่ถูกจำกัดด้วยรายชื่อ field เดิม
- รองรับผลตัวเลขและ antigen ที่ผู้ให้บริการให้เลือก
- สรุปผลห้องปฏิบัติการเทียบช่อง dynamic ของผู้ปฏิบัติ 2 คนได้
- เพิ่มคำแนะนำการตั้งชื่อไฟล์สำหรับหลายชนิดการทดสอบ

Run `sql/18_multi_test_dynamic_result_fields.sql`, Deploy `generate-competency` ใหม่ และอัปโหลดทับไฟล์หน้าเว็บ

ดู `docs/21_UPDATE_v2.2.1_MULTI_TEST_RESULT_FORMS.md`

## v2.2.2

- เพิ่มไอคอนแอปสำหรับแท็บเว็บและ Bookmark
- เพิ่ม Apple Touch Icon และ Web App Manifest
- ไม่มี SQL หรือ Backend ที่ต้องอัปเดต

ดู `docs/22_UPDATE_v2.2.2_APP_ICON.md`


## v2.2.3

- เพิ่มประเภทเอกสาร Participant Summary
- แยก Official Evaluation, ผลที่ห้องส่ง และรายงานเปรียบเทียบผู้เข้าร่วม
- ป้องกัน AI ใช้ Your Result หรือ Submitted Result เป็นเฉลย
- Educational Challenge ใช้ participant consensus เท่านั้น
- สรุปผลแยก 5 ส่วนและแจ้งข้อที่ต้องตรวจเองเมื่อหลักฐานไม่พอ

Run `sql/19_participant_summary_document_category.sql`, Deploy `generate-competency` ใหม่ และอัปโหลดไฟล์หน้าเว็บทับของเดิม

ดู `docs/23_UPDATE_v2.2.3_EVALUATION_PARTICIPANT_SUMMARY.md`

## v2.2.4

- แก้ `546 WORKER_RESOURCE_LIMIT` โดยอ่านเอกสารทีละไฟล์และเก็บผลสกัดไว้ใช้ซ้ำ
- กดสร้างใหม่แล้วทำต่อเฉพาะไฟล์ที่ยังไม่เสร็จ
- เพิ่ม progress modal และสถานะ AI รายไฟล์
- เพิ่มประเภท `antibody_panel` สำหรับ Antigram/Panel cell profile
- ใช้ Panel/Antigram ร่วมกับภาพผล Ab ID โดยไม่ใช้เป็นเฉลย

Run `sql/20_ai_document_extraction_and_antibody_panel.sql`, Deploy `generate-competency` ใหม่ และอัปโหลดหน้าเว็บทับของเดิม

ดู `docs/24_UPDATE_v2.2.4_CHUNKED_AI_AND_ANTIBODY_PANEL.md`

## v2.2.5
- เมนูย่อยรอบ EQA เป็นแนวตั้งใน Sidebar
- ปรับแบบกรอก CAP เป็น Card แยกตัวอย่าง
- เพิ่ม Instruction ตอนกรอกผล
- รองรับหลาย Panel และ Extra cell ต่อหนึ่งตัวอย่าง
- รอบนี้แก้เฉพาะหน้าเว็บ ไม่ต้อง Run SQL หรือ Deploy Edge Function


## v2.2.7

ฟอร์มเปล่าจากผู้ให้บริการเป็นตัวกำหนดโครงสร้างและจำนวนช่องแบบกรอก โดย Antigen typing แบบเลือกชนิดสร้างคู่ชื่อ Antigen/ผลตามจำนวนตำแหน่งจริง และเว้นช่องที่ไม่ได้ใช้ได้ ดู `26_UPDATE_v2.2.7_BLANK_FORM_ANTIGEN_SLOTS.md`

## v2.2.9

ปรับข้อสอบเป็นการแปลผลสุดท้ายแบบ Google Form เดิม เพิ่ม CAP Master List แบบค้นหา/เลือกหลาย antibody แสดงรูปจริงในหน้าข้อสอบ QM และเจ้าหน้าที่ และเปลี่ยน Official Summary ของ CAP J/JE-A เป็นตาราง Matrix J-01 ถึง J-05 พร้อมตาราง J-06R, JE-07 และ JE-07R ดู `29_UPDATE_v2.2.9_INTERPRETATION_QUIZ_CAP_SUMMARY.md`

## v2.3.0

สร้างข้อสอบ CAP J/JE ให้ครบจากภาพผลดิบทุกไฟล์ รวมภาพ Ab ID หลายช่วง cell กับ Antigram ในข้อเดียว แยก Ag typing เป็น C, c, E, e, K และแยกการสร้างเฉลยข้อสอบออกจากสรุปผลอย่างเป็นทางการ โดยสร้างเฉลยครั้งละไม่เกิน 5 ข้อเพื่อลด Supabase 546 ดู `30_UPDATE_v2.3.0_COMPLETE_CAP_QUIZ_AND_SPLIT_AI.md`


## v2.3.1

กำหนดกติกาชื่อไฟล์มาตรฐานและ parser สำหรับ ABO, Rh, AbScreen, AbID หลาย Panel, Crossmatch และ Ag typing รวมหลักฐานการส่งผลกับ Submitted Result Form เป็นไฟล์เดียว เปลี่ยนตัวเลือก CAP เป็น `เลข CAP │ คำตอบ` และเพิ่มการประเมิน Educational Challenge โดยเทียบ participant consensus โดยไม่หักคะแนนทางการ แต่คำตอบส่วนน้อยต้องทบทวนและชี้แจง

Run `sql/21_v2.3.1_FILENAME_SUBMISSION_EDUCATIONAL.sql`, Deploy `generate-competency` ใหม่ และอัปโหลดหน้าเว็บทับของเดิม

ดู `31_UPDATE_v2.3.1_FILENAME_SUBMISSION_EDUCATIONAL.md`


## v2.3.2
- แยกตาราง J-01 ถึง J-05 เป็น ABO, Rh, AbScreen, AbID และ Crossmatch
- แยก J-06R Antigen typing ออกจากตารางหลัก
- แก้ Educational JE-07 ให้เทียบ consensus แบบ normalize และไม่แจ้ง minority ผิดเมื่อคำตอบตรงกัน
- เพิ่มคำตอบอ้างอิง AbID หลาย antibody และตรวจโดยไม่สนลำดับ
- Sidebar ยุบ/ขยายด้วยปุ่ม ☰

Run `sql/22_v2.3.2_CAP_SUMMARY_SIDEBAR_ANSWER_KEYS.sql`, Deploy `generate-competency` ใหม่ และกดสร้างเฉลย/สรุปผลของรอบเดิมใหม่

ดู `32_UPDATE_v2.3.2_CAP_SUMMARY_SIDEBAR_ANSWER_KEYS.md`


## v2.4.0

- ปุ่มสร้างเฉลยอ่านเฉพาะ Official Evaluation และ Participant Summary
- ไม่อ่าน Raw Result / Antigram ซ้ำ
- ปุ่มสร้างสรุปอ่านเฉพาะ Official Evaluation, Participant Summary และ Submission Form
- ไม่ต้อง Run SQL เพิ่ม แต่ต้อง Deploy `generate-competency` ใหม่

ดู `33_UPDATE_v2.4.0_FAST_ANSWER_KEYS.md`


## v2.4.1

- เพิ่มปุ่มติดตั้งแอปสำหรับ Android
- เพิ่ม Pop-up วิธีติดตั้งบน iPhone/iPad
- เพิ่ม Service Worker และซ่อนปุ่มเมื่อเปิดแบบ standalone
- ไม่ต้อง Run SQL หรือ Deploy Edge Function ใหม่เมื่ออัปเดตจาก v2.4.0

ดู `35_UPDATE_v2.4.1_PWA_INSTALL.md`


## v2.4.2

- อ่านข้อสอบต้นฉบับจาก Blank Result Form โดยคงเลขข้อ โจทย์ รหัสตัวเลือก และข้อความตัวเลือก
- อ่าน Case Study และผลตรวจจาก Kit Instruction เป็นข้อมูลประกอบโจทย์
- เมื่อพบข้อสอบต้นฉบับ ระบบนำเข้าข้อสอบโดยตรงโดยไม่เรียก AI รอบสร้างคำถามซ้ำ
- คง Workflow ข้อสอบจากภาพผลดิบ ข้อสอบที่เพิ่มเอง และข้อสอบที่เผยแพร่แล้ว
- ไม่ต้อง Run SQL แต่ต้อง Deploy `generate-competency` ใหม่

ดู `36_UPDATE_v2.4.2_PROVIDER_FORM_QUESTIONS.md`

อัปเดตล่าสุด: docs/36_UPDATE_v2.4.2_PROVIDER_FORM_QUESTIONS.md
