# อัปเดต v2.4.5 — Kit Instruction หนึ่งไฟล์ใช้ร่วมหลาย Part

## ปัญหาที่แก้

CAP Kit Instruction หนึ่งไฟล์อาจครอบคลุมหลายส่วนพร้อมกัน เช่น J, JXM และ JE1 ระบบรุ่นก่อนผูกเนื้อหาทั้งไฟล์กับ Program เดียว ทำให้ Case Study ของ JE1 หรือคำแนะนำ JXM อาจปะปนกับแบบกรอก Part J

## หลักการใหม่

ระบบแบ่งเอกสารตามหัวข้อภายในไฟล์ ไม่แบ่งตามชื่อไฟล์ทั้งฉบับ

- `SHARED` — Storage, reporting, regulatory, safety และ Master List ที่ใช้ร่วมกัน
- `J` — การทดสอบตัวอย่าง Part J
- `JXM` — Electronic Crossmatch
- `JE` / `JE1` — Wet/Dry Educational Challenge และ Case Study

Blank Result Form แต่ละฉบับยังเป็นตัวกำหนดรายการตัวอย่าง ช่องกรอก และความสัมพันธ์ Crossmatch ส่วน Kit Instruction ใช้ช่วยแปลคำแนะนำ รหัส และรายละเอียดเคสเฉพาะ section ที่เกี่ยวข้อง

## ตัวอย่าง J-B 2026

ไฟล์ Kit Instruction เดียวถูกแบ่งเป็น:

1. ข้อมูลร่วมของรอบและการเก็บรักษา
2. Testing Instructions ของ Part J
3. Electronic Crossmatch ของ Part JXM
4. Dry Challenge / Case Study JE-14 ของ Part JE1
5. Reporting, safety และ Master Lists ที่ใช้ร่วมกัน

ผลที่ต้องได้:

- Part J แสดง J-08 ถึง J-12, Crossmatch กับ J-13R และ Antigen typing ตาม J Blank Result Form
- Part JE1 แสดง Dry Challenge JE-14 จำนวน 4 ข้อ พร้อมรายละเอียด Case Study หน้า 4–5 ของ Kit Instruction
- ไม่เอา Case Study JE-14 ไปสร้างช่องใน Part J
- ไม่ต้องอัปโหลด Kit Instruction ซ้ำหลายครั้ง

## Token

หลังอัปเดต ระบบจะอ่านใหม่เฉพาะเอกสารประเภท Kit Instruction ที่ยังเป็น extraction รุ่น v2.4.2 เพื่อสร้าง section scopes หนึ่งครั้ง ฟอร์มเปล่า ภาพผลดิบ Antigram Official Evaluation และ Participant Summary ที่อ่านแล้วจะใช้ cache เดิม

## การติดตั้ง

1. อัปโหลดไฟล์หน้าเว็บใน Update-only ทับ GitHub
2. Deploy `supabase/functions/generate-competency/index.ts`
3. ไม่ต้อง Run SQL
4. ไม่ต้องแก้ Apps Script
5. กด `Ctrl + F5` หรือปิดและเปิด PWA ใหม่
6. ตรวจประเภทเอกสาร:
   - J Blank Result Form = `source_document`
   - JE Blank Result Form = `source_document`
   - Kit Instruction ที่ใช้ร่วมกัน = `instruction` เพียง 1 รายการ
7. กด `1. สร้างแบบกรอกจากฟอร์มเปล่า`
   - ระบบจะอ่าน Kit Instruction ใหม่หนึ่งครั้ง แล้วประกอบ Part J และ JE1 แยกกัน
8. กด `2. สร้างคำแนะนำจากคู่มือ`
9. กด `สร้างข้อสอบจากภาพและเอกสาร` โดยเลือกแทนที่เฉพาะข้อสอบฉบับร่างที่ AI สร้าง
10. ตรวจหน้า `4. ผลรายบุคคล` และ `10. การประเมินความสามารถ` ก่อนเผยแพร่

## ความเข้ากันได้

- ไม่แก้ตารางฐานข้อมูล
- ไม่ลบผลที่ส่งหรือล็อกแล้ว
- แบบกรอกฉบับร่างใช้ schema ใหม่หลังสร้างแบบกรอกใหม่
- ข้อสอบที่เพิ่มเอง ข้อสอบที่เผยแพร่แล้ว และข้อสอบที่มีผู้ตอบแล้วไม่ถูกลบ
