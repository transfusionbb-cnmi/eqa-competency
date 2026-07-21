/* CNMI EQA and Competency Management System v2.8.1
 * Static SPA for GitHub Pages + Supabase
 */
(() => {
  'use strict';

  const cfg = window.CNMI_CONFIG || {};
  const appEl = document.getElementById('app');
  const state = {
    supabase: null,
    session: null,
    user: null,
    profile: null,
    roles: [],
    activeRole: null,
    rounds: [],
    directory: [],
    qmDelegations: [],
    currentRound: null,
    instructionExtractions: [],
    instructionExtractionCache: new Map(),
    busy: false,
  };

  const SIDEBAR_COLLAPSED_KEY = 'cnmi-eqa-sidebar-collapsed';
  const AI_EXTRACTION_SCHEMA_VERSION = 'v2.5.1';
  const REPORT_ARCHIVE_ENABLED = false; // ปิดระบบ PDF รุ่นเดิมชั่วคราวจนกว่าจะออกแบบเอกสารคุณภาพใหม่

  function isAiExtractionCurrent(doc) {
    const version = String(doc?.ai_extraction?.schema_version || '');
    if (version === AI_EXTRACTION_SCHEMA_VERSION) return true;
    const category = String(doc?.category || '');
    // v2.5.1 changes only Kit Instruction extraction: Case Study must be verbatim/full-text.
    // Keep all other document extractions cached to avoid unnecessary token use.
    if (['v2.4.5', 'v2.4.2'].includes(version)) return category !== 'instruction';
    if (version !== 'v2.3.2') return false;
    return !['source_document', 'instruction'].includes(category);
  }

  const PROGRAM_PROFILE_DEFINITIONS = Object.freeze({
    CAP_J_JE: { code:'CAP_J_JE', label:'CAP Comprehensive Transfusion Medicine J/JE', form_strategy:'cap_j_je', answer_strategy:'official_then_majority', summary_strategy:'cap_j_je_matrix' },
    CAP_ELU: { code:'CAP_ELU', label:'CAP Elution / Eluate Antibody Identification', form_strategy:'document_driven', answer_strategy:'official_then_majority', summary_strategy:'generic_matrix' },
    CAP_TRC: { code:'CAP_TRC', label:'CAP Transfusion Reaction', form_strategy:'document_driven', answer_strategy:'official_then_majority', summary_strategy:'generic_matrix' },
    CAP_AABT: { code:'CAP_AABT', label:'CAP Antibody Titer', form_strategy:'document_driven', answer_strategy:'official_then_majority', summary_strategy:'generic_matrix' },
    CAP_EXM: { code:'CAP_EXM', label:'CAP Electronic Crossmatch', form_strategy:'document_driven', answer_strategy:'official_then_majority', summary_strategy:'generic_matrix' },
    GENERIC_DOCUMENT_DRIVEN: { code:'GENERIC_DOCUMENT_DRIVEN', label:'EQA แบบกำหนดโครงสร้างจากฟอร์มผู้ให้บริการ', form_strategy:'document_driven', answer_strategy:'official_then_majority', summary_strategy:'generic_matrix' }
  });

  function resolveProgramProfile(round = state.currentRound) {
    const provider = String(round?.provider || '').toUpperCase();
    const text = `${round?.program_code || ''} ${round?.round_code || ''} ${round?.program_name || ''}`.toUpperCase();
    if (provider.includes('CAP') && ((/J\s*\/\s*JE/.test(text)) || (/\bJ[-\s]?A\b/.test(text) && /\bJE\b/.test(text)) || /COMPREHENSIVE TRANSFUSION/.test(text))) return PROGRAM_PROFILE_DEFINITIONS.CAP_J_JE;
    if (provider.includes('CAP') && /\bELU\b|ELUATE|ELUTION/.test(text)) return PROGRAM_PROFILE_DEFINITIONS.CAP_ELU;
    if (provider.includes('CAP') && /\bTRC\b|TRANSFUSION REACTION/.test(text)) return PROGRAM_PROFILE_DEFINITIONS.CAP_TRC;
    if (provider.includes('CAP') && /\bAABT\b|ANTIBODY TITER/.test(text)) return PROGRAM_PROFILE_DEFINITIONS.CAP_AABT;
    if (provider.includes('CAP') && /\bEXM\b|ELECTRONIC CROSSMATCH/.test(text)) return PROGRAM_PROFILE_DEFINITIONS.CAP_EXM;
    return PROGRAM_PROFILE_DEFINITIONS.GENERIC_DOCUMENT_DRIVEN;
  }

  function desktopSidebarCollapsed() {
    return window.innerWidth > 900 && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  }

  const ROLE_LABELS = {
    staff: 'เจ้าหน้าที่',
    reviewer: 'ผู้ทบทวนผล',
    qm: 'ผู้จัดการคุณภาพ',
    deputy_qm: 'รองผู้จัดการคุณภาพ',
    physician: 'แพทย์ผู้รับรอง',
    admin: 'ผู้ดูแลระบบ',
    viewer: 'ผู้ตรวจติดตาม'
  };
  const ROLE_HELP = {
    staff: 'รับ EQA เข้าระบบ ปฏิบัติงานตามที่ได้รับมอบหมาย และทำการประเมินความสามารถ',
    reviewer: 'ตรวจเทียบผลรายบุคคล ตรวจสรุปผลห้องปฏิบัติการที่ระบบสร้าง และส่งให้ผู้รับรองคุณภาพ',
    qm: 'บริหารรอบ EQA และอนุมัติด้านคุณภาพหลังผู้ทบทวนตรวจแล้ว',
    deputy_qm: 'ทำหน้าที่แทนผู้จัดการคุณภาพเฉพาะช่วงวันเวลาที่ผู้จัดการคุณภาพหรือผู้ดูแลระบบเปิดมอบหมาย',
    physician: 'แพทย์ผู้มีคุณสมบัติทั้งสองคนมีสิทธิ์เท่าเทียมกัน คนใดคนหนึ่งรับทราบผลของแต่ละรอบได้ และไม่ต้องทำแบบทดสอบบุคลากร',
    admin: 'จัดการผู้ใช้งาน สิทธิ์ และการตั้งค่าระบบ',
    viewer: 'อ่านรายงานและประวัติการใช้งานโดยไม่แก้ไขข้อมูล'
  };
  const ROLE_PRIORITY = ['admin', 'qm', 'deputy_qm', 'reviewer', 'physician', 'viewer', 'staff'];
  const ACTING_ROLE_ORDER = ['staff', 'reviewer', 'qm', 'deputy_qm', 'physician', 'viewer', 'admin'];
  const SIGNING_ROLE_LABELS = {
    staff: 'นักเทคนิคการแพทย์ / เจ้าหน้าที่ผู้ปฏิบัติ',
    reviewer: 'ผู้ทบทวนผล',
    qm: 'ผู้จัดการคุณภาพ',
    deputy_qm: 'รองผู้จัดการคุณภาพ',
    physician: 'แพทย์ผู้รับทราบ',
    admin: 'ผู้ดูแลระบบ',
    viewer: 'ผู้ตรวจติดตาม'
  };
  const STATUS_LABELS = {
    preparing: 'เตรียมดำเนินการ',
    in_progress: 'กำลังดำเนินการ',
    awaiting_review: 'ระบบสรุปแล้ว รอผู้ทบทวน',
    returned_for_revision: 'ส่งกลับแก้ไข',
    awaiting_qm_approval: 'รอผู้รับรองคุณภาพอนุมัติ',
    qm_approved: 'ผู้รับรองคุณภาพอนุมัติแล้ว',
    awaiting_physician_approval: 'รอแพทย์รับทราบ',
    physician_approved: 'แพทย์รับทราบแล้ว',
    submitted_to_provider: 'ส่งผลแล้ว',
    official_result_received: 'ได้รับผลประเมินแล้ว',
    closed: 'ปิดรอบ',
    cancelled: 'ยกเลิก'
  };

  const ROUND_MODE_LABELS = {
    live: 'รอบใหม่ตามขั้นตอนปกติ',
    historical_import: 'นำเข้าจากรอบที่ดำเนินการแล้ว'
  };
  const HISTORICAL_REVIEW_LABELS = {
    not_applicable: 'ไม่ใช้ขั้นตอนย้อนหลัง',
    draft: 'กำลังบันทึกข้อมูลย้อนหลัง',
    awaiting_practitioner_confirmation: 'รอผู้ปฏิบัติทั้งสองคนยืนยัน',
    awaiting_reviewer: 'รอผู้ทบทวนตรวจสอบ',
    returned_by_reviewer: 'ผู้ทบทวนส่งกลับแก้ไข',
    awaiting_qm_certification: 'รอผู้รับรองคุณภาพ',
    returned_by_qm: 'ผู้รับรองคุณภาพส่งกลับแก้ไข',
    qm_certified: 'รับรองข้อมูลแล้ว เปิดการประเมินได้'
  };
  const HISTORICAL_CONFIRM_LABELS = {
    confirmed: 'ยืนยันว่าตรงกับหลักฐานเดิม',
    disputed: 'แจ้งว่าข้อมูลไม่ตรง'
  };

  const DOCUMENT_CATEGORY_LABELS = {
    source_document: 'เอกสารต้นฉบับจากผู้ให้บริการ',
    instruction: 'คู่มือหรือคำแนะนำ',
    specimen_image: 'ภาพสิ่งส่งตรวจ',
    raw_result_image: 'ภาพผลทดสอบดิบ',
    submission_form: 'หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ',
    submission_evidence: 'หลักฐานการส่งผล (ข้อมูลเดิม — ระบบจะรวมกับแบบฟอร์มผล)',
    official_result: 'รายงานผลประเมินอย่างเป็นทางการ (Official Evaluation)',
    participant_summary: 'รายงานเปรียบเทียบผู้เข้าร่วม (Participant Summary)',
    antibody_panel: 'แผงเซลล์ Antibody Identification / Antigram',
    quiz_image: 'รูปประกอบข้อสอบ Competency',
    corrective_action: 'หลักฐานการแก้ไขและป้องกัน',
    closure_report: 'รายงานสรุปปิดรอบ',
    other: 'เอกสารอื่น ๆ'
  };
  const DOCUMENT_CATEGORY_HELP = {
    source_document: 'ฟอร์มเปล่าหรือเอกสารต้นฉบับ ใช้สร้างช่องกรอกและโครงสร้างการทดสอบ',
    instruction: 'คู่มือ วิธีปฏิบัติ ข้อควรระวัง และ Master List ใช้ประกอบการสร้างฟอร์ม แต่ไม่ใช้เป็นเฉลย',
    specimen_image: 'ภาพสิ่งส่งตรวจหรือวัสดุทดสอบที่ต้องเก็บเป็นหลักฐาน',
    raw_result_image: 'ภาพผลทดสอบดิบ ใช้สร้าง Competency สำหรับเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง',
    submission_form: 'ไฟล์เดียวกันกับหลักฐานการส่งผล: แบบฟอร์ม/PDF/ภาพหน้าจอที่แสดงผลซึ่งห้องส่งจริง ใช้ตรวจว่าห้องส่งอะไรและเชื่อมกับวันเวลาที่ส่ง ห้ามใช้เป็นเฉลย',
    submission_evidence: 'ประเภทเดิมเพื่อรองรับข้อมูลเก่า รายการใหม่ให้เลือก “หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ” เพียงประเภทเดียว',
    official_result: 'Original Evaluation หรือรายงานที่มี Intended Response / Grade ใช้เป็นแหล่งหลักของเฉลยและคะแนน',
    participant_summary: 'Participant Summary หรือ PSR ใช้เทียบสัดส่วนคำตอบของห้องอื่น และใช้ประเมิน Educational Challenge',
    antibody_panel: 'Antigram หรือ Panel cell profile ใช้จับคู่ปฏิกิริยากับ antigen profile สำหรับ Antibody Identification อัปโหลดได้หลาย Panel/หลาย Lot และตั้งชื่อ PanelA, PanelB, PanelC ตามลำดับ ไม่ใช่ภาพผลตัวอย่างและไม่ใช่เฉลย',
    quiz_image: 'รูปที่แอดมินผูกไว้กับคำถามแต่ละข้อ ผู้ทำแบบประเมินจะเห็นเฉพาะในข้อนั้น',
    corrective_action: 'หลักฐานการแก้ไข ป้องกัน และติดตามประสิทธิผล',
    closure_report: 'รายงานสรุปเมื่อปิดรอบ',
    other: 'เอกสารประกอบอื่นที่ไม่เข้ากลุ่มข้างต้น',
  };

  const VISIBILITY_LABELS = {
    restricted: 'เฉพาะผู้ทบทวน ผู้จัดการคุณภาพ และแพทย์',
    assigned: 'เฉพาะผู้ได้รับมอบหมาย',
    staff: 'บุคลากรทุกคน'
  };
  const ASSIGNMENT_ROLE_LABELS = {
    practitioner: 'ผู้ปฏิบัติจริง',
    reviewer: 'ผู้ทบทวนผล',
    quality_approver: 'ผู้รับรองคุณภาพ',
    physician: 'แพทย์ผู้รับทราบ'
  };
  const RESULT_STATUS_LABELS = {
    draft: 'ฉบับร่าง',
    submitted: 'ส่งแล้ว',
    returned: 'ส่งกลับแก้ไข',
    resubmitted: 'ส่งใหม่แล้ว',
    awaiting_practitioner_confirmations: 'กำลังจัดทำสรุปผลห้องปฏิบัติการ',
    practitioners_confirmed: 'ระบบสรุปผลแล้ว รอผู้ทบทวน',
    awaiting_qm_review: 'ผู้ทบทวนผ่านแล้ว รอผู้รับรองคุณภาพ',
    qm_approved: 'ผู้รับรองคุณภาพรับรองแล้ว รอแพทย์รับทราบ',
    awaiting_physician_approval: 'รอแพทย์รับทราบ',
    physician_approved: 'แพทย์รับทราบแล้ว',
    locked: 'ล็อกข้อมูลแล้ว'
  };
  const APPROVAL_STAGE_LABELS = {
    practitioner_confirm: 'ผู้ปฏิบัติทั้งสองคนยืนยันผลกลาง',
    reviewer_review: 'ผู้ทบทวนตรวจผลของผู้ปฏิบัติและผลกลาง',
    qm_review: 'ผู้รับรองคุณภาพตรวจและอนุมัติ',
    physician_approval: 'แพทย์รับทราบสรุปผลห้องปฏิบัติการ',
    closure_acknowledgement: 'แพทย์รับทราบการปิดรอบ',
    historical_practitioner_confirm: 'ผู้ปฏิบัติยืนยันข้อมูลย้อนหลัง',
    historical_reviewer_review: 'ผู้ทบทวนตรวจข้อมูลย้อนหลัง',
    historical_qm_certification: 'ผู้รับรองคุณภาพรับรองข้อมูลย้อนหลัง'
  };
  const DECISION_LABELS = {
    approved: 'อนุมัติ',
    returned: 'ส่งกลับแก้ไข',
    acknowledged: 'รับทราบ',
    rejected: 'ไม่อนุมัติ'
  };
  const CAPA_STATUS_LABELS = {
    open: 'เปิดรายการ',
    in_progress: 'กำลังดำเนินการ',
    awaiting_effectiveness_review: 'รอตรวจประสิทธิผล',
    effective: 'มีประสิทธิผล',
    ineffective: 'ยังไม่มีประสิทธิผล',
    closed: 'ปิดรายการ',
    cancelled: 'ยกเลิก'
  };
  const QUESTION_TYPE_LABELS = {
    single_choice: 'เลือกคำตอบเดียว',
    multiple_choice: 'เลือกได้หลายคำตอบ',
    text: 'คำตอบแบบข้อความ',
    numeric: 'คำตอบเป็นตัวเลข',
    image_interpretation: 'แปลผลจากภาพ'
  };
  const COMPETENCY_TYPE_LABELS = {
    practical: 'ประเมินจากการปฏิบัติจริง',
    quiz: 'แบบทดสอบ'
  };
  const OFFICIAL_OUTCOME_LABELS = {
    pending: 'รอผล',
    pass: 'ผ่าน',
    fail: 'ไม่ผ่าน',
    partial: 'ผ่านบางส่วน'
  };
  const AUDIT_ACTION_LABELS = {
    insert: 'เพิ่มข้อมูล',
    update: 'แก้ไขข้อมูล',
    delete: 'ลบข้อมูล',
    password_changed: 'เปลี่ยนรหัสผ่าน',
    create_user: 'สร้างบัญชีผู้ใช้',
    update_roles: 'แก้ไขบทบาทผู้ใช้',
    set_active: 'เปลี่ยนสถานะบัญชี',
    reset_password: 'รีเซ็ตรหัสผ่าน',
    approve_profile_change: 'อนุมัติการเปลี่ยนข้อมูลส่วนตัว',
    reject_profile_change: 'ไม่อนุมัติการเปลี่ยนข้อมูลส่วนตัว',
    create_qm_delegation: 'มอบหมายผู้ทำหน้าที่แทนผู้จัดการคุณภาพ',
    cancel_qm_delegation: 'ยุติการมอบหมายผู้ทำหน้าที่แทน'
  };
  const AUDIT_TABLE_LABELS = {
    ec_profiles: 'ข้อมูลผู้ใช้งาน',
    ec_user_roles: 'บทบาทผู้ใช้งาน',
    ec_eqa_rounds: 'รอบ EQA',
    ec_round_documents: 'เอกสารและภาพ',
    ec_round_assignments: 'ผู้รับผิดชอบในรอบ',
    ec_individual_results: 'ผลรายบุคคล',
    ec_consensus_results: 'สรุปผลห้องปฏิบัติการ',
    ec_approvals: 'การตรวจและอนุมัติ',
    ec_submission_evidence: 'หลักฐานการส่งผล',
    ec_official_results: 'ผลประเมินอย่างเป็นทางการ',
    ec_corrective_actions: 'การแก้ไขและป้องกัน',
    ec_questions: 'คำถามประเมินความสามารถ',
    ec_question_choices: 'ตัวเลือกคำตอบ',
    ec_question_answer_keys: 'เฉลยคำตอบ',
    ec_competency_assignments: 'การมอบหมายการประเมิน',
    ec_competency_answers: 'คำตอบการประเมิน',
    ec_profile_change_requests: 'คำขอเปลี่ยนข้อมูลส่วนตัว',
    ec_historical_result_confirmations: 'การยืนยันข้อมูลย้อนหลัง',
    ec_reflections: 'แบบทบทวนข้อผิดพลาด',
    ec_notification_settings: 'ตั้งค่าการแจ้งเตือน',
    ec_notification_logs: 'ประวัติการแจ้งเตือน',
    ec_report_archives: 'ทะเบียนไฟล์ Google Drive',
    ec_qm_delegations: 'การมอบหมายรองผู้จัดการคุณภาพ',
    ec_work_evidence: 'ไฟล์การปฏิบัติงานรายบุคคล'
  };
  const METHOD_LABELS = {
    abo: 'หมู่เลือด ABO',
    rh: 'หมู่เลือด Rh',
    screen: 'การคัดกรองแอนติบอดี',
    antibody: 'การระบุชนิดแอนติบอดี',
    crossmatch: 'การทดสอบความเข้ากันได้',
    antigen: 'การตรวจแอนติเจน'
  };

  const LEGACY_RESULT_SPECIMENS = ['J-08', 'J-09', 'J-10', 'J-11', 'J-12'];
  const CAP_J_RESULT_SPECIMENS = ['J-01', 'J-02', 'J-03', 'J-04', 'J-05'];
  const CAP_JE_RESULT_SPECIMENS = ['JE-07'];
  const CAP_J_JE_SCHEMA = 'cap-j-je-a-2026-v1';
  const PROVIDER_GENERATED_SCHEMA = 'provider-generated-v1';

  const CAP_ANTIBODY_OPTIONS = [
    ['184', 'Antibody identification not indicated (no antibody detected)'],
    ['200', 'Unable to complete testing / would refer for testing'],
    ['112', 'Anti-D'], ['113', 'Anti-C'], ['114', 'Anti-c'], ['115', 'Anti-E'], ['116', 'Anti-e'],
    ['124', 'Anti-K'], ['125', 'Anti-k'], ['126', 'Anti-Fya'], ['127', 'Anti-Fyb'],
    ['128', 'Anti-Jka'], ['129', 'Anti-Jkb'], ['131', 'Anti-Lea'], ['132', 'Anti-Leb'],
    ['133', 'Anti-P1'], ['134', 'Anti-M'], ['135', 'Anti-N'], ['136', 'Anti-S'], ['137', 'Anti-s'],
    ['147', 'Antibody to other (nonlisted) high incidence antigen'],
    ['148', 'Antibody to other (nonlisted) low incidence antigen'],
    ['149', 'Warm autoantibody, specificity unknown'],
    ['010', 'Other — specify on result form']
  ];

  const CAP_RESULT_OPTIONS = {
    abo: [
      ['', '— เลือกผล —'], ['A', '188 │ Group A'], ['B', '191 │ Group B'], ['AB', '192 │ Group AB'], ['O', '195 │ Group O'],
      ['ไม่สอดคล้อง ต้องตรวจเพิ่ม', '199 │ Cell/serum grouping do not agree — additional testing required']
    ],
    subgroup: [
      ['', '— ไม่ระบุ —'], ['ไม่ได้ตรวจ subgroup', '105 │ Subgroup not tested'], ['A1', '189 │ A1'],
      ['Asub', '124 │ A subgroup'], ['A1B', '193 │ A1B'], ['AsubB', '125 │ A subgroup B']
    ],
    rh: [['', '— เลือกผล —'], ['Rh positive', '207 │ Rh positive'], ['Rh negative', '208 │ Rh negative']],
    screen: [['', '— เลือกผล —'], ['ไม่พบแอนติบอดี', '110 │ Unexpected antibody not detected'], ['พบแอนติบอดี', '111 │ Unexpected antibody detected']],
    crossmatch: [['', '— เลือกผล —'], ['Negative', '29 │ Negative'], ['Positive', '30 │ Positive'], ['Would refer for testing', '20 │ Would refer for testing']],
    crossmatchType: [['', '— เลือกวิธี —'], ['Immediate spin only', '58 │ Immediate spin only'], ['Antiglobulin crossmatch with IgG AHG', '59 │ Antiglobulin crossmatch with IgG AHG'], ['Antiglobulin crossmatch with polyspecific AHG', '60 │ Antiglobulin crossmatch with polyspecific AHG']],
    strength: [['', '— เลือกความแรง —'], ['Microscopic', '24 │ Microscopic'], ['1+', '25 │ 1+'], ['2+', '26 │ 2+'], ['3+', '27 │ 3+'], ['4+', '28 │ 4+'], ['Not applicable', '80 │ Not applicable']],
    antigen: [['', '— เลือกผล —'], ['Negative', '209 │ Negative'], ['Positive', '210 │ Positive'], ['Reagent not available', '235 │ Reagent not available'], ['Test not indicated', '435 │ Test not indicated']]
  };

  const EQA_FILE_TEST_ALIASES = Object.freeze({
    abo: 'ABO', rh: 'Rh', abscreen: 'AbScreen', antibody_screen: 'AbScreen', screen: 'AbScreen',
    abid: 'AbID', antibodyid: 'AbID', antibodyidentification: 'AbID',
    crossmatch: 'Crossmatch', xmatch: 'Crossmatch', compatibility: 'Crossmatch',
    agtyping: 'AgTyping', antigentyping: 'AgTyping', phenotype: 'AgTyping',
    eluateabid: 'EluateAbID', eluateid: 'EluateAbID', dat: 'DAT',
    cbc: 'CBC', wbccount: 'WBCCount', antibodytiter: 'AntibodyTiter', titer: 'AntibodyTiter',
    multitest: 'MultiTest'
  });

  const EQA_FILE_ROLE_ALIASES = Object.freeze({
    rawresult: 'RawResult', antigram: 'Antigram', blankresultform: 'BlankResultForm',
    submittedresultform: 'SubmittedResultForm', officialevaluation: 'OfficialEvaluation',
    participantsummary: 'ParticipantSummary', kitinstruction: 'KitInstruction'
  });

  function canonicalFilenameToken(value) {
    return String(value || '').trim().replace(/[^a-z0-9]+/gi, '').toLowerCase();
  }

  function parseEqaFilename(fileName) {
    const original = String(fileName || '').trim();
    const extensionMatch = original.match(/\.([a-z0-9]+)$/i);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    const stem = extensionMatch ? original.slice(0, -extensionMatch[0].length) : original;
    const parts = stem.split('_').map((part) => part.trim()).filter(Boolean);
    const parsed = {
      valid: false,
      original,
      extension,
      provider_round: parts[0] || '',
      specimen: '',
      test_type: '',
      role: '',
      panel_id: '',
      cell_start: null,
      cell_end: null,
      lot: '',
      donor: '',
      antigens: [],
      phase: '',
      extra_cell: '',
      qualifiers: [],
      warnings: [],
      bundle_key: '',
      panel_key: ''
    };
    if (parts.length < 2) {
      parsed.warnings.push('ชื่อไฟล์ต้องคั่นส่วนหลักด้วยเครื่องหมาย _');
      return parsed;
    }

    const roleIndex = parts.findLastIndex((part, index) => index > 0 && Boolean(EQA_FILE_ROLE_ALIASES[canonicalFilenameToken(part)]));
    parsed.role = roleIndex >= 0 ? EQA_FILE_ROLE_ALIASES[canonicalFilenameToken(parts[roleIndex])] : '';
    if (!parsed.role) parsed.warnings.push('ไม่พบบทบาทไฟล์มาตรฐาน เช่น RawResult หรือ Antigram');

    // เอกสารทั้งฉบับ: Provider-Round_Program_DocumentRole.ext
    // รองรับชื่อเดิมที่วาง DocumentRole ก่อน qualifier เช่น KitInstruction_J-JE1
    if (['BlankResultForm','SubmittedResultForm','OfficialEvaluation','ParticipantSummary','KitInstruction'].includes(parsed.role)) {
      const documentParts = parts.slice(1).filter((_, index) => index + 1 !== roleIndex);
      parsed.specimen = documentParts[0] || 'ALL';
      parsed.qualifiers = documentParts.slice(1);
      parsed.valid = Boolean(parsed.provider_round && parsed.role && extension);
      parsed.bundle_key = [parsed.provider_round, parsed.specimen, parsed.role].join('|').toUpperCase();
      if (roleIndex !== parts.length - 1) parsed.warnings.push('ชื่อมาตรฐานใหม่ควรวางบทบาทเอกสารไว้ท้ายชื่อก่อนนามสกุล');
      return parsed;
    }

    parsed.specimen = String(parts[1] || '').toUpperCase().replace(/_/g, '-');
    const rawTest = parts[2] || '';
    parsed.test_type = EQA_FILE_TEST_ALIASES[canonicalFilenameToken(rawTest)] || rawTest;
    parsed.qualifiers = parts.slice(3).filter((_, index) => index + 3 !== roleIndex);

    for (const qualifier of parsed.qualifiers) {
      let match = qualifier.match(/^Panel([A-Za-z]|\d{1,2})$/i);
      if (match) { parsed.panel_id = String(match[1]).toUpperCase().padStart(/^\d+$/.test(match[1]) ? 2 : 1, '0'); continue; }
      match = qualifier.match(/^Cell(\d{1,2})[-–](\d{1,2})$/i);
      if (match) { parsed.cell_start = Number(match[1]); parsed.cell_end = Number(match[2]); continue; }
      match = qualifier.match(/^Lot(.+)$/i);
      if (match) { parsed.lot = match[1]; continue; }
      match = qualifier.match(/^Donor(.+)$/i);
      if (match) { parsed.donor = match[1].toUpperCase(); continue; }
      match = qualifier.match(/^ExtraCell(\d{1,2})$/i);
      if (match) { parsed.extra_cell = String(Number(match[1])).padStart(2, '0'); continue; }
      match = qualifier.match(/^(RT|IAT|IS|AHG|ENZYME)$/i);
      if (match) { parsed.phase = match[1].toUpperCase(); continue; }
    }

    if (parsed.test_type === 'AgTyping') {
      const antigenToken = parsed.qualifiers.find((item) => !/^Panel|^Cell|^Lot|^Donor|^ExtraCell|^(RT|IAT|IS|AHG|ENZYME)$/i.test(item));
      if (antigenToken && !/^SelectedAntigen$/i.test(antigenToken)) {
        parsed.antigens = antigenToken.split('-').map((item) => item.trim()).filter(Boolean);
      }
    }
    if (parsed.test_type === 'Crossmatch' && !parsed.donor) {
      const donorLike = parsed.qualifiers.find((item) => /^(?:JE|J)-?\d{1,2}R$/i.test(item));
      if (donorLike) parsed.donor = donorLike.toUpperCase();
    }

    if (parsed.test_type === 'AbID') {
      if (!parsed.panel_id && !parsed.extra_cell) parsed.warnings.push('AbID ควรระบุ PanelA/PanelB หรือ ExtraCell01');
      if (parsed.role === 'RawResult' && !parsed.extra_cell && (parsed.cell_start === null || parsed.cell_end === null)) parsed.warnings.push('ภาพผล AbID ควรระบุช่วง Cell เช่น Cell01-06');
      if (parsed.role === 'Antigram' && !parsed.lot) parsed.warnings.push('Antigram ควรระบุ Lot เช่น Lot8RA453');
    }
    if (!Object.values(EQA_FILE_TEST_ALIASES).includes(parsed.test_type)) parsed.warnings.push(`ชนิดการทดสอบ “${parsed.test_type || '-'}” ไม่อยู่ในคำมาตรฐาน`);
    if (!/^(?:JE|J|ELU|TRC|AABT|RBCAT)-?\d{1,3}[RS]?$/i.test(parsed.specimen)) parsed.warnings.push('รหัสตัวอย่างควรเป็นรูปแบบ J-01, JE-07, ELU-01 เป็นต้น');
    if (!['png','jpg','jpeg','webp','pdf'].includes(extension)) parsed.warnings.push('นามสกุลที่รองรับคือ PDF, PNG, JPG, JPEG หรือ WebP');

    parsed.bundle_key = [parsed.provider_round, parsed.specimen, parsed.test_type, parsed.donor].filter(Boolean).join('|').toUpperCase();
    parsed.panel_key = parsed.panel_id ? [parsed.bundle_key, `PANEL${parsed.panel_id}`].join('|') : '';
    parsed.valid = Boolean(parsed.provider_round && parsed.specimen && parsed.test_type && parsed.role && extension && !parsed.warnings.some((item) => item.includes('ไม่อยู่ในคำมาตรฐาน')));
    return parsed;
  }

  function filenameParsePreview(fileName) {
    const parsed = parseEqaFilename(fileName);
    const parts = [
      parsed.specimen && `ตัวอย่าง ${parsed.specimen}`,
      parsed.test_type && `การทดสอบ ${parsed.test_type}`,
      parsed.panel_id && `Panel ${parsed.panel_id}`,
      parsed.cell_start !== null && `Cell ${String(parsed.cell_start).padStart(2, '0')}–${String(parsed.cell_end).padStart(2, '0')}`,
      parsed.lot && `Lot ${parsed.lot}`,
      parsed.donor && `Donor ${parsed.donor}`,
      parsed.role && `บทบาท ${parsed.role}`
    ].filter(Boolean);
    const warningHtml = parsed.warnings.length ? `<div class="notice warning small" style="margin-top:8px"><strong>ระบบยังอ่านชื่อไฟล์ได้ไม่ครบ</strong><br>${parsed.warnings.map(esc).join('<br>')}</div>` : '';
    return `<div class="notice ${parsed.valid ? 'success' : 'info'} small"><strong>${parsed.valid ? 'ระบบ parse ชื่อไฟล์ได้' : 'ตรวจชื่อไฟล์'}</strong><br>${parts.length ? parts.map(esc).join(' · ') : 'ใช้ชื่อมาตรฐานเพื่อให้ระบบจับคู่ไฟล์อัตโนมัติ'}</div>${warningHtml}`;
  }

  function isCapJJeRound(round = state.currentRound) {
    return resolveProgramProfile(round).code === 'CAP_J_JE';
  }

  function isLegacyCapJJeARound(round = state.currentRound) {
    if (!isCapJJeRound(round)) return false;
    const text = `${round?.program_code || ''} ${round?.round_code || ''} ${round?.program_name || ''}`.toUpperCase();
    return Number(round?.survey_year || 0) === 2026
      && (/\bJ(?:\s*\/\s*JE)?[-\s]?A\b/.test(text) || (/\bJ[-\s]?A\b/.test(text) && /\bJE[-\s]?A\b/.test(text)));
  }

  function resultSpecimensForRound(round = state.currentRound, payload = null) {
    const payloadKeys = Object.keys(payload?.specimens || {});
    if (payload?.schema === PROVIDER_GENERATED_SCHEMA || generatedResultSchema(round)) {
      if (payloadKeys.length) return payloadKeys;
      const schemaKeys = [...new Set((generatedResultSchema(round)?.programs || [])
        .flatMap((program) => program.specimens || [])
        .map((item) => String(item.id || item.label || '').trim())
        .filter(Boolean))];
      if (schemaKeys.length) return schemaKeys;
    }
    if (isLegacyCapJJeARound(round) || payload?.schema === CAP_J_JE_SCHEMA) return [...CAP_J_RESULT_SPECIMENS, ...CAP_JE_RESULT_SPECIMENS];
    return payloadKeys.length ? payloadKeys : LEGACY_RESULT_SPECIMENS;
  }

  function configReady() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY
      && !String(cfg.SUPABASE_URL).includes('PASTE_')
      && !String(cfg.SUPABASE_PUBLISHABLE_KEY).includes('PASTE_');
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function labelFrom(map, value, fallback = '-') {
    return map[value] || fallback;
  }

  function displayQuestionPrompt(value) {
    return String(value || '')
      .replace(/CAP-[A-Za-z0-9_.()\-]+\.(?:png|jpe?g|pdf)/gi, '')
      .replace(/จากภาพ\s*/g, '')
      .replace(/\(\s*โปรดตอบ[^)]*\)/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '')
      .trim();
  }

  function questionPromptParts(value) {
    const raw = String(value || '').trim();
    const marker = raw.match(/^\[\[CASE_CONTEXT\]\]\s*([\s\S]*?)\s*\[\[QUESTION\]\]\s*([\s\S]*)$/i);
    if (marker) {
      const context = String(marker[1] || '').trim();
      const promptRaw = String(marker[2] || '').trim();
      return {
        context,
        prompt: displayQuestionPrompt(promptRaw) || promptRaw,
      };
    }
    const parts = raw.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    if (parts.length >= 2 && /^ข้อมูลกรณีศึกษา/i.test(parts[0])) {
      return {
        context: parts[0],
        prompt: displayQuestionPrompt(parts.slice(1).join(' ')) || parts.slice(1).join(' '),
      };
    }
    return { context: '', prompt: displayQuestionPrompt(raw) || raw };
  }

  function capAntibodyLabel(option) {
    return `${option[0]} │ ${option[1]}`;
  }

  function capAntibodyDatalist(id = 'cap-antibody-master-list') {
    return `<datalist id="${esc(id)}">${CAP_ANTIBODY_OPTIONS.map((option) => `<option value="${esc(capAntibodyLabel(option))}"></option>`).join('')}</datalist>`;
  }

  function capAntibodyAutocomplete(name, value, disabled = false, placeholder = 'พิมพ์ชื่อ เช่น Anti-K แล้วเลือก 124 │ Anti-K') {
    return `<input class="input cap-antibody-autocomplete" type="search" list="cap-antibody-master-list" name="${esc(name)}" value="${esc(value || '')}" ${disabled ? 'disabled' : ''} placeholder="${esc(placeholder)}" autocomplete="off">`;
  }

  function isAntibodyIdentificationQuestion(question) {
    const text = `${question?.section || ''} ${question?.prompt || ''}`.toLowerCase();
    return text.includes('antibody identification') || text.includes('ระบุชนิดแอนติบอดี') || /\bab\s*id\b/i.test(text);
  }

  function resolveCapAntibodyEntry(value) {
    const typed = String(value || '').trim();
    if (!typed) return '';
    const options = CAP_ANTIBODY_OPTIONS.map((option) => ({ code: option[0], name: option[1], label: capAntibodyLabel(option) }));
    const exact = options.find((option) => option.label === typed || option.code === typed || option.name === typed);
    if (exact) return exact.label;
    const codeMatch = typed.match(/(?:^|[^0-9])(\d{3})(?:[^0-9]|$)/);
    if (codeMatch) {
      const byCode = options.find((option) => option.code === codeMatch[1]);
      if (byCode) return byCode.label;
    }
    const caseSensitive = options.filter((option) => option.label.includes(typed) || option.name.includes(typed));
    if (caseSensitive.length === 1) return caseSensitive[0].label;
    const normalized = typed.toLowerCase();
    const insensitive = options.filter((option) => option.label.toLowerCase() === normalized || option.name.toLowerCase() === normalized);
    return insensitive.length === 1 ? insensitive[0].label : '';
  }

  function antibodySelectionsFromText(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const whole = resolveCapAntibodyEntry(raw);
    if (whole) return [whole];
    const delimiter = raw.includes(';') || /\s+และ\s+/.test(raw) ? /\s*(?:;|\s+และ\s+)\s*/ : /\s*,\s*/;
    const tokens = raw.split(delimiter).map((item) => item.trim()).filter(Boolean);
    const resolved = tokens.map((token) => resolveCapAntibodyEntry(token) || token);
    return [...new Set(resolved)];
  }

  function quizAntibodyPicker(question, currentValue, editable) {
    const pickerId = `antibody-picker-${question.id}`;
    const selections = antibodySelectionsFromText(currentValue);
    return `<div class="quiz-antibody-picker" data-antibody-picker="${esc(pickerId)}">
      <div class="quiz-antibody-search-row">
        <input class="input" type="search" list="${esc(pickerId)}-list" data-antibody-search placeholder="พิมพ์ Anti-K แล้วเลือก 124 │ Anti-K" ${editable ? '' : 'disabled'} autocomplete="off">
        ${editable ? '<button type="button" class="btn btn-outline" data-add-antibody>เพิ่ม</button>' : ''}
      </div>
      ${capAntibodyDatalist(`${pickerId}-list`)}
      <div class="quiz-antibody-selected" data-antibody-selected>${selections.map((label) => `<span class="antibody-chip" data-antibody-value="${esc(label)}"><span>${esc(label)}</span>${editable ? '<button type="button" data-remove-antibody aria-label="ลบ">×</button>' : ''}</span>`).join('') || '<span class="small muted" data-antibody-empty>ยังไม่ได้เลือก antibody</span>'}</div>
      <input type="hidden" name="q_${question.id}" value="${esc(selections.join('; '))}">
      <div class="help">เลือกได้มากกว่า 1 รายการ เช่น Anti-E และ Anti-K</div>
    </div>`;
  }

  function friendlyError(error) {
    console.error(error);
    const rawMessage = String(error?.message || error || '');
    const message = rawMessage.toLowerCase();
    if (/[ก-๙]/.test(rawMessage)) return rawMessage;
    if (message.includes('invalid login credentials')) return 'ชื่อผู้ใช้ อีเมล หรือรหัสผ่านไม่ถูกต้อง';
    if (message.includes('email not confirmed')) return 'อีเมลนี้ยังไม่ได้รับการยืนยัน กรุณาติดต่อผู้ดูแลระบบ';
    if (message.includes('user already registered') || message.includes('already exists')) return 'ข้อมูลนี้มีอยู่ในระบบแล้ว';
    if (message.includes('password') && message.includes('least')) return 'รหัสผ่านสั้นเกินไป กรุณาตั้งรหัสผ่านใหม่ให้ยาวขึ้น';
    if (message.includes('failed to fetch') || message.includes('network')) return 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
    if (message.includes('row-level security') || message.includes('permission') || message.includes('not authorized')) return 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการรายการนี้';
    if (message.includes('jwt') || message.includes('token') || message.includes('session')) return 'การเข้าสู่ระบบหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่';
    if (message.includes('duplicate key') || message.includes('unique constraint')) return 'ข้อมูลนี้ถูกบันทึกไว้แล้ว กรุณาตรวจสอบรายการเดิม';
    return 'ระบบดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ';
  }

  function fmtDate(value, withTime = false) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    }).format(d);
  }

  function fmtDateInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function fmtDateTimeInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function fmtHistoricalEvent(row) {
    if (!row?.actual_action_date) return '-';
    const dateText = fmtDate(row.actual_action_date);
    if (row.actual_time_known === false) return `${dateText} · ไม่ทราบเวลา`;
    const timeText = row.actual_action_time ? String(row.actual_action_time).slice(0, 5) : '';
    return timeText ? `${dateText} · ${timeText} น.` : dateText;
  }

  function historicalActionFields(prefix, label, assignment = null) {
    const dateValue = assignment?.actual_action_date ? String(assignment.actual_action_date).slice(0, 10) : '';
    const timeValue = assignment?.actual_action_time ? String(assignment.actual_action_time).slice(0, 5) : '';
    const unknown = Boolean(dateValue && assignment?.actual_time_known === false);
    return `<section class="historical-action-card" data-historical-action="${esc(prefix)}">
      <div class="historical-action-card-head"><strong>${esc(label)}</strong><span class="small muted">ตามหลักฐานเดิม (ไม่แทน Audit log)</span></div>
      <div class="historical-action-grid">
        <div class="field"><label>วันที่เกิดเหตุการณ์จริง</label><input class="input" type="date" name="${esc(prefix)}_date" value="${esc(dateValue)}"></div>
        <div class="field"><label>เวลา</label><input class="input" type="time" name="${esc(prefix)}_time" value="${esc(timeValue)}" ${unknown ? 'disabled' : ''}></div>
      </div>
      <label class="historical-unknown-time"><input type="checkbox" name="${esc(prefix)}_time_unknown" ${unknown ? 'checked' : ''}><span>หลักฐานระบุเฉพาะวันที่ ไม่ทราบเวลาที่แน่นอน</span></label>
      <div class="field"><label>หมายเหตุ/แหล่งหลักฐาน (ถ้ามี)</label><input class="input" name="${esc(prefix)}_note" value="${esc(assignment?.actual_action_note || '')}" placeholder="เช่น ลายมือชื่อในแบบฟอร์มเดิม หน้า 2"></div>
    </section>`;
  }

  function readHistoricalActionMeta(form, prefix) {
    const fd = new FormData(form);
    const date = String(fd.get(`${prefix}_date`) || '');
    const timeKnown = fd.get(`${prefix}_time_unknown`) !== 'on';
    return {
      date: date || null,
      time: date && timeKnown ? (String(fd.get(`${prefix}_time`) || '') || null) : null,
      time_known: timeKnown,
      note: String(fd.get(`${prefix}_note`) || '').trim() || null
    };
  }

  function bindHistoricalTimeControls(root = document) {
    root.querySelectorAll('[data-historical-action]').forEach((card) => {
      const prefix = card.dataset.historicalAction;
      const checkbox = card.querySelector(`input[name="${CSS.escape(prefix)}_time_unknown"]`);
      const timeInput = card.querySelector(`input[name="${CSS.escape(prefix)}_time"]`);
      if (!checkbox || !timeInput) return;
      const sync = () => {
        timeInput.disabled = checkbox.checked;
        if (checkbox.checked) timeInput.value = '';
      };
      checkbox.addEventListener('change', sync);
      sync();
    });
  }


  function historicalDateTimePair(prefix, label, dateValue = '', timeValue = '', timeKnown = true, helpText = '') {
    const unknown = Boolean(dateValue && timeKnown === false);
    return `<section class="historical-action-card" data-historical-action="${esc(prefix)}">
      <div class="historical-action-card-head"><strong>${esc(label)}</strong>${helpText ? `<span class="small muted">${esc(helpText)}</span>` : ''}</div>
      <div class="historical-action-grid">
        <div class="field"><label>วันที่</label><input class="input" type="date" name="${esc(prefix)}_date" required value="${esc(dateValue || '')}"></div>
        <div class="field"><label>เวลา</label><input class="input" type="time" name="${esc(prefix)}_time" value="${esc(timeValue || '')}" ${unknown ? 'disabled' : ''}></div>
      </div>
      <label class="historical-unknown-time"><input type="checkbox" name="${esc(prefix)}_time_unknown" ${unknown ? 'checked' : ''}><span>หลักฐานระบุเฉพาะวันที่ ไม่ทราบเวลาที่แน่นอน</span></label>
    </section>`;
  }

  const WORK_EVIDENCE_TYPES = new Set(['application/pdf','image/jpeg','image/png','image/webp']);

  function workEvidencePanelHtml(panelId, rows = [], editable = false) {
    const items = (rows || []).map((row) => `<div class="work-evidence-item">
      <div class="work-evidence-info"><strong title="${esc(row.file_name || '')}">${esc(row.file_name || 'ไฟล์หลักฐาน')}</strong><span>${fmtDate(row.created_at, true)}${row.file_size ? ` · ${(Number(row.file_size) / 1024 / 1024).toFixed(2)} MB` : ''}</span></div>
      <div class="table-actions"><button type="button" class="btn btn-outline btn-sm" data-open-work-evidence="${row.id}" data-path="${esc(row.storage_path)}">เปิดไฟล์</button>${editable ? `<button type="button" class="btn btn-danger btn-sm" data-delete-work-evidence="${row.id}">ลบ</button>` : ''}</div>
    </div>`).join('');
    return `<section class="work-evidence-panel" data-work-evidence-panel="${esc(panelId)}">
      <div class="card-header"><div><h3>ไฟล์การปฏิบัติงาน (ถ้ามี)</h3><div class="small muted">อัปโหลดได้หลายไฟล์ ใช้ยืนยันผลการทดสอบของตนเอง ไม่บังคับ</div></div><span class="badge info">${rows.length} ไฟล์</span></div>
      ${editable ? `<div class="work-evidence-upload"><input class="input" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" data-work-evidence-files><button type="button" class="btn btn-secondary" data-upload-work-evidence>อัปโหลดไฟล์</button></div><div class="help">รองรับ PDF, JPG, PNG, WebP ไฟล์ละไม่เกิน 20 MB</div>` : ''}
      <div class="work-evidence-list">${items || '<div class="small muted">ยังไม่มีไฟล์การปฏิบัติงาน</div>'}</div>
    </section>`;
  }

  async function loadWorkEvidence(filters = {}) {
    let query = state.supabase.from('ec_work_evidence').select('*').is('archived_at', null).order('created_at', { ascending: false });
    if (filters.roundId) query = query.eq('round_id', filters.roundId);
    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.contextType) query = query.eq('context_type', filters.contextType);
    if (filters.assignmentId) query = query.eq('competency_assignment_id', filters.assignmentId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function uploadWorkEvidence({ roundId, contextType, assignmentId = null, files }) {
    const fileList = Array.from(files || []);
    if (!fileList.length) throw new Error('กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์');
    for (const file of fileList) {
      if (!WORK_EVIDENCE_TYPES.has(file.type)) throw new Error(`ไฟล์ ${file.name}: รองรับเฉพาะ PDF, JPG, PNG และ WebP`);
      if (file.size > 20 * 1024 * 1024) throw new Error(`ไฟล์ ${file.name}: ขนาดเกิน 20 MB`);
    }
    for (const file of fileList) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const path = `${roundId}/work-evidence/${contextType}/${state.user.id}/${crypto.randomUUID()}_${safeName}`;
      const upload = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (upload.error) throw upload.error;
      const { error: insertError } = await state.supabase.from('ec_work_evidence').insert({
        round_id: roundId,
        user_id: state.user.id,
        context_type: contextType,
        competency_assignment_id: assignmentId,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: state.user.id
      });
      if (insertError) {
        await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([path]);
        throw insertError;
      }
    }
  }

  function bindWorkEvidencePanel(panelId, config) {
    const panel = document.querySelector(`[data-work-evidence-panel="${CSS.escape(panelId)}"]`);
    if (!panel) return;
    panel.querySelector('[data-upload-work-evidence]')?.addEventListener('click', async () => {
      const input = panel.querySelector('[data-work-evidence-files]');
      try {
        setBusy(true);
        await uploadWorkEvidence({ ...config, files: input?.files });
        toast('อัปโหลดไฟล์การปฏิบัติงานแล้ว', 'success');
        route();
      } catch (error) {
        toast(friendlyError(error), 'danger');
      } finally {
        setBusy(false);
      }
    });
    panel.querySelectorAll('[data-open-work-evidence]').forEach((button) => button.addEventListener('click', async () => {
      const { data, error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(button.dataset.path, 300);
      if (error) return toast(friendlyError(error), 'danger');
      window.open(data.signedUrl, '_blank', 'noopener');
    }));
    panel.querySelectorAll('[data-delete-work-evidence]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('ลบไฟล์การปฏิบัติงานนี้หรือไม่')) return;
      const { data, error } = await state.supabase.rpc('ec_delete_work_evidence_v262', { p_evidence_id: button.dataset.deleteWorkEvidence });
      if (error) return toast(friendlyError(error), 'danger');
      const path = data?.storage_path;
      const storageDelete = path ? await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([path]) : { error: null };
      toast(storageDelete.error ? 'ลบรายการแล้ว แต่ลบไฟล์จริงไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ' : 'ลบไฟล์แล้ว', storageDelete.error ? 'warning' : 'success');
      route();
    }));
  }

  function roleStorageKey() {
    return `cnmi_eqa_active_role_${state.user?.id || 'anonymous'}`;
  }

  function isSystemAdmin() { return state.roles.includes('admin'); }

  // สิทธิ์บัญชีจริง (state.roles) แยกจากบทบาทที่กำลังทำงาน (state.activeRole)
  // ผู้ดูแลระบบสลับมาใช้บทบาทเจ้าหน้าที่เพื่อทำ Competency ของตนเองได้
  // แต่การสลับบทบาทจะไม่แก้สิทธิ์ในฐานข้อมูล ไม่เปลี่ยนเจ้าของคำตอบ และไม่ใช่โหมด Preview
  function availableViewRoles() {
    const allowed = new Set(normalizedRoles(state.roles));
    if (isSystemAdmin()) allowed.add('staff');
    return ACTING_ROLE_ORDER.filter((role) => allowed.has(role));
  }

  function syncActiveRole() {
    const saved = localStorage.getItem(roleStorageKey());
    const available = availableViewRoles();
    const fallback = isSystemAdmin()
      ? 'admin'
      : (available.includes('staff') ? 'staff' : (ROLE_PRIORITY.find((role) => available.includes(role)) || available[0] || 'staff'));
    state.activeRole = saved && available.includes(saved) ? saved : fallback;
    localStorage.setItem(roleStorageKey(), state.activeRole);
  }

  function hasAssignedRole(...roles) { return roles.some((r) => normalizedRoles(state.roles).includes(r)); }
  // hasRole ใช้ตรวจบทบาทที่ผู้ใช้กำลังทำงานอยู่เท่านั้น
  function hasRole(...roles) { return roles.includes(state.activeRole); }
  function canManage() { return hasRole('admin', 'qm'); }
  function canQualityApprove(roundId = state.currentRound?.id || null) {
    if (hasRole('qm')) return true;
    if (!hasRole('deputy_qm')) return false;
    return Boolean(activeQmDelegation(roundId));
  }
  function canDeleteRound() { return hasRole('admin'); }
  function canReview(roundId = state.currentRound?.id || null) {
    return hasRole('admin', 'qm', 'reviewer') || (hasRole('deputy_qm') && Boolean(activeQmDelegation(roundId)));
  }
  function isPhysician() { return hasRole('physician'); }
  function canReceiveEqa() { return hasRole('staff', 'qm', 'admin'); }
  function canImportHistoricalEqa() { return hasRole('admin', 'qm'); }
  function isHistoricalRound(round) { return round?.round_mode === 'historical_import'; }
  function isCompetencyParticipant() { return hasRole('staff', 'admin') && !hasRole('physician'); }

  function visibleRoutesForActiveRole() {
    const role = state.activeRole || 'staff';
    const routes = {
      admin: ['dashboard','my-competency','rounds','round','assignment','reports','users','audit','automation','settings','help'],
      staff: ['dashboard','my-competency','rounds','round','assignment','help'],
      reviewer: ['dashboard','rounds','round','assignment','reports','help'],
      qm: ['dashboard','rounds','round','assignment','reports','help'],
      deputy_qm: ['dashboard','rounds','round','assignment','reports','help'],
      physician: ['dashboard','rounds','round','reports','help'],
      viewer: ['dashboard','rounds','round','reports','audit','help']
    };
    return routes[role] || routes.staff;
  }

  function canViewRoute(routeName) {
    return visibleRoutesForActiveRole().includes(routeName);
  }

  function defaultRouteForActiveRole() {
    if (state.activeRole === 'staff' && canViewRoute('my-competency') && isCompetencyParticipant()) return 'my-competency';
    return 'dashboard';
  }
  function personHasRole(person, role) { return Array.isArray(person?.roles) && person.roles.includes(role); }
  function normalizedRoles(roles) {
    const result = [...new Set((roles || []).filter(Boolean))];
    if ((result.includes('reviewer') || result.includes('qm') || result.includes('deputy_qm')) && !result.includes('staff')) result.unshift('staff');
    return result;
  }

  function roleOptions(selected = state.activeRole) {
    return availableViewRoles().map((role) => `<option value="${esc(role)}" ${role === selected ? 'selected' : ''}>${esc(ROLE_LABELS[role] || 'บทบาทอื่น')}</option>`).join('');
  }

  function signingRoleText(role) {
    return SIGNING_ROLE_LABELS[role] || ROLE_LABELS[role] || 'ไม่ระบุบทบาท';
  }

  function approvalSignerText(nameText, approval) {
    return `${nameText || '-'} (ลงนามในบทบาท: ${signingRoleText(approval?.acting_role)})`;
  }

  function roleChoices(currentRoles = [], lockedRoles = []) {
    return Object.entries(ROLE_LABELS).map(([role, label]) => {
      const locked = lockedRoles.includes(role);
      const checked = currentRoles.includes(role);
      const dependencyNote = role === 'staff'
        ? ' · จำเป็นสำหรับผู้ทบทวน ผู้จัดการคุณภาพ และรองผู้จัดการคุณภาพ แต่แพทย์ไม่จำเป็นต้องมีบทบาทนี้'
        : (role === 'reviewer' || role === 'qm' || role === 'deputy_qm') ? ' · ระบบจะเพิ่มบทบาทเจ้าหน้าที่ให้อัตโนมัติ' : '';
      const lockedNote = locked ? ' · ล็อกไว้สำหรับบัญชีที่กำลังใช้งาน' : '';
      return `
        <label class="role-choice">
          <input type="checkbox" name="roles" value="${esc(role)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span><strong>${esc(label)}</strong><span>${esc(ROLE_HELP[role] || '')}${dependencyNote}${lockedNote}</span></span>
        </label>`;
    }).join('');
  }

  function bindRoleDependencies(form) {
    const staff = form.querySelector('input[name="roles"][value="staff"]');
    const reviewer = form.querySelector('input[name="roles"][value="reviewer"]');
    const qm = form.querySelector('input[name="roles"][value="qm"]');
    const deputyQm = form.querySelector('input[name="roles"][value="deputy_qm"]');
    const sync = () => {
      const needsStaff = Boolean(reviewer?.checked || qm?.checked || deputyQm?.checked);
      if (needsStaff && staff) staff.checked = true;
      if (staff) staff.disabled = needsStaff;
    };
    reviewer?.addEventListener('change', sync);
    qm?.addEventListener('change', sync);
    deputyQm?.addEventListener('change', sync);
    sync();
  }

    function statusBadge(status) {
    const label = STATUS_LABELS[status] || 'ไม่ทราบสถานะ';
    const cls = ['closed', 'physician_approved', 'official_result_received'].includes(status) ? 'success'
      : ['returned_for_revision', 'cancelled'].includes(status) ? 'danger'
      : ['awaiting_review', 'awaiting_qm_approval', 'awaiting_physician_approval'].includes(status) ? 'warning'
      : 'info';
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function assignmentBadge(status) {
    const map = {
      not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', submitted: 'รอผู้ทบทวน', under_review: 'ผู้ทบทวนผ่านแล้ว รอผู้รับรองคุณภาพ',
      passed: 'ผ่าน', needs_reflection: 'ต้องทบทวน', reflection_submitted: 'ส่งแบบทบทวนแล้ว',
      passed_after_review: 'ผ่านหลังทบทวน', cancelled: 'ยกเลิก'
    };
    const cls = ['passed', 'passed_after_review'].includes(status) ? 'success'
      : ['needs_reflection'].includes(status) ? 'danger'
      : ['submitted', 'under_review', 'reflection_submitted'].includes(status) ? 'warning' : 'info';
    return `<span class="badge ${cls}">${esc(map[status] || 'ไม่ทราบสถานะ')}</span>`;
  }

  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll('button[data-busy-sensitive]').forEach((b) => { b.disabled = value; });
  }

  function toast(message, type = 'info', duration = 4200) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  async function invokeAutomation(body) {
    const { data, error } = await state.supabase.functions.invoke('eqa-automation', { body });
    if (error) {
      let detail = error.message || 'เรียกบริการแจ้งเตือนและ Google Drive ไม่สำเร็จ';
      try {
        const payload = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
        if (payload?.error) detail = payload.error;
      } catch (_) { /* keep original message */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function archiveReportToDrive(options, silent = false) {
    if (!REPORT_ARCHIVE_ENABLED) return null;
    try {
      const result = await invokeAutomation({ action: 'archive_report', ...options });
      if (!silent) toast('สร้าง PDF และเก็บใน Google Drive แล้ว', 'success');
      return result?.archive || null;
    } catch (error) {
      if (!silent) toast(friendlyError(error), 'danger');
      else console.warn('Auto archive failed', error);
      return null;
    }
  }

  function showModal(title, bodyHtml, footerHtml = '', large = false, locked = false) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'modal-backdrop';
    wrap.dataset.locked = locked ? 'true' : 'false';
    wrap.innerHTML = `
      <div class="modal ${large ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header"><h2>${esc(title)}</h2>${locked ? '' : '<button class="close-btn" data-close-modal>×</button>'}</div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      if (!locked && (e.target === wrap || e.target.closest('[data-close-modal]'))) closeModal();
    });
  }

  function closeModal() { document.getElementById('modal-backdrop')?.remove(); }

  function renderSetup() {
    appEl.innerHTML = `
      <div class="login-page">
        <section class="login-visual">
          <div class="brand-mark">CNMI</div>
          <h1>ระบบ EQA และ<br>ประเมินความสามารถ</h1>
          <p>ระบบบริหารผลทดสอบความชำนาญและการประเมินสมรรถนะบุคลากร</p>
        </section>
        <section class="login-card-wrap">
          <div class="login-card">
            <div class="brand-mark">ตั้งค่า</div>
            <h2>ยังไม่ได้เชื่อมฐานข้อมูล</h2>
            <p class="muted">เปิดไฟล์ <strong>js/config.js</strong> แล้วใส่ที่อยู่โครงการและกุญแจสำหรับเชื่อมต่อ ตามคู่มือ</p>
            <div class="notice warning">ห้ามใส่กุญแจลับหรือกุญแจระดับผู้ดูแลระบบไว้ใน GitHub</div>
            <div style="height:16px"></div>
            <a class="btn btn-primary btn-block" href="./docs/01_เริ่มตรงนี้.md">เปิดคู่มือเริ่มต้น</a>
          </div>
        </section>
      </div>`;
  }

  function loginEmailFromInput(input) {
    const v = String(input || '').trim().toLowerCase();
    return v.includes('@') ? v : `${v}@${cfg.MAHIDOL_EMAIL_DOMAIN || 'mahidol.ac.th'}`;
  }

  function renderLogin(message = '') {
    appEl.innerHTML = `
      <div class="login-page">
        <section class="login-visual">
          <div class="brand-mark">CNMI</div>
          <h1>ระบบ EQA และ<br>ประเมินความสามารถ</h1>
          <p>ติดตามการประเมินคุณภาพภายนอกตั้งแต่รับตัวอย่าง บันทึกผล ตรวจอนุมัติ รับผลประเมิน แก้ไขปัญหา และประเมินความสามารถบุคลากรในรอบเดียว</p>
        </section>
        <section class="login-card-wrap">
          <form class="login-card" id="login-form">
            <div class="brand-mark">CNMI</div>
            <h2>เข้าสู่ระบบ</h2>
            <p class="muted">ใช้ชื่อผู้ใช้หรืออีเมลมหิดล</p>
            ${message ? `<div class="notice danger">${esc(message)}</div><div style="height:12px"></div>` : ''}
            <div class="form-grid">
              <div class="field">
                <label for="login-name">ชื่อผู้ใช้หรืออีเมลมหิดล</label>
                <input class="input" id="login-name" name="login" required autocomplete="username" placeholder="ชื่อผู้ใช้ หรือ name@mahidol.ac.th">
              </div>
              <div class="field">
                <label for="login-password">รหัสผ่าน</label>
                <input class="input" id="login-password" name="password" type="password" required autocomplete="current-password" placeholder="รหัสผ่านของคุณ">
              </div>
              <button class="btn btn-primary btn-block" data-busy-sensitive type="submit">เข้าสู่ระบบ</button>
              <div class="notice">
                <strong>การเข้าสู่ระบบครั้งแรก</strong><br>
                รหัสผ่านเริ่มต้นคือ <strong>CNMI@</strong> ตามด้วยรหัสพนักงาน<br>
                หากเปลี่ยนรหัสผ่านแล้วและจำไม่ได้ กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ต
              </div>
            </div>
          </form>
        </section>
      </div>`;

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(true);
      const fd = new FormData(e.currentTarget);
      const email = loginEmailFromInput(fd.get('login'));
      const password = String(fd.get('password') || '');
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return renderLogin('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจชื่อผู้ใช้ อีเมล และรหัสผ่าน');
    });
  }

  async function loadIdentity() {
    const { data: { session } } = await state.supabase.auth.getSession();
    state.session = session;
    state.user = session?.user || null;
    if (!state.user) {
      state.profile = null; state.roles = []; state.activeRole = null;
      return false;
    }

    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] = await Promise.all([
      state.supabase.from('ec_profiles').select('*').eq('id', state.user.id).single(),
      state.supabase.from('ec_user_roles').select('role').eq('profile_id', state.user.id)
    ]);
    if (profileError || rolesError || !profile || profile.active === false) {
      await state.supabase.auth.signOut();
      state.profile = null; state.roles = []; state.activeRole = null;
      return false;
    }
    state.profile = profile;
    state.roles = (roles || []).map((r) => r.role);
    syncActiveRole();
    return true;
  }

  function navItem(route, icon, label, activeRoute) {
    const active = activeRoute === route || (route === 'rounds' && activeRoute.startsWith('round/'));
    return `<button class="nav-btn ${active ? 'active' : ''}" data-nav="${route}" title="${esc(label)}" aria-label="${esc(label)}"><span class="nav-icon">${icon}</span><span>${esc(label)}</span></button>`;
  }

  function currentRoute() {
    const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
    return raw;
  }

  function shell(content, title = '') {
    const route = currentRoute();
    const assignedRoleBadges = state.roles.map((role) => `<span class="badge">${esc(ROLE_LABELS[role] || 'บทบาทอื่น')}</span>`).join('');
    return `
      <div class="app-shell ${desktopSidebarCollapsed() ? 'sidebar-collapsed' : ''}" id="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="brand-mark">CNMI</div>
            <div><strong>EQA และประเมินความสามารถ</strong></div>
          </div>
          <div class="nav-section">งานของฉัน</div>
          ${canViewRoute('dashboard') ? navItem('dashboard', '⌂', 'ภาพรวม', route) : ''}
          ${canViewRoute('my-competency') && isCompetencyParticipant() ? navItem('my-competency', '✓', 'งานของฉัน', route) : ''}
          ${canViewRoute('rounds') ? '<div class="nav-section">งาน EQA</div>' : ''}
          ${canViewRoute('rounds') ? navItem('rounds', '▦', 'รอบ EQA', route) : ''}
          ${canViewRoute('rounds') ? roundSubmenu(route) : ''}
          ${canViewRoute('reports') ? navItem('reports', '▤', 'รายงาน (กำลังปรับปรุง)', route) : ''}
          ${(canViewRoute('users') || canViewRoute('audit') || canViewRoute('automation') || canViewRoute('settings')) ? '<div class="nav-section">การจัดการ</div>' : ''}
          ${canViewRoute('users') ? navItem('users', '♙', 'ผู้ใช้งานและสิทธิ์', route) : ''}
          ${canViewRoute('audit') ? navItem('audit', '◷', 'ประวัติการใช้งาน', route) : ''}
          ${canViewRoute('automation') ? navItem('automation', '◉', 'แจ้งเตือน', route) : ''}
          ${canViewRoute('settings') ? navItem('settings', '⚙', 'ตั้งค่าระบบ', route) : ''}
          <div class="nav-section">ช่วยเหลือ</div>
          ${canViewRoute('help') ? navItem('help', '?', 'คู่มือการใช้งาน', route) : ''}
          <div class="sidebar-footer">
            <div class="user-mini">
              <div class="user-name-row">
                <strong>${esc(state.profile?.full_name)}</strong>
                <span class="badge info">ออนไลน์</span>
              </div>
              <div class="role-switcher">
                <label for="active-role-select">ทำงานในบทบาท</label>
                <select class="role-select" id="active-role-select" data-role-switch ${availableViewRoles().length <= 1 ? 'disabled' : ''}>
                  ${roleOptions()}
                </select>
                <div class="account-role-summary"><span>สิทธิ์บัญชี</span><strong>${esc(normalizedRoles(state.roles).map((role) => ROLE_LABELS[role] || role).join(' · ') || 'ไม่ระบุ')}</strong></div>
              </div>
              <button class="btn btn-outline btn-sm" id="logout-btn">ออกจากระบบ</button>
            </div>
          </div>
        </aside>
        <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
        <main class="main">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <button class="btn btn-outline sidebar-toggle" id="sidebar-toggle" aria-label="ยุบหรือเปิดเมนูด้านข้าง" aria-expanded="${desktopSidebarCollapsed() ? 'false' : 'true'}">☰</button>
              <div style="min-width:0"><strong>${esc(title || 'ระบบ EQA และประเมินความสามารถ')}</strong><div class="small muted">${esc(cfg.ORGANIZATION_NAME || '')}</div></div>
            </div>
            <div class="topbar-user">
              <span class="active-role-badge">กำลังทำงาน: ${esc(ROLE_LABELS[state.activeRole] || 'ไม่ระบุบทบาท')}</span>
              <span class="small topbar-username">${esc(state.profile?.username || '')}</span>
            </div>
          </header>
          ${content}
        </main>
      </div>`;
  }

  function enhanceMobileTables() {
    document.querySelectorAll('.table-wrap > table').forEach((table) => {
      if (table.dataset.mobileEnhanced === '1') return;
      const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!headers.length) return;
      table.querySelectorAll('tbody tr').forEach((row) => {
        [...row.children].forEach((cell, index) => {
          if (!cell.dataset.label) cell.dataset.label = headers[index] || '';
        });
      });
      table.dataset.mobileEnhanced = '1';
    });
  }

  function enhanceMobileSpecimenSelectors() {
    document.querySelectorAll('.provider-specimen-tabs').forEach((tabs, groupIndex) => {
      if (tabs.dataset.mobileSelectEnhanced === '1') return;
      const buttons = [...tabs.querySelectorAll('.provider-specimen-tab')];
      if (buttons.length < 2) return;
      const select = document.createElement('select');
      select.className = 'select provider-mobile-specimen-select';
      select.setAttribute('aria-label', 'เลือกตัวอย่าง');
      buttons.forEach((button, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = button.textContent.trim();
        option.selected = button.classList.contains('active');
        select.appendChild(option);
      });
      select.addEventListener('change', () => buttons[Number(select.value)]?.click());
      buttons.forEach((button, index) => button.addEventListener('click', () => { select.value = String(index); }));
      tabs.parentNode.insertBefore(select, tabs);
      tabs.dataset.mobileSelectEnhanced = '1';
    });
  }

  function enhanceResponsiveUi() {
    enhanceMobileTables();
    enhanceMobileSpecimenSelectors();
  }

  function bindShell() {
    enhanceResponsiveUi();
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const closeSidebar = () => {
      sidebar?.classList.remove('open');
      backdrop?.classList.remove('show');
    };
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await state.supabase.auth.signOut();
    });
    document.getElementById('sidebar-toggle')?.addEventListener('click', (event) => {
      const shellEl = document.getElementById('app-shell');
      if (window.innerWidth <= 900) {
        const isOpen = sidebar?.classList.toggle('open');
        backdrop?.classList.toggle('show', Boolean(isOpen));
        event.currentTarget.setAttribute('aria-expanded', String(Boolean(isOpen)));
        return;
      }
      const collapsed = shellEl?.classList.toggle('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    });
    backdrop?.addEventListener('click', closeSidebar);
    document.querySelectorAll('[data-role-switch]').forEach((select) => select.addEventListener('change', async (event) => {
      const nextRole = String(event.currentTarget.value || '');
      if (!availableViewRoles().includes(nextRole)) return;
      state.activeRole = nextRole;
      localStorage.setItem(roleStorageKey(), nextRole);
      closeSidebar();
      toast(`เปลี่ยนโหมดการทำงานเป็น ${ROLE_LABELS[nextRole] || 'บทบาทที่เลือก'} แล้ว`, 'success');
      const routeName = currentRoute().split('/')[0] || 'dashboard';
      if (!canViewRoute(routeName)) navigate(defaultRouteForActiveRole());
      else await route();
    }));
  }

  function navigate(route) {
    location.hash = `#/${route}`;
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-backdrop')?.classList.remove('show');
  }

  async function renderForcePassword() {
    appEl.innerHTML = `
      <div class="login-page">
        <section class="login-visual">
          <div class="brand-mark">CNMI</div><h1>ตั้งรหัสผ่านใหม่</h1>
          <p>รหัสเริ่มต้นใช้ได้เฉพาะครั้งแรกหรือหลังผู้ดูแลระบบรีเซ็ต</p>
        </section>
        <section class="login-card-wrap">
          <form class="login-card" id="force-password-form">
            <div class="brand-mark">รหัส</div>
            <h2>กรุณาเปลี่ยนรหัสผ่าน</h2>
            <div class="notice warning">รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร ไม่บังคับรูปแบบอื่น</div>
            <div style="height:14px"></div>
            <div class="form-grid">
              <div class="field"><label>รหัสผ่านใหม่</label><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
              <div class="field"><label>ยืนยันรหัสผ่านใหม่</label><input class="input" name="confirm" type="password" minlength="8" required autocomplete="new-password"></div>
              <button class="btn btn-primary btn-block" data-busy-sensitive>บันทึกรหัสผ่านใหม่</button>
              <button type="button" class="btn btn-outline btn-block" id="force-logout">ออกจากระบบ</button>
            </div>
          </form>
        </section>
      </div>`;
    document.getElementById('force-logout').addEventListener('click', () => state.supabase.auth.signOut());
    document.getElementById('force-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const password = String(fd.get('password') || '');
      const confirm = String(fd.get('confirm') || '');
      if (password.length < 8) return toast('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 'danger');
      if (password !== confirm) return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'danger');
      setBusy(true);
      const { error } = await state.supabase.auth.updateUser({ password });
      if (!error) {
        const { error: rpcError } = await state.supabase.rpc('ec_complete_password_change');
        if (rpcError) toast(friendlyError(rpcError), 'danger');
      }
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      state.profile.must_change_password = false;
      toast('เปลี่ยนรหัสผ่านเรียบร้อย', 'success');
      navigate('dashboard');
      await route();
    });
  }

  async function loadRounds() {
    const { data, error } = await state.supabase.from('ec_eqa_rounds').select('*').order('survey_year', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    state.rounds = data || [];
    return state.rounds;
  }

  async function loadDirectory() {
    let result = await state.supabase.rpc('ec_get_user_directory_with_roles');
    if (result.error) {
      result = await state.supabase.rpc('ec_get_staff_directory');
      if (result.error) throw result.error;
      state.directory = (result.data || []).map((person) => ({ ...person, roles: [] }));
    } else {
      state.directory = result.data || [];
    }
    return state.directory;
  }


  async function loadQmDelegations() {
    const { data, error } = await state.supabase
      .from('ec_qm_delegations')
      .select('*')
      .order('starts_at', { ascending: false });
    if (error) throw error;
    state.qmDelegations = data || [];
    return state.qmDelegations;
  }

  function delegationActiveAt(row, at = new Date()) {
    if (!row || row.status !== 'active') return false;
    const now = at.getTime();
    return new Date(row.starts_at).getTime() <= now && now <= new Date(row.ends_at).getTime();
  }

  function activeQmDelegation(roundId = null, userId = state.user?.id) {
    return (state.qmDelegations || []).find((row) =>
      row.deputy_qm_id === userId
      && delegationActiveAt(row)
      && (!row.round_id || row.round_id === roundId)
    ) || null;
  }

  function qualityApproverCandidates(directory, roundId = null, currentAssignedId = '') {
    return (directory || []).filter((person) => {
      if (personHasRole(person, 'qm')) return true;
      if (!personHasRole(person, 'deputy_qm')) return false;
      if (person.id === currentAssignedId) return true;
      return Boolean((state.qmDelegations || []).find((row) =>
        row.deputy_qm_id === person.id
        && row.status === 'active'
        && new Date(row.ends_at).getTime() >= Date.now()
        && (!row.round_id || row.round_id === roundId)
      ));
    });
  }

  function delegationScopeText(row, rounds = state.rounds || []) {
    if (!row?.round_id) return 'ทุกรอบในช่วงเวลาที่กำหนด';
    const round = rounds.find((item) => item.id === row.round_id);
    return round ? `${round.provider} ${round.round_code}` : 'เฉพาะรอบที่กำหนด';
  }

  function renderQmDelegationCard(rounds, directory) {
    if (!hasRole('qm', 'deputy_qm', 'admin')) return '';
    const currentOrScheduled = (state.qmDelegations || []).filter((row) => row.status === 'active' && new Date(row.ends_at).getTime() >= Date.now());
    const name = (id) => directory.find((person) => person.id === id)?.full_name || '-';
    const own = hasRole('deputy_qm') ? currentOrScheduled.find((row) => row.deputy_qm_id === state.user.id) : null;
    const activeRows = hasRole('deputy_qm') ? (own ? [own] : []) : currentOrScheduled;
    return `<div class="card qm-delegation-card">
      <div class="card-header"><div><h2>การมอบหมายผู้จัดการคุณภาพ</h2><div class="small muted">รองผู้จัดการคุณภาพทำหน้าที่แทนได้เฉพาะช่วงที่เปิดมอบหมาย และสิทธิ์จะสิ้นสุดอัตโนมัติเมื่อครบกำหนด</div></div>${hasRole('qm','admin') ? '<button class="btn btn-primary btn-sm" id="open-qm-delegation">มอบหมายผู้ทำหน้าที่แทน</button>' : ''}</div>
      ${activeRows.length ? `<div class="timeline">${activeRows.map((row) => `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(name(row.deputy_qm_id))}</strong><br><span class="small">${esc(delegationScopeText(row, rounds))}</span><br><span class="badge ${delegationActiveAt(row) ? 'success' : 'info'}">${delegationActiveAt(row) ? 'กำลังทำหน้าที่แทน' : 'กำหนดไว้ล่วงหน้า'}</span><br><span class="small muted">${fmtDate(row.starts_at, true)} ถึง ${fmtDate(row.ends_at, true)} · ${esc(row.reason || '-')}</span>${hasRole('qm','admin') ? `<div style="margin-top:8px"><button class="btn btn-outline btn-sm" data-cancel-qm-delegation="${row.id}">ยุติก่อนกำหนด</button></div>` : ''}</div></div>`).join('')}</div>` : `<div class="notice ${hasRole('deputy_qm') ? 'warning' : 'info'}">${hasRole('deputy_qm') ? 'ขณะนี้ยังไม่มีการมอบหมายให้ทำหน้าที่แทนผู้จัดการคุณภาพ จึงเปิดดูได้แต่ยังรับรองผลไม่ได้' : 'ขณะนี้ไม่มีการมอบหมายผู้ทำหน้าที่แทน'}</div>`}
    </div>`;
  }

  async function openQmDelegationModal() {
    if (!hasRole('qm','admin')) return toast('เฉพาะผู้จัดการคุณภาพหรือผู้ดูแลระบบเท่านั้นที่เปิดการมอบหมายได้', 'warning');
    const [directory, rounds] = await Promise.all([loadDirectory(), loadRounds()]);
    const deputies = directory.filter((person) => personHasRole(person, 'deputy_qm'));
    if (!deputies.length) return toast('ยังไม่มีผู้ใช้ที่ได้รับบทบาทรองผู้จัดการคุณภาพ', 'warning');
    const now = new Date();
    const start = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const end = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    const personOptions = deputies.map((person) => `<option value="${person.id}">${esc(person.full_name)}${person.position_title ? ` — ${esc(person.position_title)}` : ''}</option>`).join('');
    const roundOptions = (rounds || []).filter((round) => !['closed','cancelled'].includes(round.status)).map((round) => `<option value="${round.id}">${esc(round.provider)} ${esc(round.round_code)}</option>`).join('');
    showModal('มอบหมายผู้ทำหน้าที่แทนผู้จัดการคุณภาพ', `<form id="qm-delegation-form" class="form-grid cols-2">
      <div class="notice" style="grid-column:1/-1"><strong>สิทธิ์ชั่วคราว</strong><br><span class="small">รองผู้จัดการคุณภาพจะเห็นและรับรองงานในขอบเขตที่กำหนดเท่านั้น เมื่อครบกำหนดระบบปิดสิทธิ์ให้อัตโนมัติ</span></div>
      <div class="field" style="grid-column:1/-1"><label>รองผู้จัดการคุณภาพ</label><select class="select" name="deputy_qm_id" required>${personOptions}</select></div>
      <div class="field"><label>เริ่มทำหน้าที่แทน</label><input class="input" type="datetime-local" name="starts_at" required value="${start}"></div>
      <div class="field"><label>สิ้นสุด</label><input class="input" type="datetime-local" name="ends_at" required value="${end}"></div>
      <div class="field" style="grid-column:1/-1"><label>ขอบเขต</label><select class="select" name="round_id"><option value="">ทุกรอบในช่วงเวลาที่กำหนด</option>${roundOptions}</select></div>
      <div class="field" style="grid-column:1/-1"><label>เหตุผล</label><textarea class="textarea" name="reason" required placeholder="เช่น ผู้จัดการคุณภาพไปประชุมต่างประเทศ วันที่... ถึงวันที่..."></textarea></div>
    </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-qm-delegation">บันทึกการมอบหมาย</button>`);
    document.getElementById('save-qm-delegation')?.addEventListener('click', async () => {
      const form = document.getElementById('qm-delegation-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const startValue = String(fd.get('starts_at') || '');
      const endValue = String(fd.get('ends_at') || '');
      const reason = String(fd.get('reason') || '').trim();
      if (new Date(endValue).getTime() <= new Date(startValue).getTime()) return toast('วันเวลาสิ้นสุดต้องอยู่หลังวันเวลาเริ่ม', 'warning');
      setBusy(true);
      const { error } = await state.supabase.rpc('ec_create_qm_delegation_v260', {
        p_deputy_qm_id: String(fd.get('deputy_qm_id') || ''),
        p_starts_at: new Date(startValue).toISOString(),
        p_ends_at: new Date(endValue).toISOString(),
        p_reason: reason,
        p_round_id: String(fd.get('round_id') || '') || null
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal();
      toast('เปิดการมอบหมายผู้ทำหน้าที่แทนแล้ว', 'success');
      route();
    });
  }

  async function cancelQmDelegation(id) {
    const reason = prompt('ระบุเหตุผลที่ยุติการมอบหมายก่อนกำหนด');
    if (reason === null) return;
    if (!reason.trim()) return toast('กรุณาระบุเหตุผล', 'warning');
    const { error } = await state.supabase.rpc('ec_cancel_qm_delegation_v260', { p_delegation_id: id, p_reason: reason.trim() });
    if (error) return toast(friendlyError(error), 'danger');
    toast('ยุติการมอบหมายแล้ว', 'success');
    route();
  }

    async function renderDashboard() {
    const [roundsRes, assignmentRes, directory] = await Promise.all([
      state.supabase.from('ec_eqa_rounds').select('*').order('created_at', { ascending: false }).limit(8),
      state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(round_code,provider)').eq('user_id', state.user.id).order('created_at', { ascending: false }),
      loadDirectory(),
      loadQmDelegations()
    ]);
    const rounds = roundsRes.data || [];
    const assignments = assignmentRes.data || [];
    const openRounds = rounds.filter((r) => !['closed', 'cancelled'].includes(r.status)).length;
    const pendingCompetency = assignments.filter((a) => !['passed', 'passed_after_review', 'cancelled'].includes(a.status)).length;

    const content = `
      <section class="page">
        <div class="page-header">
          <div><h1>ภาพรวม</h1><p>ยินดีต้อนรับ ${esc(state.profile.full_name)}</p></div>
          <div class="header-actions">
            ${canReceiveEqa() ? `<button class="btn btn-primary" id="receive-eqa-btn">＋ รับ EQA ใหม่เข้าระบบ</button>` : ''}
            ${canImportHistoricalEqa() ? `<button class="btn btn-secondary" id="historical-eqa-btn">＋ นำเข้ารอบที่ส่งผลแล้ว</button>` : ''}
            ${canManage() ? `<button class="btn btn-outline" id="new-round-btn">สร้างรอบล่วงหน้า</button>` : ''}
          </div>
        </div>
        <div class="grid cols-4">
          <div class="card stat-card"><div><div class="stat-value">${rounds.length}</div><div class="stat-label">รอบล่าสุด</div></div><div class="stat-icon">▦</div></div>
          <div class="card stat-card"><div><div class="stat-value">${openRounds}</div><div class="stat-label">รอบที่ยังไม่ปิด</div></div><div class="stat-icon">◷</div></div>
          ${isCompetencyParticipant() ? `<div class="card stat-card"><div><div class="stat-value">${assignments.length}</div><div class="stat-label">การประเมินของฉัน</div></div><div class="stat-icon">✓</div></div>
          <div class="card stat-card"><div><div class="stat-value">${pendingCompetency}</div><div class="stat-label">รายการที่ต้องดำเนินการ</div></div><div class="stat-icon">!</div></div>` : `<div class="card stat-card"><div><div class="stat-value">${openRounds}</div><div class="stat-label">รอบที่รอการรับรอง</div></div><div class="stat-icon">✓</div></div>
          <div class="card stat-card"><div><div class="stat-value">0</div><div class="stat-label">แบบทดสอบที่ต้องทำ</div></div><div class="stat-icon">–</div></div>`}
        </div>
        ${renderQmDelegationCard(rounds, directory)}
        <div style="height:18px"></div>
        <div class="grid cols-2">
          <div class="card">
            <div class="card-header"><h2>รอบ EQA ล่าสุด</h2><button class="btn btn-outline btn-sm" data-nav-inline="rounds">ดูทั้งหมด</button></div>
            ${rounds.length ? `<div class="timeline">${rounds.map((r) => `
              <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content">
                <button class="btn btn-outline btn-sm" style="float:right" data-open-round="${r.id}">เปิด</button>
                <strong>${esc(r.provider)} ${esc(r.round_code)}</strong><br>
                ${isHistoricalRound(r) ? '<span class="badge info">ข้อมูลย้อนหลัง</span> ' : ''}${statusBadge(r.status)} <span class="small muted">ครบกำหนด ${fmtDate(r.due_date)}</span>
              </div></div>`).join('')}</div>` : empty('ยังไม่มีรอบ EQA')}
          </div>
          <div class="card">
            <div class="card-header"><h2>${isCompetencyParticipant() ? 'การประเมินของฉัน' : hasRole('physician') ? 'งานแพทย์ผู้รับทราบ' : hasRole('reviewer') ? 'งานทบทวนผล' : 'งานรับรองคุณภาพ'}</h2>${isCompetencyParticipant() ? `<button class="btn btn-outline btn-sm" data-nav-inline="my-competency">ดูทั้งหมด</button>` : ''}</div>
            ${isCompetencyParticipant() ? (assignments.length ? assignments.slice(0, 6).map((a) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
              <strong>${esc(a.ec_eqa_rounds?.provider || '')} ${esc(a.ec_eqa_rounds?.round_code || '')}</strong>
              <span style="float:right">${a.correction_required ? '<span class="badge danger">ส่งกลับแก้ไข</span>' : assignmentBadge(a.status)}</span>
            </div>`).join('') : empty('ยังไม่มีการประเมินที่ได้รับมอบหมาย')) : hasRole('physician') ? `<div class="notice">แพทย์ผู้รับรองทั้งสองคนมีสิทธิ์เท่าเทียมกัน คนใดคนหนึ่งตรวจและกดรับทราบต่อรอบได้ ระบบจะบันทึกชื่อและวันเวลาของผู้ที่ดำเนินการจริง</div>` : hasRole('deputy_qm') ? `<div class="notice">เปิดรอบที่ได้รับมอบหมายเพื่อตรวจงานได้ ปุ่มรับรองจะแสดงเฉพาะเมื่ออยู่ในช่วงที่ผู้จัดการคุณภาพเปิดให้ทำหน้าที่แทน</div>` : `<div class="notice">เปิดรอบที่เกี่ยวข้องเพื่อดำเนินงานตามบทบาทและลำดับที่ได้รับมอบหมาย</div>`}
          </div>
        </div>
      </section>`;
    appEl.innerHTML = shell(content, 'ภาพรวม');
    bindShell();
    document.querySelectorAll('[data-nav-inline]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.navInline)));
    document.querySelectorAll('[data-open-round]').forEach((b) => b.addEventListener('click', () => navigate(`round/${b.dataset.openRound}/overview`)));
    document.getElementById('new-round-btn')?.addEventListener('click', openRoundModal);
    document.getElementById('receive-eqa-btn')?.addEventListener('click', () => openReceiveEqaModal());
    document.getElementById('historical-eqa-btn')?.addEventListener('click', () => openHistoricalRoundModal());
    document.getElementById('open-qm-delegation')?.addEventListener('click', openQmDelegationModal);
    document.querySelectorAll('[data-cancel-qm-delegation]').forEach((button) => button.addEventListener('click', () => cancelQmDelegation(button.dataset.cancelQmDelegation)));
  }

  function empty(text) { return `<div class="empty-state"><div class="empty-icon">○</div>${esc(text)}</div>`; }

  function openRoundModal(round = null) {
    const editable = canManage();
    if (!editable) return toast('ไม่มีสิทธิ์สร้างหรือแก้ไขรอบ', 'danger');
    showModal(round ? 'แก้ไขข้อมูลรอบ EQA' : 'สร้างรอบ EQA', `
      <form id="round-form" class="form-grid cols-2">
        <input type="hidden" name="id" value="${esc(round?.id || '')}">
        <div class="field"><label>ผู้ให้บริการ</label><input class="input" name="provider" required value="${esc(round?.provider || 'CAP')}"></div>
        <div class="field"><label>ชื่อโปรแกรม</label><input class="input" name="program_name" required value="${esc(round?.program_name || 'Comprehensive Transfusion Medicine')}"></div>
        <div class="field"><label>รหัสโปรแกรม</label><input class="input" name="program_code" value="${esc(round?.program_code || 'J')}"></div>
        <div class="field"><label>ชื่อรอบ</label><input class="input" name="round_code" required value="${esc(round?.round_code || 'J-B 2026')}"></div>
        <div class="field"><label>เลขชุดตัวอย่าง</label><input class="input" name="kit_number" value="${esc(round?.kit_number || '')}"></div>
        <div class="field"><label>ปี ค.ศ.</label><input class="input" type="number" name="survey_year" required min="2000" max="2200" value="${esc(round?.survey_year || new Date().getFullYear())}"></div>
        <div class="field"><label>วันรับตัวอย่าง</label><input class="input" type="datetime-local" name="received_at" value="${round?.received_at ? new Date(round.received_at).toISOString().slice(0,16) : ''}"></div>
        <div class="field"><label>อุณหภูมิตอนรับ (°C)</label><input class="input" type="number" step="0.1" name="received_temperature" value="${esc(round?.received_temperature || '')}"></div>
        <div class="field"><label>วันครบกำหนดส่ง</label><input class="input" type="date" name="due_date" value="${fmtDateInput(round?.due_date)}"></div>
        <div class="field"><label>เลขเอกสาร</label><input class="input" name="document_number" value="${esc(round?.document_number || '')}"></div>
        <div class="field" style="grid-column:1/-1"><label>หมายเหตุ</label><textarea class="textarea" name="notes">${esc(round?.notes || '')}</textarea></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-round">บันทึก</button>`);
    document.getElementById('save-round').addEventListener('click', async () => {
      const form = document.getElementById('round-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const id = String(fd.get('id') || '');
      const payload = {
        provider: String(fd.get('provider')).trim(), program_name: String(fd.get('program_name')).trim(),
        program_code: String(fd.get('program_code')).trim() || null, round_code: String(fd.get('round_code')).trim(),
        kit_number: String(fd.get('kit_number')).trim() || null, survey_year: Number(fd.get('survey_year')),
        received_at: fd.get('received_at') ? new Date(String(fd.get('received_at'))).toISOString() : null,
        received_temperature: fd.get('received_temperature') ? Number(fd.get('received_temperature')) : null,
        due_date: fd.get('due_date') || null, document_number: String(fd.get('document_number')).trim() || null,
        notes: String(fd.get('notes')).trim() || null, updated_by: state.user.id
      };
      let result;
      if (id) result = await state.supabase.from('ec_eqa_rounds').update(payload).eq('id', id).select().single();
      else result = await state.supabase.from('ec_eqa_rounds').insert({ ...payload, created_by: state.user.id }).select().single();
      if (result.error) return toast(friendlyError(result.error), 'danger');
      closeModal(); toast('บันทึกรอบ EQA แล้ว', 'success');
      navigate(`round/${result.data.id}/overview`);
    });
  }

  function receiptPayloadFromForm(form) {
    const fd = new FormData(form);
    return {
      provider: String(fd.get('provider') || '').trim(),
      program_name: String(fd.get('program_name') || '').trim(),
      program_code: String(fd.get('program_code') || '').trim() || null,
      round_code: String(fd.get('round_code') || '').trim(),
      kit_number: String(fd.get('kit_number') || '').trim() || null,
      survey_year: Number(fd.get('survey_year')),
      received_at: fd.get('received_at') ? new Date(String(fd.get('received_at'))).toISOString() : new Date().toISOString(),
      received_temperature: fd.get('received_temperature') !== '' ? Number(fd.get('received_temperature')) : null,
      due_date: fd.get('due_date') || null,
      notes: String(fd.get('notes') || '').trim() || null
    };
  }

  function openReceiveEqaModal(round = null) {
    if (!canReceiveEqa()) return toast('กรุณาเลือกโหมดเจ้าหน้าที่ ผู้จัดการคุณภาพ หรือผู้ดูแลระบบ', 'warning');
    const editing = Boolean(round?.id);
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
    showModal(editing ? 'บันทึกหรือแก้ไขข้อมูลการรับ EQA' : 'รับ EQA เข้าระบบ', `
      <form id="receive-eqa-form" class="form-grid cols-2">
        <div class="notice" style="grid-column:1/-1"><strong>ผู้บันทึกการรับ:</strong> ${esc(state.profile.full_name)}<br><span class="small">ระบบบันทึกชื่อผู้รับและวันเวลาให้อัตโนมัติ</span></div>
        <div class="field"><label>ผู้ให้บริการ</label><input class="input" name="provider" required value="${esc(round?.provider || 'CAP')}"></div>
        <div class="field"><label>ชื่อโปรแกรม</label><input class="input" name="program_name" required value="${esc(round?.program_name || 'Comprehensive Transfusion Medicine')}"></div>
        <div class="field"><label>รหัสโปรแกรม</label><input class="input" name="program_code" value="${esc(round?.program_code || 'J')}"></div>
        <div class="field"><label>ชื่อรอบ</label><input class="input" name="round_code" required value="${esc(round?.round_code || '')}" placeholder="เช่น J-B 2026"></div>
        <div class="field"><label>เลขชุดตัวอย่าง</label><input class="input" name="kit_number" value="${esc(round?.kit_number || '')}"></div>
        <div class="field"><label>ปี ค.ศ.</label><input class="input" type="number" name="survey_year" required min="2000" max="2200" value="${esc(round?.survey_year || new Date().getFullYear())}"></div>
        <div class="field"><label>วันและเวลาที่รับ</label><input class="input" type="datetime-local" name="received_at" required value="${round?.received_at ? new Date(new Date(round.received_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16) : nowLocal}"></div>
        <div class="field"><label>อุณหภูมิตอนรับ (°C)</label><input class="input" type="number" step="0.1" name="received_temperature" value="${esc(round?.received_temperature ?? '')}"></div>
        <div class="field"><label>วันครบกำหนดส่ง</label><input class="input" type="date" name="due_date" value="${fmtDateInput(round?.due_date)}"></div>
        <div class="field" style="grid-column:1/-1"><label>หมายเหตุการรับ</label><textarea class="textarea" name="notes">${esc(round?.notes || '')}</textarea></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-receipt">บันทึกการรับ EQA</button>`, true);
    document.getElementById('save-receipt').addEventListener('click', async () => {
      const form = document.getElementById('receive-eqa-form');
      if (!form.reportValidity()) return;
      const payload = receiptPayloadFromForm(form);
      setBusy(true);
      const { data, error } = await state.supabase.rpc('ec_record_eqa_receipt', { p_payload: payload, p_round_id: round?.id || null });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal();
      toast('บันทึกการรับ EQA แล้ว', 'success');
      navigate(`round/${data}/overview`);
    });
  }

  async function openHistoricalRoundModal(round = null) {
    if (!canImportHistoricalEqa()) return toast('กรุณาเลือกโหมดผู้ดูแลระบบหรือผู้จัดการคุณภาพ', 'warning');
    let directory;
    try { [directory] = await Promise.all([loadDirectory(), loadQmDelegations()]); } catch (error) { return toast(friendlyError(error), 'danger'); }

    const [{ data: currentAssignments }, resultCount] = round?.id
      ? await Promise.all([
          state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
          state.supabase.from('ec_individual_results').select('id', { count: 'exact', head: true }).eq('round_id', round.id)
        ])
      : [{ data: [] }, { count: 0 }];

    const assigned = currentAssignments || [];
    const practitionersLocked = Boolean(resultCount.count);
    const findAssignment = (role, slot = null) => assigned.find((a) => a.assignment_role === role && (slot ? a.practitioner_slot === slot : true)) || null;
    const findAssigned = (role, slot = null) => findAssignment(role, slot)?.user_id || '';
    const practitioners = directory.filter((person) => personHasRole(person, 'staff') && !personHasRole(person, 'physician'));
    const reviewers = directory.filter((person) => personHasRole(person, 'reviewer'));
    const qualityApprovers = qualityApproverCandidates(directory, round?.id || null, findAssigned('quality_approver'));
    const physicians = directory.filter((person) => personHasRole(person, 'physician'));
    const people = directory.filter((person) => person.active !== false && personHasRole(person, 'staff') && !personHasRole(person, 'physician'));
    const options = (rows, selected, blank = 'กรุณาเลือก') => `<option value="">${blank}</option>${rows.map((person) => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${esc(person.full_name)}${person.position_title ? ` — ${esc(person.position_title)}` : ''}</option>`).join('')}`;
    const defaultYear = round?.survey_year || new Date().getFullYear();
    const convertingExistingRound = Boolean(round?.id && !isHistoricalRound(round));

    showModal(convertingExistingRound ? 'เปลี่ยนรอบนี้เป็นข้อมูลย้อนหลัง' : (round ? 'แก้ไขข้อมูลรอบที่ดำเนินการแล้ว' : 'นำเข้ารอบ EQA ที่ดำเนินการแล้ว'), `
      <form id="historical-round-form" class="form-grid cols-2">
        <div class="notice" style="grid-column:1/-1"><strong>${convertingExistingRound ? 'กำลังเปลี่ยนรอบที่มีอยู่ให้เป็นข้อมูลย้อนหลัง' : 'ใช้สำหรับ EQA ที่ห้องปฏิบัติการตรวจและส่งผลไปแล้ว'}</strong><br><span class="small">กรอกตามหลักฐานเดิม ระบบเก็บ “วันเวลาเหตุการณ์จริง” แยกจากวันเวลาที่นำข้อมูลเข้าระบบ เพื่อรักษา Audit trail${convertingExistingRound ? ' เอกสารที่อัปโหลดไว้จะยังอยู่เหมือนเดิม' : ''}</span></div>
        <div class="field"><label>ผู้ให้บริการ</label><input class="input" name="provider" required value="${esc(round?.provider || 'CAP')}"></div>
        <div class="field"><label>ชื่อโปรแกรม</label><input class="input" name="program_name" required value="${esc(round?.program_name || 'Comprehensive Transfusion Medicine')}"></div>
        <div class="field"><label>รหัสโปรแกรม</label><input class="input" name="program_code" value="${esc(round?.program_code || 'J')}"></div>
        <div class="field"><label>ชื่อรอบ</label><input class="input" name="round_code" required value="${esc(round?.round_code || '')}" placeholder="เช่น J/JE-A 2026"></div>
        <div class="field"><label>เลขชุดตัวอย่าง</label><input class="input" name="kit_number" value="${esc(round?.kit_number || '')}"></div>
        <div class="field"><label>ปี ค.ศ.</label><input class="input" type="number" name="survey_year" min="2000" max="2200" required value="${esc(defaultYear)}"></div>
        <div class="field"><label>วันและเวลาที่รับจริง</label><input class="input" type="datetime-local" name="received_at" value="${fmtDateTimeInput(round?.received_at)}"></div>
        <div class="field"><label>เจ้าหน้าที่ผู้รับจริง</label><select class="select" name="receiver_id">${options(people, round?.receiver_id || '', 'ไม่ทราบหรือไม่มีหลักฐาน')}</select></div>
        <div class="field"><label>อุณหภูมิตอนรับ (°C)</label><input class="input" type="number" step="0.1" name="received_temperature" value="${esc(round?.received_temperature ?? '')}"></div>
        <div class="field"><label>วันครบกำหนดส่ง</label><input class="input" type="date" name="due_date" value="${fmtDateInput(round?.due_date)}"></div>
        <div class="field"><label>วันที่และเวลาที่ส่งผลจริง</label><input class="input" type="datetime-local" name="actual_submitted_at" required value="${fmtDateTimeInput(round?.actual_submitted_at)}"></div>
        <div class="field"><label>เจ้าหน้าที่ผู้ส่งผลจริง</label><select class="select" name="actual_submitted_by">${options(people, round?.actual_submitted_by || '', 'ไม่ทราบหรือไม่มีหลักฐาน')}</select></div>
        <div class="field"><label>เลขอ้างอิงการส่งผล</label><input class="input" name="actual_provider_reference" value="${esc(round?.actual_provider_reference || '')}"></div>
        <div class="field"><label>ระยะปัจจุบันของรอบ</label><select class="select" name="status"><option value="submitted_to_provider" ${round?.status === 'submitted_to_provider' ? 'selected' : ''}>ส่งผลให้ผู้ให้บริการแล้ว</option><option value="official_result_received" ${round?.status === 'official_result_received' ? 'selected' : ''}>ได้รับผลประเมินกลับแล้ว</option></select></div>

        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 1</label><select class="select" name="p1" required ${practitionersLocked ? 'disabled' : ''}>${options(practitioners, findAssigned('practitioner', 1))}</select>${practitionersLocked ? '<div class="help">ล็อกแล้ว เพราะมีการกรอกผลย้อนหลัง</div>' : ''}</div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 2</label><select class="select" name="p2" required ${practitionersLocked ? 'disabled' : ''}>${options(practitioners, findAssigned('practitioner', 2))}</select>${practitionersLocked ? '<div class="help">ล็อกแล้ว เพราะมีการกรอกผลย้อนหลัง</div>' : ''}</div>
        <div class="field"><label>ผู้ทบทวนผล</label><select class="select" name="reviewer" required>${options(reviewers, findAssigned('reviewer'))}</select><div class="help">ต้องไม่ใช่ผู้ปฏิบัติจริงของรอบนี้</div></div>
        <div class="field"><label>ผู้รับรองคุณภาพ</label><select class="select" name="quality_approver" required>${options(qualityApprovers, findAssigned('quality_approver'))}</select><div class="help">ผู้จัดการคุณภาพรับรองได้ตามปกติ ส่วนรองผู้จัดการคุณภาพจะแสดงเมื่อมีช่วงมอบหมายที่ใช้งานอยู่</div></div>
        <div class="field" style="grid-column:1/-1"><label>แพทย์ผู้รับทราบตามหลักฐานเดิม</label><select class="select" name="physician">${options(physicians, findAssigned('physician'), 'ยังไม่ระบุ')}</select><div class="help">ใช้เฉพาะข้อมูลย้อนหลัง เพื่อบันทึกว่าแพทย์คนใดรับทราบจริงในเอกสารเดิม</div></div>

        <div class="historical-action-section" style="grid-column:1/-1">
          <h3>วันเวลาเหตุการณ์จริงตามเอกสารเดิม</h3>
          <p class="small muted">เว้นว่างได้หากขั้นตอนนั้นยังไม่เกิดขึ้น กรณีเอกสารมีเฉพาะวันที่ให้เลือก “ไม่ทราบเวลาที่แน่นอน”</p>
          ${historicalActionFields('reviewer_action', 'ผู้ทบทวนตรวจผลจริง', findAssignment('reviewer'))}
          ${historicalActionFields('quality_action', 'ผู้รับรองคุณภาพรับรองจริง', findAssignment('quality_approver'))}
          ${historicalActionFields('physician_action', 'แพทย์รับทราบจริง', findAssignment('physician'))}
        </div>

        <div class="field"><label>เลขเอกสาร</label><input class="input" name="document_number" value="${esc(round?.document_number || '')}"></div>
        <div class="field"><label>ผู้บันทึกข้อมูลเข้าระบบ</label><input class="input" value="${esc(state.profile.full_name)}" disabled><div class="help">ระบบบันทึกชื่อและเวลาปัจจุบันอัตโนมัติ ไม่ใช้แทนชื่อผู้ปฏิบัติจริง</div></div>
        <div class="field" style="grid-column:1/-1"><label>แหล่งข้อมูล/หลักฐานที่ใช้กรอกย้อนหลัง</label><textarea class="textarea" name="historical_source_note" required placeholder="เช่น แบบบันทึกผลเดิม สำเนาผลที่ส่ง CAP และภาพหน้าจอหลักฐานการส่ง">${esc(round?.historical_source_note || '')}</textarea></div>
        <div class="field" style="grid-column:1/-1"><label>หมายเหตุเพิ่มเติม</label><textarea class="textarea" name="notes">${esc(round?.notes || '')}</textarea></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-historical-round">${convertingExistingRound ? 'เปลี่ยนเป็นข้อมูลย้อนหลังและไปกรอกผล' : 'บันทึกและไปกรอกผลย้อนหลัง'}</button>`, true);

    bindHistoricalTimeControls(document.getElementById('historical-round-form'));

    document.getElementById('save-historical-round').addEventListener('click', async () => {
      const form = document.getElementById('historical-round-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const p1 = String(fd.get('p1') || findAssigned('practitioner', 1) || '');
      const p2 = String(fd.get('p2') || findAssigned('practitioner', 2) || '');
      const reviewer = String(fd.get('reviewer') || '');
      const qualityApprover = String(fd.get('quality_approver') || '');
      const physician = String(fd.get('physician') || '') || null;
      if (p1 === p2) return toast('ผู้ปฏิบัติจริงทั้งสองคนต้องเป็นคนละคน', 'warning');
      if ([p1, p2].includes(reviewer)) return toast('ผู้ทบทวนต้องเป็นคนละคนกับผู้ปฏิบัติจริง', 'warning');
      if ([p1, p2, reviewer].includes(qualityApprover)) return toast('ผู้รับรองคุณภาพต้องเป็นคนละคนกับผู้ปฏิบัติจริงและผู้ทบทวน', 'warning');

      const payload = {
        provider: String(fd.get('provider') || '').trim(),
        program_name: String(fd.get('program_name') || '').trim(),
        program_code: String(fd.get('program_code') || '').trim() || null,
        round_code: String(fd.get('round_code') || '').trim(),
        kit_number: String(fd.get('kit_number') || '').trim() || null,
        survey_year: Number(fd.get('survey_year')),
        received_at: fd.get('received_at') ? new Date(String(fd.get('received_at'))).toISOString() : null,
        receiver_id: String(fd.get('receiver_id') || '') || null,
        received_temperature: fd.get('received_temperature') !== '' ? Number(fd.get('received_temperature')) : null,
        due_date: fd.get('due_date') || null,
        actual_submitted_at: new Date(String(fd.get('actual_submitted_at'))).toISOString(),
        actual_submitted_by: String(fd.get('actual_submitted_by') || '') || null,
        actual_provider_reference: String(fd.get('actual_provider_reference') || '').trim() || null,
        status: String(fd.get('status')),
        document_number: String(fd.get('document_number') || '').trim() || null,
        historical_source_note: String(fd.get('historical_source_note') || '').trim(),
        notes: String(fd.get('notes') || '').trim() || null
      };

      const actionMeta = {
        reviewer: readHistoricalActionMeta(form, 'reviewer_action'),
        quality_approver: readHistoricalActionMeta(form, 'quality_action'),
        physician: readHistoricalActionMeta(form, 'physician_action')
      };

      setBusy(true);
      const { data, error } = await state.supabase.rpc('ec_save_historical_round', {
        p_round_id: round?.id || null,
        p_payload: payload,
        p_practitioner_1: p1,
        p_practitioner_2: p2,
        p_reviewer: reviewer
      });
      if (error) {
        setBusy(false);
        return toast(friendlyError(error), 'danger');
      }

      const savedRoundId = typeof data === 'string' ? data : (data?.id || round?.id);
      const { error: assignmentError } = await state.supabase.rpc('ec_set_round_assignments_v259', {
        p_round_id: savedRoundId,
        p_practitioner_1: p1,
        p_practitioner_2: p2,
        p_reviewer: reviewer,
        p_quality_approver: qualityApprover,
        p_physician: physician,
        p_action_meta: actionMeta
      });
      setBusy(false);
      if (assignmentError) return toast(friendlyError(assignmentError), 'danger');

      closeModal();
      toast('บันทึกรอบย้อนหลังแล้ว ขั้นต่อไปกรอกผลจากหลักฐานเดิมของผู้ปฏิบัติทั้งสองคน', 'success', 6500);
      navigate(`round/${savedRoundId}/individual`);
    });
  }

  async function removeRoundStorageFiles(paths) {
    const uniquePaths = [...new Set((paths || []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!uniquePaths.length) return null;
    const chunkSize = 100;
    for (let start = 0; start < uniquePaths.length; start += chunkSize) {
      const chunk = uniquePaths.slice(start, start + chunkSize);
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const { error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove(chunk);
        if (!error) {
          lastError = null;
          break;
        }
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
      if (lastError) return lastError;
    }
    return null;
  }

  function openDeleteRoundModal(round) {
    if (!canDeleteRound()) return toast('เฉพาะผู้ดูแลระบบเท่านั้นที่ลบรอบ EQA ได้', 'danger');
    const roundName = `${round.provider || ''} ${round.round_code || ''}`.trim();
    showModal('ลบรอบ EQA ถาวร', `
      <div class="notice danger">
        <strong>ยืนยันลบรอบ ${esc(roundName)} แบบถาวร</strong><br>
        รอบนี้ ผลการปฏิบัติ ผลกลาง การอนุมัติ การประเมินความสามารถ เอกสาร และข้อมูลที่เกี่ยวข้องทั้งหมดจะถูกลบออกจากฐานข้อมูล
      </div>
      <div style="height:12px"></div>
      <p class="muted"><strong>กู้คืนไม่ได้</strong> หลังลบแล้วสามารถสร้างรอบชื่อเดิมและปีเดิมใหม่ได้</p>
    `, `
      <button class="btn btn-outline" data-close-modal>ยกเลิก</button>
      <button class="btn btn-danger" id="confirm-delete-round" data-busy-sensitive>ลบถาวร</button>
    `);
    document.getElementById('confirm-delete-round')?.addEventListener('click', async () => {
      setBusy(true);
      const { data, error } = await state.supabase.rpc('ec_delete_eqa_round', {
        p_round_id: round.id
      });
      if (error) {
        setBusy(false);
        return toast(friendlyError(error), 'danger');
      }
      const storagePaths = Array.isArray(data?.storage_paths) ? data.storage_paths : [];
      const storageError = await removeRoundStorageFiles(storagePaths);
      setBusy(false);
      closeModal();
      if (storageError) {
        toast(`ลบรอบ ${roundName} และข้อมูลในฐานข้อมูลถาวรแล้ว แต่ไฟล์บางรายการลบไม่สำเร็จ กรุณาตรวจสอบ Storage`, 'warning', 8000);
      } else {
        toast(`ลบรอบ ${roundName} และข้อมูลที่เกี่ยวข้องถาวรแล้ว`, 'success', 5500);
      }
      route();
    });
  }

  async function renderRounds() {
    let rounds;
    try { rounds = await loadRounds(); } catch (e) { return renderError(e); }
    const content = `
      <section class="page">
        <div class="page-header"><div><h1>รอบ EQA</h1><p>เปิดรอบเดียวเพื่อดูหลักฐาน ผล การอนุมัติ การแก้ไขและป้องกัน และการประเมินความสามารถ</p></div>
        <div class="header-actions">
          ${canReceiveEqa() ? `<button class="btn btn-primary" id="receive-eqa-btn">＋ รับ EQA ใหม่เข้าระบบ</button>` : ''}
          ${canImportHistoricalEqa() ? `<button class="btn btn-secondary" id="historical-eqa-btn">＋ นำเข้ารอบที่ส่งผลแล้ว</button>` : ''}
          ${canManage() ? `<button class="btn btn-outline" id="new-round-btn">สร้างรอบล่วงหน้า</button>` : ''}
        </div></div>
        <div class="card">
          ${rounds.length ? `<div class="table-wrap"><table><thead><tr><th>รอบ</th><th>โปรแกรม / ชุดตัวอย่าง</th><th>ครบกำหนด</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
            ${rounds.map((r) => `<tr><td><strong>${esc(r.provider)} ${esc(r.round_code)}</strong> ${isHistoricalRound(r) ? '<span class="badge info">ข้อมูลย้อนหลัง</span>' : ''}<br><span class="small muted">ปี ${esc(r.survey_year)}</span></td>
            <td>${esc(r.program_name)}<br><span class="small muted">${esc(r.program_code || '-')} · ชุดตัวอย่าง ${esc(r.kit_number || '-')}</span></td>
            <td>${fmtDate(r.due_date)}</td><td>${statusBadge(r.status)}</td><td class="table-actions"><button class="btn btn-primary btn-sm" data-open-round="${r.id}">เปิดรอบ</button>${canManage() ? `<button class="btn btn-outline btn-sm" data-edit-round="${r.id}">แก้ไข</button>` : ''}${canDeleteRound() ? `<button class="btn btn-danger btn-sm" data-delete-round="${r.id}">ลบ</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : empty('ยังไม่มีรอบ EQA')}
        </div>
      </section>`;
    appEl.innerHTML = shell(content, 'รอบ EQA'); bindShell();
    document.getElementById('new-round-btn')?.addEventListener('click', () => openRoundModal());
    document.getElementById('receive-eqa-btn')?.addEventListener('click', () => openReceiveEqaModal());
    document.getElementById('historical-eqa-btn')?.addEventListener('click', () => openHistoricalRoundModal());
    document.querySelectorAll('[data-open-round]').forEach((b) => b.addEventListener('click', () => navigate(`round/${b.dataset.openRound}/overview`)));
    document.querySelectorAll('[data-edit-round]').forEach((b) => b.addEventListener('click', () => {
      const target = rounds.find((r) => r.id === b.dataset.editRound);
      if (!target) return;
      if (isHistoricalRound(target)) openHistoricalRoundModal(target);
      else openRoundModal(target);
    }));
    document.querySelectorAll('[data-delete-round]').forEach((b) => b.addEventListener('click', () => {
      const target = rounds.find((r) => r.id === b.dataset.deleteRound);
      if (target) openDeleteRoundModal(target);
    }));
  }

  const ROUND_TABS = [
    ['overview', '1. ข้อมูลรอบ'], ['documents', '2. เอกสาร/ภาพ'], ['assignments', '3. ผู้รับผิดชอบ'],
    ['individual', '4. ผลรายบุคคล'], ['consensus', '5. สรุปผลห้องแลป'], ['approval', '6. ตรวจ/รับรอง'],
    ['submission', '7. หลักฐานการส่ง'], ['official', '8. ผลประเมินกลับ'], ['capa', '9. การแก้ไขและป้องกัน'], ['competency', '10. การประเมินความสามารถ']
  ];

  function roundSubmenu(route) {
    if (!route.startsWith('round/') || !state.currentRound?.id) return '';
    const active = route.split('/')[2] || 'overview';
    return `<div class="round-subnav"><div class="round-subnav-title">เมนูย่อยของรอบนี้</div>${ROUND_TABS.map(([key, label]) => `<button class="round-subnav-btn ${active === key ? 'active' : ''}" data-round-tab="${key}"><span class="round-subnav-dot"></span><span>${label}</span></button>`).join('')}</div>`;
  }

  function roundMobileSelector(active) {
    return `<div class="round-mobile-nav"><label for="round-section-select">หัวข้อของรอบ</label><select class="select" id="round-section-select">${ROUND_TABS.map(([key, label]) => `<option value="${key}" ${active === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`;
  }

  function roundStepper(round) {
    if (isHistoricalRound(round)) {
      const steps = [
        ['draft','กรอกข้อมูล'],
        ['awaiting_practitioner_confirmation','ผู้ปฏิบัติยืนยัน'],
        ['awaiting_reviewer','ผู้ทบทวน'],
        ['awaiting_qm_certification','ผู้จัดการคุณภาพ'],
        ['qm_certified','เปิดการประเมิน']
      ];
      const normalized = ['returned_by_reviewer','returned_by_qm'].includes(round.historical_review_status) ? 'draft' : round.historical_review_status;
      const currentIndex = Math.max(0, steps.findIndex(([status]) => status === normalized));
      return `<div class="stepper">${steps.map(([status,label],index) => `<div class="step ${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}"><div class="step-number">${index+1}</div>${label}</div>`).join('')}</div>`;
    }
    const steps = [
      ['preparing','เตรียม'], ['in_progress','ดำเนินการ'], ['awaiting_review','ผู้ทบทวน'], ['awaiting_qm_approval','ผู้จัดการคุณภาพ'],
      ['awaiting_physician_approval','แพทย์'], ['submitted_to_provider','ส่งผล'], ['official_result_received','ผลกลับ'], ['closed','ปิดรอบ']
    ];
    const currentIndex = Math.max(0, steps.findIndex(([status]) => status === round.status));
    return `<div class="stepper">${steps.map(([status,label],index) => `<div class="step ${index < currentIndex ? 'done' : index === currentIndex ? 'current' : ''}"><div class="step-number">${index+1}</div>${label}</div>`).join('')}</div>`;
  }

  async function getRound(id) {
    const { data, error } = await state.supabase.from('ec_eqa_rounds').select('*').eq('id', id).single();
    if (error) throw error;
    state.currentRound = data;
    return data;
  }

  async function renderRound(routeParts) {
    const roundId = routeParts[1];
    const tab = routeParts[2] || 'overview';
    let round;
    try { round = await getRound(roundId); } catch (e) { return renderError(e); }
    let tabContent = '';
    try {
      if (tab === 'overview') tabContent = await roundOverview(round);
      else if (tab === 'documents') tabContent = await roundDocuments(round);
      else if (tab === 'assignments') tabContent = await roundAssignments(round);
      else if (tab === 'individual') tabContent = await roundIndividual(round);
      else if (tab === 'consensus') tabContent = await roundConsensus(round);
      else if (tab === 'approval') tabContent = await roundApproval(round);
      else if (tab === 'submission') tabContent = await roundSubmission(round);
      else if (tab === 'official') tabContent = await roundOfficial(round);
      else if (tab === 'capa') tabContent = await roundCapa(round);
      else if (tab === 'competency') tabContent = await roundCompetency(round);
    } catch (e) { tabContent = `<div class="notice danger">${esc(friendlyError(e))}</div>`; }

    const content = `<section class="page">
      <div class="page-header"><div><h1>${esc(round.provider)} ${esc(round.round_code)} ${isHistoricalRound(round) ? '<span class="badge info">ข้อมูลย้อนหลัง</span>' : ''}</h1><p>${esc(round.program_name)} · ชุดตัวอย่าง ${esc(round.kit_number || '-')}</p></div>
      <div class="header-actions">${isHistoricalRound(round) ? `<span class="badge">${esc(labelFrom(HISTORICAL_REVIEW_LABELS, round.historical_review_status, 'กำลังตรวจข้อมูลย้อนหลัง'))}</span>` : ''}${statusBadge(round.status)}<button class="btn btn-outline" id="back-rounds">กลับ</button></div></div>
      <div class="card">${roundStepper(round)}</div><div style="height:14px"></div>
      ${roundMobileSelector(tab)}
      ${tabContent}
    </section>`;
    appEl.innerHTML = shell(content, `${round.provider} ${round.round_code}`); bindShell();
    document.getElementById('back-rounds')?.addEventListener('click', () => navigate('rounds'));
    document.querySelectorAll('[data-round-tab]').forEach((b) => b.addEventListener('click', () => navigate(`round/${round.id}/${b.dataset.roundTab}`)));
    document.getElementById('round-section-select')?.addEventListener('change', (event) => navigate(`round/${round.id}/${event.currentTarget.value}`));
    bindRoundTab(round, tab);
  }

  async function roundOverview(round) {
    const directory = await loadDirectory();
    const personName = (id) => directory.find((person) => person.id === id)?.full_name || '-';
    const receiver = round.receiver_id ? personName(round.receiver_id) : '-';
    if (isHistoricalRound(round)) {
      const importedBy = round.historical_imported_by ? personName(round.historical_imported_by) : '-';
      const submittedBy = round.actual_submitted_by ? personName(round.actual_submitted_by) : '-';
      return `<div class="grid cols-2">
        <div class="card"><div class="card-header"><div><h2>ข้อมูลรอบที่ดำเนินการแล้ว</h2><div class="small muted">บันทึกตามหลักฐานจริงในอดีต โดยไม่ย้อนวันเวลาการกรอกข้อมูลเข้าระบบ</div></div>${canImportHistoricalEqa() ? `<button class="btn btn-primary btn-sm" id="edit-historical-round">แก้ไขข้อมูลย้อนหลัง</button>` : ''}</div>
          <div class="table-wrap"><table><tbody>
            <tr><th>ประเภทข้อมูล</th><td><span class="badge info">นำเข้าจากรอบที่ดำเนินการแล้ว</span></td></tr>
            <tr><th>ผู้ให้บริการ</th><td>${esc(round.provider)}</td></tr><tr><th>ชื่อโปรแกรม</th><td>${esc(round.program_name)}</td></tr>
            <tr><th>รหัสโปรแกรม / รอบ</th><td>${esc(round.program_code || '-')} / ${esc(round.round_code)}</td></tr>
            <tr><th>เลขชุดตัวอย่าง</th><td>${esc(round.kit_number || '-')}</td></tr><tr><th>วันครบกำหนด</th><td>${fmtDate(round.due_date)}</td></tr>
            <tr><th>วันและเวลาที่รับจริง</th><td>${fmtDate(round.received_at, true)}</td></tr><tr><th>อุณหภูมิตอนรับ</th><td>${round.received_temperature ?? '-'} °C</td></tr>
            <tr><th>เจ้าหน้าที่ผู้รับจริง</th><td>${esc(receiver)}</td></tr><tr><th>วันที่ส่งผลจริง</th><td>${fmtDate(round.actual_submitted_at, true)}</td></tr>
            <tr><th>เจ้าหน้าที่ผู้ส่งผลจริง</th><td>${esc(submittedBy)}</td></tr><tr><th>เลขอ้างอิงการส่ง</th><td>${esc(round.actual_provider_reference || '-')}</td></tr>
            <tr><th>ผู้บันทึกข้อมูลเข้าระบบ</th><td>${esc(importedBy)}<br><span class="small muted">บันทึกเมื่อ ${fmtDate(round.historical_imported_at, true)}</span></td></tr>
            <tr><th>สถานะตรวจข้อมูลย้อนหลัง</th><td>${esc(labelFrom(HISTORICAL_REVIEW_LABELS, round.historical_review_status))}</td></tr>
            <tr><th>เลขเอกสาร</th><td>${esc(round.document_number || '-')} ฉบับแก้ไขที่ ${esc(round.document_revision || '1')}</td></tr>
          </tbody></table></div>
          <div style="height:14px"></div><h3>หลักฐานที่ใช้อ้างอิง</h3><p>${esc(round.historical_source_note || 'ยังไม่ระบุ')}</p>
          ${round.notes ? `<h3>หมายเหตุเพิ่มเติม</h3><p>${esc(round.notes)}</p>` : ''}
        </div>
        <div class="card"><h2>ขั้นตอนสำหรับรอบย้อนหลัง</h2>
          <div class="notice">1) ผู้ดูแลระบบหรือผู้จัดการคุณภาพกรอกผลแทนผู้ปฏิบัติจริงทั้ง 2 คนจากเอกสารเดิม ระบบจะแสดงคำว่า “กรอกแทนผู้ปฏิบัติ” ชัดเจน</div>
          <div style="height:10px"></div><div class="notice">2) กรอกผลกลางที่ห้องส่งจริง หากไม่มีผลรายบุคคลแยก ให้ระบุว่าไม่มีหลักฐาน ห้ามคาดเดาคำตอบย้อนหลัง</div>
          <div style="height:10px"></div><div class="notice">3) ผู้ปฏิบัติทั้ง 2 คนตรวจข้อมูลของตนและกดยืนยัน หรือแจ้งว่าข้อมูลไม่ตรง</div>
          <div style="height:10px"></div><div class="notice">4) ผู้ทบทวนตรวจสอบ → ผู้รับรองคุณภาพรับรองและเปิดการประเมินความสามารถ</div>
          <div style="height:10px"></div><div class="notice">5) ผู้ปฏิบัติจริงใช้แบบประเมินการปฏิบัติงาน ส่วนเจ้าหน้าที่คนอื่นทำแบบทดสอบ แพทย์ไม่ถูกนำมาทำการประเมิน</div>
          <div style="height:16px"></div><button class="btn btn-primary" data-go-historical-step="individual">ไปกรอก/ยืนยันผลย้อนหลัง</button>
        </div>
      </div>`;
    }
    return `<div class="grid cols-2">
      <div class="card"><div class="card-header"><h2>ข้อมูลรอบ EQA</h2><div class="table-actions">${canReceiveEqa() ? `<button class="btn btn-primary btn-sm" id="record-receipt">${round.received_at ? 'แก้ไขข้อมูลการรับ' : 'บันทึกการรับ EQA'}</button>` : ''}${canManage() ? `<button class="btn btn-outline btn-sm" id="edit-current-round">แก้ไขข้อมูลรอบ</button>` : ''}${canImportHistoricalEqa() && !['closed','cancelled'].includes(round.status) ? `<button class="btn btn-secondary btn-sm" id="convert-historical-round">ใช้รอบนี้เป็นข้อมูลย้อนหลัง</button>` : ''}</div></div>
        <div class="table-wrap"><table><tbody>
          <tr><th>ผู้ให้บริการ</th><td>${esc(round.provider)}</td></tr><tr><th>ชื่อโปรแกรม</th><td>${esc(round.program_name)}</td></tr>
          <tr><th>รหัสโปรแกรม</th><td>${esc(round.program_code || '-')}</td></tr><tr><th>รอบ</th><td>${esc(round.round_code)}</td></tr>
          <tr><th>เลขชุดตัวอย่าง</th><td>${esc(round.kit_number || '-')}</td></tr><tr><th>วันครบกำหนด</th><td>${fmtDate(round.due_date)}</td></tr>
          <tr><th>วันและเวลาที่รับ</th><td>${fmtDate(round.received_at, true)}</td></tr><tr><th>อุณหภูมิตอนรับ</th><td>${round.received_temperature ?? '-'} °C</td></tr>
          <tr><th>เจ้าหน้าที่ผู้รับ</th><td>${esc(receiver)}</td></tr><tr><th>เลขเอกสาร</th><td>${esc(round.document_number || '-')} ฉบับแก้ไขที่ ${esc(round.document_revision || '1')}</td></tr>
        </tbody></table></div>
      </div>
      <div class="card"><h2>ขั้นตอนของรอบนี้</h2>
        <div class="notice">1) ผู้ปฏิบัติจริง 2 คนบันทึกผลแยกกัน และจะยังไม่เห็นคำตอบของอีกคนจนกว่าทั้งคู่ส่งผล</div>
        <div style="height:10px"></div><div class="notice">2) เมื่อผู้ปฏิบัติทั้งสองคนส่งผลครบ ระบบจะเทียบและสร้างสรุปผลห้องปฏิบัติการให้อัตโนมัติ ค่าที่ตรงกันจะถูกเติมให้ทันที ส่วนค่าที่ต่างกันจะรอผู้ทบทวนตัดสิน</div>
        <div style="height:10px"></div><div class="notice">3) ผู้ทบทวนตรวจและกดส่ง → ผู้รับรองคุณภาพรับรอง → แพทย์รับทราบ โดยผู้ปฏิบัติไม่ต้องมานั่งทำผลกลางซ้ำ</div>
        <div style="height:10px"></div><div class="notice">4) แพทย์ไม่ต้องทำแบบทดสอบบุคลากร ส่วนเจ้าหน้าที่คนอื่นทำการประเมินหลังห้องส่งผลแล้วและก่อนเปิดเฉลย</div>
        ${round.notes ? `<div style="height:14px"></div><h3>หมายเหตุ</h3><p>${esc(round.notes)}</p>` : ''}
      </div>
    </div>`;
  }

    async function loadSignedImageMap(documentIds, expiresIn = 900) {
    const ids = [...new Set((documentIds || []).filter(Boolean))];
    const result = new Map();
    if (!ids.length) return result;
    const { data: documents, error } = await state.supabase
      .from('ec_round_documents')
      .select('id,title,file_name,storage_path,mime_type,visibility,category')
      .in('id', ids);
    if (error) return result;
    await Promise.all((documents || []).filter((doc) =>
      String(doc.mime_type || '').startsWith('image/') || doc.mime_type === 'application/pdf'
    ).map(async (doc) => {
      const { data, error: signError } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(doc.storage_path, expiresIn);
      if (!signError && data?.signedUrl) result.set(doc.id, { ...doc, url: data.signedUrl });
    }));
    return result;
  }

  async function loadRoundInstructionExtractions(roundId, force = false) {
    if (!roundId) {
      state.instructionExtractions = [];
      return [];
    }
    if (!force && state.instructionExtractionCache.has(roundId)) {
      const cached = state.instructionExtractionCache.get(roundId) || [];
      state.instructionExtractions = cached;
      return cached;
    }
    const { data, error } = await state.supabase
      .from('ec_round_documents')
      .select('id,title,file_name,ai_extraction,ai_extraction_status')
      .eq('round_id', roundId)
      .eq('category', 'instruction')
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) {
      state.instructionExtractions = [];
      return [];
    }
    const rows = (data || []).filter((row) => row.ai_extraction_status === 'completed' && row.ai_extraction);
    state.instructionExtractionCache.set(roundId, rows);
    state.instructionExtractions = rows;
    return rows;
  }

  function questionImageIds(question) {
    return [...new Set([
      question?.image_document_id,
      ...(Array.isArray(question?.ai_source_document_ids) ? question.ai_source_document_ids : []),
    ].filter(Boolean))];
  }

  function questionImageGallery(question, imageMap, variant = 'quiz') {
    const images = questionImageIds(question).map((id) => imageMap.get(id)).filter(Boolean);
    if (!images.length) return '';
    const isAbId = isAntibodyIdentificationQuestion(question);
    const questionText = `${question?.section || ''} ${question?.prompt || ''}`;
    const isProviderCase = /DRY\s*CHALLENGE|EDUCATIONAL\s*CHALLENGE|แบบฟอร์มผู้ให้บริการ|\[\[CASE_CONTEXT\]\]/i.test(questionText);
    const documentLabel = (image) => {
      if (image.category === 'instruction') return 'รายละเอียดเคสและคู่มือ';
      if (image.category === 'source_document') return 'โจทย์และแบบฟอร์มต้นฉบับ';
      return 'เอกสารอ้างอิง';
    };
    const items = images.map((image, index) => {
      const isPanel = image.category === 'antibody_panel' || /antigram/i.test(`${image.file_name || ''} ${image.title || ''}`);
      const className = isPanel ? 'question-gallery-panel' : 'question-gallery-result';
      const title = image.title || image.file_name || 'เอกสาร PDF';
      const pdfFrame = `<iframe class="question-gallery-pdf" src="${esc(image.url)}#toolbar=0&navpanes=0" title="${esc(title)}"></iframe>`;
      const collapsePdf = variant === 'quiz' || isProviderCase;
      const media = image.mime_type === 'application/pdf'
        ? (collapsePdf
          ? `<details class="question-reference-document"><summary>${esc(documentLabel(image))}: ${esc(title)}</summary>${pdfFrame}</details>`
          : pdfFrame)
        : `<img src="${esc(image.url)}" alt="${esc(image.title || image.file_name || 'รูปประกอบคำถาม')}">`;
      return `<figure class="question-gallery-item ${className}">
        ${media}
        <figcaption>${esc(title || `รูปประกอบ ${index + 1}`)}</figcaption>
      </figure>`;
    }).join('');
    return `<div class="question-image-gallery ${isAbId ? 'is-abid' : ''} ${variant === 'admin' ? 'is-admin' : ''}">${items}</div>`;
  }

  function competencyEvidenceSpecimen(document) {
    const source = `${document?.title || ''} ${document?.file_name || ''}`
      .replace(/[_]+/g, '-')
      .replace(/\s+/g, ' ');
    const match = source.match(/\b(JE|J|ELU|TRC|AABT)[- ]?(\d{1,2})(R|S)?\b/i);
    if (!match) return isAntigramEvidenceDocument(document) ? 'Panel / Antigram' : 'ภาพผลดิบอื่น';
    const prefix = String(match[1] || '').toUpperCase();
    const number = String(match[2] || '').padStart(2, '0');
    const suffix = String(match[3] || '').toUpperCase();
    return `${prefix}-${number}${suffix}`;
  }

  function isAntigramEvidenceDocument(document) {
    const source = `${document?.title || ''} ${document?.file_name || ''}`.toLowerCase();
    return document?.category === 'antibody_panel' || /antigram|antigen profile|panel cell profile/.test(source);
  }

  function competencyEvidenceTest(document) {
    const source = `${document?.title || ''} ${document?.file_name || ''}`.toLowerCase();
    if (isAntigramEvidenceDocument(document)) return 'Panel / Antigram';
    if (/agtyping|antigen typing|ag typing/.test(source)) return 'Antigen typing';
    if (/x-?match|crossmatch/.test(source)) return 'Crossmatch';
    if (/abid|antibody identification/.test(source)) return 'Antibody Identification';
    if (/abscreen|antibody screen/.test(source)) return 'Antibody Screening';
    if (/rhd|rh[_ -]?d|rh type/.test(source)) return 'Rh(D)';
    if (/abo/.test(source)) return 'ABO';
    return 'ภาพผลดิบ';
  }

  function competencyEvidenceGallery(documents, imageMap) {
    const visible = (documents || []).map((document) => imageMap.get(document.id)).filter(Boolean);
    if (!visible.length) return `<div class="notice warning"><strong>ยังไม่พบภาพผลดิบที่ผู้ทำ Competency เปิดดูได้</strong><br>ตรวจว่าภาพผลดิบและ Panel/Antigram ตั้งสิทธิ์เป็น “บุคลากรทุกคน”</div>`;
    const groups = new Map();
    visible.forEach((document) => {
      const specimen = competencyEvidenceSpecimen(document);
      if (!groups.has(specimen)) groups.set(specimen, []);
      groups.get(specimen).push(document);
    });
    const sortKey = (value) => value === 'Panel / Antigram' ? 'ZZ1' : value === 'ภาพผลดิบอื่น' ? 'ZZ2' : value;
    const sections = [...groups.entries()].sort((a, b) => sortKey(a[0]).localeCompare(sortKey(b[0]), 'en')).map(([specimen, rows], groupIndex) => {
      const cards = rows.sort((a, b) => competencyEvidenceTest(a).localeCompare(competencyEvidenceTest(b), 'en')).map((document) => {
        const title = document.title || document.file_name || 'ภาพผลดิบ';
        const test = competencyEvidenceTest(document);
        const media = document.mime_type === 'application/pdf'
          ? `<iframe class="competency-evidence-pdf" src="${esc(document.url)}#toolbar=0&navpanes=0" title="${esc(title)}"></iframe>`
          : `<a href="${esc(document.url)}" target="_blank" rel="noopener"><img src="${esc(document.url)}" alt="${esc(title)}"></a>`;
        return `<figure class="competency-evidence-card">${media}<figcaption><strong>${esc(test)}</strong><span>${esc(title)}</span></figcaption></figure>`;
      }).join('');
      return `<details class="competency-evidence-group" ${groupIndex < 2 ? 'open' : ''}><summary><strong>${esc(specimen)}</strong><span class="badge info">${rows.length} ไฟล์</span></summary><div class="competency-evidence-grid">${cards}</div></details>`;
    }).join('');
    return `<div class="competency-evidence-shell"><div class="notice info"><strong>หลักฐานผลดิบจากผู้ปฏิบัติจริง 2 คน</strong><br>ใช้ภาพชุดนี้แปลผล แล้วกรอกแบบประเมินด้านล่างเหมือนแบบผลรายบุคคล ห้ามเปิดดูคำตอบของผู้ปฏิบัติจริง</div>${sections}</div>`;
  }

  function normalizeCompetencySpecimen(value) {
    const text = String(value || '').toUpperCase().replace(/^SPECIMEN\s+/, '').replace(/[_ ]+/g, '-');
    const match = text.match(/\b(JE|J|ELU|TRC|AABT)-?(\d{1,2})(R|S)?\b/);
    if (!match) return '';
    return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
  }

  function competencyEvidenceMatchesSpecimen(document, specimenId) {
    const target = normalizeCompetencySpecimen(specimenId);
    if (!target) return false;
    const documentSpecimen = normalizeCompetencySpecimen(competencyEvidenceSpecimen(document));
    if (documentSpecimen && documentSpecimen === target) return true;
    const parsed = parseEqaFilename(document?.file_name || document?.title || '');
    return normalizeCompetencySpecimen(parsed?.specimen) === target;
  }

  function competencyEvidenceRelevantDocuments(documents, specimenIds, fieldCategories = []) {
    const targets = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).filter(Boolean);
    const explicit = (documents || []).filter((document) => targets.some((specimenId) => competencyEvidenceMatchesSpecimen(document, specimenId)));
    const categories = new Set((fieldCategories || []).map((value) => String(value || '').toLowerCase()));
    const needsPanel = categories.has('antibody_id');
    const sharedPanels = needsPanel ? (documents || []).filter((document) => {
      if (!isAntigramEvidenceDocument(document)) return false;
      return !normalizeCompetencySpecimen(competencyEvidenceSpecimen(document));
    }) : [];
    return [...new Map([...explicit, ...sharedPanels].map((document) => [document.id, document])).values()];
  }

  function providerSpecimenEvidenceHtml(documents, imageMap, specimenIds, fieldCategories = [], displayLabel = '', options = {}) {
    const primaryIds = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).filter(Boolean);
    let relevant = competencyEvidenceRelevantDocuments(documents, primaryIds, fieldCategories);
    if (options?.donorOnly) {
      relevant = relevant.filter((document) => ['Crossmatch', 'Antigen typing'].includes(competencyEvidenceTest(document)));
    }
    const linkedCrossmatchIds = (Array.isArray(options?.linkedCrossmatchIds) ? options.linkedCrossmatchIds : []).filter(Boolean);
    const linkedCrossmatchDocuments = linkedCrossmatchIds.length ? (documents || []).filter((document) => {
      if (competencyEvidenceTest(document) !== 'Crossmatch') return false;
      return linkedCrossmatchIds.some((specimenId) => competencyEvidenceMatchesSpecimen(document, specimenId));
    }) : [];
    relevant = [...new Map([...relevant, ...linkedCrossmatchDocuments].map((document) => [document.id, document])).values()];
    const rows = relevant
      .map((document) => imageMap?.get(document.id))
      .filter(Boolean)
      .sort((a, b) => competencyEvidenceTest(a).localeCompare(competencyEvidenceTest(b), 'en'));
    const label = displayLabel || primaryIds[0];
    if (!rows.length) {
      return `<div class="provider-evidence-empty"><strong>No raw-result image is linked to ${esc(providerCapSpecimenLabel(label))}</strong><span>Admin: upload the file using the specimen ID in the filename and set visibility to “บุคลากรทุกคน”.</span></div>`;
    }
    const cards = rows.map((document) => {
      const title = document.title || document.file_name || 'Raw result';
      let test = competencyEvidenceTest(document);
      const isLinkedCrossmatch = test === 'Crossmatch' && linkedCrossmatchIds.some((specimenId) => competencyEvidenceMatchesSpecimen(document, specimenId));
      if (isLinkedCrossmatch && options?.crossmatchLabel) test = options.crossmatchLabel;
      const isPdf = document.mime_type === 'application/pdf';
      const thumb = isPdf
        ? `<div class="provider-evidence-pdf-thumb"><span>PDF</span></div>`
        : `<img src="${esc(document.url)}" loading="lazy" alt="${esc(title)}">`;
      return `<button type="button" class="provider-evidence-thumb" data-evidence-url="${esc(document.url)}" data-evidence-title="${esc(title)}" data-evidence-mime="${esc(document.mime_type || '')}">${thumb}<span><strong>${esc(test)}</strong><small>${esc(title)}</small></span></button>`;
    }).join('');
    return `<section class="provider-specimen-evidence"><div class="provider-specimen-evidence-head"><div><span class="eyebrow">RAW RESULTS FOR COMPETENCY</span><h4>Images used to answer — ${esc(providerCapSpecimenLabel(label))}</h4></div><span class="badge info">${rows.length} files</span></div><div class="provider-evidence-thumb-grid">${cards}</div></section>`;
  }

  function openEvidenceLightbox(url, title, mimeType) {
    document.getElementById('competency-evidence-lightbox')?.remove();
    const isPdf = String(mimeType || '').includes('pdf');
    const overlay = document.createElement('div');
    overlay.id = 'competency-evidence-lightbox';
    overlay.className = 'competency-evidence-lightbox';
    overlay.innerHTML = `<div class="competency-evidence-lightbox-panel"><div class="competency-evidence-lightbox-head"><strong>${esc(title || 'Raw result')}</strong><div><a class="btn btn-outline btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Open original</a><button type="button" class="btn btn-primary btn-sm" data-close-evidence-lightbox>Close</button></div></div>${isPdf ? `<iframe src="${esc(url)}#toolbar=1&navpanes=0" title="${esc(title || 'PDF')}"></iframe>` : `<img src="${esc(url)}" alt="${esc(title || 'Raw result')}">`}</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.closest('[data-close-evidence-lightbox]')) close(); });
    document.addEventListener('keydown', function handler(event) { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', handler); } });
  }

  function resultPayloadHasData(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const copy = JSON.parse(JSON.stringify(payload));
    delete copy.schema;
    delete copy.form_schema_version;
    const hasValue = (value) => {
      if (Array.isArray(value)) return value.some(hasValue);
      if (value && typeof value === 'object') return Object.values(value).some(hasValue);
      return String(value ?? '').trim() !== '';
    };
    return hasValue(copy);
  }

  async function roundDocuments(round) {
    const { data: docs, error } = await state.supabase.from('ec_round_documents').select('*').eq('round_id', round.id).order('created_at', { ascending: false });
    if (error) throw error;
    const uploadAllowed = canManage() || canReview() || round.receiver_id === state.user.id || await isAssigned(round.id);
    const sourceDocuments = (docs || []).filter((doc) => doc.category === 'source_document');
    const instructionDocuments = (docs || []).filter((doc) => doc.category === 'instruction');
    const rawResultDocuments = (docs || []).filter((doc) => doc.category === 'raw_result_image');
    const antibodyPanelDocuments = (docs || []).filter((doc) => doc.category === 'antibody_panel');
    const submittedResultDocuments = (docs || []).filter((doc) => doc.category === 'submission_form');
    const officialDocuments = (docs || []).filter((doc) => doc.category === 'official_result');
    const participantSummaryDocuments = (docs || []).filter((doc) => doc.category === 'participant_summary');
    const formReady = sourceDocuments.length > 0;
    const instructionReady = instructionDocuments.length > 0;
    const questionReady = sourceDocuments.length + instructionDocuments.length + rawResultDocuments.length + antibodyPanelDocuments.length > 0;
    const answerBundleReady = officialDocuments.length > 0;
    const historicalBundleReady = formReady && instructionReady && answerBundleReady;
    const generatedAt = round.generated_form_generated_at ? fmtDate(round.generated_form_generated_at, true) : '';
    const generatedFormStatus = `<div class="compact-status"><span>ฟอร์มต้นฉบับ <strong>${sourceDocuments.length}</strong></span><span>คู่มือ/คำแนะนำ <strong>${instructionDocuments.length}</strong></span><span>ภาพผลดิบ <strong>${rawResultDocuments.length}</strong></span><span>Panel/Antigram <strong>${antibodyPanelDocuments.length}</strong></span><span>ผลที่ส่ง <strong>${submittedResultDocuments.length}</strong></span><span>Official Evaluation <strong>${officialDocuments.length}</strong></span><span>Participant Summary <strong>${participantSummaryDocuments.length}</strong></span></div>
      <div style="height:10px"></div>
      <div class="compact-status"><span>แบบกรอก <strong>${round.generated_result_form_schema ? 'สร้างแล้ว' : 'ยังไม่สร้าง'}</strong></span><span>โครงสร้าง <strong class="text-${providerStructureStatusClass(round.generated_result_form_schema)}">${esc(providerStructureStatusLabel(round.generated_result_form_schema))}</strong></span><span>คำแนะนำ <strong>${round.generated_instruction_th ? 'สร้างแล้ว' : 'ยังไม่สร้าง'}</strong></span>${generatedAt ? `<span>อัปเดตแบบกรอก <strong>${esc(generatedAt)}</strong></span>` : ''}</div>
      ${round.generated_instruction_th ? `<details class="notice success" style="margin-top:10px"><summary><strong>เปิดดูคำแนะนำภาษาไทย</strong></summary><div class="small" style="white-space:pre-wrap;margin-top:8px">${esc(round.generated_instruction_th)}</div></details>` : ''}`;
    return `<div class="card">
      <div class="card-header"><div><h2>เอกสารและภาพ</h2></div>
      <div class="table-actions">${uploadAllowed ? `<button class="btn btn-primary" id="upload-doc-btn">＋ อัปโหลดไฟล์</button>` : ''}${canManage() && (rawResultDocuments.length || antibodyPanelDocuments.length) ? `<button class="btn btn-outline" id="open-evidence-for-staff">เปิดภาพ Competency ให้บุคลากร</button>` : ''}<button class="btn btn-outline" id="go-auto-competency">จัดการข้อสอบ</button></div></div>
      ${canManage() ? `<div class="notice info"><strong>ส่วนแบบทดสอบเปลี่ยนเป็นจัดเองแล้ว</strong><br>AI จะไม่สร้างข้อสอบหรือเฉลยจากเอกสารอีก ให้กด “จัดการข้อสอบ” แล้วใช้ปุ่ม “อ่านข้อความจากเอกสาร” จากนั้นมัสเพิ่มคำถาม ตัวเลือก เฉลย และรูปเองเหมือน Microsoft Forms</div><div class="ai-action-grid">
        <button class="btn btn-primary" id="generate-form-only" ${formReady ? '' : 'disabled'}>สร้างแบบกรอกผลแลปจากฟอร์มเปล่า</button>
        <button class="btn btn-outline" id="review-round-structure" ${round.generated_result_form_schema ? '' : 'disabled'}>ตรวจโครงสร้างแบบกรอกผลแลป</button>
        <button class="btn btn-outline" id="generate-instruction-only" ${instructionReady ? '' : 'disabled'}>สร้างคำแนะนำจากคู่มือ</button>
        <button class="btn btn-outline" id="generate-official-summary" ${answerBundleReady ? '' : 'disabled'}>สร้างสรุปผลอย่างเป็นทางการ</button>
        <button class="btn btn-secondary" id="go-manual-question-builder">ไปสร้างข้อสอบด้วยตนเอง</button>
      </div>` : ''}
      ${participantSummaryDocuments.length && !officialDocuments.length ? `<div class="notice warning"><strong>มี Participant Summary แต่ยังไม่มี Official Evaluation</strong><br>ระบบยังไม่เปิดสร้างเฉลย เพื่อป้องกันการนำร้อยละของผู้เข้าร่วมมาใช้แทนผลของห้องปฏิบัติการ</div><div style="height:12px"></div>` : ''}
      ${officialDocuments.length && !participantSummaryDocuments.length ? `<div class="notice info"><strong>สร้างผลแบบให้คะแนนได้แล้ว</strong><br>หากรอบนี้มี Educational Challenge ให้เพิ่ม Participant Summary เพื่อให้ระบบประเมินเทียบ consensus ของผู้เข้าร่วมได้ถูกต้อง</div><div style="height:12px"></div>` : ''}
      ${generatedFormStatus}
      ${(docs || []).length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ชื่อ</th><th>สถานะ AI</th><th>ผู้ที่เปิดดูได้</th><th>วันที่อัปโหลด</th><th>จัดการ</th></tr></thead><tbody>
        ${(docs || []).map((d) => {
          const canEditDocument = canManage() || d.uploaded_by === state.user.id;
          const extractable = ['source_document','instruction','raw_result_image','antibody_panel','submission_form','official_result','participant_summary'].includes(d.category);
          const aiStatus = !extractable
            ? '<span class="small muted">ไม่ต้องอ่าน</span>'
            : d.ai_extraction_status === 'completed'
              ? '<span class="badge success">AI อ่านแล้ว</span>'
              : d.ai_extraction_status === 'processing'
                ? '<span class="badge info">กำลังอ่าน</span>'
                : d.ai_extraction_status === 'failed'
                  ? `<span class="badge danger">อ่านไม่สำเร็จ</span>${d.ai_extraction_error ? `<br><span class="small muted">${esc(d.ai_extraction_error)}</span>` : ''}`
                  : '<span class="badge">รออ่าน</span>';
          return `<tr><td>${esc(labelFrom(DOCUMENT_CATEGORY_LABELS, d.category))}</td><td><strong>${esc(d.title)}</strong><br><span class="small muted">${esc(d.file_name)}</span></td><td>${aiStatus}</td><td>${esc(labelFrom(VISIBILITY_LABELS, d.visibility))}</td><td>${fmtDate(d.created_at, true)}</td><td><div class="table-actions"><button class="btn btn-outline btn-sm" data-open-doc="${d.id}" data-path="${esc(d.storage_path)}">เปิดไฟล์</button>${canEditDocument ? `<button class="btn btn-outline btn-sm" data-edit-doc="${d.id}">แก้ไข</button><button class="btn btn-danger btn-sm" data-delete-doc="${d.id}">ลบ</button>` : ''}</div></td></tr>`;
        }).join('')}
      </tbody></table></div>` : empty('ยังไม่มีไฟล์ในรอบนี้')}
    </div>`;
  }

  async function isAssigned(roundId) {
    const { data } = await state.supabase.from('ec_round_assignments').select('id').eq('round_id', roundId).eq('user_id', state.user.id).eq('active', true).limit(1);
    return Boolean(data?.length);
  }

  async function roundAssignments(round) {
    const [{ data: assignments, error }, directory, resultCount] = await Promise.all([
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
      loadDirectory(),
      isHistoricalRound(round)
        ? state.supabase.from('ec_individual_results').select('id', { count: 'exact', head: true }).eq('round_id', round.id)
        : Promise.resolve({ count: 0 })
    ]);
    if (error) throw error;
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const canChange = canManage();
    const historicalColumn = isHistoricalRound(round) ? '<th>วันเวลาเหตุการณ์จริง</th>' : '';
    return `<div class="card">
      <div class="card-header"><div><h2>ผู้รับผิดชอบ</h2><div class="small muted">ผู้ปฏิบัติจริง 2 คน ผู้ทบทวน และผู้รับรองคุณภาพต้องเป็นคนละคนในรอบเดียวกัน รองผู้จัดการคุณภาพทำแทนได้เฉพาะช่วงที่ได้รับมอบหมาย</div></div>${canChange ? `<button class="btn btn-primary" id="manage-assignments">กำหนดผู้รับผิดชอบ</button>` : ''}</div>
      <div class="notice info">บุคคลเดียวกันมีหลายบทบาทในระบบได้ และสามารถทำหน้าที่คนละบทบาทในคนละรอบ แต่ระบบจะไม่ให้ทำหน้าที่ที่ขัดกันภายในรอบเดียวกัน<br><span class="small">สำหรับรอบปกติ ไม่ต้องเลือกแพทย์ล่วงหน้า แพทย์ผู้รับรองทั้งสองคนมีสิทธิ์เท่าเทียมกันและคนแรกที่กดรับทราบจะเป็นผู้ลงนามของรอบนั้น</span></div><div style="height:12px"></div>
      ${isHistoricalRound(round) && resultCount.count ? `<div class="notice warning">มีการกรอกผลย้อนหลังแล้ว ระบบล็อกชื่อผู้ปฏิบัติจริงไว้ แต่ยังแก้ผู้ทบทวน ผู้รับรองคุณภาพ แพทย์ และวันเวลาเหตุการณ์จริงได้</div><div style="height:12px"></div>` : ''}
      ${(assignments || []).length ? `<div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>ชื่อ</th><th>ลำดับ</th>${historicalColumn}<th>บันทึกในระบบเมื่อ</th></tr></thead><tbody>
        ${(assignments || []).map((assignment) => `<tr><td>${esc(labelFrom(ASSIGNMENT_ROLE_LABELS, assignment.assignment_role))}</td><td>${esc(name(assignment.user_id))}</td><td>${assignment.practitioner_slot || '-'}</td>${isHistoricalRound(round) ? `<td>${esc(fmtHistoricalEvent(assignment))}${assignment.actual_action_note ? `<br><span class="small muted">${esc(assignment.actual_action_note)}</span>` : ''}</td>` : ''}<td>${fmtDate(assignment.assigned_at, true)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('ยังไม่ได้กำหนดผู้ปฏิบัติ ผู้ทบทวน หรือผู้รับรองคุณภาพ')}
    </div>`;
  }

  function selectOptions(options, value) {
    return options.map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${String(value || '') === optionValue ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }

  function generatedResultSchema(round = state.currentRound) {
    const schema = round?.generated_result_form_schema;
    return schema && typeof schema === 'object' && Array.isArray(schema.programs) ? schema : null;
  }


  function providerStructureReview(schema = generatedResultSchema()) {
    const review = schema?.structure_review;
    if (review && typeof review === 'object') return review;
    // Schemas created before v2.7.0 remain usable and are marked as legacy so
    // current JA/JB work is not blocked. New schemas are generated as draft.
    return { status: 'legacy', version: 'legacy', confirmed_at: null, confirmed_by: null };
  }

  function providerStructureStatusLabel(schema = generatedResultSchema()) {
    const status = String(providerStructureReview(schema)?.status || 'draft');
    if (status === 'confirmed') return 'ยืนยันโครงสร้างแล้ว';
    if (status === 'legacy') return 'โครงสร้างเดิม';
    return 'รอตรวจโครงสร้าง';
  }

  function providerStructureStatusClass(schema = generatedResultSchema()) {
    const status = String(providerStructureReview(schema)?.status || 'draft');
    if (status === 'confirmed') return 'success';
    if (status === 'legacy') return 'info';
    return 'warning';
  }

  function providerSpecimenRoleLabel(role) {
    return ({ patient: 'ตัวอย่างทดสอบ', donor: 'Donor / unit', reference: 'ตัวอย่างอ้างอิง', case: 'Case Study', unknown: 'ยังไม่ระบุ' })[String(role || 'unknown')] || 'ยังไม่ระบุ';
  }

  function providerStructureAllSpecimens(schema) {
    const rows = [];
    (schema?.programs || []).forEach((program, programIndex) => {
      (program?.specimens || []).forEach((specimen, specimenIndex) => rows.push({ program, programIndex, specimen, specimenIndex }));
    });
    return rows;
  }

  function providerStructureSpecimenOptions(program) {
    const values = new Map();
    (program?.specimens || []).forEach((item) => {
      const id = String(item?.id || item?.label || '').trim();
      if (id) values.set(id, String(item?.label || id));
    });
    (program?.relationships || []).forEach((relationship) => {
      [relationship?.from_specimen, relationship?.to_specimen].forEach((raw) => {
        const id = String(raw || '').trim();
        if (id && !values.has(id)) values.set(id, id);
      });
    });
    return [...values.entries()];
  }

  function providerStructureProgramTests(program) {
    const categories = [...new Set((program?.specimen_fields || []).map((field) => providerFieldCategory(program, field)))];
    return categories.map((category) => ({
      abo_rh: 'ABO/Rh', screening: 'Ab screen', antibody_id: 'Ab ID', crossmatch: 'Crossmatch', antigen: 'Ag typing', other: 'ข้อมูลอื่น'
    })[category] || category);
  }

  function providerStructureReviewHtml(schema) {
    const programs = Array.isArray(schema?.programs) ? schema.programs : [];
    if (!programs.length) return '<div class="notice warning">ยังไม่มีแบบกรอกที่สร้างจาก Blank Result Form</div>';
    return `<div class="notice info"><strong>ตรวจจากฟอร์มของรอบนี้ก่อนเปิดให้เจ้าหน้าที่ใช้งาน</strong><br>ตรวจ Part, Wet/Dry, บทบาทตัวอย่าง, หมู่เลือด Donor และคู่ Crossmatch ระบบจะใช้โครงสร้างนี้กับรอบในอนาคตโดยไม่ผูกกับรหัส JA/JB หรือปี 2026</div>
      <div class="round-structure-editor" id="round-structure-editor">${programs.map((program, programIndex) => {
        const specimenOptions = providerStructureSpecimenOptions(program);
        const tests = providerStructureProgramTests(program);
        const relationships = Array.isArray(program?.relationships) ? program.relationships : [];
        return `<section class="round-structure-program" data-structure-program="${programIndex}">
          <div class="round-structure-program-head"><div><span class="eyebrow">PROGRAM ${programIndex + 1}</span><h3>${esc(program?.title || program?.key || `Program ${programIndex + 1}`)}</h3><div class="structure-test-badges">${tests.map((test) => `<span>${esc(test)}</span>`).join('')}</div></div>
          <div class="round-structure-program-controls"><label>ส่วนของฟอร์ม<select class="select" data-structure-scope><option value="J" ${program?.scope === 'J' ? 'selected' : ''}>Part J</option><option value="JE" ${program?.scope === 'JE' ? 'selected' : ''}>Part JE</option><option value="JE1" ${program?.scope === 'JE1' ? 'selected' : ''}>JE1</option><option value="JXM" ${program?.scope === 'JXM' ? 'selected' : ''}>JXM</option><option value="OTHER" ${!['J','JE','JE1','JXM'].includes(String(program?.scope || '')) ? 'selected' : ''}>อื่น ๆ</option></select></label>
          <label>รูปแบบ<select class="select" data-structure-challenge><option value="wet" ${program?.challenge_mode === 'wet' ? 'selected' : ''}>Wet / ตัวอย่างจริง</option><option value="dry" ${program?.challenge_mode === 'dry' ? 'selected' : ''}>Dry / Case Study</option><option value="mixed" ${program?.challenge_mode === 'mixed' ? 'selected' : ''}>Mixed</option><option value="not_applicable" ${program?.challenge_mode === 'not_applicable' ? 'selected' : ''}>ไม่เกี่ยวข้อง</option><option value="unknown" ${!['wet','dry','mixed','not_applicable'].includes(String(program?.challenge_mode || '')) ? 'selected' : ''}>ยังไม่แน่ใจ</option></select></label></div></div>
          <div class="round-structure-subhead"><strong>ตัวอย่างในส่วนนี้</strong><span>${(program?.specimens || []).length} รายการ</span></div>
          <div class="round-structure-specimen-list">${(program?.specimens || []).map((specimen, specimenIndex) => `<div class="round-structure-specimen" data-structure-specimen="${specimenIndex}">
            <div class="structure-specimen-id"><strong>${esc(specimen?.id || '-')}</strong><small>${esc(specimen?.source_reference || '')}</small></div>
            <label>ชื่อที่แสดง<input class="input" data-structure-label value="${esc(specimen?.label || specimen?.id || '')}"></label>
            <label>หน้าที่<select class="select" data-structure-role><option value="patient" ${specimen?.role === 'patient' ? 'selected' : ''}>ตัวอย่างทดสอบ</option><option value="donor" ${specimen?.role === 'donor' ? 'selected' : ''}>Donor / unit</option><option value="reference" ${specimen?.role === 'reference' ? 'selected' : ''}>ตัวอย่างอ้างอิง</option><option value="case" ${specimen?.role === 'case' ? 'selected' : ''}>Case Study</option><option value="unknown" ${!['patient','donor','reference','case'].includes(String(specimen?.role || '')) ? 'selected' : ''}>ยังไม่ระบุ</option></select></label>
            <label>ABO<input class="input" data-structure-abo value="${esc(specimen?.abo_group || '')}" placeholder="เช่น O"></label>
            <label>Rh<select class="select" data-structure-rh><option value="" ${!specimen?.rh_type ? 'selected' : ''}>ไม่ระบุ</option><option value="Positive" ${specimen?.rh_type === 'Positive' ? 'selected' : ''}>Positive</option><option value="Negative" ${specimen?.rh_type === 'Negative' ? 'selected' : ''}>Negative</option></select></label>
          </div>`).join('')}</div>
          <div class="round-structure-subhead"><strong>คู่ Crossmatch / ความสัมพันธ์</strong><button type="button" class="btn btn-outline btn-sm" data-add-structure-relationship="${programIndex}">＋ เพิ่มคู่</button></div>
          <div class="round-structure-relationship-list" data-structure-relationships>${relationships.map((relationship, relationshipIndex) => `<div class="round-structure-relationship" data-structure-relationship="${relationshipIndex}">
            <select class="select" data-structure-from>${specimenOptions.map(([id, label]) => `<option value="${esc(id)}" ${String(relationship?.from_specimen || '') === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><span>×</span><select class="select" data-structure-to>${specimenOptions.map(([id, label]) => `<option value="${esc(id)}" ${String(relationship?.to_specimen || '') === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><input class="input" data-structure-relation-note value="${esc(relationship?.note || '')}" placeholder="หมายเหตุ"><button type="button" class="btn btn-danger btn-sm" data-remove-structure-relationship>ลบ</button>
          </div>`).join('')}</div>
        </section>`;
      }).join('')}</div>`;
  }

  function providerCollectStructureSchema(schema, status = 'draft') {
    const copy = JSON.parse(JSON.stringify(schema || {}));
    document.querySelectorAll('[data-structure-program]').forEach((programNode) => {
      const programIndex = Number(programNode.dataset.structureProgram);
      const program = copy.programs?.[programIndex];
      if (!program) return;
      program.scope = String(programNode.querySelector('[data-structure-scope]')?.value || 'OTHER');
      program.challenge_mode = String(programNode.querySelector('[data-structure-challenge]')?.value || 'unknown');
      programNode.querySelectorAll('[data-structure-specimen]').forEach((specimenNode) => {
        const specimenIndex = Number(specimenNode.dataset.structureSpecimen);
        const specimen = program.specimens?.[specimenIndex];
        if (!specimen) return;
        specimen.label = String(specimenNode.querySelector('[data-structure-label]')?.value || specimen.id || '').trim();
        specimen.role = String(specimenNode.querySelector('[data-structure-role]')?.value || 'unknown');
        specimen.abo_group = String(specimenNode.querySelector('[data-structure-abo]')?.value || '').trim().toUpperCase();
        specimen.rh_type = String(specimenNode.querySelector('[data-structure-rh]')?.value || '');
        specimen.provider_group_text = [specimen.abo_group ? `Blood Group ${specimen.abo_group}` : '', specimen.rh_type ? `Rh ${specimen.rh_type}` : ''].filter(Boolean).join(', ');
      });
      program.relationships = [...programNode.querySelectorAll('[data-structure-relationship]')].map((row) => ({
        type: 'crossmatch',
        from_specimen: String(row.querySelector('[data-structure-from]')?.value || '').trim(),
        to_specimen: String(row.querySelector('[data-structure-to]')?.value || '').trim(),
        note: String(row.querySelector('[data-structure-relation-note]')?.value || '').trim(),
        source_reference: 'ตรวจและยืนยันโดยผู้ดูแลระบบ'
      })).filter((relationship) => relationship.from_specimen && relationship.to_specimen && relationship.from_specimen !== relationship.to_specimen);
    });
    copy.structure_review = {
      ...(copy.structure_review || {}),
      status,
      version: '2.7.0',
      reviewed_at: new Date().toISOString(),
      confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
      confirmed_by: status === 'confirmed' ? state.user.id : null
    };
    return copy;
  }

  async function providerSaveRoundStructure(round, schema, status) {
    const payload = providerCollectStructureSchema(schema, status);
    const { data, error } = await state.supabase.rpc('ec_save_round_structure', { p_round_id: round.id, p_schema: payload, p_status: status });
    if (error) throw error;
    state.currentRound = { ...round, generated_result_form_schema: data?.generated_result_form_schema || payload };
    return state.currentRound.generated_result_form_schema;
  }

  function providerBindStructureEditor(round, schema) {
    document.querySelectorAll('[data-add-structure-relationship]').forEach((button) => button.addEventListener('click', () => {
      const programIndex = Number(button.dataset.addStructureRelationship);
      const programNode = document.querySelector(`[data-structure-program="${programIndex}"]`);
      const program = schema?.programs?.[programIndex];
      const options = providerStructureSpecimenOptions(program);
      if (options.length < 2) return toast('ต้องมีตัวอย่างอย่างน้อย 2 รายการก่อนเพิ่มคู่ Crossmatch', 'warning');
      const list = programNode?.querySelector('[data-structure-relationships]');
      if (!list) return;
      const row = document.createElement('div');
      row.className = 'round-structure-relationship';
      row.dataset.structureRelationship = String(list.children.length);
      const optionHtml = options.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
      row.innerHTML = `<select class="select" data-structure-from>${optionHtml}</select><span>×</span><select class="select" data-structure-to>${optionHtml}</select><input class="input" data-structure-relation-note placeholder="หมายเหตุ"><button type="button" class="btn btn-danger btn-sm" data-remove-structure-relationship>ลบ</button>`;
      list.appendChild(row);
      row.querySelector('[data-remove-structure-relationship]')?.addEventListener('click', () => row.remove());
    }));
    document.querySelectorAll('[data-remove-structure-relationship]').forEach((button) => button.addEventListener('click', () => button.closest('[data-structure-relationship]')?.remove()));
  }

  function providerPrepareStructureSchema(schema) {
    const copy = JSON.parse(JSON.stringify(schema || {}));
    (copy.programs || []).forEach((program) => {
      program.scope = ['J','JE','JE1','JXM'].includes(String(program?.scope || '').toUpperCase()) ? String(program.scope).toUpperCase() : providerProgramScope(program);
      program.challenge_mode = String(program?.challenge_mode || 'unknown');
      if (!Array.isArray(program.specimens)) program.specimens = [];
      if (!Array.isArray(program.relationships)) program.relationships = [];
      const ids = new Set(program.specimens.map((item) => String(item?.id || item?.label || '').trim()).filter(Boolean));
      program.relationships.forEach((relationship) => {
        [relationship?.from_specimen, relationship?.to_specimen].forEach((raw) => {
          const id = String(raw || '').trim();
          if (id && !ids.has(id)) { program.specimens.push({ id, label: id, role: 'unknown', abo_group: '', rh_type: '', provider_group_text: '', source_reference: relationship?.source_reference || '' }); ids.add(id); }
        });
      });
      program.specimens = program.specimens.map((specimen) => {
        const text = `${specimen?.label || ''} ${program?.title || ''} ${program?.description || ''}`;
        const role = ['patient','donor','reference','case','unknown'].includes(String(specimen?.role || ''))
          ? String(specimen.role)
          : (/\bDONOR\b/i.test(text) ? 'donor' : String(program.challenge_mode).toLowerCase() === 'dry' ? 'case' : 'patient');
        const abo = String(specimen?.abo_group || text.match(/(?:BLOOD\s+GROUP|GROUP)\s*(AB|A|B|O)\b/i)?.[1] || '').toUpperCase();
        const rhRaw = String(specimen?.rh_type || text.match(/RH(?:\s*TYPE)?\s*[:\-]?\s*(POSITIVE|NEGATIVE|POS|NEG|\+|\-)/i)?.[1] || '').toUpperCase();
        const rh = /POS|\+/.test(rhRaw) ? 'Positive' : /NEG|\-/.test(rhRaw) ? 'Negative' : '';
        return { ...specimen, role, abo_group: abo, rh_type: rh, provider_group_text: String(specimen?.provider_group_text || [abo ? `Blood Group ${abo}` : '', rh ? `Rh ${rh}` : ''].filter(Boolean).join(', ')), source_reference: String(specimen?.source_reference || '') };
      });
    });
    return copy;
  }

  function openRoundStructureReview(round) {
    const rawSchema = generatedResultSchema(round);
    if (!rawSchema) return toast('กรุณาสร้างแบบกรอกจาก Blank Result Form ก่อน', 'warning');
    const schema = providerPrepareStructureSchema(rawSchema);
    showModal('ตรวจโครงสร้างรอบจาก Blank Result Form', providerStructureReviewHtml(schema), `<button class="btn btn-outline" data-close-modal>ปิด</button><button class="btn btn-secondary" id="save-round-structure-draft">บันทึกร่าง</button><button class="btn btn-primary" id="confirm-round-structure">ยืนยันและเปิดใช้งาน</button>`, true);
    providerBindStructureEditor(round, schema);
    document.getElementById('save-round-structure-draft')?.addEventListener('click', async () => {
      try { await providerSaveRoundStructure(round, schema, 'draft'); closeModal(); toast('บันทึกร่างโครงสร้างแล้ว', 'success'); route(); }
      catch (error) { toast(friendlyError(error), 'danger'); }
    });
    document.getElementById('confirm-round-structure')?.addEventListener('click', async () => {
      try { await providerSaveRoundStructure(round, schema, 'confirmed'); closeModal(); toast('ยืนยันโครงสร้างรอบแล้ว', 'success'); route(); }
      catch (error) { toast(friendlyError(error), 'danger'); }
    });
  }

  const PROVIDER_THAI_EXACT = Object.freeze({
    "what is the most appropriate interpretation of the patient's results?": 'ข้อใดเป็นการแปลผลของผู้ป่วยที่เหมาะสมที่สุด',
    'which of the following is the most likely source of the detected antibodies?': 'ข้อใดเป็นแหล่งที่มาของแอนติบอดีที่ตรวจพบได้มากที่สุด',
    'based on the case study findings, which rbcs should be crossmatched and issued to the patient?': 'จากข้อมูลกรณีศึกษา ควร Crossmatch และจ่ายเม็ดเลือดแดงชนิดใดให้ผู้ป่วย',
    'the clinical team considered various potential causes of hemolytic anemia and initiated first-line treatment for suspected pls. which cells are responsible for causing pls?': 'ทีมรักษาสงสัย Passenger Lymphocyte Syndrome (PLS) เซลล์ชนิดใดเป็นสาเหตุของภาวะนี้',
    'the patient is an a1 blood type and has detectable anti-a1 antibodies.': 'ผู้ป่วยเป็นหมู่เลือด A1 และตรวจพบ Anti-A1',
    'the patient is an a1 blood type and has detectable warm autoantibodies.': 'ผู้ป่วยเป็นหมู่เลือด A1 และตรวจพบ Warm autoantibody',
    'the patient is a non-a1 blood type and has naturally-occurring anti-a1 antibodies.': 'ผู้ป่วยเป็นหมู่เลือด A ที่ไม่ใช่ A1 และมี Anti-A1 ที่เกิดขึ้นตามธรรมชาติ',
    'the patient converted to a group o blood type and has naturally-occurring anti-a1 antibodies.': 'ผู้ป่วยเปลี่ยนเป็นหมู่เลือด O และมี Anti-A1 ที่เกิดขึ้นตามธรรมชาติ',
    'naturally-occurring anti-a1 antibodies of recipient origin': 'Anti-A1 ที่เกิดขึ้นตามธรรมชาติจากผู้รับ',
    'passive administration from intravenous immune globulin received six months prior': 'ได้รับแอนติบอดีแบบ passive จาก IVIG เมื่อ 6 เดือนก่อน',
    'passive administration from transfusion of out-of-group blood products': 'ได้รับแอนติบอดีแบบ passive จากการให้ส่วนประกอบโลหิตต่างหมู่',
    'passenger lymphocyte syndrome (pls) from the minor abo-incompatible lung transplant': 'Passenger Lymphocyte Syndrome (PLS) จากการปลูกถ่ายปอดที่มี minor ABO incompatibility',
    'group o, rh-negative rbcs': 'เม็ดเลือดแดงหมู่ O, Rh(D) ลบ',
    'group o, rh-positive rbcs': 'เม็ดเลือดแดงหมู่ O, Rh(D) บวก',
    'group a, rh-negative rbcs': 'เม็ดเลือดแดงหมู่ A, Rh(D) ลบ',
    'group a, rh-positive rbcs': 'เม็ดเลือดแดงหมู่ A, Rh(D) บวก',
    'donor b lymphocytes': 'B lymphocyte ของผู้บริจาคอวัยวะ',
    'donor t lymphocytes': 'T lymphocyte ของผู้บริจาคอวัยวะ',
    'recipient b lymphocytes': 'B lymphocyte ของผู้รับ',
    'recipient t lymphocytes': 'T lymphocyte ของผู้รับ',
    'group a': 'หมู่ A', 'group b': 'หมู่ B', 'group ab': 'หมู่ AB', 'group o': 'หมู่ O',
    'group a1': 'หมู่ A1', 'group asub': 'หมู่ A subgroup', 'group a1b': 'หมู่ A1B', 'group asubb': 'หมู่ A subgroup B',
    'abo subtyping not performed': 'ไม่ได้ตรวจ ABO subgroup',
    'rh positive': 'Rh(D) บวก', 'rh negative': 'Rh(D) ลบ',
    'unexpected antibody not detected': 'ไม่พบแอนติบอดีผิดปกติ',
    'unexpected antibody detected': 'พบแอนติบอดีผิดปกติ',
    'negative': 'ลบ', 'positive': 'บวก', 'would refer for testing': 'ส่งตรวจต่อ',
    'immediate spin only': 'Immediate spin',
    'antiglobulin crossmatch with igg ahg': 'Antiglobulin crossmatch ด้วย IgG AHG',
    'antiglobulin crossmatch with polyspecific ahg': 'Antiglobulin crossmatch ด้วย Polyspecific AHG',
    'microscopic reaction': 'ปฏิกิริยาระดับ microscopic', '1+ reaction': 'ปฏิกิริยา 1+', '2+ reaction': 'ปฏิกิริยา 2+', '3+ reaction': 'ปฏิกิริยา 3+', '4+ reaction': 'ปฏิกิริยา 4+',
    'not applicable': 'ไม่เกี่ยวข้อง', 'reagent not available': 'ไม่มีน้ำยา', 'test not indicated': 'ไม่จำเป็นต้องตรวจ',
    'antibody identification not indicated (no antibody detected)': 'ไม่จำเป็นต้องทำ Antibody identification (ไม่พบแอนติบอดี)',
    'unable to complete testing or would refer to outside laboratory for testing': 'ไม่สามารถตรวจให้เสร็จหรือส่งตรวจภายนอก',
    'serum/plasma and cell group do not agree; additional testing or sample required': 'ผล Cell grouping และ Serum/Plasma grouping ไม่สอดคล้อง ต้องตรวจเพิ่มหรือขอตัวอย่างใหม่'
  });

  function providerThaiText(value) {
    const original = String(value || '').trim();
    if (!original) return '';
    const numberPrefix = original.match(/^(\d+[.)]\s*)/);
    const core = numberPrefix ? original.slice(numberPrefix[0].length).trim() : original;
    const exact = PROVIDER_THAI_EXACT[core.toLowerCase()] || PROVIDER_THAI_EXACT[original.toLowerCase()];
    if (exact) return `${numberPrefix ? numberPrefix[0] : ''}${exact}`;
    let text = original;
    const replacements = [
      [/^Specimen\s+/i, 'ตัวอย่าง '],
      [/Blood Group A,?\s*Rh Negative/gi, 'หมู่ A, Rh(D) ลบ'],
      [/Blood Group A,?\s*Rh Positive/gi, 'หมู่ A, Rh(D) บวก'],
      [/ABO Subgroups \(Ungraded\)\s*\/\s*Subtyping selection/gi, 'ผล ABO subgroup (ไม่ให้คะแนน)'],
      [/ABO Manufacturer Code(?: \(box\))?/gi, 'รหัสผู้ผลิตน้ำยา ABO'],
      [/ABO Method Code(?: \(box\))?/gi, 'รหัสวิธีตรวจ ABO'],
      [/ABO Exception Code/gi, 'รหัสข้อยกเว้น ABO'],
      [/Anti-D Manufacturer Code(?: \(Anti-D column header\))?/gi, 'รหัสผู้ผลิตน้ำยา Anti-D'],
      [/Anti-D Method Code(?: \(Anti-D column header\))?/gi, 'รหัสวิธีตรวจ Anti-D'],
      [/D Control Manufacturer Code/gi, 'รหัสผู้ผลิตน้ำยา D control'],
      [/D Control Method Code/gi, 'รหัสวิธีตรวจ D control'],
      [/Unexpected Antibody Detection/gi, 'ผลคัดกรองแอนติบอดีผิดปกติ'],
      [/Screening Cell(?: Code)?/gi, 'รหัส Screening cell'],
      [/Primary Antibody/gi, 'แอนติบอดีหลัก'],
      [/Additional Antibodies/gi, 'แอนติบอดีเพิ่มเติม'],
      [/Primary Manufacturer Code/gi, 'รหัสผู้ผลิต Panel หลัก'],
      [/Primary Method Code/gi, 'รหัสวิธีตรวจ Panel หลัก'],
      [/Secondary Manufacturer Code/gi, 'รหัสผู้ผลิต Panel ที่สอง'],
      [/Secondary Method Code/gi, 'รหัสวิธีตรวจ Panel ที่สอง'],
      [/Serologic Crossmatch Result/gi, 'ผล Serologic crossmatch'],
      [/Type of Crossmatch/gi, 'ชนิด Crossmatch'],
      [/Strength of Reaction/gi, 'ความแรงของปฏิกิริยา'],
      [/Manufacturer Code/gi, 'รหัสผู้ผลิตน้ำยา'],
      [/Method Code/gi, 'รหัสวิธีตรวจ'],
      [/Exception Code/gi, 'รหัสข้อยกเว้น'],
      [/Interpretation/gi, 'ผลการแปลผล'],
      [/Identification of Other Red Cell Antigens\/Antisera/gi, 'ชื่อ Antigen / รหัส Antisera อื่น'],
      [/Anti-A \(ABO typing\)/gi, 'Anti-A (Cell grouping)'],
      [/Anti-B \(ABO typing\)/gi, 'Anti-B (Cell grouping)'],
      [/Anti-A1 \(ABO subtyping \/ if performed\)/gi, 'Anti-A1 (ตรวจ subgroup หากทำ)'],
      [/Anti-A,B \(ABO typing\)/gi, 'Anti-A,B (Cell grouping)'],
      [/A1 Cells \(reverse typing\)/gi, 'A1 cells (Serum grouping)'],
      [/B Cells \(reverse typing\)/gi, 'B cells (Serum grouping)'],
      [/Instrument \/ system used \(free text\)/gi, 'เครื่องมือหรือระบบที่ใช้'],
      [/Enter observed reactivity\/result as on form/gi, 'กรอกผลปฏิกิริยาตามที่ตรวจได้'],
      [/Enter observed reactivity\/result or leave if not performed/gi, 'กรอกผล หรือเว้นว่างหากไม่ได้ตรวจ'],
      [/Enter observed reactivity\/result/gi, 'กรอกผลปฏิกิริยา'],
      [/Enter manufacturer code as on form/gi, 'กรอกรหัสผู้ผลิตตามแบบฟอร์ม'],
      [/Enter method code as on form/gi, 'กรอกรหัสวิธีตรวจตามแบบฟอร์ม'],
      [/Select an option/gi, 'เลือกผล'],
      [/Column Agglutination \(Gel Testing\)/gi, 'วิธีเจล Column agglutination'],
      [/Column Agglutination \(semi-automated\)/gi, 'Column agglutination แบบกึ่งอัตโนมัติ'],
      [/Tube Testing/gi, 'วิธีหลอดทดลอง'],
      [/Liquid Micro Well Testing/gi, 'วิธี Liquid micro well'],
      [/Solid Phase Red Cell Adherence/gi, 'วิธี Solid phase'],
      [/Other manufacturer, specify on result form/gi, 'ผู้ผลิตอื่น ระบุในแบบฟอร์ม'],
      [/Other, specify on result form/gi, 'อื่น ๆ ระบุในแบบฟอร์ม'],
      [/Case Study/gi, 'กรณีศึกษา'],
      [/Dry Challenge/gi, 'กรณีศึกษาแบบแห้ง']
    ];
    replacements.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
    return text;
  }

  function providerThaiSpecimenLabel(value) {
    return providerThaiText(value)
      .replace(/^Donor\s+/i, 'Donor ')
      .replace(/\(Blood Group A, Rh Negative\)/i, '(หมู่ A, Rh(D) ลบ)');
  }

  const CAP_CODE_OPTIONS = Object.freeze({
    reaction: [
      { code: '1', label: 'NT' },
      { code: '2', label: 'POS' },
      { code: '3', label: 'NEG' }
    ],
    aboGroup: [
      { code: '188', label: 'Group A' },
      { code: '191', label: 'Group B' },
      { code: '192', label: 'Group AB' },
      { code: '195', label: 'Group O' },
      { code: '199', label: 'Serum/Plasma and cell group do not agree; additional testing or sample required' }
    ],
    aboSubgroup: [
      { code: '189', label: 'Group A1' },
      { code: '124', label: 'Group Asub' },
      { code: '193', label: 'Group A1B' },
      { code: '125', label: 'Group AsubB' },
      { code: '105', label: 'ABO subtyping not performed' }
    ],
    rhType: [
      { code: '207', label: 'Rh positive' },
      { code: '208', label: 'Rh negative' }
    ],
    antibodyScreen: [
      { code: '110', label: 'Unexpected antibody not detected' },
      { code: '111', label: 'Unexpected antibody detected' }
    ],
    crossmatchResult: [
      { code: '29', label: 'Negative' },
      { code: '30', label: 'Positive' },
      { code: '20', label: 'Would refer for testing' }
    ],
    crossmatchType: [
      { code: '58', label: 'Immediate spin only' },
      { code: '59', label: 'Antiglobulin crossmatch with IgG AHG' },
      { code: '60', label: 'Antiglobulin crossmatch with polyspecific AHG' }
    ],
    strength: [
      { code: '24', label: 'Microscopic reaction' },
      { code: '25', label: '1+ reaction' },
      { code: '26', label: '2+ reaction' },
      { code: '27', label: '3+ reaction' },
      { code: '28', label: '4+ reaction' },
      { code: '80', label: 'Not applicable' }
    ],
    antigenResult: [
      { code: '209', label: 'Negative' },
      { code: '210', label: 'Positive' },
      { code: '235', label: 'Reagent not available' },
      { code: '435', label: 'Test not indicated' }
    ],
    exception: [
      { code: '11', label: 'Unable to analyze' },
      { code: '33', label: 'Specimen unsatisfactory' }
    ],
    manufacturer: [
      { code: '125', label: 'Laboratory developed' },
      { code: '113', label: 'Alba Bioscience (Quotient Biodiagnostics)' },
      { code: '120', label: 'American Red Cross' },
      { code: '183', label: 'Bio-Rad / DiaMed' },
      { code: '115', label: 'DBL NOVACLONE Blood Grouping Reagent' },
      { code: '123', label: 'Grifols' },
      { code: '119', label: 'Immucor' },
      { code: '118', label: 'Medion Diagnostics' },
      { code: '121', label: 'Ortho-Clinical Diagnostics' },
      { code: '112', label: 'Siemens' },
      { code: '111', label: 'Selected cells from any of these in this list' },
      { code: '010', label: 'Other manufacturer, specify on result form' }
    ],
    aboMethod: [
      { code: '29', label: 'Column Agglutination (Gel Testing)' },
      { code: '96', label: 'Column Agglutination (semi-automated)' },
      { code: '28', label: 'Liquid Micro Well Testing' },
      { code: '27', label: 'Solid Phase Red Cell Adherence' },
      { code: '26', label: 'Tube Testing' },
      { code: '01', label: 'Other, specify on result form' }
    ],
    dControlMethod: [
      { code: '26', label: 'Tube Testing' },
      { code: '27', label: 'Solid Phase Red Cell Adherence' },
      { code: '28', label: 'Liquid Micro Well Testing' },
      { code: '29', label: 'Column Agglutination (Gel Testing)' },
      { code: '96', label: 'Column Agglutination (semi-automated)' },
      { code: '88', label: 'D control not run; control not required by method' },
      { code: '01', label: 'Other, specify on result form' }
    ],
    screeningCell: [
      { code: '1891', label: 'Two cell suspensions used separately' },
      { code: '2207', label: 'Three cell suspensions used separately' },
      { code: '2382', label: 'Four cell suspensions used separately' },
      { code: '1892', label: 'One suspension of pooled cells prepared by the manufacturer' },
      { code: '1893', label: 'One suspension of pooled cells prepared by the user' },
      { code: '0010', label: 'Other, specify in final section' }
    ],
    antibodyMethod: [
      { code: '10', label: 'Saline - AHG' },
      { code: '11', label: 'Albumin - AHG' },
      { code: '12', label: 'LISS - AHG' },
      { code: '13', label: 'PEG - AHG' },
      { code: '14', label: 'Other tube testing' },
      { code: '27', label: 'Solid Phase Red Cell Adherence' },
      { code: '28', label: 'Liquid Micro Well Testing' },
      { code: '29', label: 'Column Agglutination (Gel Testing)' },
      { code: '96', label: 'Column Agglutination (semi-automated)' },
      { code: '01', label: 'Other, specify on result form' }
    ],
    antibody: [
      { code: '184', label: 'Antibody identification not indicated (no antibody detected)' },
      { code: '200', label: 'Unable to complete testing or would refer to outside laboratory for testing' },
      { code: '112', label: 'Anti-D' },
      { code: '113', label: 'Anti-C' },
      { code: '114', label: 'Anti-c' },
      { code: '115', label: 'Anti-E' },
      { code: '116', label: 'Anti-e' },
      { code: '124', label: 'Anti-K' },
      { code: '125', label: 'Anti-k' },
      { code: '126', label: 'Anti-Fya' },
      { code: '127', label: 'Anti-Fyb' },
      { code: '128', label: 'Anti-Jka' },
      { code: '129', label: 'Anti-Jkb' },
      { code: '131', label: 'Anti-Lea' },
      { code: '132', label: 'Anti-Leb' },
      { code: '133', label: 'Anti-P1' },
      { code: '134', label: 'Anti-M' },
      { code: '135', label: 'Anti-N' },
      { code: '136', label: 'Anti-S' },
      { code: '137', label: 'Anti-s' },
      { code: '147', label: 'Antibody to other (nonlisted) high incidence antigen' },
      { code: '148', label: 'Antibody to other (nonlisted) low incidence antigen' },
      { code: '149', label: 'Warm autoantibody, specificity unknown' },
      { code: '010', label: 'Other, specify on result form' }
    ],
    otherAntigen: [
      { code: '112', label: 'Anti-D' },
      { code: '124', label: 'Anti-K' },
      { code: '125', label: 'Anti-k' },
      { code: '126', label: 'Anti-Fya' },
      { code: '127', label: 'Anti-Fyb' },
      { code: '128', label: 'Anti-Jka' },
      { code: '129', label: 'Anti-Jkb' },
      { code: '131', label: 'Anti-Lea' },
      { code: '132', label: 'Anti-Leb' },
      { code: '133', label: 'Anti-P1' },
      { code: '134', label: 'Anti-M' },
      { code: '135', label: 'Anti-N' },
      { code: '136', label: 'Anti-S' },
      { code: '137', label: 'Anti-s' },
      { code: '147', label: 'Antibody to other (nonlisted) high incidence antigen' },
      { code: '148', label: 'Antibody to other (nonlisted) low incidence antigen' },
      { code: '010', label: 'Other, specify on result form' }
    ]
  });

  function providerNormalizedOption(option) {
    const rawValue = String(option?.value ?? '').trim();
    let code = String(option?.code || '').trim();
    let label = String(option?.label ?? rawValue ?? code).trim();
    if (!code && /^\d{1,4}$/.test(rawValue) && label && label !== rawValue) code = rawValue;
    if (!code) {
      const prefixed = label.match(/^\s*(\d{1,4})\s*(?:[|│:–—-]+)\s*(.+)$/);
      if (prefixed) {
        code = prefixed[1];
        label = prefixed[2].trim();
      }
    }
    if (code) {
      const originalLabel = label;
      const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      label = label
        .replace(new RegExp(`^\\s*${escapedCode}\\s*(?:[|│:–—-]+)\\s*`, 'i'), '')
        .replace(new RegExp(`\\s*\\(?\\s*CAP\\s*${escapedCode}\\s*\\)?\\s*$`, 'i'), '')
        .trim() || originalLabel;
    }
    const value = String(code || rawValue || label).trim();
    return { code, label, value };
  }

  function providerFieldText(field, context = {}) {
    return `${field?.key || ''} ${field?.label || ''} ${field?.placeholder || ''} ${context?.category || ''} ${context?.program?.key || ''} ${context?.program?.title || ''}`.replace(/\s+/g, ' ').trim();
  }

  function providerResolvedOptions(field, context = {}) {
    const existing = (Array.isArray(field?.options) ? field.options : []).map(providerNormalizedOption).filter((option) => option.value || option.label);
    const text = providerFieldText(field, context);
    const upper = text.toUpperCase();
    const category = String(context?.category || '').toLowerCase();
    const cleanLabel = providerCapFieldLabel(field).toUpperCase();
    let options = null;
    let forceCanonical = false;

    // These two provider fields are frequently extracted from the blank form with
    // malformed pseudo-codes (for example "4+ | 4+") or as free-text inputs.
    // Always replace them with the official CAP master-list choices.
    if (/STRENGTH\s+OF\s+REACTION/.test(upper)) {
      options = CAP_CODE_OPTIONS.strength;
      forceCanonical = true;
    } else if (
      !/INTERPRETATION|\bRESULT\b/.test(upper)
      && (
        /OTHER\s+RED\s+CELL\s+ANTISERA\s+USED/.test(upper)
        || /(?:ENTER|SPECIFY)\s+ANTISERA\s+CODE/.test(upper)
        || /ANTISERA\s+CODE\s*\d*/.test(upper)
        || /IDENTIFICATION\s+OF\s+OTHER\s+RED\s+CELL\s+ANTIGENS/.test(upper)
        || /ANTIGENS?\s*\/\s*ANTISERA/.test(upper)
        || /OTHER\s+RED\s+CELL\s+ANTIGEN/.test(upper)
      )
    ) {
      options = CAP_CODE_OPTIONS.otherAntigen;
      forceCanonical = true;
    }

    // CAP reporting-code fields must use the correct master list for their own
    // semantic role. OCR/AI extraction can mistakenly copy the Screening Cell
    // value (for example 2207) into Manufacturer Code and Method Code, so these
    // three fields must never reuse extracted pseudo-options.
    if (!options && /SCREENING\s+CELL/.test(upper) && /CODE|BOX/.test(upper)) {
      options = CAP_CODE_OPTIONS.screeningCell;
      forceCanonical = true;
    } else if (!options && /MANUFACTURER\s+CODE/.test(upper)) {
      options = CAP_CODE_OPTIONS.manufacturer;
      forceCanonical = true;
    } else if (!options && /METHOD\s+CODE/.test(upper)) {
      if (/D\s*CONTROL/.test(upper)) options = CAP_CODE_OPTIONS.dControlMethod;
      else if (/ABO|ANTI-D|RH\s+TYPE/.test(upper) && !/ANTIBODY|CROSSMATCH/.test(upper)) options = CAP_CODE_OPTIONS.aboMethod;
      else options = CAP_CODE_OPTIONS.antibodyMethod;
      forceCanonical = true;
    }

    // Options extracted directly from the provider form normally win, except for
    // canonical CAP fields above where extracted values are unreliable.
    if (!forceCanonical && existing.some((option) => option.code)) return existing;

    // Raw ABO/Rh reaction fields use the worksheet codes 1=NT, 2=POS, 3=NEG.
    // Match these before Antigen typing so Anti-A/Anti-B are never mapped to 209/210.
    if (!options && !/MANUFACTURER|METHOD|EXCEPTION|ANTIBODY/.test(upper) && /^(?:ANTI-A(?:1|,B)?|ANTI-B|A1 CELLS?|B CELLS?|ANTI-D|D CONTROL)(?:\s*\(|$)/.test(cleanLabel)) options = CAP_CODE_OPTIONS.reaction;
    else if (!options && /PRIMARY\s+ANTIBODY/.test(upper)) options = CAP_CODE_OPTIONS.antibody;
    else if (!options && /ADDITIONAL\s+ANTIBOD/.test(upper)) options = CAP_CODE_OPTIONS.antibody.filter((option) => !['184', '200'].includes(option.code));
    else if (!options && /SEROLOGIC\s+CROSSMATCH\s+RESULT|CROSSMATCH\s+RESULT/.test(upper)) options = CAP_CODE_OPTIONS.crossmatchResult;
    else if (!options && /TYPE\s+OF\s+CROSSMATCH/.test(upper)) options = CAP_CODE_OPTIONS.crossmatchType;
    else if (!options && /ABO\s+SUBGROUP/.test(upper)) options = CAP_CODE_OPTIONS.aboSubgroup;
    else if (!options && /\bABO\s+GROUP\b/.test(upper) && !/GROUP\s*\/\s*RH/.test(upper)) options = CAP_CODE_OPTIONS.aboGroup;
    else if (!options && /\bRH(?:\(D\))?\s+TYPE\b|RH\s+POSITIVE|RH\s+NEGATIVE/.test(upper) && !/METHOD|MANUFACTURER/.test(upper)) options = CAP_CODE_OPTIONS.rhType;
    else if (!options && /UNEXPECTED\s+ANTIBODY.*(?:RESULT|DETECTION)|ANTIBODY\s+SCREEN(?:ING)?\s+RESULT/.test(upper)) options = CAP_CODE_OPTIONS.antibodyScreen;
    else if (!options && /EXCEPTION\s+CODE/.test(upper)) options = CAP_CODE_OPTIONS.exception;
    else if (!options && category === 'antigen' && (/INTERPRETATION|\bRESULT\b|^ANTI[- ]?(?:C|E|K|FYA|FYB|JKA|JKB|LEA|LEB|P1|M|N|S)$/.test(cleanLabel))) options = CAP_CODE_OPTIONS.antigenResult;

    if (!options && existing.length) return existing;
    return (options || []).map(providerNormalizedOption);
  }

  function providerCapFieldLabel(field) {
    let label = String(field?.label || field?.key || '').trim();
    const replacements = [
      [/Anti-A \(ABO typing\)/gi, 'Anti-A'],
      [/Anti-B \(ABO typing\)/gi, 'Anti-B'],
      [/Anti-A1 \(ABO subtyping \/ if performed\)/gi, 'Anti-A1'],
      [/Anti-A,B \(ABO typing\)/gi, 'Anti-A,B'],
      [/A1 Cells \(reverse typing\)/gi, 'A1 Cells'],
      [/B Cells \(reverse typing\)/gi, 'B Cells'],
      [/\s*\(box\)\s*/gi, ''],
      [/\s*\(Anti-D column header\)\s*/gi, ''],
      [/Rh Type per reagent column.*$/gi, 'Rh Type'],
      [/Unexpected Antibody Screen result.*$/gi, 'Unexpected Antibody Detection'],
      [/Identification of Other Red Cell Antigens\/Antisera/gi, 'Identification of Other Red Cell Antigens / Antisera']
    ];
    replacements.forEach(([pattern, replacement]) => { label = label.replace(pattern, replacement); });
    return label.replace(/\s+/g, ' ').trim();
  }

  function providerIsWorksheetReactionField(program, field) {
    const scope = providerProgramScope(program);
    if (!['J', 'JXM'].includes(scope)) return false;

    const programFields = Array.isArray(program?.specimen_fields) ? program.specimen_fields : [];
    const hasOfficialFinalResult = programFields.some((candidate) => {
      const text = providerFieldText(candidate, { program }).toUpperCase();
      return /\bABO\s+GROUP\b/.test(text) || /\bRH(?:\(D\))?\s+TYPE\b/.test(text);
    });
    if (!hasOfficialFinalResult) return false;

    const label = providerCapFieldLabel(field).toUpperCase().replace(/\s+/g, ' ').trim();
    return /^(?:ANTI-A|ANTI-B|ANTI-A1|ANTI-A,B|A1 CELLS?|B CELLS?|ANTI-D|D CONTROL)$/.test(label);
  }

  function providerCapSpecimenLabel(value) {
    const raw = String(value || '').trim().replace(/^Specimen\s+/i, '');
    const explicitPair = raw.match(/^(J-\d{2})R\s*[\/–-]\s*(J-\d{2})S$/i);
    if (explicitPair) return `${explicitPair[1].toUpperCase()}R / ${explicitPair[1].toUpperCase()}S`;
    const single = raw.match(/^(J-\d{2})(R|S)?$/i);
    if (single && (!single[2] || single[2].toUpperCase() === 'S')) return `${single[1].toUpperCase()}R / ${single[1].toUpperCase()}S`;
    return raw.replace(/\(Blood Group A,\s*Rh Negative\)/i, '(Blood Group A, Rh Negative)');
  }

  function providerOptionMatches(option, value) {
    const normalizeComparable = (input) => String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[|│:–—-]+/g, ' ')
      .replace(/\breaction\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const current = normalizeComparable(value);
    if (!current) return false;
    const candidates = [option?.value, option?.code, option?.label, `${option?.code || ''} │ ${option?.label || ''}`]
      .map(normalizeComparable)
      .filter(Boolean);
    return candidates.includes(current);
  }

  function providerOptionDisplay(option) {
    const normalized = providerNormalizedOption(option);
    return normalized.code ? `${normalized.code} │ ${normalized.label}` : normalized.label;
  }

  function providerIsReportingCodeField(field) {
    const upper = providerFieldText(field).toUpperCase();
    return /MANUFACTURER\s+CODE|METHOD\s+CODE|EXCEPTION\s+CODE|SCREENING\s+CELL.*(?:CODE|BOX)|INSTRUMENT|SYSTEM\s+USED/.test(upper);
  }

  function providerIsAboGroupResultField(field, context = {}) {
    const upper = providerFieldText(field, context).toUpperCase();
    // CAP blank forms may label the same answer as either “ABO Group” or
    // “ABO primary group”. Treat both as one result field so the UI does not
    // inject a second synthetic ABO question beside the provider question.
    return /\bABO(?:\s+PRIMARY)?\s+GROUP\b/.test(upper)
      && !/SUBGROUP|METHOD|MANUFACTURER|EXCEPTION|GROUP\s*\/\s*RH/.test(upper);
  }

  function providerSyntheticAboGroupField() {
    return {
      key: '__cap_abo_group',
      label: 'ABO Group',
      input_type: 'select',
      required: true,
      options: CAP_CODE_OPTIONS.aboGroup.map((option) => ({ ...option, value: option.code }))
    };
  }

  function providerStoredAboGroup(values = {}) {
    const preferredKeys = ['__cap_abo_group', 'abo_group', 'abo'];
    for (const key of preferredKeys) {
      const value = String(values?.[key] || '').trim();
      if (value) return value;
    }
    const dynamic = Object.entries(values || {}).find(([key, value]) => {
      const upper = String(key || '').toUpperCase();
      return value != null && String(value).trim() && /ABO.*GROUP/.test(upper) && !/SUB/.test(upper);
    });
    return dynamic ? String(dynamic[1]).trim() : '';
  }

  function providerPreferredSpecimenAnswerId(specimenIds = []) {
    const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return ids.find((id) => /S\b/i.test(id)) || ids[0] || '';
  }

  function providerScopedFieldLabel(field, specimenIds = []) {
    let label = providerCapFieldLabel(field);
    const currentSpecimenId = providerPreferredSpecimenAnswerId(specimenIds);
    if (!currentSpecimenId) return label;

    const specimenMatch = String(currentSpecimenId).toUpperCase().match(/(?:JE|J)[-_ ]?\d{1,3}[RS]?/);
    const displayId = specimenMatch ? specimenMatch[0].replace(/[_ ]+/g, '-') : String(currentSpecimenId).trim();
    const specimenRange = /(?:JE|J)[-_ ]?\d{1,3}[RS]?\s*(?:\.{2,3}|…|–|—|\bTO\b|\bTHROUGH\b)\s*(?:JE|J)[-_ ]?\d{1,3}[RS]?/gi;
    const perSpecimenRange = new RegExp(`\\s*[-–—]?\\s*per\\s+specimen\\s+${specimenRange.source}`, 'gi');

    if (perSpecimenRange.test(label)) {
      label = label.replace(perSpecimenRange, ` — ${displayId}`);
    } else {
      label = label.replace(specimenRange, displayId);
    }
    return label.replace(/\s+/g, ' ').trim();
  }

  function providerFieldBlock(row) {
    const label = String(row?.displayLabel || providerCapFieldLabel(row.field));
    const requiredMark = row.field?.required ? '<span class="cap-required" aria-label="required">*</span>' : '';
    return `<div class="cap-form-question"><div class="cap-form-question-label">${esc(label)} ${requiredMark}</div>${row.html}</div>`;
  }

  function generatedOptionLabel(option) {
    return providerOptionDisplay(option);
  }

  function generatedFieldControl(field, value, attributes, disabled, context = {}) {
    const inputType = String(field?.input_type || 'text');
    const required = field?.required ? 'required' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const placeholderText = String(field?.placeholder || '').trim();
    const placeholder = placeholderText ? `placeholder="${esc(placeholderText)}"` : '';
    const options = providerResolvedOptions(field, context);
    if (options.length) {
      if (options.length <= 5) {
        const radioName = `cap-${providerDomToken(`${attributes}-${field?.key || field?.label || 'field'}`)}`;
        return `<div class="cap-choice-control"><div class="cap-choice-list" role="radiogroup" aria-label="${esc(providerCapFieldLabel(field))}">${options.map((option, index) => {
          const normalized = providerNormalizedOption(option);
          const checked = providerOptionMatches(normalized, value) ? 'checked' : '';
          const requiredAttr = field?.required && index === 0 ? 'required' : '';
          return `<label class="cap-choice-option"><input type="radio" name="${esc(radioName)}" value="${esc(normalized.value)}" ${attributes} ${checked} ${requiredAttr} ${disabledAttr}><span class="cap-choice-dot" aria-hidden="true"></span><span class="cap-choice-copy">${normalized.code ? `<strong>${esc(normalized.code)}</strong><span class="cap-choice-divider">│</span>` : ''}<span>${esc(normalized.label)}</span></span></label>`;
        }).join('')}</div>${!disabled ? `<button type="button" class="cap-clear-choice" data-clear-cap-radio="${esc(radioName)}">Clear selection</button>` : ''}</div>`;
      }
      return `<select class="select cap-code-select" ${attributes} ${required} ${disabledAttr}><option value="">— Select —</option>${options.map((option) => {
        const normalized = providerNormalizedOption(option);
        return `<option value="${esc(normalized.value)}" ${providerOptionMatches(normalized, value) ? 'selected' : ''}>${esc(providerOptionDisplay(normalized))}</option>`;
      }).join('')}</select>`;
    }
    if (inputType === 'textarea') {
      return `<textarea class="textarea" ${attributes} ${required} ${disabledAttr} ${placeholder}>${esc(value || '')}</textarea>`;
    }
    if (inputType === 'number') {
      return `<input class="input" type="number" step="any" inputmode="decimal" value="${esc(value || '')}" ${attributes} ${required} ${disabledAttr} ${placeholder}>`;
    }
    return `<input class="input" type="text" value="${esc(value || '')}" ${attributes} ${required} ${disabledAttr} ${placeholder}>`;
  }

  const PROVIDER_FIELD_GROUPS = Object.freeze([
    ['abo_rh', 'ABO Group / Rh Type'],
    ['screening', 'Unexpected Antibody'],
    ['antibody_id', 'Antibody Identification'],
    ['crossmatch', 'Crossmatch / Compatibility Testing'],
    ['antigen', 'Identification of Red Cell Antigens'],
    ['other', 'Additional Information']
  ]);

  function providerProgramScope(program) {
    const explicitScope = String(program?.scope || '').toUpperCase();
    if (['J','JE','JE1','JXM'].includes(explicitScope)) return explicitScope;
    const challengeMode = String(program?.challenge_mode || '').toLowerCase();
    const specimenText = (Array.isArray(program?.specimens) ? program.specimens : [])
      .map((item) => `${item?.id || ''} ${item?.label || ''}`)
      .join(' ');
    const text = `${program?.key || ''} ${program?.title || ''} ${program?.description || ''} ${specimenText}`.toUpperCase();
    if (challengeMode === 'dry' || /DRY\s*CHALLENGE|EDUCATIONAL\s*CHALLENGE|\bJE1\b|JE-\d+/.test(text) && /DRY|CASE/.test(text)) return 'JE1';
    if (/\bJXM\b|ELECTRONIC\s*CROSSMATCH/.test(text)) return 'JXM';
    if (/\bJE\b|\bJE1\b|JE-\d+/.test(text)) return 'JE';
    if (/\bJ\b|J-\d+/.test(text)) return 'J';
    return String(program?.key || 'OTHER').toUpperCase();
  }

  function providerScopeLabel(scope, programs = []) {
    const dry = programs.some((program) => String(program?.challenge_mode || '').toLowerCase() === 'dry');
    if (scope === 'J') return 'Part J';
    if (scope === 'JE1') return dry ? 'JE1 กรณีศึกษาแบบแห้ง' : 'Part JE1';
    if (scope === 'JE') return dry ? 'JE กรณีศึกษาแบบแห้ง' : 'Part JE';
    if (scope === 'JXM') return 'Part JXM';
    return programs[0]?.title || scope;
  }

  function providerDomToken(value) {
    return String(value || 'item').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  function providerSpecimenOrder(value) {
    const text = String(value || '').toUpperCase();
    const match = text.match(/(?:JE|J|EXM|ELU|TRC|AABT)[-_ ]?(\d+)/);
    const number = match ? Number(match[1]) : 9999;
    const suffix = /DONOR/.test(text) ? 9 : /R\b/.test(text) ? 2 : /S\b/.test(text) ? 1 : 0;
    return number * 10 + suffix;
  }

  function providerFieldCategory(program, field) {
    // Classify from the actual field first. Program titles often mention every test type,
    // so using the whole program text can incorrectly turn ABO fields into Antigen typing.
    const fieldText = `${field?.key || ''} ${field?.label || ''} ${field?.placeholder || ''}`.toLowerCase();
    const programText = `${program?.key || ''} ${program?.title || ''} ${program?.description || ''}`.toLowerCase();
    if (/crossmatch|compatib|strength\s*of\s*reaction|serologic\s*result/.test(fieldText)) return 'crossmatch';
    if (/primary\s*antibody|additional\s*antibod|antibody\s*ident|\babid\b|panel|selected\s*cell|extra\s*cell|rule\s*of\s*3/.test(fieldText)) return 'antibody_id';
    if (/unexpected\s*antibody|antibody\s*screen|screening\s*cell/.test(fieldText)) return 'screening';
    if (/\babo\b|\brh\b|anti[-_ ]?a(?:1|,b)?\b|anti[-_ ]?b\b|anti[-_ ]?d\b|a1\s*cells?|b\s*cells?|d\s*control|subgroup/.test(fieldText)) return 'abo_rh';
    if (/antigen\s*typing|red\s*cell\s*antigen|antisera|anti[-_ ]?(?:c|e|k|fya|fyb|jka|jkb|lea|leb|p1|m|n|s)\b|\bphenotype\b|ag[_ -]?typing/.test(fieldText)) return 'antigen';
    // Fall back to program scope only for generic fields.
    if (/crossmatch|compatib/.test(programText)) return 'crossmatch';
    if (/antibody\s*ident|\babid\b/.test(programText)) return 'antibody_id';
    if (/screen/.test(programText)) return 'screening';
    if (/antigen\s*typing|red\s*cell\s*antigen|ag[_ -]?typing/.test(programText)) return 'antigen';
    if (/\babo\b|\brh\b/.test(programText)) return 'abo_rh';
    return 'other';
  }

  function providerInstructionBuckets(instruction) {
    const text = String(instruction || '').trim();
    if (!text) return [];
    const blocks = text
      .replace(/\r/g, '')
      .split(/\n(?=\s*\d+\)\s)|\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
    const buckets = { shared: [], J: [], JXM: [], JE1: [] };
    blocks.forEach((block) => {
      const upper = block.toUpperCase();
      if (/JE-\d+|\bJE1\b|DRY\s*CHALLENGE|CASE\s*STUDY|ELUATE|ANTI-A1|PASSENGER\s*LYMPHOCYTE|\bDAT\b/.test(upper)) buckets.JE1.push(block);
      else if (/\bJXM\b|ELECTRONIC\s*CROSSMATCH|SIMULATED\s*DONOR|ISBT|\bLIS\b/.test(upper)) buckets.JXM.push(block);
      else if (/\bABO\b|\bRH\b|ANTIBODY|CROSSMATCH|ANTIGEN|TESTING\s*INSTRUCTION/.test(upper)) buckets.J.push(block);
      else buckets.shared.push(block);
    });
    const labels = { shared: 'ข้อมูลร่วมของรอบ', J: 'Part J', JXM: 'Part JXM', JE1: 'Part JE1 / Dry Challenge' };
    return Object.entries(buckets)
      .filter(([, rows]) => rows.length)
      .map(([key, rows]) => ({ key, label: labels[key], text: rows.join('\n\n') }));
  }

  function providerInstructionDetails(instruction) {
    if (!String(instruction || '').trim()) return '';
    return `<details class="provider-instruction-compact">
      <summary><span>คำแนะนำสำคัญ</span><span class="provider-instruction-open-label">เปิดดู</span></summary>
      <div class="provider-instruction-summary-grid">
        <section><h4>Part J</h4><ul><li>กรอกเฉพาะรายการที่ห้องปฏิบัติการตรวจจริง</li><li>หากทำ Antibody identification ต้องกรอกผล แม้ผลคัดกรองเป็นลบ</li><li>Crossmatch ให้บันทึกผลตามจริงและเลือกชนิดวิธีตรวจให้ตรง</li></ul></section>
        <section><h4>JE1 แบบแห้ง</h4><ul><li>อ่านกรณีศึกษาและผลตรวจทั้งหมดก่อนตอบ</li><li>เลือกคำตอบตามรหัส CAP ในแบบฟอร์ม</li><li>คำตอบของแต่ละคนถูกเก็บแยกและไม่แสดงให้ผู้อื่นเห็นก่อนส่ง</li></ul></section>
        <section><h4>รหัสข้อยกเว้น</h4><ul><li>11 = ไม่สามารถวิเคราะห์ได้</li><li>33 = ตัวอย่างไม่เหมาะสม</li><li>เว้นช่องผลที่ใช้รหัสข้อยกเว้น</li></ul></section>
      </div>
    </details>`;
  }

  function providerExtractReaction(text, labelPattern) {
    const match = String(text || '').match(new RegExp(`(?:${labelPattern})[^\n\r]{0,55}?(4\\+|3\\+|2\\+|1\\+|0|NEG(?:ATIVE)?|POS(?:ITIVE)?|NT)`, 'i'));
    const reaction = match?.slice(1).find(Boolean) || '';
    return String(reaction).toUpperCase();
  }

  function providerLabTable(title, headers, rows) {
    const usable = rows.filter((row) => row.slice(1).some(Boolean));
    if (!usable.length) return '';
    return `<div class="provider-case-table-card"><h4>${esc(title)}</h4><div class="provider-case-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${usable.map((row) => `<tr>${row.map((cell, index) => `<${index === 0 ? 'th' : 'td'}>${esc(cell || '-')}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }

  const JE14_FALLBACK_CASE = Object.freeze({
    case_id: 'JE-14',
    title: 'JE-14',
    narrative: '45-year-old man with interstitial lung disease underwent bilateral lung transplantation. Pre-operative testing: Group A, Rh-positive; antibody screen negative. The organ donor was Group O, Rh-positive. Two RBC units were transfused perioperatively.\n\nOn post-operative day 10, the patient developed jaundice, indirect hyperbilirubinemia, elevated LDH, and hemoglobin decreased from 9.0 g/dL to 6.9 g/dL. A type and crossmatch and DAT were ordered.',
    findings: [
      'ABO/Rh: Anti-A 4+, Anti-B 0, Anti-D 4+, A1 cells 2+, B cells 4+',
      'Antibody screen: SC1 0, SC2 0, SC3 0',
      'DAT: Polyspecific 3+, Anti-IgG 3+, Anti-C3d 2+',
      'Eluate panel: SC1 AHG 0 CC 4+ LW 0; SC2 AHG 0 CC 4+ LW 0; SC3 AHG 0 CC 4+ LW 0; A1 cells #1 AHG 3+ CC NT LW 0; A1 cells #2 AHG 3+ CC NT LW 0; A1 cells #3 AHG 3+ CC NT LW 0; B cells #1 AHG 0 CC 4+ LW 0; B cells #2 AHG 0 CC 4+ LW 0; B cells #3 AHG 0 CC 4+ LW 0',
      'Additional studies: Anti-A1 was detected in the patient plasma by IAT. The pre-transfusion specimen was A1 lectin-positive (4+).'
    ],
    source_location: 'Kit Instructions, pages 4–5'
  });

  function providerCaseReference(programs = []) {
    return programs.flatMap((program) => program.specimens || [])
      .map((item) => String(item?.id || item?.label || '').trim())
      .find(Boolean) || '';
  }

  function providerNormalizeCaseKey(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9ก-๙]+/g, '');
  }

  function providerStructuredDryCase(programs = []) {
    const target = providerNormalizeCaseKey(providerCaseReference(programs));
    const candidates = [];
    (state.instructionExtractions || []).forEach((document) => {
      const extraction = document?.ai_extraction || {};
      (Array.isArray(extraction.case_studies) ? extraction.case_studies : []).forEach((item) => {
        const key = providerNormalizeCaseKey(item?.case_id || item?.title);
        const narrative = String(item?.narrative || '').trim();
        const findings = Array.isArray(item?.findings) ? item.findings.map((row) => String(row || '').trim()).filter(Boolean) : [];
        candidates.push({ ...item, narrative, findings, _key: key, _score: narrative.length + findings.join(' ').length + 10000 });
      });
      (Array.isArray(extraction.document_sections) ? extraction.document_sections : [])
        .filter((section) => String(section?.section_role || '') === 'case_study')
        .forEach((section) => {
          const refs = Array.isArray(section?.case_references) ? section.case_references : [];
          const key = providerNormalizeCaseKey(refs[0] || section?.section_id || section?.title);
          const narrative = String(section?.content_summary || '').trim();
          const findings = Array.isArray(section?.instructions) ? section.instructions.map((row) => String(row || '').trim()).filter(Boolean) : [];
          candidates.push({ case_id: refs[0] || section?.section_id, title: section?.title, narrative, findings, source_location: section?.source_location, _key: key, _score: narrative.length + findings.join(' ').length });
        });
    });
    const matched = candidates
      .filter((item) => !target || item._key === target || item._key.includes(target) || target.includes(item._key))
      .sort((a, b) => Number(b._score || 0) - Number(a._score || 0))[0];
    if (matched && (matched.narrative.length > 300 || matched.findings.length >= 3)) return { ...matched, _requiresRefresh: false };
    if (/JE14/.test(target)) return { ...JE14_FALLBACK_CASE, narrative: '', _requiresRefresh: true };
    return matched ? { ...matched, _requiresRefresh: true } : null;
  }

  function providerDryCaseDetails(instruction, programs = []) {
    const structured = providerStructuredDryCase(programs);
    const fallbackText = String(instruction || '').trim();
    if (!structured && !fallbackText) return '';
    const narrative = String(structured?.narrative || '').trim();
    const findings = Array.isArray(structured?.findings) ? structured.findings.filter(Boolean) : [];
    const caseText = [narrative, ...findings].filter(Boolean).join('\n');
    const caseLabel = structured?.case_id || structured?.title || providerCaseReference(programs) || 'Case Study';
    const structuredTables = Array.isArray(structured?.lab_tables) ? structured.lab_tables.filter((table) => Array.isArray(table?.headers) && Array.isArray(table?.rows)) : [];
    const exactTableHtml = structuredTables.map((table) => {
      const headers = ['', ...(table.headers || []).map((item) => String(item || '').trim())];
      const rows = (table.rows || []).map((row) => [String(row?.label || '').trim(), ...(Array.isArray(row?.values) ? row.values.map((item) => String(item || '').trim()) : [])]);
      return providerLabTable(String(table.title || 'Laboratory results'), headers, rows);
    }).join('');

    const aboRows = [['Result', providerExtractReaction(caseText, '\\bAnti[- ]?A(?!1)\\b'), providerExtractReaction(caseText, '\\bAnti[- ]?B\\b'), providerExtractReaction(caseText, '\\bAnti[- ]?D\\b'), providerExtractReaction(caseText, 'A1\\s*cells?'), providerExtractReaction(caseText, 'B\\s*cells?')]];
    const screenRows = ['SC1', 'SC2', 'SC3'].map((cell) => [cell, providerExtractReaction(caseText, `Antibody\\s*screen[^\\n]{0,120}${cell}|${cell}`)]);
    const datRows = [['Result', providerExtractReaction(caseText, 'Polyspecific'), providerExtractReaction(caseText, 'Anti[- ]?IgG'), providerExtractReaction(caseText, 'Anti[- ]?C3d')]];
    const eluateNames = ['SC1', 'SC2', 'SC3', 'A1 cells #1', 'A1 cells #2', 'A1 cells #3', 'B cells #1', 'B cells #2', 'B cells #3'];
    const eluateText = caseText.split(/Eluate\s*panel/i)[1] || caseText;
    const eluateRows = eluateNames.map((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s*');
      const rowMatch = eluateText.match(new RegExp(`${escaped}[^;\\n\\r]{0,90}?(4\\+|3\\+|2\\+|1\\+|0|NT)[^;\\n\\r]{0,45}?(4\\+|3\\+|2\\+|1\\+|0|NT)[^;\\n\\r]{0,45}?(4\\+|3\\+|2\\+|1\\+|0|NT)`, 'i'));
      return [name, rowMatch?.[1] || '', rowMatch?.[2] || '', rowMatch?.[3] || ''];
    });
    const parsedTableHtml = `<div class="provider-case-table-grid">
      ${providerLabTable('ABO/Rh', ['', 'Anti-A', 'Anti-B', 'Anti-D', 'A1 cells', 'B cells'], aboRows)}
      ${providerLabTable('Antibody Screen', ['', 'Result'], screenRows)}
      ${providerLabTable('DAT', ['', 'Polyspecific', 'Anti-IgG', 'Anti-C3d'], datRows)}
      ${providerLabTable('Eluate Panel', ['', 'AHG', 'Check cell', 'Last wash'], eluateRows)}
    </div>`;
    const additionalRows = Array.isArray(structured?.additional_studies) ? structured.additional_studies.map((line) => String(line || '').trim()).filter(Boolean) : [];
    const additional = additionalRows.length
      ? additionalRows.join('\n')
      : findings.filter((line) => /Anti-A1|pre-transfusion|lectin|additional stud/i.test(line)).join('\n').replace(/^Additional studies:\s*/i, '');
    return `<details class="provider-dry-case-details" open>
      <summary><span>Case Study — ${esc(caseLabel)}</span><span>Show / Hide</span></summary>
      <div class="provider-dry-case-body">
        ${structured?._requiresRefresh ? `<div class="notice warning"><strong>Full Case Study ยังไม่ได้อ่านด้วยโครงสร้าง v2.5.1</strong><br>ผู้ดูแลระบบต้องไปที่ “2. เอกสาร/ภาพ” แล้วกด “2. สร้างคำแนะนำจากคู่มือ” อีกครั้ง เพื่ออ่านหน้า Case Study แบบเต็มตามต้นฉบับ โดยไม่ย่อความ</div>` : ''}
        ${narrative ? `<div class="provider-case-narrative"><strong>DRY CHALLENGE (JE1) — CASE STUDY</strong><div>${esc(narrative)}</div></div>` : ''}
        ${exactTableHtml ? `<div class="provider-case-table-grid">${exactTableHtml}</div>` : parsedTableHtml}
        ${additional ? `<div class="notice info provider-additional-study"><strong>Additional Studies</strong><div class="provider-additional-copy">${esc(additional)}</div></div>` : ''}
        ${structured?.source_location ? `<div class="small muted">Source: ${esc(structured.source_location)}</div>` : ''}
      </div>
    </details>`;
  }

  function providerGroupPrograms(schema) {
    const groups = new Map();
    (schema?.programs || []).forEach((program, index) => {
      const scope = providerProgramScope(program);
      if (!groups.has(scope)) groups.set(scope, { scope, programs: [], order: index });
      groups.get(scope).programs.push(program);
    });
    return [...groups.values()].sort((a, b) => {
      const order = { J: 1, JXM: 2, JE: 3, JE1: 4 };
      return (order[a.scope] || 20 + a.order) - (order[b.scope] || 20 + b.order);
    });
  }

  function providerGroupSpecimens(group, schema) {
    const map = new Map();
    group.programs.forEach((program) => {
      (program.specimens || []).forEach((item) => {
        const id = String(item?.id || item?.label || '').trim();
        if (!id) return;
        const current = map.get(id) || {};
        map.set(id, {
          ...current,
          ...item,
          id,
          label: String(item?.label || current?.label || id),
          role: String(item?.role || current?.role || 'unknown')
        });
      });
      // Relationship-only IDs remain available, but are marked unknown until the
      // Admin confirms the structure. This avoids hard-coding JA/JB specimen numbers.
      (program.relationships || []).forEach((relationship) => {
        [relationship?.from_specimen, relationship?.to_specimen].forEach((raw) => {
          const id = String(raw || '').trim();
          if (id && !map.has(id)) map.set(id, { id, label: id, role: 'unknown' });
        });
      });
    });
    (schema?.antigen_sections || []).forEach((section) => {
      const id = String(section?.specimen_id || '').trim();
      if (!id) return;
      const inferred = providerProgramScope({ key: id, specimens: [{ id }] });
      if (inferred === group.scope && !map.has(id)) map.set(id, { id, label: id, role: 'unknown' });
    });

    let rows = [...map.values()].map((item) => ({ ...item, sourceIds: [item.id] }));

    const mergePhysicalPairs = (items, prefix) => {
      const pairedByBase = new Map();
      const unpaired = [];
      items.forEach((row) => {
        const isDonor = row.role === 'donor' || /\bDONOR\b/i.test(String(row.label || ''));
        if (isDonor) { unpaired.push(row); return; }
        const match = `${row.id || ''} ${row.label || ''}`.match(new RegExp(`\\b(${prefix}[-_ ]?\\d{1,3})(R|S)\\b`, 'i'));
        if (!match) { unpaired.push(row); return; }
        const base = match[1].replace(/[_ ]+/g, '-').toUpperCase();
        if (!pairedByBase.has(base)) pairedByBase.set(base, []);
        pairedByBase.get(base).push(row);
      });
      const pairedRows = [...pairedByBase.entries()].map(([base, members]) => {
        const sourceIds = [...new Set(members.flatMap((row) => row.sourceIds || [row.id]))];
        const hasR = members.some((row) => /R\b/i.test(`${row.id || ''} ${row.label || ''}`));
        const hasS = members.some((row) => /S\b/i.test(`${row.id || ''} ${row.label || ''}`));
        if (hasR && hasS) return { ...members[0], id: `${base}R/${base}S`, label: `${base}R / ${base}S`, sourceIds, role: 'patient' };
        return { ...members[0], sourceIds };
      });
      return pairedRows.concat(unpaired);
    };

    if (group.scope === 'J') rows = mergePhysicalPairs(rows, 'J');
    if (group.scope === 'JE') {
      // A donor used only as a Crossmatch reference belongs in the relationship,
      // not as a separate JE answer tab. This works for JE-07, future JE specimens,
      // and future rounds with different donor numbers.
      rows = rows.filter((row) => !(row.role === 'donor' || /\bDONOR\b/i.test(String(row.label || ''))));
      rows = mergePhysicalPairs(rows, 'JE');
    }

    return rows.sort((a, b) => providerSpecimenOrder(a.id) - providerSpecimenOrder(b.id) || a.id.localeCompare(b.id, 'en'));
  }

  function providerRelationshipHtml(programs, specimenIds) {
    const ids = new Set((Array.isArray(specimenIds) ? specimenIds : [specimenIds]).map((value) => String(value || '').trim()).filter(Boolean));
    const relationships = programs.flatMap((program) => program.relationships || []).filter((relationship) => {
      const from = String(relationship?.from_specimen || '').trim();
      const to = String(relationship?.to_specimen || '').trim();
      return ids.has(from) || ids.has(to);
    });
    if (!relationships.length) return '';
    const labels = [...new Set(relationships.map((relationship) => {
      const from = String(relationship?.from_specimen || '').trim();
      const to = String(relationship?.to_specimen || '').trim();
      const other = ids.has(from) ? to : from;
      if (ids.has(other)) return '';
      const type = String(relationship?.type || '').toLowerCase();
      if (/crossmatch|compatib/.test(type) || /crossmatch|compatib/i.test(String(relationship?.note || ''))) return `Crossmatch กับ ${other || 'Donor'}`;
      return other ? `เกี่ยวข้องกับ ${other}` : '';
    }).filter(Boolean))];
    return labels.length ? `<div class="provider-relationship-chips">${labels.map((label) => `<span>${esc(label)}</span>`).join('')}</div>` : '';
  }


  function providerCanonicalSpecimenId(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/\bSPECIMEN\b/g, '')
      .replace(/[^A-Z0-9]+/g, '');
  }

  function providerSpecimenIdMatches(left, right) {
    const a = providerCanonicalSpecimenId(left);
    const b = providerCanonicalSpecimenId(right);
    return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  }

  function providerExplicitFieldSpecimenIds(field) {
    const text = [field?.key, field?.label, field?.placeholder, field?.source_reference]
      .map((value) => String(value || ''))
      .join(' ')
      .toUpperCase();
    const ids = [];
    const pattern = /(?:^|[^A-Z0-9])(?:DONOR[^A-Z0-9]*)?((?:JE|J)[^A-Z0-9]*\d{1,3}[RS]?)(?=$|[^A-Z0-9])/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = providerCanonicalSpecimenId(match[1]);
      if (id) ids.push(id);
    }
    return [...new Set(ids)];
  }

  function providerProgramAntigenTargetSpecimenIds(program) {
    const fieldTargets = [...new Set((program?.specimen_fields || [])
      .flatMap((field) => providerExplicitFieldSpecimenIds(field)))];
    if (fieldTargets.length) return fieldTargets;

    // Some extracted schemas keep the donor/specimen reference only in the
    // antigen section heading, not in every field label. A single target in the
    // program heading is safe to use; a multi-specimen heading remains unscoped
    // and is handled by the donor-only fallback during rendering.
    const headingTargets = providerExplicitFieldSpecimenIds({
      key: program?.key,
      label: `${program?.title || ''} ${program?.description || ''}`,
      source_reference: program?.source_reference
    });
    return headingTargets.length === 1 ? headingTargets : [];
  }

  function providerTargetIdsMatchSpecimen(targetIds, specimenIds) {
    if (!targetIds?.length) return true;
    const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds])
      .map((value) => providerCanonicalSpecimenId(value))
      .filter(Boolean);
    return targetIds.some((target) => ids.some((id) => providerSpecimenIdMatches(target, id)));
  }

  function providerProgramText(program) {
    return [
      program?.key,
      program?.title,
      program?.description,
      ...(Array.isArray(program?.specimens) ? program.specimens.flatMap((item) => [item?.id, item?.label]) : []),
      ...(Array.isArray(program?.relationships) ? program.relationships.flatMap((item) => [item?.type, item?.from_specimen, item?.to_specimen, item?.note]) : []),
    ].map((value) => String(value || '')).join(' ');
  }

  function providerProgramIsCrossmatch(program) {
    if (/CROSSMATCH|COMPATIB/i.test(providerProgramText(program))) return true;
    return (program?.specimen_fields || []).some((field) => providerFieldCategory(program, field) === 'crossmatch');
  }

  function providerDonorMetadata(group, specimen) {
    const sourceIds = Array.isArray(specimen?.sourceIds) && specimen.sourceIds.length ? specimen.sourceIds : [specimen?.id];
    const idText = sourceIds.join(' ');
    const schemaSpecimens = (group?.programs || []).flatMap((program) => (program?.specimens || []).filter((item) => sourceIds.some((id) => providerSpecimenIdMatches(item?.id || item?.label, id))));
    const explicitRole = schemaSpecimens.map((item) => String(item?.role || '')).find(Boolean) || '';
    const contextRows = [String(specimen?.label || ''), idText, ...schemaSpecimens.flatMap((item) => [item?.label, item?.provider_group_text, item?.source_reference])];
    let explicitDonor = explicitRole === 'donor' || /\bDONOR\b/i.test(contextRows.join(' '));

    (group?.programs || []).forEach((program) => {
      const programText = providerProgramText(program);
      const referencesSpecimen = sourceIds.some((id) => providerSpecimenIdMatches(programText, id));
      if (referencesSpecimen) contextRows.push(programText);
      sourceIds.forEach((id) => {
        const escaped = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_ ]+/g, '[-_ ]*');
        if (escaped && new RegExp(`DONOR\\s*${escaped}`, 'i').test(programText)) explicitDonor = true;
      });
    });

    const relationshipDonor = (group?.programs || []).some((program) => (program.relationships || []).some((relationship) => {
      const relationText = `${relationship?.type || ''} ${relationship?.note || ''} ${program?.title || ''} ${program?.description || ''}`;
      if (!/CROSSMATCH|COMPATIB/i.test(relationText)) return false;
      const from = String(relationship?.from_specimen || '');
      const to = String(relationship?.to_specimen || '');
      const currentIsFrom = sourceIds.some((id) => providerSpecimenIdMatches(from, id));
      const currentIsTo = sourceIds.some((id) => providerSpecimenIdMatches(to, id));
      if (!currentIsFrom && !currentIsTo) return false;
      const other = currentIsFrom ? to : from;
      const currentLooksRbc = sourceIds.some((id) => /R\b/i.test(String(id)));
      const otherLooksSerum = /S\b/i.test(other);
      return currentLooksRbc && otherLooksSerum && (/DONOR/i.test(relationText) || !/DONOR/i.test(String(other)));
    }));

    let isDonor = explicitDonor || relationshipDonor;
    const combined = contextRows.join(' ');
    const donorId = sourceIds.find((id) => /(?:JE|J)[-_ ]?\d{1,2}R\b/i.test(String(id))) || sourceIds[0] || specimen?.id || 'Donor';
    const explicitAbo = schemaSpecimens.map((item) => String(item?.abo_group || '').trim()).find(Boolean) || '';
    const explicitRh = schemaSpecimens.map((item) => String(item?.rh_type || '').trim()).find(Boolean) || '';
    const groupMatch = combined.match(/(?:BLOOD\s+GROUP|GROUP)\s*(AB|A|B|O)\b/i);
    const rhMatch = combined.match(/RH(?:\s*TYPE)?\s*[:\-]?\s*(POSITIVE|NEGATIVE|POS|NEG|\+|\-)/i);
    let abo = explicitAbo.toUpperCase() || (groupMatch ? groupMatch[1].toUpperCase() : '');
    const rhRaw = String(explicitRh || rhMatch?.[1] || '').toUpperCase();
    let rh = /POS|\+/.test(rhRaw) ? 'Positive' : /NEG|\-/.test(rhRaw) ? 'Negative' : '';
    // Current CAP J/JE 2026 blank forms explicitly identify these donor units.
    // Keep a deterministic fallback so an older generated schema still renders
    // the correct provider-supplied donor group without asking staff to re-enter it.
    const normalizedDonor = providerCanonicalSpecimenId(donorId);
    const roundCode = String(state.currentRound?.round_code || '').toUpperCase();
    // Legacy generated schemas may omit role=donor even though the official
    // CAP J-A/J-B form identifies these reference red-cell specimens as donors.
    // Mark them deterministically so patient tabs never inherit donor-only fields.
    if (normalizedDonor === 'J06R' && /J\/?JE-A|J-A/.test(roundCode)) isDonor = true;
    if (normalizedDonor === 'J13R' && /J\/?JE-B|J-B/.test(roundCode)) isDonor = true;
    // CAP J-A 2026 page 4 explicitly identifies Donor J-06R as
    // Blood Group O, Rh Positive. Keep a deterministic fallback for legacy
    // generated schemas that omitted the provider-supplied donor group.
    if (!abo && !rh && normalizedDonor === 'J06R' && /J\/?JE-A|J-A/.test(roundCode)) { abo = 'O'; rh = 'Positive'; }
    if (!abo && !rh && normalizedDonor === 'J13R' && /J\/?JE-B|J-B/.test(roundCode)) { abo = 'A'; rh = 'Negative'; }
    const knownGroup = [abo ? `Group ${abo}` : '', rh ? `Rh ${rh}` : ''].filter(Boolean).join(', ');
    return { isDonor, donorId, sourceIds, abo, rh, knownGroup };
  }

  function providerGroupDonors(group, specimens) {
    return (specimens || []).map((specimen) => ({ specimen, meta: providerDonorMetadata(group, specimen) })).filter((row) => row.meta.isDonor);
  }

  function providerSerumSpecimenId(value) {
    const text = String(value || '');
    const match = text.match(/\b((?:JE|J)[-_ ]?\d{1,2}S)\b/i);
    return match ? match[1].replace(/[_ ]+/g, '-').toUpperCase() : text.trim();
  }

  function providerLinkedCrossmatchSpecimens(group, donorMeta) {
    const donorIds = donorMeta?.sourceIds || [donorMeta?.donorId];
    const linked = [];
    (group?.programs || []).forEach((program) => {
      if (!providerProgramIsCrossmatch(program)) return;
      (program.relationships || []).forEach((relationship) => {
        const from = String(relationship?.from_specimen || '').trim();
        const to = String(relationship?.to_specimen || '').trim();
        const donorIsFrom = donorIds.some((id) => providerSpecimenIdMatches(from, id));
        const donorIsTo = donorIds.some((id) => providerSpecimenIdMatches(to, id));
        if (!donorIsFrom && !donorIsTo) return;
        const other = donorIsFrom ? to : from;
        if (other && !donorIds.some((id) => providerSpecimenIdMatches(other, id))) linked.push(providerSerumSpecimenId(other));
      });
    });
    if (!linked.length) {
      (group?.programs || []).filter(providerProgramIsCrossmatch).forEach((program) => {
        (program.specimens || []).forEach((item) => {
          const id = String(item?.id || item?.label || '').trim();
          if (!id || donorIds.some((donorId) => providerSpecimenIdMatches(id, donorId))) return;
          if (/S\b/i.test(id) || /SERUM|PLASMA/i.test(`${item?.label || ''} ${program?.title || ''}`)) linked.push(providerSerumSpecimenId(id));
        });
      });
    }
    // Some older JA/JB schemas contain only the first donor relationship even
    // though the provider form contains five crossmatch rows. Complete the matrix
    // deterministically from the round and donor ID without requiring regeneration.
    const normalizedDonor = providerCanonicalSpecimenId(donorMeta?.donorId);
    const roundCode = String(state.currentRound?.round_code || '').toUpperCase();
    if (group?.scope === 'J' && normalizedDonor === 'J06R' && /J\/?JE-A|J-A/.test(roundCode)) {
      for (let number = 1; number <= 5; number += 1) linked.push(`J-${String(number).padStart(2, '0')}S`);
    }
    if (group?.scope === 'J' && normalizedDonor === 'J13R' && /J\/?JE-B|J-B/.test(roundCode)) {
      for (let number = 8; number <= 12; number += 1) linked.push(`J-${String(number).padStart(2, '0')}S`);
    }
    return [...new Set(linked)].sort((a, b) => providerSpecimenOrder(a) - providerSpecimenOrder(b) || a.localeCompare(b, 'en'));
  }

  function providerLinkedCrossmatchDonorIds(group, specimenIds) {
    const ids = (Array.isArray(specimenIds) ? specimenIds : [specimenIds]).map((value) => String(value || '').trim()).filter(Boolean);
    const linked = [];
    (group?.programs || []).forEach((program) => {
      if (!providerProgramIsCrossmatch(program)) return;
      (program.relationships || []).forEach((relationship) => {
        const from = String(relationship?.from_specimen || '').trim();
        const to = String(relationship?.to_specimen || '').trim();
        const currentIsFrom = ids.some((id) => providerSpecimenIdMatches(from, id));
        const currentIsTo = ids.some((id) => providerSpecimenIdMatches(to, id));
        if (!currentIsFrom && !currentIsTo) return;
        const other = currentIsFrom ? to : from;
        if (/(?:JE|J)[-_ ]?\d{1,2}R\b/i.test(other)) linked.push(other.replace(/[_ ]+/g, '-').toUpperCase());
      });
    });
    const roundCode = String(state.currentRound?.round_code || '').toUpperCase();
    if (group?.scope === 'JE' && ids.some((id) => /^JE-?0?7[RS]?$/i.test(id)) && /J\/?JE-A|J-A/.test(roundCode)) linked.push('J-06R');
    return [...new Set(linked)];
  }

  function providerCrossmatchFieldRole(field, program) {
    const text = providerFieldText(field, { program }).toUpperCase();
    if (/STRENGTH\s+OF\s+REACTION|REACTION\s+STRENGTH/.test(text)) return 'strength';
    if (/TYPE\s+OF\s+CROSSMATCH|CROSSMATCH\s+TYPE/.test(text)) return 'type';
    if (/SEROLOGIC\s+CROSSMATCH\s+RESULT|CROSSMATCH\s+RESULT|COMPATIBILITY\s+RESULT/.test(text)) return 'result';
    return `other:${String(field?.key || text)}`;
  }

  function providerSyntheticCrossmatchFields() {
    const toOptions = (rows) => rows.map((option) => ({ value: option.code, label: option.label, code: option.code }));
    return [
      { key: 'crossmatch_result', label: 'Serologic Crossmatch Result', input_type: 'select', required: true, placeholder: '', options: toOptions(CAP_CODE_OPTIONS.crossmatchResult) },
      { key: 'crossmatch_type', label: 'Type of Crossmatch', input_type: 'select', required: false, placeholder: '', options: toOptions(CAP_CODE_OPTIONS.crossmatchType) },
      { key: 'crossmatch_strength', label: 'Strength of Reaction', input_type: 'select', required: false, placeholder: '', options: toOptions(CAP_CODE_OPTIONS.strength) },
    ];
  }

  function providerCrossmatchFieldTemplates(group) {
    const rows = [];
    (group?.programs || []).filter(providerProgramIsCrossmatch).forEach((program) => {
      (program.specimen_fields || []).forEach((field) => {
        if (providerFieldCategory(program, field) !== 'crossmatch') return;
        const role = providerCrossmatchFieldRole(field, program);
        if (!['result', 'type', 'strength'].includes(role)) return;
        rows.push({ program, field, role });
      });
    });
    const byRole = new Map();
    rows.forEach((row) => { if (!byRole.has(row.role)) byRole.set(row.role, row); });
    const fallbackProgram = (group?.programs || []).find(providerProgramIsCrossmatch) || group?.programs?.[0] || {};
    providerSyntheticCrossmatchFields().forEach((field) => {
      const role = providerCrossmatchFieldRole(field, fallbackProgram);
      if (!byRole.has(role)) byRole.set(role, { program: fallbackProgram, field, role });
    });
    const order = { result: 1, type: 2, strength: 3 };
    return [...byRole.values()].sort((a, b) => (order[a.role] || 20) - (order[b.role] || 20));
  }

  function providerStoredFieldValue(candidates, field, role) {
    const directKey = String(field?.key || '');
    for (const values of candidates) {
      if (!values || typeof values !== 'object') continue;
      const direct = String(values[directKey] || '').trim();
      if (direct) return direct;
      const semantic = Object.entries(values).find(([key, value]) => {
        if (!String(value || '').trim()) return false;
        const upper = String(key || '').toUpperCase();
        if (role === 'result') return /CROSSMATCH.*RESULT|SEROLOGIC.*RESULT/.test(upper);
        if (role === 'type') return /CROSSMATCH.*TYPE|TYPE.*CROSSMATCH/.test(upper);
        if (role === 'strength') return /STRENGTH|REACTION/.test(upper);
        return false;
      });
      if (semantic) return String(semantic[1]).trim();
    }
    return '';
  }

  function providerDonorCrossmatchHtml(group, donorMeta, storedById, methodsByProgram, prefix, disabled, showReportingCodes) {
    const linked = providerLinkedCrossmatchSpecimens(group, donorMeta);
    if (!linked.length) return '';
    const templates = providerCrossmatchFieldTemplates(group);
    const donorValues = donorMeta.sourceIds.map((id) => storedById[id] || {}).filter(Boolean);
    const cards = linked.map((specimenId) => {
      const exactValues = storedById[specimenId] || {};
      const matchedValues = Object.entries(storedById || {})
        .filter(([key]) => providerSpecimenIdMatches(key, specimenId))
        .map(([, values]) => values);
      const candidates = [exactValues, ...matchedValues, ...(linked.length === 1 ? donorValues : [])];
      const fields = templates.map((row) => {
        const fieldKey = String(row.field?.key || '');
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(specimenId)}" data-provider-field="${esc(fieldKey)}"`;
        const value = providerStoredFieldValue(candidates, row.field, row.role);
        return providerFieldBlock({ ...row, context: { program: row.program, category: 'crossmatch' }, html: generatedFieldControl(row.field, value, attrs, disabled, { program: row.program, category: 'crossmatch' }) });
      }).join('');
      return `<article class="provider-crossmatch-specimen-card"><div class="provider-crossmatch-specimen-title"><strong>${esc(providerCapSpecimenLabel(specimenId))}</strong><span>× ${esc(providerCapSpecimenLabel(donorMeta.donorId))}</span></div><div class="cap-form-grid">${fields}</div></article>`;
    }).join('');

    const methodRows = [];
    (group?.programs || []).filter(providerProgramIsCrossmatch).forEach((program) => {
      (program.method_fields || []).forEach((field) => methodRows.push({ program, field }));
    });
    const seenMethodKeys = new Set();
    const methodHtml = showReportingCodes && methodRows.length ? `<details class="provider-method-card"><summary>CAP reporting codes / Crossmatch method</summary><div class="cap-form-grid cap-reporting-code-grid">${methodRows.filter((row) => {
      const token = `${row.program?.key || ''}:${row.field?.key || ''}`;
      if (seenMethodKeys.has(token)) return false;
      seenMethodKeys.add(token);
      return true;
    }).map((row) => {
      const fieldKey = String(row.field?.key || '');
      const programKey = String(row.program?.key || 'PROGRAM');
      const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="method" data-provider-item="${esc(programKey)}" data-provider-field="${esc(fieldKey)}"`;
      return providerFieldBlock({ program: row.program, field: row.field, context: { program: row.program, category: 'method' }, html: generatedFieldControl(row.field, methodsByProgram?.[programKey]?.[fieldKey], attrs, disabled, { program: row.program, category: 'method' }) });
    }).join('')}</div></details>` : '';

    return `<section class="provider-donor-crossmatch provider-test-card"><div class="provider-donor-section-head"><div><h4>Crossmatch / Compatibility Testing</h4><p>บันทึกผลของแต่ละ serum specimen ที่ทดสอบกับ donor นี้</p></div><span class="badge info">${linked.length} คู่ทดสอบ</span></div><div class="provider-crossmatch-specimen-list">${cards}</div>${methodHtml}</section>`;
  }

  function providerDonorSummaryHtml(meta) {
    if (!meta?.isDonor) return '';
    const hasKnownGroup = Boolean(meta.knownGroup);
    const groupText = hasKnownGroup ? meta.knownGroup : 'ไม่แสดงหมู่เลือดของ Donor';
    const note = hasKnownGroup
      ? 'เป็นข้อมูลอ้างอิงจากแบบฟอร์ม CAP ไม่ต้องกรอก ABO/Rh ซ้ำ'
      : 'ใช้เป็น Donor สำหรับ Crossmatch และ Antigen typing โดยไม่สร้างช่อง ABO/Rh ซ้ำ';
    return `<section class="provider-donor-summary"><div><span class="eyebrow">DONOR INFORMATION FROM PROVIDER FORM</span><h4>${esc(providerCapSpecimenLabel(meta.donorId))}</h4></div><div class="provider-donor-blood-group"><strong>${esc(groupText)}</strong><span>${esc(note)}</span></div></section>`;
  }

  function providerSpecimenCards(group, schema, specimens, antigenTyping, methodsByProgram, prefix, disabled, formOptions = {}) {
    const evidenceContext = formOptions?.evidenceContext || null;
    const showReportingCodes = formOptions?.showReportingCodes !== false;
    const groupDonors = providerGroupDonors(group, specimens);
    const centralizeDonorCrossmatch = group.scope === 'J' && groupDonors.length > 0;
    return specimens.map((specimen, specimenIndex) => {
      const categorized = new Map(PROVIDER_FIELD_GROUPS.map(([key]) => [key, []]));
      const donorMeta = providerDonorMetadata(group, specimen);
      const relevantPrograms = [];
      const sourceIds = Array.isArray(specimen.sourceIds) && specimen.sourceIds.length ? specimen.sourceIds : [specimen.id];
      const storedById = state.currentResultPayload?.specimens || {};
      const preferredSourceId = sourceIds.find((id) => /S\b/i.test(String(id))) || sourceIds[0] || specimen.id;
      const primarySpecimenValues = sourceIds
        .map((id) => storedById[id] || {})
        .sort((a, b) => Object.values(b).filter((value) => value != null && String(value).trim()).length - Object.values(a).filter((value) => value != null && String(value).trim()).length)[0] || {};
      group.programs.forEach((program) => {
        const programSpecimenIds = (program.specimens || []).map((item) => String(item?.id || item?.label || '')).filter(Boolean);
        const matchingSourceIds = sourceIds.filter((id) => programSpecimenIds.includes(id));
        const hasSpecimen = matchingSourceIds.length > 0;
        const hasRelationship = (program.relationships || []).some((relationship) => [relationship?.from_specimen, relationship?.to_specimen].map(String).some((id) => sourceIds.includes(id)));
        if (hasSpecimen || hasRelationship) relevantPrograms.push(program);
        if (!hasSpecimen) return;
        const storageSpecimenId = matchingSourceIds.find((id) => /S\b/i.test(String(id))) || matchingSourceIds[0] || preferredSourceId;
        const values = storedById[storageSpecimenId] || primarySpecimenValues;
        (program.specimen_fields || []).forEach((field) => {
          // The CAP Kit Instruction worksheet contains 1=NT, 2=POS, 3=NEG reaction rows.
          // Those rows are for the laboratory worksheet only and are not CAP Result Form
          // submission fields. When final ABO Group/Rh Type reporting fields exist, omit
          // these worksheet-only reactions from the official result-entry form.
          if (providerIsWorksheetReactionField(program, field)) return;
          const fieldKey = String(field?.key || '');
          const category = providerFieldCategory(program, field);
          // A provider program can list all Part J specimens even when an Antigen
          // typing block is explicitly labelled for one donor (for example Donor
          // J-06R or J-13R). Apply the whole antigen block only to its stated
          // specimen so patient tabs do not inherit donor-only questions.
          if (category === 'antigen') {
            // CAP Part J patient specimens do not contain Red Cell Antigen
            // questions. In J-A and J-B these questions belong only to the
            // donor/reference red-cell specimen, so suppress them on every
            // non-donor Part J tab even when an old AI schema attached an
            // explicit patient ID or copied the block to all specimens.
            if (group.scope === 'J' && !donorMeta.isDonor) return;
            const fieldTargets = providerExplicitFieldSpecimenIds(field);
            const programTargets = providerProgramAntigenTargetSpecimenIds(program);
            const applicableTargets = fieldTargets.length ? fieldTargets : programTargets;
            if (applicableTargets.length && !providerTargetIdsMatchSpecimen(applicableTargets, sourceIds)) return;
            // CAP Part J places Red Cell Antigen questions on the donor/reference
            // specimen page. Older AI schemas sometimes copied that shared block to
            // every patient specimen without retaining “Donor J-xxR” in each field.
            // When the round has a donor, keep unscoped antigen fields on the donor
            // tab only. Explicit patient targets and non-Part-J programs remain valid.
            if (!applicableTargets.length && group.scope === 'J' && groupDonors.length && !donorMeta.isDonor) return;
          }
          // Part J donor/reference specimens are not patient samples. Their ABO/Rh
          // group is supplied on the CAP form, so the answer form keeps only donor
          // antigen typing. Crossmatch is rendered once as a donor-centred matrix.
          if (donorMeta.isDonor && !['antigen', 'other'].includes(category)) return;
          if (!donorMeta.isDonor && centralizeDonorCrossmatch && category === 'crossmatch') return;
          const context = { program, category };
          const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(storageSpecimenId)}" data-provider-field="${esc(fieldKey)}"`;
          // Preserve a draft that was previously saved in the temporary
          // __cap_abo_group field when the official provider field is
          // “ABO primary group”.
          const storedValue = providerIsAboGroupResultField(field, context)
            ? (values[fieldKey] || providerStoredAboGroup(values))
            : values[fieldKey];
          categorized.get(category).push({
            program,
            field,
            context,
            displayLabel: providerScopedFieldLabel(field, sourceIds),
            html: generatedFieldControl(field, storedValue, attrs, disabled, context)
          });
        });
      });
      // Defensive cleanup for schemas generated before donor/reference rules
      // were enforced. A donor tab may contain only antigen typing; crossmatch is
      // added below as one matrix covering all linked serum specimens.
      if (donorMeta.isDonor) {
        [...categorized.keys()].forEach((key) => {
          if (!['antigen', 'other'].includes(key)) categorized.set(key, []);
        });
      }

      // When both a generic/synthetic “ABO Group” and the provider's
      // “ABO primary group” exist, keep one official question only.
      const originalAboRows = categorized.get('abo_rh') || [];
      const aboGroupRows = originalAboRows.filter((row) => providerIsAboGroupResultField(row.field, row.context));
      if (aboGroupRows.length > 1) {
        const preferredAboRow = aboGroupRows.find((row) => /ABO\s+PRIMARY\s+GROUP/i.test(providerFieldText(row.field, row.context)) && !row.context?.synthetic)
          || aboGroupRows.find((row) => !row.context?.synthetic)
          || aboGroupRows[0];
        categorized.set('abo_rh', originalAboRows.filter((row) => !providerIsAboGroupResultField(row.field, row.context) || row === preferredAboRow));
      }

      const aboRows = categorized.get('abo_rh') || [];
      const hasAboGroup = aboRows.some((row) => providerIsAboGroupResultField(row.field, row.context));
      const hasAboReportingContext = aboRows.some((row) => {
        const upper = providerFieldText(row.field, row.context).toUpperCase();
        return /ABO\s+SUBGROUP|\bRH(?:\(D\))?\s+TYPE\b/.test(upper);
      });
      if (!hasAboGroup && hasAboReportingContext && !donorMeta.isDonor) {
        const field = providerSyntheticAboGroupField();
        const context = { program: relevantPrograms[0] || group.programs[0], category: 'abo_rh', synthetic: true };
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(preferredSourceId)}" data-provider-field="${esc(field.key)}"`;
        categorized.get('abo_rh').unshift({
          program: context.program,
          field,
          context,
          html: generatedFieldControl(field, providerStoredAboGroup(primarySpecimenValues), attrs, disabled, context)
        });
      }

      // antigen_sections is a second, legacy storage path separate from
      // program.specimen_fields. It previously bypassed the Part J donor-only
      // filter above and re-added “Identification of Red Cell Antigens” to
      // J-01–J-05 and J-08–J-12. Apply the same hard scope here.
      if (!(group.scope === 'J' && !donorMeta.isDonor)) {
        (schema?.antigen_sections || []).filter((section) => sourceIds.includes(String(section?.specimen_id || ''))).forEach((section) => {
          const antigenSpecimenId = String(section?.specimen_id || specimen.id);
          const values = antigenTyping[antigenSpecimenId] || {};
          (section.fields || []).forEach((field) => {
            const fieldKey = String(field?.key || '');
            const context = { program: section, category: 'antigen' };
            const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="antigen" data-provider-item="${esc(antigenSpecimenId)}" data-provider-field="${esc(fieldKey)}"`;
            categorized.get('antigen').push({
              program: section,
              field,
              context,
              displayLabel: providerScopedFieldLabel(field, [antigenSpecimenId]),
              html: generatedFieldControl(field, values[fieldKey], attrs, disabled, context)
            });
          });
        });
      }
      const linkedCrossmatchSpecimens = donorMeta.isDonor ? providerLinkedCrossmatchSpecimens(group, donorMeta) : [];
      const categoryKeysWithRows = [...categorized.entries()].filter(([, rows]) => rows.length).map(([key]) => key);
      if (donorMeta.isDonor && linkedCrossmatchSpecimens.length) categoryKeysWithRows.push('crossmatch');
      const evidenceDocuments = evidenceContext?.documents || [];
      const linkedCrossmatchDonorIds = !donorMeta.isDonor && categoryKeysWithRows.includes('crossmatch')
        ? providerLinkedCrossmatchDonorIds(group, sourceIds)
        : [];
      const serumId = sourceIds.find((id) => /S\b/i.test(String(id))) || (String(specimen.id || '').replace(/R\/?/i, 'S'));
      const linkedDonorId = linkedCrossmatchDonorIds[0] || '';
      const specimenEvidence = evidenceContext?.showEvidence
        ? providerSpecimenEvidenceHtml(
            evidenceDocuments,
            evidenceContext.imageMap || new Map(),
            sourceIds,
            categoryKeysWithRows,
            donorMeta.isDonor ? donorMeta.donorId : specimen.label,
            {
              donorOnly: donorMeta.isDonor,
              linkedCrossmatchIds: linkedCrossmatchDonorIds,
              crossmatchLabel: linkedDonorId ? `Crossmatch — ${providerCapSpecimenLabel(serumId)} × Donor ${providerCapSpecimenLabel(linkedDonorId)}` : '',
            }
          )
        : '';
      const categoryCards = PROVIDER_FIELD_GROUPS.map(([categoryKey, categoryLabel]) => {
        const rows = categorized.get(categoryKey) || [];
        if (!rows.length) return '';
        const resultRows = rows.filter((row) => !providerIsReportingCodeField(row.field));
        const codeRows = rows.filter((row) => providerIsReportingCodeField(row.field));
        if (!resultRows.length && (!showReportingCodes || !codeRows.length)) return '';
        const resultHtml = resultRows.length ? `<div class="cap-form-grid">${resultRows.map(providerFieldBlock).join('')}</div>` : '';
        const codesHtml = showReportingCodes && codeRows.length ? `<details class="cap-reporting-code-details"><summary>CAP reporting codes / methods</summary><div class="cap-form-grid cap-reporting-code-grid">${codeRows.map(providerFieldBlock).join('')}</div></details>` : '';
        return `<section class="provider-test-card provider-test-${esc(categoryKey)}"><h4>${esc(categoryLabel)}</h4>${resultHtml}${codesHtml}</section>`;
      }).join('');
      const methodRows = relevantPrograms
        .filter((program) => !(centralizeDonorCrossmatch && providerProgramIsCrossmatch(program)))
        .flatMap((program) => (program.method_fields || []).map((field) => ({ program, field, context: { program, category: 'method' } })));
      const methods = showReportingCodes && methodRows.length ? `<details class="provider-method-card"><summary>CAP reporting codes / Method / Manufacturer</summary><div class="cap-form-grid cap-reporting-code-grid">${methodRows.map((row) => {
        const fieldKey = String(row.field?.key || '');
        const programKey = String(row.program?.key || 'PROGRAM');
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="method" data-provider-item="${esc(programKey)}" data-provider-field="${esc(fieldKey)}"`;
        return providerFieldBlock({ ...row, html: generatedFieldControl(row.field, methodsByProgram?.[programKey]?.[fieldKey], attrs, disabled, row.context) });
      }).join('')}</div></details>` : '';
      const donorSummary = providerDonorSummaryHtml(donorMeta);
      const donorCrossmatch = donorMeta.isDonor && centralizeDonorCrossmatch
        ? providerDonorCrossmatchHtml(group, donorMeta, storedById, methodsByProgram, prefix, disabled, showReportingCodes)
        : '';
      const emptyMessage = donorMeta.isDonor
        ? '<div class="notice warning">ไม่พบช่อง Antigen typing จากฟอร์มผู้ให้บริการ กรุณาสร้างแบบกรอกจาก Blank Result Form ใหม่</div>'
        : '<div class="notice warning">No result fields were found for this specimen.</div>';
      return `<section class="provider-specimen-panel" data-provider-specimen-panel="${esc(specimen.id)}" ${specimenIndex ? 'hidden' : ''}>
        <div class="provider-specimen-heading"><div><span class="eyebrow">CAP result entry</span><h3>${esc(providerCapSpecimenLabel(specimen.label))}</h3></div><span class="badge info">1 specimen at a time</span></div>
        ${donorSummary}
        ${donorMeta.isDonor ? '' : providerRelationshipHtml(group.programs, sourceIds)}
        ${specimenEvidence}
        ${donorCrossmatch}
        <div class="provider-test-card-grid">${categoryCards || emptyMessage}</div>
        ${methods}
      </section>`;
    }).join('');
  }

  function providerDryProgramPanel(group, instruction, specimensPayload, prefix, disabled) {
    const questionCards = group.programs.flatMap((program) => (program.specimens || []).flatMap((specimen) => {
      const specimenId = String(specimen?.id || specimen?.label || 'CASE');
      const values = specimensPayload[specimenId] || {};
      return (program.specimen_fields || []).map((field, index) => {
        const fieldKey = String(field?.key || '');
        const context = { program, category: 'dry' };
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(specimenId)}" data-provider-field="${esc(fieldKey)}"`;
        return `<div class="provider-case-question"><div class="provider-case-question-head"><span class="question-number">${index + 1}</span><label>${esc(providerCapFieldLabel(field))}</label></div>${generatedFieldControl(field, values[fieldKey], attrs, disabled, context)}</div>`;
      });
    }));
    return `<div class="provider-dry-page">
      ${providerDryCaseDetails(instruction, group.programs)}
      <section class="provider-dry-question-section"><div class="provider-specimen-heading"><div><span class="eyebrow">JE1 — Dry Challenge</span><h3>CAP questions</h3></div><span class="badge info">${questionCards.length} questions</span></div><div class="provider-case-question-list">${questionCards.join('') || '<div class="notice warning">Questions from the Blank Result Form were not found.</div>'}</div></section>
    </div>`;
  }

  function providerGeneratedResultForm(payload, prefix, disabled, options = {}) {
    const schema = generatedResultSchema();
    if (!schema) return '';
    const p = payload && payload.schema === PROVIDER_GENERATED_SCHEMA ? payload : {};
    const specimensPayload = p.specimens || {};
    const antigenTyping = p.antigen_typing || {};
    const methodsByProgram = p.methods_by_program || {};
    const instruction = String(state.currentRound?.generated_instruction_th || '').trim();
    // ใช้เฉพาะระหว่างการประกอบ HTML เพื่อไม่ต้องส่ง payload ผ่านทุก helper และล้างทันทีหลังสร้าง
    state.currentResultPayload = p;
    const groups = providerGroupPrograms(schema);
    const shellToken = `${providerDomToken(prefix)}-${providerDomToken(schema.schema_version || '1')}`;
    const programPanels = groups.map((group, groupIndex) => {
      const scopeLabel = providerScopeLabel(group.scope, group.programs);
      const isDry = group.programs.some((program) => String(program?.challenge_mode || '').toLowerCase() === 'dry');
      const groupToken = `${shellToken}-${providerDomToken(group.scope)}`;
      if (isDry) {
        return `<section class="provider-program-panel" data-provider-program-panel="${esc(group.scope)}" ${groupIndex ? 'hidden' : ''}>${providerDryProgramPanel(group, instruction, specimensPayload, prefix, disabled)}</section>`;
      }
      const groupSpecimens = providerGroupSpecimens(group, schema);
      return `<section class="provider-program-panel" data-provider-program-panel="${esc(group.scope)}" ${groupIndex ? 'hidden' : ''}>
        <div class="provider-specimen-tabs" role="tablist" aria-label="เลือกตัวอย่างใน ${esc(scopeLabel)}">${groupSpecimens.map((specimen, index) => `<button type="button" class="provider-specimen-tab ${index ? '' : 'active'}" data-provider-specimen-tab="${esc(specimen.id)}" aria-selected="${index ? 'false' : 'true'}">${esc(providerCapSpecimenLabel(specimen.label))}</button>`).join('')}</div>
        ${providerSpecimenCards(group, schema, groupSpecimens, antigenTyping, methodsByProgram, prefix, disabled, options)}
      </section>`;
    }).join('');
    const generalFields = (Array.isArray(schema.general_fields) ? schema.general_fields : [])
      .filter((field) => options?.showReportingCodes !== false || !providerIsReportingCodeField(field));
    const generalHtml = generalFields.length ? `<details class="provider-general-card"><summary>ข้อมูลรวมของรอบ / หมายเหตุ</summary><div class="cap-form-grid cap-reporting-code-grid">${generalFields.map((field) => {
      const fieldKey = String(field?.key || '');
      const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="general" data-provider-field="${esc(fieldKey)}"`;
      return `${providerFieldBlock({ field, context: { category: 'general' }, html: generatedFieldControl(field, p[fieldKey], attrs, disabled, { category: 'general' }) })}`;
    }).join('')}</div></details>` : '';
    const html = `<div class="result-grid provider-generated-result-form" data-provider-form-shell="${esc(shellToken)}">
      <div class="provider-form-intro provider-form-intro-compact"><div><h3>${options?.showReportingCodes === false ? 'Competency result interpretation' : 'CAP result entry'}</h3><p>${options?.showReportingCodes === false ? 'Interpret the raw results. Manufacturer, method, and exception reporting codes are not required in Part 10.' : 'Select the CAP reporting code. Free text is available only where the provider form requires it.'}</p></div></div>
      ${providerInstructionDetails(instruction)}
      <nav class="provider-program-tabs" role="tablist" aria-label="เลือก Part">${groups.map((group, index) => `<button type="button" class="provider-program-tab ${index ? '' : 'active'}" data-provider-program-tab="${esc(group.scope)}" aria-selected="${index ? 'false' : 'true'}">${esc(providerScopeLabel(group.scope, group.programs))}</button>`).join('')}</nav>
      <div class="provider-program-panels">${programPanels}</div>
      ${generalHtml}
    </div>`;
    delete state.currentResultPayload;
    return html;
  }

  function bindProviderGeneratedResultControls(root = document) {
    root.querySelectorAll('[data-provider-form-shell]').forEach((shell) => {
      shell.querySelectorAll('[data-provider-program-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          const target = button.dataset.providerProgramTab;
          shell.querySelectorAll('[data-provider-program-tab]').forEach((item) => {
            const active = item === button;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', String(active));
          });
          shell.querySelectorAll('[data-provider-program-panel]').forEach((panel) => { panel.hidden = panel.dataset.providerProgramPanel !== target; });
        });
      });
      shell.querySelectorAll('[data-provider-program-panel]').forEach((programPanel) => {
        programPanel.querySelectorAll('[data-provider-specimen-tab]').forEach((button) => {
          button.addEventListener('click', () => {
            const target = button.dataset.providerSpecimenTab;
            programPanel.querySelectorAll('[data-provider-specimen-tab]').forEach((item) => {
              const active = item === button;
              item.classList.toggle('active', active);
              item.setAttribute('aria-selected', String(active));
            });
            programPanel.querySelectorAll('[data-provider-specimen-panel]').forEach((panel) => { panel.hidden = panel.dataset.providerSpecimenPanel !== target; });
          });
        });
      });
      shell.querySelectorAll('[data-evidence-url]').forEach((button) => {
        button.addEventListener('click', () => openEvidenceLightbox(button.dataset.evidenceUrl, button.dataset.evidenceTitle, button.dataset.evidenceMime));
      });
      shell.querySelectorAll('[data-clear-cap-radio]').forEach((button) => {
        button.addEventListener('click', () => {
          const radioName = button.dataset.clearCapRadio;
          shell.querySelectorAll('input[type="radio"]').forEach((radio) => { if (radio.name === radioName) radio.checked = false; });
        });
      });
    });
  }


  function collectProviderGeneratedPayload(form, prefix) {
    const schema = generatedResultSchema();
    const payload = {
      schema: PROVIDER_GENERATED_SCHEMA,
      form_schema_version: String(schema?.schema_version || '1'),
      specimens: {},
      antigen_typing: {},
      methods_by_program: {},
      reagents: '',
      instrument: '',
      overall_note: ''
    };
    form.querySelectorAll('[data-provider-field]').forEach((field) => {
      if (field.dataset.providerPrefix !== prefix) return;
      if (field.type === 'radio' && !field.checked) return;
      const group = field.dataset.providerGroup;
      const item = field.dataset.providerItem || '';
      const key = field.dataset.providerField || '';
      const value = String(field.value || '').trim();
      if (group === 'specimen') {
        payload.specimens[item] ||= {};
        payload.specimens[item][key] = value;
        payload.specimens[item].notes ||= '';
      } else if (group === 'antigen') {
        payload.antigen_typing[item] ||= {};
        payload.antigen_typing[item][key] = value;
        payload.antigen_typing[item].notes ||= '';
      } else if (group === 'method') {
        payload.methods_by_program[item] ||= {};
        payload.methods_by_program[item][key] = value;
      } else if (group === 'general') {
        payload[key] = value;
      }
    });
    return payload;
  }

  function defaultCapSpecimenPayload() {
    return {
      abo: '', abo_subgroup: '', rh: '', screen: '', antibody: '', additional_antibodies: '',
      crossmatch: '', crossmatch_type: '', strength: '', notes: '',
      antibody_workup: { panels: [], extra_cells: [] }
    };
  }

  const CAP_OTHER_ANTIGEN_SLOT_COUNT = Object.freeze({
    'J-06R': 3,
    'JE-07R': 3
  });

  function normalizeOtherAntigens(value, slotCount = 0) {
    const rows = Array.isArray(value?.other_antigens)
      ? value.other_antigens.map((row) => ({
          antigen: String(row?.antigen || row?.name || row?.antisera || '').trim(),
          result: String(row?.result || '').trim()
        }))
      : [];
    if (!rows.length && (value?.other_antigen || value?.other_result)) {
      rows.push({
        antigen: String(value?.other_antigen || '').trim(),
        result: String(value?.other_result || '').trim()
      });
    }
    const target = Math.max(Number(slotCount || 0), rows.length);
    while (rows.length < target) rows.push({ antigen: '', result: '' });
    return rows;
  }

  function defaultCapAntigenPayload(specimen) {
    return {
      C: '', E: '', c: '', e: '',
      other_antigens: normalizeOtherAntigens({}, CAP_OTHER_ANTIGEN_SLOT_COUNT[specimen] || 0),
      notes: ''
    };
  }

  function defaultResultPayload(round = state.currentRound) {
    if (generatedResultSchema(round)) {
      return {
        schema: PROVIDER_GENERATED_SCHEMA,
        form_schema_version: String(generatedResultSchema(round)?.schema_version || '1'),
        specimens: {},
        antigen_typing: {},
        methods_by_program: {},
        reagents: '',
        instrument: '',
        overall_note: ''
      };
    }
    if (isLegacyCapJJeARound(round)) {
      return {
        schema: CAP_J_JE_SCHEMA,
        specimens: Object.fromEntries([...CAP_J_RESULT_SPECIMENS, ...CAP_JE_RESULT_SPECIMENS].map((s) => [s, defaultCapSpecimenPayload()])),
        antigen_typing: {
          'J-06R': defaultCapAntigenPayload('J-06R'),
          'JE-07R': defaultCapAntigenPayload('JE-07R')
        },
        methods_by_program: {
          J: { abo_manufacturer: '', abo_method: '', rh_manufacturer: '', rh_method: '', d_control_manufacturer: '', d_control_method: '', screen_cells: '', screen_manufacturer: '', screen_method: '', antibody_primary_manufacturer: '', antibody_primary_method: '', antibody_secondary_manufacturer: '', antibody_secondary_method: '', crossmatch_method: '', antigen_manufacturer: '' },
          JE: { abo_manufacturer: '', abo_method: '', rh_manufacturer: '', rh_method: '', d_control_manufacturer: '', d_control_method: '', screen_cells: '', screen_manufacturer: '', screen_method: '', antibody_primary_manufacturer: '', antibody_primary_method: '', antibody_secondary_manufacturer: '', antibody_secondary_method: '', crossmatch_method: '', antigen_manufacturer: '' }
        },
        reagents: '', instrument: '', overall_note: ''
      };
    }
    return {
      specimens: Object.fromEntries(LEGACY_RESULT_SPECIMENS.map((s) => [s, { abo: '', rh: '', screen: '', antibody: '', crossmatch: '', strength: '', notes: '' }])),
      methods: { abo: '', rh: '', screen: '', antibody: '', crossmatch: '', antigen: '' },
      reagents: '', instrument: '', overall_note: ''
    };
  }

  function workupPanelRowHtml(prefix, specimen, index, row = {}, disabled = false) {
    return `<div class="workup-row" data-workup-panel data-specimen="${esc(specimen)}">
      <div class="workup-row-head"><strong>Panel ${index + 1}</strong>${disabled ? '' : '<button type="button" class="btn btn-danger btn-sm" data-remove-workup-row>ลบ</button>'}</div>
      <div class="form-grid cols-3">
        <div class="field"><label>ชื่อ Panel / ลำดับ</label><input class="input" data-workup-field="label" value="${esc(row.label || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น Panel A / Panel 2"></div>
        <div class="field"><label>Lot</label><input class="input" data-workup-field="lot" value="${esc(row.lot || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น 8RA453"></div>
        <div class="field"><label>ช่วง Cell</label><input class="input" data-workup-field="cell_range" value="${esc(row.cell_range || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น Cell 01–11"></div>
        <div class="field"><label>Phase / วิธีตรวจ</label><input class="input" data-workup-field="phase" value="${esc(row.phase || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น IAT, enzyme"></div>
        <div class="field"><label>รูปแบบปฏิกิริยา</label><input class="input" data-workup-field="reaction_pattern" value="${esc(row.reaction_pattern || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น Cell 1, 3, 5 = 2+"></div>
        <div class="field"><label>สรุปจาก Panel นี้</label><input class="input" data-workup-field="interpretation" value="${esc(row.interpretation || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น เข้าได้กับ Anti-E"></div>
      </div>
    </div>`;
  }

  function workupExtraCellRowHtml(prefix, specimen, index, row = {}, disabled = false) {
    return `<div class="workup-row extra-cell-row" data-workup-extra data-specimen="${esc(specimen)}">
      <div class="workup-row-head"><strong>Extra cell ${index + 1}</strong>${disabled ? '' : '<button type="button" class="btn btn-danger btn-sm" data-remove-workup-row>ลบ</button>'}</div>
      <div class="form-grid cols-3">
        <div class="field"><label>ชื่อ Cell / รหัส</label><input class="input" data-workup-field="label" value="${esc(row.label || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น Selected cell 01"></div>
        <div class="field"><label>แหล่งที่มา / Lot</label><input class="input" data-workup-field="source" value="${esc(row.source || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น Panel B Lot ..."></div>
        <div class="field"><label>ใช้ยืนยันอะไร</label><input class="input" data-workup-field="purpose" value="${esc(row.purpose || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น rule out Anti-K / Rule of 3"></div>
        <div class="field"><label>Phase</label><input class="input" data-workup-field="phase" value="${esc(row.phase || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น IAT"></div>
        <div class="field" style="grid-column:span 2"><label>ผล</label><input class="input" data-workup-field="result" value="${esc(row.result || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น 0 / 2+ และข้อสรุป"></div>
      </div>
    </div>`;
  }

  function capAntibodyWorkup(payload, prefix, specimen, disabled) {
    const x = payload.specimens?.[specimen] || defaultCapSpecimenPayload();
    const panels = Array.isArray(x.antibody_workup?.panels) ? x.antibody_workup.panels : [];
    const extraCells = Array.isArray(x.antibody_workup?.extra_cells) ? x.antibody_workup.extra_cells : [];
    return `<details class="antibody-workup-details" ${panels.length || extraCells.length ? 'open' : ''}>
      <summary>รายละเอียด Antibody Identification / Panel cell ${panels.length || extraCells.length ? `<span class="badge info">${panels.length} panel · ${extraCells.length} extra cell</span>` : '<span class="small muted">กรอกเมื่อมีการทำ Ab ID</span>'}</summary>
      <div class="workup-help">หนึ่งตัวอย่างทำได้หลาย Panel และเพิ่ม Selected/Extra cell เพื่อยืนยันได้ ระบบจะเก็บแยกเป็นลำดับ ไม่บังคับว่าต้องมีเพียง Panel A</div>
      <div class="workup-section">
        <div class="workup-section-head"><strong>Panel ที่ใช้</strong>${disabled ? '' : `<button type="button" class="btn btn-outline btn-sm" data-add-workup-panel data-prefix="${esc(prefix)}" data-specimen="${esc(specimen)}">＋ เพิ่ม Panel</button>`}</div>
        <div class="workup-list" data-panel-list data-prefix="${esc(prefix)}" data-specimen="${esc(specimen)}">${panels.map((row, index) => workupPanelRowHtml(prefix, specimen, index, row, disabled)).join('') || '<div class="workup-empty">ยังไม่ได้เพิ่ม Panel</div>'}</div>
      </div>
      <div class="workup-section">
        <div class="workup-section-head"><strong>Selected / Extra cell สำหรับยืนยัน</strong>${disabled ? '' : `<button type="button" class="btn btn-outline btn-sm" data-add-workup-extra data-prefix="${esc(prefix)}" data-specimen="${esc(specimen)}">＋ เพิ่ม Extra cell</button>`}</div>
        <div class="workup-list" data-extra-list data-prefix="${esc(prefix)}" data-specimen="${esc(specimen)}">${extraCells.map((row, index) => workupExtraCellRowHtml(prefix, specimen, index, row, disabled)).join('') || '<div class="workup-empty">ยังไม่ได้เพิ่ม Extra cell</div>'}</div>
      </div>
    </details>`;
  }

  function capSpecimenCards(payload, prefix, specimens, disabled) {
    return `<div class="cap-specimen-grid">${specimens.map((specimen, index) => {
      const x = payload.specimens?.[specimen] || defaultCapSpecimenPayload();
      const hasAbId = Boolean(x.antibody || x.additional_antibodies || x.antibody_workup?.panels?.length || x.antibody_workup?.extra_cells?.length);
      return `<section class="cap-specimen-card google-form-card" id="result-${esc(prefix)}-${esc(specimen)}">
        <div class="cap-specimen-title">
          <div><span class="question-number">${index + 1}</span><strong>ตัวอย่าง ${esc(specimen)}</strong></div>
          <span class="small muted">เลือกเฉพาะผลที่รายงานจริง</span>
        </div>
        <div class="cap-field-group">
          <div class="form-question-heading"><span>หมู่เลือด ABO และ Rh(D)</span><small>เลือกคำตอบตามรหัส CAP</small></div>
          <div class="form-grid cols-3">
            <div class="field"><label>ABO Group</label><select class="select" name="${prefix}_${specimen}_abo" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.abo, x.abo)}</select></div>
            <div class="field"><label>ABO subgroup</label><select class="select" name="${prefix}_${specimen}_abo_subgroup" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.subgroup, x.abo_subgroup)}</select></div>
            <div class="field"><label>Rh(D) Type</label><select class="select" name="${prefix}_${specimen}_rh" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.rh, x.rh)}</select></div>
          </div>
        </div>
        <div class="cap-field-group">
          <div class="form-question-heading"><span>Antibody Screening และ Identification</span><small>ถ้าไม่พบแอนติบอดี ให้เว้นช่องชนิดแอนติบอดี</small></div>
          <div class="form-grid cols-3">
            <div class="field"><label>Unexpected Antibody Detection</label><select class="select" name="${prefix}_${specimen}_screen" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.screen, x.screen)}</select></div>
            <div class="field"><label>Primary antibody</label>${capAntibodyAutocomplete(`${prefix}_${specimen}_antibody`, x.antibody, disabled)}</div>
            <div class="field"><label>Additional antibodies</label>${capAntibodyAutocomplete(`${prefix}_${specimen}_additional_antibodies`, x.additional_antibodies, disabled, 'ถ้ามี ให้พิมพ์ชื่อแล้วเลือกจาก CAP Master List')}</div>
          </div>
          ${capAntibodyWorkup(payload, prefix, specimen, disabled)}
        </div>
        <div class="cap-field-group">
          <div class="form-question-heading"><span>Crossmatch กับ Donor J-06R</span><small>Negative หรือ Would refer ให้เลือก Strength = Not applicable</small></div>
          <div class="form-grid cols-3">
            <div class="field"><label>Serologic Crossmatch Result</label><select class="select" name="${prefix}_${specimen}_crossmatch" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.crossmatch, x.crossmatch)}</select></div>
            <div class="field"><label>Type of Crossmatch</label><select class="select" name="${prefix}_${specimen}_crossmatch_type" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.crossmatchType, x.crossmatch_type)}</select></div>
            <div class="field"><label>Strength of Reaction</label><select class="select" name="${prefix}_${specimen}_strength" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.strength, x.strength)}</select></div>
          </div>
        </div>
      </section>`;
    }).join('')}</div>`;
  }

  function bindCapWorkupControls(root = document) {
    bindProviderGeneratedResultControls(root);
    root.querySelectorAll('.cap-antibody-autocomplete').forEach((input) => {
      if (input.dataset.capAntibodyBound === '1') return;
      input.dataset.capAntibodyBound = '1';
      const normalize = () => {
        const typed = String(input.value || '').trim();
        if (!typed) return;
        const resolved = resolveCapAntibodyEntry(typed);
        if (resolved) input.value = resolved;
      };
      input.addEventListener('change', normalize);
      input.addEventListener('blur', normalize);
    });
    root.querySelectorAll('[data-add-workup-panel]').forEach((button) => {
      button.onclick = () => {
        const list = root.querySelector(`[data-panel-list][data-prefix="${CSS.escape(button.dataset.prefix)}"][data-specimen="${CSS.escape(button.dataset.specimen)}"]`);
        if (!list) return;
        list.querySelector('.workup-empty')?.remove();
        const index = list.querySelectorAll('[data-workup-panel]').length;
        list.insertAdjacentHTML('beforeend', workupPanelRowHtml(button.dataset.prefix, button.dataset.specimen, index));
        bindCapWorkupControls(root);
      };
    });
    root.querySelectorAll('[data-add-workup-extra]').forEach((button) => {
      button.onclick = () => {
        const list = root.querySelector(`[data-extra-list][data-prefix="${CSS.escape(button.dataset.prefix)}"][data-specimen="${CSS.escape(button.dataset.specimen)}"]`);
        if (!list) return;
        list.querySelector('.workup-empty')?.remove();
        const index = list.querySelectorAll('[data-workup-extra]').length;
        list.insertAdjacentHTML('beforeend', workupExtraCellRowHtml(button.dataset.prefix, button.dataset.specimen, index));
        bindCapWorkupControls(root);
      };
    });
    root.querySelectorAll('[data-remove-workup-row]').forEach((button) => {
      button.onclick = () => {
        const row = button.closest('.workup-row');
        const list = row?.parentElement;
        row?.remove();
        if (list && !list.querySelector('.workup-row')) list.innerHTML = '<div class="workup-empty">ยังไม่ได้เพิ่มรายการ</div>';
      };
    });
  }

  function capAntigenTable(payload, prefix, specimen, disabled) {
    const raw = payload.antigen_typing?.[specimen] || defaultCapAntigenPayload(specimen);
    const slotCount = CAP_OTHER_ANTIGEN_SLOT_COUNT[specimen] || 0;
    const x = { ...defaultCapAntigenPayload(specimen), ...raw };
    const otherAntigens = normalizeOtherAntigens(raw, slotCount);
    return `<div class="subcard antigen-entry-section">
      <h3>การตรวจแอนติเจนเม็ดเลือดแดง — ${esc(specimen)}</h3>
      <div class="notice info small">จำนวนช่องและชนิดการตรวจสร้างจากแบบฟอร์มเปล่าของผู้ให้บริการ ช่อง C, E, c, e เป็นรายการคงที่ ส่วน “แอนติเจนอื่น” ให้ผู้ปฏิบัติเลือกชนิดที่เหมาะสมเอง ไม่ต้องกรอกครบทุกตำแหน่ง</div>
      <div class="antigen-fixed-grid">
        ${['C','E','c','e'].map((field) => `<div class="field"><label>Anti-${field}</label><select class="select" name="${prefix}_antigen_${specimen}_${field}" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.antigen, x[field])}</select></div>`).join('')}
      </div>
      <div class="other-antigen-heading"><strong>แอนติเจนอื่นตามจำนวนช่องในฟอร์มเปล่า</strong><span class="small muted">เว้นตำแหน่งที่ไม่ได้ใช้ได้</span></div>
      <div class="other-antigen-grid">
        ${otherAntigens.slice(0, slotCount).map((row, index) => `<section class="other-antigen-card">
          <div class="other-antigen-title">ตำแหน่งที่ ${index + 1}</div>
          <div class="field"><label>รหัส Antisera ที่ใช้</label><select class="select cap-code-select" name="${prefix}_antigen_${specimen}_other_${index}_antigen" ${disabled ? 'disabled' : ''}><option value="">— Select —</option>${CAP_CODE_OPTIONS.otherAntigen.map((option) => `<option value="${esc(option.code)}" ${providerOptionMatches(option, row.antigen) ? 'selected' : ''}>${esc(providerOptionDisplay(option))}</option>`).join('')}</select></div>
          <div class="field"><label>ผล</label><select class="select" name="${prefix}_antigen_${specimen}_other_${index}_result" ${disabled ? 'disabled' : ''}>${selectOptions(CAP_RESULT_OPTIONS.antigen, row.result)}</select></div>
        </section>`).join('')}
      </div>
    </div>`;
  }

  function capMethodFields(payload, prefix, programKey, title, disabled) {
    const m = payload.methods_by_program?.[programKey] || {};
    const fields = [
      ['abo_manufacturer', 'ABO — Manufacturer code'], ['abo_method', 'ABO — Method code'],
      ['rh_manufacturer', 'Rh Anti-D — Manufacturer code'], ['rh_method', 'Rh Anti-D — Method code'],
      ['d_control_manufacturer', 'D control — Manufacturer code'], ['d_control_method', 'D control — Method code'],
      ['screen_cells', 'Screening cell code/จำนวนเซลล์'], ['screen_manufacturer', 'Antibody screen — Manufacturer code'],
      ['screen_method', 'Antibody screen — Method code'], ['antibody_primary_manufacturer', 'Antibody ID ชุดที่ 1 — Manufacturer'],
      ['antibody_primary_method', 'Antibody ID ชุดที่ 1 — Method'], ['antibody_secondary_manufacturer', 'Antibody ID ชุดที่ 2 — Manufacturer'],
      ['antibody_secondary_method', 'Antibody ID ชุดที่ 2 — Method'], ['crossmatch_method', 'Crossmatch — Method code'],
      ['antigen_manufacturer', 'Antigen typing — Manufacturer code']
    ];
    return `<details class="result-method-details"><summary>${esc(title)} — วิธีตรวจและรหัสน้ำยา</summary><div class="form-grid cols-3" style="margin-top:12px">
      ${fields.map(([key, label]) => `<div class="field"><label>${esc(label)}</label><input class="input" name="${prefix}_method_${programKey}_${key}" value="${esc(m[key] || '')}" ${disabled ? 'disabled' : ''}></div>`).join('')}
    </div></details>`;
  }

  function capJJeResultForm(payload, prefix, disabled) {
    const base = defaultResultPayload(state.currentRound);
    const p = { ...base, ...(payload || {}), schema: CAP_J_JE_SCHEMA };
    p.specimens = { ...base.specimens, ...(payload?.specimens || {}) };
    p.antigen_typing = { ...base.antigen_typing, ...(payload?.antigen_typing || {}) };
    p.methods_by_program = { ...base.methods_by_program, ...(payload?.methods_by_program || {}) };
    return `<div class="result-grid cap-result-form cap-google-form">
      <div class="result-form-hero">
        <div>
          <span class="eyebrow">CAP J/JE-A 2026</span>
          <h3>บันทึกผลที่ห้องปฏิบัติการรายงาน</h3>
          <p>เลือกผลสรุปและรหัสตามแบบฟอร์ม CAP ไม่ต้องคัดลอกค่าปฏิกิริยาดิบทุกหลุม</p>
        </div>
        <span class="badge info">J-A: J-01–J-05 · JE-A: JE-07</span>
      </div>
      <details class="result-instruction google-form-help" open>
        <summary>คำแนะนำก่อนกรอกผล</summary>
        <ol>
          <li>กรอกเฉพาะการทดสอบที่ทำจริงตามฟอร์ม CAP ช่องที่ไม่ได้ใช้เว้นว่างได้</li>
          <li>Antibody screen เลือกผลรวม Detected / Not detected ส่วนรายละเอียด Panel บันทึกเฉพาะเมื่อมีการทำ Antibody Identification</li>
          <li>ถ้า Primary antibody เป็น CAP 184 หรือ CAP 200 ให้เว้น Additional antibodies</li>
          <li>Crossmatch ที่เป็น Negative หรือ Would refer ให้เลือก Strength เป็น Not applicable</li>
          <li>หนึ่งตัวอย่างเพิ่มได้หลาย Panel และ Selected/Extra cell เพื่อยืนยัน Rule of 3 หรือ rule out</li>
          <li>จำนวนช่อง Other antigen มาจากแบบฟอร์มเปล่า ผู้ปฏิบัติเป็นผู้เลือกชนิด Antigen เอง</li>
        </ol>
      </details>

      <nav class="result-jump-nav" aria-label="ทางลัดแบบกรอก">
        <a href="#result-program-j">J-A</a>
        ${CAP_J_RESULT_SPECIMENS.map((s) => `<a href="#result-${esc(prefix)}-${esc(s)}">${esc(s)}</a>`).join('')}
        <a href="#result-antigen-j06">J-06R Antigen</a>
        <a href="#result-program-je">JE-A</a>
        <a href="#result-${esc(prefix)}-JE-07">JE-07</a>
        <a href="#result-antigen-je07">JE-07R Antigen</a>
      </nav>

      <section class="cap-program-section" id="result-program-j">
        <div class="section-banner">
          <div><span class="section-kicker">Program J</span><h3>Comprehensive Transfusion Medicine — J-A 2026</h3></div>
          <p>ตัวอย่าง J-01 ถึง J-05 และ Crossmatch กับ Donor J-06R</p>
        </div>
        ${capSpecimenCards(p, prefix, CAP_J_RESULT_SPECIMENS, disabled)}
      </section>

      <div id="result-antigen-j06">${capAntigenTable(p, prefix, 'J-06R', disabled)}</div>

      <section class="cap-program-section" id="result-program-je">
        <div class="section-banner educational">
          <div><span class="section-kicker">Program JE1</span><h3>Educational Challenge — JE-A 2026</h3></div>
          <p>ตัวอย่าง JE-07R/JE-07S และ Crossmatch กับ Donor J-06R</p>
        </div>
        ${capSpecimenCards(p, prefix, CAP_JE_RESULT_SPECIMENS, disabled)}
      </section>

      <div id="result-antigen-je07">${capAntigenTable(p, prefix, 'JE-07R', disabled)}</div>

      ${capAntibodyDatalist()}

      <details class="result-method-details">
        <summary>รหัสวิธีตรวจ น้ำยา และเครื่องมือ</summary>
        <div class="method-details-grid">
          ${capMethodFields(p, prefix, 'J', 'J-A', disabled)}
          ${capMethodFields(p, prefix, 'JE', 'JE-A', disabled)}
        </div>
        <div class="form-grid cols-2" style="margin-top:14px">
          <div class="field"><label>น้ำยา / เลขรุ่นผลิต</label><textarea class="textarea" name="${prefix}_reagents" ${disabled ? 'disabled' : ''}>${esc(p.reagents || '')}</textarea></div>
          <div class="field"><label>เครื่องมือ</label><textarea class="textarea" name="${prefix}_instrument" ${disabled ? 'disabled' : ''}>${esc(p.instrument || '')}</textarea></div>
        </div>
        <div class="field"><label>หมายเหตุรวม</label><textarea class="textarea" name="${prefix}_overall_note" ${disabled ? 'disabled' : ''}>${esc(p.overall_note || '')}</textarea></div>
      </details>
    </div>`;
  }

  function genericResultForm(payload, prefix, disabled) {
    const base = defaultResultPayload(null);
    const p = { ...base, ...(payload || {}) };
    p.specimens = { ...base.specimens, ...(payload?.specimens || {}) };
    const specimens = resultSpecimensForRound(null, p);
    return `<div class="result-grid">
      <div class="result-row"><strong>ตัวอย่าง</strong><span>ABO</span><span>Rh</span><span>คัดกรองแอนติบอดี</span><span>ระบุชนิดแอนติบอดี</span><span>ความเข้ากันได้ / ความแรงปฏิกิริยา</span></div>
      ${specimens.map((s) => { const x = p.specimens[s] || {}; return `<div class="result-row"><strong>${esc(s)}</strong>
        <input class="input" name="${prefix}_${s}_abo" value="${esc(x.abo)}" ${disabled ? 'disabled' : ''} placeholder="A/B/O/AB">
        <input class="input" name="${prefix}_${s}_rh" value="${esc(x.rh)}" ${disabled ? 'disabled' : ''} placeholder="บวก / ลบ">
        <input class="input" name="${prefix}_${s}_screen" value="${esc(x.screen)}" ${disabled ? 'disabled' : ''} placeholder="พบ / ไม่พบ">
        <input class="input" name="${prefix}_${s}_antibody" value="${esc(x.antibody)}" ${disabled ? 'disabled' : ''} placeholder="เช่น Anti-K">
        <div class="form-grid"><input class="input" name="${prefix}_${s}_crossmatch" value="${esc(x.crossmatch)}" ${disabled ? 'disabled' : ''} placeholder="เข้ากันได้ / เข้ากันไม่ได้"><input class="input" name="${prefix}_${s}_strength" value="${esc(x.strength)}" ${disabled ? 'disabled' : ''} placeholder="0–4+"></div>
      </div>`; }).join('')}
      <div class="form-grid cols-3">
        ${['abo','rh','screen','antibody','crossmatch','antigen'].map((m) => `<div class="field"><label>วิธีตรวจ: ${esc(METHOD_LABELS[m] || m)}</label><input class="input" name="${prefix}_method_${m}" value="${esc(p.methods?.[m] || '')}" ${disabled ? 'disabled' : ''}></div>`).join('')}
      </div>
      <div class="form-grid cols-2"><div class="field"><label>น้ำยา / เลขรุ่นผลิต</label><textarea class="textarea" name="${prefix}_reagents" ${disabled ? 'disabled' : ''}>${esc(p.reagents || '')}</textarea></div><div class="field"><label>เครื่องมือ</label><textarea class="textarea" name="${prefix}_instrument" ${disabled ? 'disabled' : ''}>${esc(p.instrument || '')}</textarea></div></div>
      <div class="field"><label>หมายเหตุรวม</label><textarea class="textarea" name="${prefix}_overall_note" ${disabled ? 'disabled' : ''}>${esc(p.overall_note || '')}</textarea></div>
    </div>`;
  }

  function resultForm(payload, prefix = 'result', disabled = false, preferCurrentGeneratedForm = false, options = {}) {
    // ถ้ารอบมี schema ที่สร้างจากแบบฟอร์มจริง ให้ใช้ก่อนเสมอ เพื่อแยก Program J, JE1 และโปรแกรมอื่นตามเอกสารของรอบนั้น
    // ผลที่ส่งแล้วจากฟอร์มรุ่นเก่ายังคงเปิดอ่านด้วยรูปแบบเดิม แต่ฉบับร่าง/ผลว่างจะเปลี่ยนมาใช้ฟอร์มจริงของรอบแม้กำลังเปิดดูด้วยบทบาทอื่น
    if (preferCurrentGeneratedForm && generatedResultSchema(state.currentRound)) {
      const currentPayload = payload?.schema === PROVIDER_GENERATED_SCHEMA ? payload : defaultResultPayload(state.currentRound);
      return providerGeneratedResultForm(currentPayload, prefix, disabled, options);
    }
    if (payload?.schema === CAP_J_JE_SCHEMA && (!generatedResultSchema(state.currentRound) || disabled)) return capJJeResultForm(payload, prefix, disabled);
    if (payload?.schema === PROVIDER_GENERATED_SCHEMA || generatedResultSchema(state.currentRound)) return providerGeneratedResultForm(payload, prefix, disabled, options);
    if (isLegacyCapJJeARound(state.currentRound)) return capJJeResultForm(payload, prefix, disabled);
    if (isCapJJeRound(state.currentRound)) return `<div class="notice warning" data-provider-form-required="true"><strong>ยังไม่มีแบบกรอกจากฟอร์มของรอบนี้</strong><br>รอบ J/JE แต่ละรอบอาจเป็นตัวอย่างจริงหรือ Dry Challenge และอาจใช้ Donor ร่วมกันต่างกัน กรุณาไปที่ “2. เอกสาร/ภาพ” แล้วกด “1. สร้างแบบกรอกจากฟอร์มเปล่า” ก่อนบันทึกผล เพื่อไม่ให้ระบบนำแบบ J-A/JE-A เดิมมาใช้ผิดรอบ</div>`;
    return genericResultForm(payload, prefix, disabled);
  }

  function collectCapResultPayload(form, prefix) {
    const fd = new FormData(form);
    const specimens = {};
    [...CAP_J_RESULT_SPECIMENS, ...CAP_JE_RESULT_SPECIMENS].forEach((s) => {
      const panelRows = [...form.querySelectorAll(`[data-workup-panel][data-specimen="${CSS.escape(s)}"]`)].map((row) => Object.fromEntries([...row.querySelectorAll('[data-workup-field]')].map((field) => [field.dataset.workupField, String(field.value || '').trim()]))).filter((row) => Object.values(row).some(Boolean));
      const extraCellRows = [...form.querySelectorAll(`[data-workup-extra][data-specimen="${CSS.escape(s)}"]`)].map((row) => Object.fromEntries([...row.querySelectorAll('[data-workup-field]')].map((field) => [field.dataset.workupField, String(field.value || '').trim()]))).filter((row) => Object.values(row).some(Boolean));
      specimens[s] = {
        abo: String(fd.get(`${prefix}_${s}_abo`) || '').trim(),
        abo_subgroup: String(fd.get(`${prefix}_${s}_abo_subgroup`) || '').trim(),
        rh: String(fd.get(`${prefix}_${s}_rh`) || '').trim(),
        screen: String(fd.get(`${prefix}_${s}_screen`) || '').trim(),
        antibody: String(fd.get(`${prefix}_${s}_antibody`) || '').trim(),
        additional_antibodies: String(fd.get(`${prefix}_${s}_additional_antibodies`) || '').trim(),
        crossmatch: String(fd.get(`${prefix}_${s}_crossmatch`) || '').trim(),
        crossmatch_type: String(fd.get(`${prefix}_${s}_crossmatch_type`) || '').trim(),
        strength: String(fd.get(`${prefix}_${s}_strength`) || '').trim(),
        notes: '',
        antibody_workup: { panels: panelRows, extra_cells: extraCellRows }
      };
    });
    const antigen_typing = {};
    ['J-06R','JE-07R'].forEach((specimen) => {
      const slotCount = CAP_OTHER_ANTIGEN_SLOT_COUNT[specimen] || 0;
      antigen_typing[specimen] = {
        C: String(fd.get(`${prefix}_antigen_${specimen}_C`) || '').trim(),
        E: String(fd.get(`${prefix}_antigen_${specimen}_E`) || '').trim(),
        c: String(fd.get(`${prefix}_antigen_${specimen}_c`) || '').trim(),
        e: String(fd.get(`${prefix}_antigen_${specimen}_e`) || '').trim(),
        other_antigens: Array.from({ length: slotCount }, (_, index) => ({
          antigen: String(fd.get(`${prefix}_antigen_${specimen}_other_${index}_antigen`) || '').trim(),
          result: String(fd.get(`${prefix}_antigen_${specimen}_other_${index}_result`) || '').trim()
        })),
        notes: ''
      };
    });
    const methodKeys = ['abo_manufacturer','abo_method','rh_manufacturer','rh_method','d_control_manufacturer','d_control_method','screen_cells','screen_manufacturer','screen_method','antibody_primary_manufacturer','antibody_primary_method','antibody_secondary_manufacturer','antibody_secondary_method','crossmatch_method','antigen_manufacturer'];
    const methods_by_program = {};
    ['J','JE'].forEach((programKey) => {
      methods_by_program[programKey] = Object.fromEntries(methodKeys.map((key) => [key, String(fd.get(`${prefix}_method_${programKey}_${key}`) || '').trim()]));
    });
    return {
      schema: CAP_J_JE_SCHEMA,
      specimens,
      antigen_typing,
      methods_by_program,
      reagents: String(fd.get(`${prefix}_reagents`) || '').trim(),
      instrument: String(fd.get(`${prefix}_instrument`) || '').trim(),
      overall_note: String(fd.get(`${prefix}_overall_note`) || '').trim()
    };
  }

  function collectResultPayload(form, prefix = 'result') {
    if (!form || form.querySelector('[data-provider-form-required]')) return null;
    if (form.querySelector('[data-provider-field]')) return collectProviderGeneratedPayload(form, prefix);
    if (isLegacyCapJJeARound(state.currentRound)) return collectCapResultPayload(form, prefix);
    const fd = new FormData(form);
    const specimens = {};
    const names = resultSpecimensForRound(state.currentRound, state.currentRound?.result_payload);
    names.forEach((s) => {
      specimens[s] = {
        abo: String(fd.get(`${prefix}_${s}_abo`) || '').trim(),
        rh: String(fd.get(`${prefix}_${s}_rh`) || '').trim(),
        screen: String(fd.get(`${prefix}_${s}_screen`) || '').trim(),
        antibody: String(fd.get(`${prefix}_${s}_antibody`) || '').trim(),
        crossmatch: String(fd.get(`${prefix}_${s}_crossmatch`) || '').trim(),
        strength: String(fd.get(`${prefix}_${s}_strength`) || '').trim(), notes: ''
      };
    });
    const methods = {};
    ['abo','rh','screen','antibody','crossmatch','antigen'].forEach((m) => { methods[m] = String(fd.get(`${prefix}_method_${m}`) || '').trim(); });
    return { specimens, methods, reagents: String(fd.get(`${prefix}_reagents`) || '').trim(), instrument: String(fd.get(`${prefix}_instrument`) || '').trim(), overall_note: String(fd.get(`${prefix}_overall_note`) || '').trim() };
  }

  function historicalConfirmationBadge(confirmation) {
    if (!confirmation) return '<span class="badge warning">รอยืนยัน</span>';
    const cls = confirmation.decision === 'confirmed' ? 'success' : 'danger';
    return `<span class="badge ${cls}">${esc(labelFrom(HISTORICAL_CONFIRM_LABELS, confirmation.decision))}</span>`;
  }

  async function roundHistoricalIndividual(round) {
    const [{ data: rows, error }, { data: assignments }, { data: confirmations }, { data: consensus }, { data: evidenceRows }, directory] = await Promise.all([
      state.supabase.from('ec_individual_results').select('*').eq('round_id', round.id).order('updated_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('assignment_role', 'practitioner').eq('active', true).order('practitioner_slot'),
      state.supabase.from('ec_historical_result_confirmations').select('*').eq('round_id', round.id),
      state.supabase.from('ec_consensus_results').select('id,status').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_work_evidence').select('*').eq('round_id', round.id).eq('context_type', 'practical').is('archived_at', null).order('created_at', { ascending: false }),
      loadDirectory()
    ]);
    if (error) throw error;
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const cards = (assignments || []).map((assignment) => {
      const row = (rows || []).find((item) => item.user_id === assignment.user_id);
      const confirmation = row ? (confirmations || []).find((item) => item.individual_result_id === row.id && item.user_id === assignment.user_id) : null;
      const enteredBy = row?.entered_by ? name(row.entered_by) : '-';
      const isOwn = assignment.user_id === state.user.id;
      const canEnter = isOwn || canImportHistoricalEqa();
      const mayConfirm = isOwn && hasRole('staff') && row && row.entry_mode === 'entered_on_behalf' && consensus && round.historical_review_status === 'awaiting_practitioner_confirmation';
      const userEvidence = (evidenceRows || []).filter((item) => item.user_id === assignment.user_id);
      const entryLabel = row?.entry_mode === 'self' ? 'ผู้ปฏิบัติกรอกเอง' : 'กรอกแทนจากหลักฐานเดิม';
      const panelId = `historical-practical-${assignment.user_id}`;
      return `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
        <div class="card-header"><div><h3>ผู้ปฏิบัติจริง คนที่ ${assignment.practitioner_slot}: ${esc(name(assignment.user_id))}</h3><div class="small muted">กรอกตามผลและหลักฐานเดิมของรอบที่ผ่านมา ห้ามทำการทดสอบใหม่เพื่อแทนข้อมูลเดิม</div></div>${historicalConfirmationBadge(confirmation)}</div>
        ${row ? `<div class="grid cols-2">
          <div><strong>วิธีบันทึก</strong><p><span class="badge info">${esc(entryLabel)}</span></p></div>
          <div><strong>ผู้บันทึกเข้าระบบ</strong><p>${esc(enteredBy)}<br><span class="small muted">${fmtDate(row.entered_at, true)}</span></p></div>
          <div><strong>วันที่ปฏิบัติจริง</strong><p>${row.performed_date ? `${fmtDate(row.performed_date)}${row.performed_time_known === false ? ' · ไม่ทราบเวลา' : row.performed_time ? ` · ${String(row.performed_time).slice(0,5)} น.` : ''}` : '-'}</p></div>
          <div><strong>วันที่ส่งให้แพทย์</strong><p>${row.sent_to_physician_date ? `${fmtDate(row.sent_to_physician_date)}${row.sent_to_physician_time_known === false ? ' · ไม่ทราบเวลา' : row.sent_to_physician_time ? ` · ${String(row.sent_to_physician_time).slice(0,5)} น.` : ''}` : '-'}</p></div>
        </div>
        <p><strong>แหล่งข้อมูล/หมายเหตุ:</strong> ${esc(row.evidence_note || '-')}</p>
        ${row.no_individual_evidence ? `<div class="notice warning">ไม่มีหลักฐานผลรายบุคคลแยก ระบบเก็บเฉพาะข้อมูลว่าบุคคลนี้เป็นผู้ร่วมปฏิบัติจริง</div>` : `<button class="btn btn-outline btn-sm" data-view-individual="${row.id}">ดูผลที่บันทึก</button>`}
        ` : `<div class="notice warning">ยังไม่ได้บันทึกข้อมูลย้อนหลังของผู้ปฏิบัติคนนี้</div>`}
        <div class="table-actions" style="margin-top:12px">
          ${canEnter ? `<button class="btn btn-primary btn-sm" data-enter-historical-individual="${assignment.user_id}">${row ? (isOwn ? 'แก้ไขข้อมูลย้อนหลังของฉัน' : 'แก้ไขข้อมูลที่กรอกแทน') : (isOwn ? 'กรอกผลย้อนหลังของฉัน' : 'กรอกผลย้อนหลังแทนผู้ปฏิบัติ')}</button>` : ''}
          ${mayConfirm ? `<button class="btn btn-success btn-sm" data-confirm-historical-result>ยืนยันว่าข้อมูลตรงกับหลักฐานเดิม</button><button class="btn btn-warning btn-sm" data-dispute-historical-result>แจ้งว่าข้อมูลไม่ตรง</button>` : ''}
        </div>
        <div style="height:12px"></div>${workEvidencePanelHtml(panelId, userEvidence, isOwn)}
        ${confirmation?.note ? `<div class="notice ${confirmation.decision === 'confirmed' ? 'success' : 'warning'}" style="margin-top:12px">หมายเหตุ: ${esc(confirmation.note)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="card">
      <div class="card-header"><div><h2>ผลย้อนหลังของผู้ปฏิบัติจริง</h2><div class="small muted">ผู้ปฏิบัติจริงกรอกและยืนยันข้อมูลของตนเองได้ ผู้ดูแลระบบหรือผู้จัดการคุณภาพกรอกแทนได้เมื่อมีหลักฐานเดิม</div></div><span class="badge info">ข้อมูลย้อนหลัง</span></div>
      <div class="notice"><strong>วันเวลาที่เกิดเหตุการณ์จริง</strong> แยกจากวันเวลาที่บันทึกเข้าระบบ ซึ่งระบบเก็บอัตโนมัติใน Audit trail</div>
      <div style="height:14px"></div><div class="grid cols-2">${cards || empty('ยังไม่ได้กำหนดผู้ปฏิบัติจริง')}</div>
      ${(rows || []).length === 2 ? `<div class="modal-footer"><button class="btn btn-primary" data-go-historical-step="consensus">ขั้นต่อไป: กรอกผลกลางที่ห้องส่งจริง</button></div>` : ''}
    </div>`;
  }

  async function openHistoricalIndividualEntry(round, userId) {
    const isSelf = userId === state.user.id;
    if (!isSelf && !canImportHistoricalEqa()) return toast('ไม่มีสิทธิ์กรอกข้อมูลย้อนหลังแทนบุคคลนี้', 'warning');
    const [{ data: existing }, directory] = await Promise.all([
      state.supabase.from('ec_individual_results').select('*').eq('round_id', round.id).eq('user_id', userId).maybeSingle(),
      loadDirectory()
    ]);
    const person = directory.find((item) => item.id === userId);
    const noEvidence = Boolean(existing?.no_individual_evidence && !isSelf);
    const fallbackDateTime = existing?.performed_at || round.actual_submitted_at || round.received_at;
    const fallbackDate = fallbackDateTime ? fmtDateInput(fallbackDateTime) : '';
    const fallbackTime = fallbackDateTime ? fmtDateTimeInput(fallbackDateTime).slice(11, 16) : '';
    const performedDate = existing?.performed_date ? String(existing.performed_date).slice(0, 10) : fallbackDate;
    const performedTime = existing?.performed_time ? String(existing.performed_time).slice(0, 5) : fallbackTime;
    const performedTimeKnown = existing?.performed_time_known !== false;
    const sentDate = existing?.sent_to_physician_date ? String(existing.sent_to_physician_date).slice(0, 10) : (round.actual_submitted_at ? fmtDateInput(round.actual_submitted_at) : performedDate);
    const sentTime = existing?.sent_to_physician_time ? String(existing.sent_to_physician_time).slice(0, 5) : (round.actual_submitted_at ? fmtDateTimeInput(round.actual_submitted_at).slice(11, 16) : performedTime);
    const sentTimeKnown = existing?.sent_to_physician_time_known !== false;
    const title = isSelf ? `กรอกผลย้อนหลังของฉัน — ${person?.full_name || ''}` : `กรอกผลย้อนหลังแทน — ${person?.full_name || ''}`;

    showModal(title, `
      <form id="historical-individual-form" class="form-grid">
        <div class="notice"><strong>ผู้ปฏิบัติจริง:</strong> ${esc(person?.full_name || userId)}<br><strong>ผู้บันทึกเข้าระบบ:</strong> ${esc(state.profile.full_name)}<br><span class="small">ระบบจะเก็บวันเวลาที่บันทึกเข้าระบบอัตโนมัติ แยกจากวันเวลาเหตุการณ์จริงด้านล่าง</span></div>
        ${historicalDateTimePair('performed', 'วันที่และเวลาที่ปฏิบัติจริง', performedDate, performedTime, performedTimeKnown, 'ตามแบบบันทึกหรือหลักฐานเดิม')}
        ${historicalDateTimePair('sent_physician', 'วันที่และเวลาที่ส่งผลให้แพทย์', sentDate, sentTime, sentTimeKnown, 'ตามหลักฐานเดิม')}
        ${!isSelf ? `<label style="display:flex;gap:9px;align-items:flex-start"><input type="checkbox" id="no-individual-evidence" name="no_evidence" ${noEvidence ? 'checked' : ''}><span><strong>ไม่มีหลักฐานผลรายบุคคลแยก</strong><br><span class="small muted">เลือกเมื่อมีเพียงผลกลางที่ห้องส่ง ห้ามคาดเดาผลรายบุคคล</span></span></label>` : ''}
        <div class="field"><label>แหล่งข้อมูล/หมายเหตุ</label><textarea class="textarea" name="evidence_note" required placeholder="เช่น แบบบันทึกผลเดิม หน้า 2 หรือผลที่ตนเองบันทึกไว้">${esc(existing?.evidence_note || '')}</textarea></div>
        <div id="historical-individual-result-fields">${resultForm(existing?.result_payload, 'historicalIndividual', noEvidence, true)}</div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-secondary" id="save-historical-draft">บันทึกร่าง</button><button class="btn btn-primary" id="submit-historical-individual">ยืนยันและส่งผล</button>`, true);

    bindCapWorkupControls(document.getElementById('historical-individual-form'));
    bindHistoricalTimeControls(document.getElementById('historical-individual-form'));
    const checkbox = document.getElementById('no-individual-evidence');
    const toggle = () => {
      if (!checkbox) return;
      document.querySelectorAll('#historical-individual-result-fields input, #historical-individual-result-fields textarea, #historical-individual-result-fields select').forEach((field) => { field.disabled = checkbox.checked; });
      document.querySelectorAll('#historical-individual-result-fields [data-add-workup-panel], #historical-individual-result-fields [data-add-workup-extra], #historical-individual-result-fields [data-remove-workup-row]').forEach((button) => { button.disabled = checkbox.checked; });
    };
    checkbox?.addEventListener('change', toggle);
    toggle();

    const save = async (submit) => {
      const form = document.getElementById('historical-individual-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const performedKnown = fd.get('performed_time_unknown') !== 'on';
      const sentKnown = fd.get('sent_physician_time_unknown') !== 'on';
      const performedTimeValue = String(fd.get('performed_time') || '');
      const sentTimeValue = String(fd.get('sent_physician_time') || '');
      if (performedKnown && !performedTimeValue) return toast('กรุณาระบุเวลาปฏิบัติ หรือเลือกไม่ทราบเวลา', 'warning');
      if (sentKnown && !sentTimeValue) return toast('กรุณาระบุเวลาที่ส่งให้แพทย์ หรือเลือกไม่ทราบเวลา', 'warning');
      const noIndividualEvidence = Boolean(checkbox?.checked);
      const payload = noIndividualEvidence ? defaultResultPayload() : collectResultPayload(form, 'historicalIndividual');
      if (!payload) return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning');
      if (submit && !noIndividualEvidence && !resultPayloadHasData(payload)) return toast('กรุณากรอกผลอย่างน้อย 1 รายการก่อนส่ง', 'warning');
      setBusy(true);
      const { error } = await state.supabase.rpc('ec_record_historical_individual_result_v262', {
        p_round_id: round.id,
        p_user_id: userId,
        p_result_payload: payload,
        p_performed_date: String(fd.get('performed_date') || ''),
        p_performed_time: performedKnown ? performedTimeValue : null,
        p_performed_time_known: performedKnown,
        p_sent_to_physician_date: String(fd.get('sent_physician_date') || ''),
        p_sent_to_physician_time: sentKnown ? sentTimeValue : null,
        p_sent_to_physician_time_known: sentKnown,
        p_evidence_note: String(fd.get('evidence_note') || '').trim(),
        p_no_individual_evidence: noIndividualEvidence,
        p_submit: submit
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal();
      toast(submit ? 'ส่งผลย้อนหลังแล้ว' : 'บันทึกร่างข้อมูลย้อนหลังแล้ว', 'success');
      route();
    };
    document.getElementById('save-historical-draft').addEventListener('click', () => save(false));
    document.getElementById('submit-historical-individual').addEventListener('click', () => {
      if (confirm('ยืนยันส่งผลย้อนหลังหรือไม่ หลังส่งจะเข้าสู่ขั้นตอนทบทวน')) save(true);
    });
  }

  async function roundIndividual(round) {
    if (isHistoricalRound(round)) return roundHistoricalIndividual(round);
    await loadRoundInstructionExtractions(round.id);
    const [{ data: rows, error }, { data: evidenceRows, error: evidenceError }] = await Promise.all([
      state.supabase.from('ec_individual_results').select('*, ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('round_id', round.id).order('updated_at'),
      state.supabase.from('ec_work_evidence').select('*').eq('round_id', round.id).eq('user_id', state.user.id).eq('context_type', 'practical').is('archived_at', null).order('created_at', { ascending: false })
    ]);
    if (error || evidenceError) throw (error || evidenceError);
    const own = (rows || []).find((row) => row.user_id === state.user.id);
    const practitioner = await isPractitioner(round.id);
    const canEditOwn = practitioner && hasRole('staff') && (!own || ['draft','returned'].includes(own.status));
    const useCurrentGeneratedForm = Boolean(generatedResultSchema(round) && (!own || ['draft','returned'].includes(own.status)));
    const correctionSections = Array.isArray(own?.correction_scope?.sections) ? own.correction_scope.sections : [];
    const correctionBanner = own?.status === 'returned'
      ? `<div class="notice warning"><strong>ผู้ทบทวนส่งกลับให้แก้เฉพาะหัวข้อ</strong><br>${esc(own.reviewer_note || 'กรุณาตรวจหัวข้อที่เปิดให้แก้ แล้วส่งกลับตรวจอีกครั้ง')}<div class="small" style="margin-top:6px">หัวข้อที่ต้องแก้: ${esc(correctionSections.map((item) => ({ specimen:'ผลตัวอย่าง/การแปลผล', method:'วิธีทดสอบและผู้ผลิต', antigen:'Antigen typing', general:'ข้อมูลทั่วไป', evidence:'ภาพหลักฐาน' }[item] || item)).join(', ') || 'ตามหมายเหตุ')}</div></div><div style="height:12px"></div>`
      : '';

    const reviewStatusBadge = (row) => {
      if (row.status === 'returned' || row.review_status === 'returned') return '<span class="badge danger">ส่งกลับแก้ไข</span>';
      if (row.review_status === 'approved') return '<span class="badge success">ผู้ทบทวนตรวจผ่าน</span>';
      if (['submitted','resubmitted'].includes(row.status)) return '<span class="badge warning">รอผู้ทบทวน</span>';
      return `<span class="badge info">${esc(labelFrom(RESULT_STATUS_LABELS, row.status))}</span>`;
    };

    return `<div class="grid ${canReview() ? 'cols-2' : ''}">
      <div class="card">
        <div class="card-header"><div><h2>ผลที่ฉันบันทึก</h2><div class="small muted">ผู้ทบทวนตรวจจากผลที่กรอก ภาพหลักฐาน และข้อมูลอ้างอิงของรอบนี้</div></div>${own ? `${reviewStatusBadge(own)}<span class="badge">ฉบับที่ ${own.version}</span>` : ''}</div>
        ${correctionBanner}
        ${practitioner ? `<form id="individual-result-form" data-correction-sections="${esc(JSON.stringify(correctionSections))}" data-is-correction="${own?.status === 'returned' ? '1' : '0'}">${resultForm(own?.result_payload, 'individual', !canEditOwn, useCurrentGeneratedForm)}</form>
          <div style="height:14px"></div>${workEvidencePanelHtml('practical-current', evidenceRows || [], canEditOwn && (own?.status !== 'returned' || correctionSections.includes('evidence')))}
          ${canEditOwn ? `<div class="modal-footer"><button class="btn btn-secondary" id="save-individual">บันทึกร่าง</button><button class="btn btn-primary" id="submit-individual">${own?.status === 'returned' ? 'ส่งกลับตรวจอีกครั้ง' : 'ยืนยันและส่งผล'}</button></div>` : practitioner && !hasRole('staff') && (!own || ['draft','returned'].includes(own.status)) ? `<div class="notice warning">กรุณาเปลี่ยน “ทำงานในบทบาท” เป็นเจ้าหน้าที่ก่อนบันทึกผลของตนเอง</div>` : '<div class="notice">ผลถูกส่งแล้วและกำลังอยู่ในขั้นตรวจ</div>'}` : '<div class="notice">หน้านี้ใช้สำหรับผู้ปฏิบัติจริงที่ได้รับมอบหมายเท่านั้น</div>'}
      </div>
      ${canReview() ? `<div class="card"><div class="card-header"><div><h2>ตรวจผลรายบุคคล</h2><div class="small muted">ตรวจทีละคน แล้วเลือกเฉพาะหัวข้อที่ต้องส่งกลับแก้</div></div></div>${(rows || []).length ? (rows || []).map((row) => {
        const ready = ['submitted','resubmitted'].includes(row.status);
        return `<div class="individual-review-row"><div><strong>${esc(row.ec_profiles?.full_name || row.user_id)}</strong><div class="small muted">ส่ง ${fmtDate(row.submitted_at, true)} · ฉบับที่ ${row.version}</div>${row.reviewer_note ? `<div class="small danger-text">${esc(row.reviewer_note)}</div>` : ''}</div><div>${reviewStatusBadge(row)}<div class="table-actions" style="margin-top:8px">${ready && row.user_id !== state.user.id ? `<button class="btn btn-primary btn-sm" data-review-individual="${row.id}">ตรวจ / ส่งกลับ</button>` : `<button class="btn btn-outline btn-sm" data-view-individual="${row.id}">ดูผล</button>`}</div></div></div>`;
      }).join('') : empty('ยังไม่มีผู้ปฏิบัติส่งผล')}</div>` : ''}
    </div>`;
  }

  async function isPractitioner(roundId) {
    const { data } = await state.supabase.from('ec_round_assignments').select('id').eq('round_id', roundId).eq('user_id', state.user.id).eq('assignment_role', 'practitioner').eq('active', true).limit(1);
    return Boolean(data?.length);
  }

  function resultSummary(payload, specimen) {
    const x = payload?.specimens?.[specimen] || {};
    if (payload?.schema === PROVIDER_GENERATED_SCHEMA && generatedResultSchema()) {
      const fieldDefinitions = generatedResultSchema().programs
        .filter((program) => (program.specimens || []).some((item) => String(item.id || item.label || '') === String(specimen)))
        .flatMap((program) => program.specimen_fields || []);
      const hasAboGroupDefinition = fieldDefinitions.some((field) => providerIsAboGroupResultField(field));
      const rows = [];
      if (!hasAboGroupDefinition && providerStoredAboGroup(x)) {
        const raw = providerStoredAboGroup(x);
        const option = CAP_CODE_OPTIONS.aboGroup.find((item) => String(item.code) === String(raw) || String(item.label) === String(raw));
        rows.push(`ABO Group: ${esc(option ? providerOptionDisplay(option) : raw)}`);
      }
      fieldDefinitions.forEach((field) => {
        const raw = x[field.key] || '';
        const option = (field.options || []).find((item) => String(item.value ?? item.code ?? item.label ?? '') === String(raw));
        const shown = option ? generatedOptionLabel(option) : raw;
        rows.push(`${esc(field.label || field.key)}: ${esc(shown || '-')}`);
      });
      return rows.length ? rows.join('<br>') : '-';
    }
    const rows = [
      `ABO: ${x.abo || '-'}`,
      ...(payload?.schema === CAP_J_JE_SCHEMA ? [`ABO subgroup: ${x.abo_subgroup || '-'}`] : []),
      `Rh: ${x.rh || '-'}`,
      `คัดกรอง: ${x.screen || '-'}`,
      `แอนติบอดีหลัก: ${x.antibody || '-'}`,
      ...(payload?.schema === CAP_J_JE_SCHEMA ? [`แอนติบอดีเพิ่มเติม: ${x.additional_antibodies || '-'}`] : []),
      `Crossmatch: ${x.crossmatch || '-'}`,
      ...(payload?.schema === CAP_J_JE_SCHEMA ? [`ชนิด Crossmatch: ${x.crossmatch_type || '-'}`] : []),
      `ความแรง: ${x.strength || '-'}`
    ];
    return rows.join('<br>');
  }

  function antigenSummary(payload, specimen) {
    const x = payload?.antigen_typing?.[specimen] || {};
    const otherRows = normalizeOtherAntigens(x, 0)
      .filter((row) => row.antigen || row.result)
      .map((row, index) => `อื่น ${index + 1}: ${row.antigen || '-'} = ${row.result || '-'}`);
    return [`C: ${x.C || '-'}`, `E: ${x.E || '-'}`, `c: ${x.c || '-'}`, `e: ${x.e || '-'}`, ...otherRows].join('<br>');
  }

  function resultComparison(rows, consensus) {
    if (!rows || rows.length < 2) return '';
    const [first, second] = rows;
    const payloadForShape = first.result_payload || second.result_payload || consensus?.result_payload;
    const specimens = resultSpecimensForRound(state.currentRound, payloadForShape);
    const mainTable = `<div class="table-wrap"><table style="min-width:1000px"><thead><tr><th>ตัวอย่าง</th><th>${esc(first.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 1')}</th><th>${esc(second.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 2')}</th><th>สรุปผลห้องปฏิบัติการ</th></tr></thead><tbody>
      ${specimens.map((specimen) => `<tr><td><strong>${esc(specimen)}</strong></td><td>${resultSummary(first.result_payload, specimen)}</td><td>${resultSummary(second.result_payload, specimen)}</td><td>${resultSummary(consensus?.result_payload, specimen)}</td></tr>`).join('')}
    </tbody></table></div>`;
    let antigenSpecimens = [];
    if (payloadForShape?.schema === CAP_J_JE_SCHEMA) antigenSpecimens = ['J-06R','JE-07R'];
    if (payloadForShape?.schema === PROVIDER_GENERATED_SCHEMA && generatedResultSchema()) {
      antigenSpecimens = (generatedResultSchema().antigen_sections || []).map((section) => String(section.specimen_id || '')).filter(Boolean);
    }
    if (!antigenSpecimens.length) return mainTable;
    const antigenTable = `<div style="height:14px"></div><div class="table-wrap"><table style="min-width:900px"><thead><tr><th>Antigen typing</th><th>${esc(first.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 1')}</th><th>${esc(second.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 2')}</th><th>สรุปผลห้องปฏิบัติการ</th></tr></thead><tbody>
      ${antigenSpecimens.map((specimen) => `<tr><td><strong>${esc(specimen)}</strong></td><td>${antigenSummary(first.result_payload, specimen)}</td><td>${antigenSummary(second.result_payload, specimen)}</td><td>${antigenSummary(consensus?.result_payload, specimen)}</td></tr>`).join('')}
    </tbody></table></div>`;
    return mainTable + antigenTable;
  }

  function autoLabSummaryPanel(consensus) {
    if (!consensus?.auto_generated) return '';
    const summary = consensus.comparison_summary || {};
    const differences = Array.isArray(summary.differences) ? summary.differences : [];
    const unresolved = Number(summary.reviewer_unresolved_count ?? summary.unresolved_count ?? differences.length ?? 0);
    const matched = Number(summary.matched_count || 0);
    const different = Number(summary.different_count || 0);
    const missing = Number(summary.missing_one_count || 0);
    const rows = differences.map((item) => `<tr>
      <td>${esc(item.specimen || '-')}</td>
      <td>${esc(item.label || item.field || '-')}</td>
      <td>${esc(item.first_value || '-')}</td>
      <td>${esc(item.second_value || '-')}</td>
    </tr>`).join('');
    return `<div class="notice ${unresolved ? 'warning' : 'success'}">
      <strong>ระบบเทียบผลให้อัตโนมัติแล้ว</strong><br>
      ค่าที่ตรงกัน ${matched} รายการ · ค่าที่ต่างกัน ${different} รายการ · ขาดข้อมูลหนึ่งคน ${missing} รายการ
      ${unresolved ? `<br><strong>ผู้ทบทวนต้องตรวจและเลือกผลสรุปอีก ${unresolved} รายการก่อนส่งให้ผู้รับรองคุณภาพ</strong>` : '<br>ค่าที่ต่างกันได้รับการตรวจครบแล้ว'}
    </div>${rows ? `<div style="height:12px"></div><div class="table-wrap"><table><thead><tr><th>ตัวอย่าง</th><th>รายการ</th><th>ผู้ปฏิบัติคนที่ 1</th><th>ผู้ปฏิบัติคนที่ 2</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  }

  async function roundHistoricalConsensus(round) {
    const [{ data: consensus }, { data: rows }, { data: assignments }, { data: confirmations }, directory] = await Promise.all([
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_individual_results').select('*').eq('round_id', round.id).order('submitted_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('assignment_role', 'practitioner').eq('active', true).order('practitioner_slot'),
      state.supabase.from('ec_historical_result_confirmations').select('*').eq('round_id', round.id),
      loadDirectory()
    ]);
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const complete = (assignments || []).length === 2 && (assignments || []).every((assignment) => (rows || []).some((row) => row.user_id === assignment.user_id));
    const canEdit = canImportHistoricalEqa() && round.historical_review_status !== 'qm_certified';
    const comparisonRows = (assignments || []).map((assignment) => {
      const row = (rows || []).find((item) => item.user_id === assignment.user_id);
      return row ? { ...row, ec_profiles: { full_name: name(assignment.user_id) } } : null;
    }).filter(Boolean);
    const confirmationRows = (assignments || []).map((assignment) => {
      const row = (rows || []).find((item) => item.user_id === assignment.user_id);
      const confirmation = row ? (confirmations || []).find((item) => item.individual_result_id === row.id && item.user_id === assignment.user_id) : null;
      return `<tr><td>${esc(name(assignment.user_id))}</td><td>${historicalConfirmationBadge(confirmation)}</td><td>${confirmation ? fmtDate(confirmation.confirmed_at, true) : '-'}</td><td>${esc(confirmation?.note || '-')}</td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-header"><div><h2>ผลกลางที่ห้องส่งจริง</h2><div class="small muted">กรอกจากแบบส่งผลหรือหลักฐานที่ห้องปฏิบัติการส่งจริง ไม่สร้างผลใหม่ย้อนหลัง</div></div>${consensus ? `<span class="badge info">กรอกแทนจากหลักฐานเดิม</span>` : ''}</div>
      ${!complete ? `<div class="notice warning">กรุณากรอกข้อมูลย้อนหลังของผู้ปฏิบัติทั้ง 2 คนในหัวข้อ 4 ก่อน แม้ไม่มีผลรายบุคคลแยกก็ต้องระบุไว้ตามจริง</div>` : ''}
      ${complete && comparisonRows.length === 2 ? `<h3>ข้อมูลของผู้ปฏิบัติที่นำเข้า</h3>${resultComparison(comparisonRows, consensus)}<div style="height:18px"></div>` : ''}
      ${complete ? `<form id="historical-consensus-form">
        ${resultForm(consensus?.result_payload, 'historicalConsensus', !canEdit)}
        <div class="field"><label>แหล่งข้อมูลของผลกลาง</label><textarea class="textarea" name="source_note" ${canEdit ? '' : 'disabled'} required placeholder="เช่น สำเนาแบบส่งผล CAP ลงวันที่...">${esc(consensus?.source_note || '')}</textarea></div>
      </form>
      <div class="modal-footer">${canEdit ? `<button class="btn btn-primary" id="save-historical-consensus">บันทึกผลกลางที่ส่งจริง</button>` : ''}</div>` : ''}
      ${consensus ? `<div class="notice"><strong>ผู้กรอกผลกลางแทน:</strong> ${esc(name(consensus.entered_by || consensus.prepared_by))} · ${fmtDate(consensus.entered_at || consensus.updated_at, true)}<br><span class="small">หลังแก้ผลกลาง ระบบจะล้างการยืนยันเดิมและให้ผู้ปฏิบัติทั้งสองคนตรวจยืนยันใหม่</span></div>
      <div style="height:14px"></div><h3>การยืนยันของผู้ปฏิบัติจริง</h3><div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ผลการยืนยัน</th><th>วันเวลา</th><th>หมายเหตุ</th></tr></thead><tbody>${confirmationRows}</tbody></table></div>` : ''}
      ${round.historical_review_status === 'awaiting_reviewer' ? `<div class="modal-footer"><button class="btn btn-primary" data-go-historical-step="approval">ผู้ปฏิบัติยืนยันครบแล้ว ไปขั้นผู้ทบทวน</button></div>` : ''}
    </div>`;
  }

  async function roundHistoricalApproval(round) {
    const [{ data: approvals }, { data: assignments }, directory] = await Promise.all([
      state.supabase.from('ec_approvals').select('*').eq('round_id', round.id).in('stage', ['historical_practitioner_confirm','historical_reviewer_review','historical_qm_certification']).order('signed_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
      loadDirectory(),
      loadQmDelegations()
    ]);
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const reviewer = (assignments || []).find((assignment) => assignment.assignment_role === 'reviewer');
    const qualityApprover = (assignments || []).find((assignment) => assignment.assignment_role === 'quality_approver');
    const isAssignedReviewer = reviewer?.user_id === state.user.id;
    const isAssignedQualityApprover = qualityApprover?.user_id === state.user.id;
    const reviewerCanAct = hasRole('reviewer') && isAssignedReviewer && round.historical_review_status === 'awaiting_reviewer';
    const qmCanAct = canQualityApprove(round.id) && isAssignedQualityApprover && round.historical_review_status === 'awaiting_qm_certification';
    const stages = [
      ['historical_practitioner_confirm','ผู้ปฏิบัติจริงตรวจและยืนยันข้อมูลของตน'],
      ['historical_reviewer_review','ผู้ทบทวนตรวจข้อมูลและหลักฐานย้อนหลัง'],
      ['historical_qm_certification','ผู้รับรองคุณภาพรับรองและเปิดการประเมิน']
    ];
    return `<div class="grid cols-2">
      <div class="card"><h2>ลำดับการตรวจข้อมูลย้อนหลัง</h2><div class="timeline">${stages.map(([stage,label]) => {
        const found = (approvals || []).filter((item) => item.stage === stage);
        return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(label)}</strong><br>${found.length ? found.map((item) => `${esc(approvalSignerText(name(item.approver_id), item))} — ${esc(labelFrom(DECISION_LABELS, item.decision))} (${fmtDate(item.signed_at, true)})${item.note ? `<br><span class="small muted">${esc(item.note)}</span>` : ''}`).join('<br>') : '<span class="muted">ยังไม่มีการรับรอง</span>'}</div></div>`;
      }).join('')}</div></div>
      <div class="card"><h2>ดำเนินการตามลำดับ</h2>
        <div class="notice">สถานะปัจจุบัน: <strong>${esc(labelFrom(HISTORICAL_REVIEW_LABELS, round.historical_review_status))}</strong></div>
        ${reviewerCanAct ? `<div class="form-grid"><div class="field"><label>ข้อคิดเห็นของผู้ทบทวน</label><textarea class="textarea" id="historical-reviewer-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="historical-reviewer-approve">ตรวจผ่านและส่งให้ผู้รับรองคุณภาพ</button><button class="btn btn-warning" id="historical-reviewer-return">ส่งกลับให้แก้ข้อมูลย้อนหลัง</button></div></div>` : ''}
        ${qmCanAct ? `<div class="form-grid"><div class="notice success">ผู้ทบทวนตรวจผ่านแล้ว ผู้รับรองคุณภาพสามารถรับรองและเปิดการประเมินความสามารถได้</div><div class="field"><label>หมายเหตุผู้รับรองคุณภาพ</label><textarea class="textarea" id="historical-qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="historical-qm-approve">รับรองข้อมูลและเปิดการประเมิน</button><button class="btn btn-warning" id="historical-qm-return">ส่งกลับแก้ไข</button></div></div>` : ''}
        ${round.historical_review_status === 'qm_certified' ? `<div class="notice success"><strong>รับรองข้อมูลย้อนหลังแล้ว</strong><br>สามารถไปหัวข้อ 10 เพื่อสร้างรายการประเมิน ผู้ปฏิบัติจริง 2 คนจะได้แบบประเมินการปฏิบัติงาน ส่วนเจ้าหน้าที่คนอื่นจะได้แบบทดสอบ</div><div class="modal-footer"><button class="btn btn-primary" data-go-historical-step="competency">ไปเปิดการประเมินความสามารถ</button></div>` : ''}
        ${hasRole('reviewer') && reviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนเป็น ${esc(name(reviewer.user_id))} คุณเปิดดูได้แต่กดตรวจผ่านไม่ได้</div>` : ''}
        ${hasRole('deputy_qm') && isAssignedQualityApprover && !canQualityApprove(round.id) ? `<div class="notice warning">คุณได้รับกำหนดเป็นผู้รับรองคุณภาพของรอบนี้ แต่ช่วงมอบหมายให้ทำหน้าที่แทนยังไม่เปิดหรือหมดอายุแล้ว</div>` : ''}
        ${(hasRole('qm','deputy_qm')) && qualityApprover && !isAssignedQualityApprover ? `<div class="notice warning">รอบนี้มอบหมายผู้รับรองคุณภาพเป็น ${esc(name(qualityApprover.user_id))} คุณเปิดดูได้แต่รับรองแทนไม่ได้</div>` : ''}
      </div>
    </div>`;
  }

  async function roundConsensus(round) {
    if (isHistoricalRound(round)) return roundHistoricalConsensus(round);
    const [{ data: consensus }, { data: individualRows }, { data: assignmentRows }] = await Promise.all([
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_individual_results').select('*, ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('round_id', round.id).order('submitted_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true)
    ]);
    const practitioner = await isPractitioner(round.id);
    const practitionerAssignments = (assignmentRows || []).filter((row) => row.assignment_role === 'practitioner');
    const assignedReviewer = (assignmentRows || []).find((row) => row.assignment_role === 'reviewer');
    const submittedIds = new Set((individualRows || []).filter((row) => ['submitted','resubmitted','locked'].includes(row.status)).map((row) => row.user_id));
    const approvedIds = new Set((individualRows || []).filter((row) => row.review_status === 'approved').map((row) => row.user_id));
    const pairComplete = practitionerAssignments.length === 2 && practitionerAssignments.every((row) => submittedIds.has(row.user_id));
    const individualReviewComplete = practitionerAssignments.length === 2 && practitionerAssignments.every((row) => approvedIds.has(row.user_id));
    const isAssignedReviewer = Boolean(assignedReviewer && assignedReviewer.user_id === state.user.id);
    const reviewerCanEdit = Boolean(consensus && individualReviewComplete && hasRole('reviewer') && isAssignedReviewer && ['practitioners_confirmed','returned'].includes(consensus.status));
    const canSeeComparison = pairComplete && (practitioner || canReview() || hasRole('physician','viewer'));
    const sentForward = consensus && ['awaiting_qm_review','qm_approved','awaiting_physician_approval','physician_approved','submitted','locked'].includes(consensus.status);
    return `<div class="card"><div class="card-header"><div><h2>สรุปผลห้องปฏิบัติการ</h2><div class="small muted">เมื่อผู้ปฏิบัติทั้งสองคนส่งผลครบ ระบบจะเทียบผลและเติมค่าที่ตรงกันให้อัตโนมัติ ผู้ทบทวนตรวจเฉพาะค่าที่ต่างกันแล้วส่งให้ผู้รับรองคุณภาพ</div></div>${consensus ? `<span class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status))} · ฉบับที่ ${consensus.version}</span>` : ''}</div>
      ${!pairComplete ? `<div class="notice warning">ยังสร้างสรุปไม่ได้ ต้องรอผู้ปฏิบัติจริงทั้ง 2 คนกด “ยืนยันและส่งผล” ให้ครบก่อน</div>` : ''}
      ${pairComplete && !individualReviewComplete ? `<div class="notice warning"><strong>ยังส่งต่อผู้รับรองคุณภาพไม่ได้</strong><br>ผู้ทบทวนต้องตรวจผลรายบุคคลของผู้ปฏิบัติจริงทีละคนให้ผ่านครบก่อน แล้วจึงตรวจสรุปผลกลาง<div class="table-actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="go-individual-review">ไปตรวจผลรายบุคคล</button></div></div>` : ''}
      ${pairComplete && individualReviewComplete && !consensus ? `<div class="notice warning">ผู้ปฏิบัติส่งครบและผู้ทบทวนตรวจผ่านแล้ว ระบบกำลังสร้างสรุปผลห้องปฏิบัติการ กรุณารีเฟรชหน้านี้อีกครั้ง</div>` : ''}
      ${canSeeComparison ? `<h3>เปรียบเทียบผลของผู้ปฏิบัติ</h3>${resultComparison((individualRows || []).filter((row) => submittedIds.has(row.user_id)), consensus)}<div style="height:18px"></div>` : ''}
      ${consensus && canSeeComparison ? `${autoLabSummaryPanel(consensus)}<div style="height:18px"></div><h3>สรุปผลที่ใช้ส่งต่อ</h3><form id="consensus-form">${resultForm(consensus.result_payload, 'consensus', !reviewerCanEdit)}</form>
        ${reviewerCanEdit ? `<div class="field"><label>หมายเหตุผู้ทบทวน</label><textarea class="textarea" id="reviewer-summary-note" placeholder="ระบุเหตุผลเมื่อเลือกผลสรุปต่างจากผู้ปฏิบัติ หรือหมายเหตุเพิ่มเติม">${esc(consensus.reviewer_note || '')}</textarea></div>` : consensus.reviewer_note ? `<div class="notice"><strong>หมายเหตุผู้ทบทวน:</strong> ${esc(consensus.reviewer_note)}</div>` : ''}
        <div class="modal-footer">
          ${reviewerCanEdit ? `<button class="btn btn-secondary" id="save-reviewer-summary">บันทึกร่างสรุป</button><button class="btn btn-primary" id="finalize-reviewer-summary">ตรวจเสร็จและส่งให้ผู้รับรองคุณภาพ</button>` : ''}
          ${sentForward ? `<button class="btn btn-outline" id="go-approval-from-summary">ดูขั้นตรวจ/รับรอง</button>` : ''}
        </div>` : pairComplete ? `<div class="notice">หน้านี้เปิดให้ผู้ปฏิบัติ ผู้ทบทวน ผู้จัดการคุณภาพ แพทย์ และผู้มีสิทธิ์ดูรายงานเท่านั้น</div>` : ''}
      ${hasRole('reviewer') && assignedReviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนเป็นบุคคลอื่น คุณเปิดดูได้แต่แก้หรือส่งสรุปไม่ได้</div>` : ''}
      ${practitioner && consensus ? `<div class="notice success">ผู้ปฏิบัติไม่ต้องจัดทำผลกลางซ้ำ ระบบนำผลของทั้งสองคนมาเทียบให้แล้ว</div>` : ''}
    </div>`;
  }

    async function roundApproval(round) {
    if (isHistoricalRound(round)) return roundHistoricalApproval(round);
    const [{ data: approvals }, { data: consensus }, { data: assignments }] = await Promise.all([
      state.supabase.from('ec_approvals').select('*, ec_profiles!ec_approvals_approver_id_fkey(full_name)').eq('round_id', round.id).order('signed_at'),
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
      loadQmDelegations()
    ]);
    const assignedReviewer = (assignments || []).find((a) => a.assignment_role === 'reviewer');
    const assignedQualityApprover = (assignments || []).find((a) => a.assignment_role === 'quality_approver');
    const isAssignedReviewer = Boolean(assignedReviewer && assignedReviewer.user_id === state.user.id);
    const isAssignedQualityApprover = Boolean(assignedQualityApprover && assignedQualityApprover.user_id === state.user.id);
    const reviewerCanAct = consensus && hasRole('reviewer') && isAssignedReviewer && ['practitioners_confirmed','returned'].includes(consensus.status);
    const qmCanAct = consensus && canQualityApprove(round.id) && isAssignedQualityApprover && ['awaiting_qm_review'].includes(consensus.status);
    const physicianCanAct = consensus && hasRole('physician') && ['qm_approved','awaiting_physician_approval'].includes(consensus.status);
    const stages = ['reviewer_review','qm_review','physician_approval'];
    return `<div class="grid cols-2">
      <div class="card"><h2>ลำดับการตรวจ รับรอง และรับทราบ</h2>
        <div class="timeline">${stages.map((stage) => {
          const found = (approvals || []).filter((a) => a.stage === stage);
          return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(labelFrom(APPROVAL_STAGE_LABELS, stage))}</strong><br>${found.length ? found.map((a) => `${esc(approvalSignerText(a.ec_profiles?.full_name || '', a))} — ${esc(labelFrom(DECISION_LABELS, a.decision))} (${fmtDate(a.signed_at,true)})${a.note ? `<br><span class="small muted">${esc(a.note)}</span>` : ''}`).join('<br>') : '<span class="muted">ยังไม่มีการดำเนินการ</span>'}</div></div>`;
        }).join('')}</div>
      </div>
      <div class="card"><h2>ดำเนินการตามลำดับ</h2>
        ${!consensus ? `<div class="notice warning">ยังไม่มีสรุปผลห้องปฏิบัติการ</div>` : ''}
        ${reviewerCanAct ? `<div class="form-grid"><div class="notice">ระบบสร้างสรุปจากผลผู้ปฏิบัติทั้งสองคนแล้ว ผู้ทบทวนต้องตรวจค่าที่ต่างกันในหัวข้อ 5 ก่อนส่งต่อ</div><div class="table-actions"><button class="btn btn-primary" id="go-reviewer-summary">ไปตรวจสรุปผลห้องแลป</button></div></div>` : ''}
        ${qmCanAct ? `<div class="form-grid"><div class="notice">ผู้ทบทวนตรวจสรุปและส่งมาแล้ว ผู้รับรองคุณภาพที่ได้รับมอบหมายจึงสามารถรับรองได้</div><div class="field"><label>หมายเหตุผู้รับรองคุณภาพ</label><textarea class="textarea" id="qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="qm-approve">ผู้รับรองคุณภาพรับรอง</button><button class="btn btn-warning" id="qm-return">ส่งกลับให้ผู้ทบทวนแก้สรุป</button></div></div>` : ''}
        ${physicianCanAct ? `<div class="form-grid"><div class="notice">ผู้รับรองคุณภาพรับรองแล้ว แพทย์ผู้รับรองคนใดคนหนึ่งตรวจดูและกดรับทราบ ระบบจะบันทึกผู้ที่ดำเนินการจริง</div><div class="field"><label>หมายเหตุแพทย์</label><textarea class="textarea" id="physician-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="physician-acknowledge">แพทย์รับทราบ</button><button class="btn btn-warning" id="physician-return">ส่งกลับผู้รับรองคุณภาพ</button></div></div>` : ''}
        ${consensus && !reviewerCanAct && !qmCanAct && !physicianCanAct ? `<div class="notice">สถานะปัจจุบัน: ${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status, consensus.status))}<br>ระบบจะเปิดปุ่มให้เฉพาะผู้มีหน้าที่ในลำดับปัจจุบันเท่านั้น</div>` : ''}
        ${hasRole('reviewer') && assignedReviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนคนอื่น คุณเปิดดูได้แต่ไม่สามารถส่งสรุปได้</div>` : ''}
        ${hasRole('deputy_qm') && isAssignedQualityApprover && !canQualityApprove(round.id) ? `<div class="notice warning">คุณได้รับกำหนดเป็นผู้รับรองคุณภาพของรอบนี้ แต่ช่วงมอบหมายให้ทำหน้าที่แทนยังไม่เปิดหรือหมดอายุแล้ว</div>` : ''}
        ${(hasRole('qm','deputy_qm')) && assignedQualityApprover && !isAssignedQualityApprover ? `<div class="notice warning">รอบนี้มอบหมายผู้รับรองคุณภาพเป็นบุคคลอื่น คุณเปิดดูได้แต่ไม่สามารถรับรองได้</div>` : ''}
      </div>
    </div>`;
  }

  async function roundSubmission(round) {
    const [{ data: rows, error }, { data: submissionDocs, error: docError }, directory] = await Promise.all([
      state.supabase.from('ec_submission_evidence').select('*, ec_round_documents(*)').eq('round_id', round.id).order('submitted_at', { ascending: false }),
      state.supabase.from('ec_round_documents').select('id,title,file_name,storage_path,mime_type,category,created_at').eq('round_id', round.id).in('category', ['submission_form','submission_evidence']).is('archived_at', null).order('created_at', { ascending: false }),
      loadDirectory()
    ]);
    if (error || docError) throw (error || docError);
    const name = (id) => directory.find((person) => person.id === id)?.full_name || '-';
    const documentCell = (row) => {
      const doc = row.ec_round_documents;
      if (!doc) return '<span class="muted">ไม่ได้เชื่อมไฟล์</span>';
      return `<strong>${esc(doc.title || doc.file_name)}</strong><br><span class="small muted">${esc(doc.file_name || '')}</span><div style="margin-top:6px"><button class="btn btn-outline btn-sm" data-open-submission-path="${esc(doc.storage_path)}">เปิดไฟล์</button></div>`;
    };
    const rowsTable = (rows || []).length ? `<div class="table-wrap"><table style="min-width:820px"><thead><tr><th>วันเวลา</th><th>ผู้ส่ง</th><th>เลขอ้างอิง</th><th>ไฟล์หลักฐาน/แบบฟอร์มผล</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${fmtDate(row.submitted_at,true)}</td><td>${esc(name(row.submitted_by))}</td><td>${esc(row.provider_reference || '-')}</td><td>${documentCell(row)}</td><td>${esc(row.note || '-')}</td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่ได้บันทึกวันเวลาและไฟล์ที่ส่งผล');
    const linkedIds = new Set((rows || []).map((row) => row.document_id).filter(Boolean));
    const unlinkedDocs = (submissionDocs || []).filter((doc) => !linkedIds.has(doc.id));
    const unlinkedNotice = unlinkedDocs.length ? `<div class="notice warning"><strong>พบไฟล์ผลที่ส่งซึ่งยังไม่เชื่อมกับวันเวลาส่ง ${unlinkedDocs.length} ไฟล์</strong><br>${unlinkedDocs.map((doc) => esc(doc.file_name)).join('<br>')}<br><span class="small">กด “บันทึกการส่ง” แล้วเลือกไฟล์เดิม ไม่ต้องอัปโหลดซ้ำ</span></div><div style="height:12px"></div>` : '';

    if (isHistoricalRound(round)) {
      return `<div class="card"><div class="card-header"><div><h2>หลักฐาน/แบบฟอร์มผลที่ส่งย้อนหลัง</h2><div class="small muted">ไฟล์เดียวใช้ทั้งยืนยันคำตอบที่ห้องส่งและเป็นหลักฐานการส่ง โดยเชื่อมกับวันเวลาและผู้ส่งจริง</div></div>${canManage() ? `<button class="btn btn-primary" id="add-submission">＋ เชื่อมไฟล์กับข้อมูลการส่ง</button>` : ''}</div>
        <div class="grid cols-3">
          <div><strong>วันที่และเวลาที่ส่งจริง</strong><p>${fmtDate(round.actual_submitted_at, true)}</p></div>
          <div><strong>เจ้าหน้าที่ผู้ส่งผลจริง</strong><p>${esc(name(round.actual_submitted_by))}</p></div>
          <div><strong>เลขอ้างอิง</strong><p>${esc(round.actual_provider_reference || '-')}</p></div>
        </div>
        <div class="notice info">อัปโหลดไฟล์เพียงครั้งเดียวในหัวข้อ 2 โดยเลือกประเภท “หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ” แล้วกลับมาเชื่อมไฟล์ในหน้านี้</div>
        <div style="height:12px"></div>${unlinkedNotice}${rowsTable}
      </div>`;
    }
    return `<div class="card"><div class="card-header"><div><h2>หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ</h2><div class="small muted">อัปโหลดไฟล์ครั้งเดียว แล้วบันทึกวันเวลา ผู้ส่ง เลขอ้างอิง และเลือกไฟล์เดียวกันเป็นหลักฐาน</div></div>${canManage() ? `<button class="btn btn-primary" id="add-submission">＋ บันทึกการส่ง</button>` : ''}</div>
      <div class="notice info">ไฟล์นี้ใช้สรุปว่า “ห้องส่งอะไร” และเป็นหลักฐานการส่ง แต่ไม่ใช้เป็นเฉลยของ Competency</div><div style="height:12px"></div>
      ${unlinkedNotice}${rowsTable}
    </div>`;
  }

  function officialAssessmentInfo(value) {
    return {
      pass: ['ผ่าน', 'success', '✓'],
      fail: ['ไม่ผ่าน', 'danger', '✕'],
      educational: ['Educational', 'info', '–'],
      not_graded: ['ไม่ให้คะแนน', 'warning', '–'],
      pending: ['รอตรวจ', 'warning', '…']
    }[String(value || 'pending')] || ['รอตรวจ', 'warning', '…'];
  }

  function isEducationalOfficialRow(row) {
    return String(row?.challenge_type || '').toLowerCase() === 'educational'
      || ['educational','not_graded'].includes(String(row?.assessment || '').toLowerCase())
      || /educational|see note\s*\[?26\]?|not graded/i.test(`${row?.official_grade || ''} ${row?.note || ''}`);
  }

  function educationalReviewInfo(row) {
    if (!isEducationalOfficialRow(row)) return null;
    const alignment = String(row?.consensus_alignment || '').toLowerCase();
    const status = String(row?.internal_review_status || '').toLowerCase();
    if (alignment === 'minority' || status === 'needs_explanation' || row?.review_required === true) {
      return ['คำตอบส่วนน้อย — ต้องชี้แจง', 'danger', row?.review_reason || 'ผลที่ห้องรายงานต่างจากคำตอบของผู้เข้าร่วมส่วนใหญ่ กรุณาทบทวนความเหมาะสมและระบุเหตุผล'];
    }
    if (alignment === 'aligned' || status === 'acceptable') {
      return ['สอดคล้องกับกลุ่มส่วนใหญ่', 'success', row?.review_reason || 'ผลที่ห้องรายงานตรงกับ participant consensus'];
    }
    return ['รอตรวจความเหมาะสม', 'warning', row?.review_reason || 'ข้อมูล consensus ยังไม่ชัดหรือยังไม่มี Participant Summary'];
  }

  function educationalReviewBadge(row) {
    const info = educationalReviewInfo(row);
    if (!info) return '<span class="muted">—</span>';
    const [label, cls, detail] = info;
    return `<span class="badge ${esc(cls)}">${esc(label)}</span>${detail ? `<div class="small muted" style="margin-top:5px">${esc(detail)}</div>` : ''}`;
  }


  function isEducationalCompetencyReview(item) {
    return item?.is_educational === true
      || String(item?.challenge_type || '').toLowerCase() === 'educational'
      || String(item?.answer_basis || '').toLowerCase() === 'participant_consensus';
  }

  function competencyReviewStatus(item) {
    if (isEducationalCompetencyReview(item)) {
      if (item?.is_correct === true || String(item?.comparison_status || '') === 'aligned') return ['สอดคล้องกับกลุ่มส่วนใหญ่', 'success'];
      if (item?.is_correct === false || String(item?.comparison_status || '') === 'minority') return ['คำตอบส่วนน้อย — ต้องชี้แจง', 'warning'];
      return ['รอตรวจความเหมาะสม', 'warning'];
    }
    if (item?.is_correct === true) return ['ตอบถูก', 'success'];
    if (item?.is_correct === false) return ['ต้องทบทวน', 'danger'];
    return ['รอตรวจ', 'warning'];
  }

  function canonicalOfficialSpecimen(value, testName = '') {
    const raw = String(value || '').toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, '');
    const jat = raw.match(/JAT-?0?([1-5])/);
    if (jat) return `J-0${jat[1]}`;
    const j = raw.match(/^J-?0?([1-5])(?:R|S)?$/);
    if (j) return `J-0${j[1]}`;
    if (/J-?0?6/.test(raw)) return 'J-06R';
    if (/JE-?0?7R/.test(raw)) return 'JE-07R';
    if (/JE-?0?7/.test(raw)) {
      const antigenOnly = /^(?:ANTI-)?(?:C|E|K|D|FYA|FYB|JKA|JKB)\s*(?:TYPE|ANTIGEN)?$/i.test(String(testName || '').trim())
        || /^ANTIGEN\s+(?:C|E|K|D|FYA|FYB|JKA|JKB)$/i.test(String(testName || '').trim());
      return antigenOnly ? 'JE-07R' : 'JE-07';
    }
    return String(value || '-').trim() || '-';
  }

  function officialTestRank(name) {
    const raw = String(name || '').trim();
    const text = raw.toLowerCase();
    if (text.includes('abo')) return 10;
    if (text.includes('rh')) return 20;
    if (text.includes('screen') || text.includes('detection')) return 30;
    if (text.includes('identification')) return 40;
    if (text.includes('crossmatch') || text.includes('compatibility')) return text.includes('strength') ? 55 : 50;
    if (/^C\s+Type$/i.test(raw) && raw.startsWith('C')) return 60;
    if (/^E\s+Type$/i.test(raw) && raw.startsWith('E')) return 61;
    if (/^c\s+Type$/.test(raw)) return 62;
    if (/^e\s+Type$/.test(raw)) return 63;
    if (/^K\s+Type$/i.test(raw)) return 64;
    if (/\bType$|antigen/i.test(raw)) return 70;
    return 100;
  }

  function officialPrimaryResult(row) {
    return String(row?.official_grade || row?.intended_response || row?.lab_result || '-').trim() || '-';
  }

  function officialSecondaryResult(row) {
    const primary = officialPrimaryResult(row);
    const intended = String(row?.intended_response || '').trim();
    const lab = String(row?.lab_result || '').trim();
    if (intended && intended !== primary) return intended;
    if (lab && lab !== primary) return `ห้องส่ง: ${lab}`;
    return '';
  }

  function officialAssessmentCell(row) {
    if (!row) return '<span class="muted">—</span>';
    const [label, cls, symbol] = officialAssessmentInfo(row.assessment);
    return `<span class="official-check ${esc(cls)}" title="${esc(label)}">${esc(symbol)}</span><span class="official-check-label">${esc(label)}</span>`;
  }

  function officialDetailTable(title, subtitle, rows) {
    if (!rows.length) return '';
    const sorted = rows.slice().sort((a, b) => officialTestRank(a.test_name) - officialTestRank(b.test_name) || String(a.test_name || '').localeCompare(String(b.test_name || '')));
    return `<section class="cap-official-section">
      <div class="cap-official-section-head"><div><span class="section-kicker">${esc(subtitle)}</span><h3>${esc(title)}</h3></div><span class="badge info">${rows.length} รายการ</span></div>
      <div class="official-table-wrap"><table class="cap-official-detail-table">
        <thead><tr><th>ลำดับ</th><th>รายการทดสอบ</th><th>ผลประเมิน / Intended Response</th><th>คำตอบส่วนใหญ่ / % ผู้เข้าร่วม</th><th>ผ่าน</th><th>ไม่ผ่าน</th><th>ประเมินภายใน Educational</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${sorted.map((row, index) => {
          const [label] = officialAssessmentInfo(row.assessment);
          const peer = [String(row.peer_result || '').trim(), String(row.majority_percent || '').trim()].filter(Boolean).join(' · ') || '-';
          return `<tr><td>${index + 1}</td><td><strong>${esc(row.test_name || '-')}</strong></td><td><strong>${esc(officialPrimaryResult(row))}</strong>${officialSecondaryResult(row) ? `<div class="small muted">${esc(officialSecondaryResult(row))}</div>` : ''}</td><td>${esc(peer)}</td><td class="official-mark-cell">${row.assessment === 'pass' ? '✓' : ''}</td><td class="official-mark-cell fail">${row.assessment === 'fail' ? '✓' : ''}</td><td>${educationalReviewBadge(row)}</td><td>${esc(row.note || (['educational','not_graded'].includes(row.assessment) ? label : ''))}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;
  }

  const OFFICIAL_TEST_DEFINITIONS = [
    { key: 'abo', label: 'ABO Group', pattern: /\babo\b/i },
    { key: 'rh', label: 'Rh Type', pattern: /\brh(?:\(d\))?\s*(?:type|typing)?\b/i },
    { key: 'screen', label: 'Unexpected Antibody Detection', pattern: /unexpected\s+antibody\s+detection|antibody\s+(?:screen|detection)/i },
    { key: 'identification', label: 'Antibody Identification', pattern: /antibody\s+identification|\bab\s*id\b/i },
    { key: 'crossmatch', label: 'Crossmatch/Compatibility Testing', pattern: /crossmatch|compatibility\s+testing/i },
  ];

  function canonicalOfficialTestName(value) {
    const text = String(value || '').trim();
    const matches = OFFICIAL_TEST_DEFINITIONS.filter((definition) => definition.pattern.test(text));
    return matches.length === 1 ? matches[0].label : text;
  }

  function officialCompositeTests(value) {
    const text = String(value || '').trim();
    return OFFICIAL_TEST_DEFINITIONS.filter((definition) => definition.pattern.test(text));
  }

  function officialValueSegments(value) {
    const text = String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').trim();
    if (!text) return [];
    const segments = text.split(/\s*(?:;|\n|\r|\u2022|\|\|)\s*/).map((item) => item.trim()).filter(Boolean);
    return segments.length > 1 ? segments : [text];
  }

  function officialSegmentAt(value, index, expectedCount) {
    const parts = officialValueSegments(value);
    if (parts.length === expectedCount) return parts[index] || '';
    if (parts.length === 1) return parts[0];
    return parts[index] || '';
  }

  function officialComparisonKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const capCodes = [...raw.matchAll(/(?:^|[^0-9])(\d{3})\s*[│|]/g)].map((match) => match[1]).sort();
    if (capCodes.length) return `codes:${[...new Set(capCodes)].join(';')}`;
    const antibodies = [...raw.matchAll(/anti-([A-Za-z0-9]+(?:\^[A-Za-z0-9]+)?)/gi)].map((match) => `Anti-${match[1]}`).sort();
    if (antibodies.length) return `antibodies:${[...new Set(antibodies)].join(';')}`;
    if (/ANTIBODY\s+NOT\s+DETECTED/.test(upper)) return 'screen:not-detected';
    if (/ANTIBODY\s+DETECTED/.test(upper)) return 'screen:detected';
    const group = upper.match(/GROUP\s+(AB|A|B|O)\b/);
    if (group) return `abo:${group[1]}`;
    if (/RH(?:\(D\))?\s+NEGATIVE/.test(upper)) return 'rh:negative';
    if (/RH(?:\(D\))?\s+POSITIVE/.test(upper)) return 'rh:positive';
    if (/CROSSMATCH|COMPATIBIL/.test(upper)) {
      if (/NEGATIVE|COMPATIBLE/.test(upper)) return 'crossmatch:negative';
      if (/POSITIVE|INCOMPATIBLE/.test(upper)) return 'crossmatch:positive';
    }
    const strength = upper.match(/(?:MICROSCOPIC|\+[1-4])\s*(?:REACTION)?/);
    if (strength) return `strength:${strength[0].replace(/\s+/g, '')}`;
    if (/\bNEGATIVE\b/.test(upper) && !/POSITIVE/.test(upper)) return 'result:negative';
    if (/\bPOSITIVE\b/.test(upper) && !/NEGATIVE/.test(upper)) return 'result:positive';
    return upper
      .replace(/\b(?:RESULT|YOUR|LAB|PARTICIPANT|CONSENSUS|MOST\s+FREQUENT|RESPONSE|SUMMARY|FROM|FOR)\b/g, '')
      .replace(/\d+(?:\.\d+)?%/g, '')
      .replace(/[^A-Z0-9+]+/g, '');
  }

  function normalizeEducationalOfficialRow(row) {
    if (!isEducationalOfficialRow(row)) return row;
    const labKey = officialComparisonKey(row?.lab_result);
    const peerKey = officialComparisonKey(row?.peer_result || row?.intended_response);
    if (labKey && peerKey && labKey === peerKey) {
      return {
        ...row,
        consensus_alignment: 'aligned',
        internal_review_status: 'acceptable',
        review_required: false,
        review_reason: row?.review_reason && !/ต่าง|ส่วนน้อย|unclear|ไม่ชัด/i.test(String(row.review_reason))
          ? row.review_reason
          : 'ผลที่ห้องรายงานตรงกับคำตอบส่วนใหญ่ของผู้เข้าร่วม',
        assessment: 'educational',
      };
    }
    if (!labKey || !peerKey) {
      return {
        ...row,
        consensus_alignment: 'unclear',
        internal_review_status: 'pending',
        review_required: true,
        review_reason: 'ข้อมูลผลของห้องหรือ participant consensus ยังไม่ครบ กรุณาตรวจเอกสารต้นทาง',
        assessment: row?.assessment === 'educational' ? 'pending' : row?.assessment,
      };
    }
    return row;
  }

  function normalizeCapOfficialRows(specimenRows) {
    const expanded = [];
    for (const originalRow of specimenRows || []) {
      const specimen = canonicalOfficialSpecimen(originalRow?.specimen, originalRow?.test_name);
      const tests = officialCompositeTests(originalRow?.test_name);
      if (/^J-0[1-5]$/.test(specimen) && tests.length > 1) {
        tests.forEach((test, index) => {
          expanded.push(normalizeEducationalOfficialRow({
            ...originalRow,
            specimen,
            test_name: test.label,
            lab_result: officialSegmentAt(originalRow?.lab_result, index, tests.length),
            intended_response: officialSegmentAt(originalRow?.intended_response, index, tests.length),
            official_grade: officialSegmentAt(originalRow?.official_grade, index, tests.length),
            peer_result: officialSegmentAt(originalRow?.peer_result, index, tests.length),
            majority_percent: officialSegmentAt(originalRow?.majority_percent, index, tests.length),
          }));
        });
      } else {
        expanded.push(normalizeEducationalOfficialRow({
          ...originalRow,
          specimen,
          test_name: canonicalOfficialTestName(originalRow?.test_name),
        }));
      }
    }
    const byKey = new Map();
    expanded.forEach((row) => {
      const key = `${row.specimen}|${String(row.test_name || '').toLowerCase()}`;
      const previous = byKey.get(key);
      if (!previous || String(row.lab_result || row.intended_response || '').length > String(previous.lab_result || previous.intended_response || '').length) byKey.set(key, row);
    });
    return [...byKey.values()];
  }

  function capOfficialSummaryTables(specimenRows) {
    const normalized = normalizeCapOfficialRows(specimenRows).map((row) => ({ ...row, _specimen: canonicalOfficialSpecimen(row.specimen, row.test_name) }));
    const mainSpecimens = ['J-01','J-02','J-03','J-04','J-05'];
    const mainRows = normalized.filter((row) => mainSpecimens.includes(row._specimen));
    const testNames = [...new Set(mainRows.map((row) => String(row.test_name || '').trim()).filter(Boolean))]
      .sort((a, b) => officialTestRank(a) - officialTestRank(b) || a.localeCompare(b));
    const matrix = testNames.length ? `<section class="cap-official-section">
      <div class="cap-official-section-head"><div><span class="section-kicker">Program J</span><h3>สรุปผล J-01 ถึง J-05</h3></div><span class="badge info">รูปแบบ FM-CNCPL-048</span></div>
      <div class="official-table-wrap"><table class="cap-official-matrix">
        <thead><tr><th rowspan="2">ลำดับ</th><th rowspan="2">รายการทดสอบ</th>${mainSpecimens.map((specimen) => `<th colspan="2">Specimen ID ${esc(specimen)}</th>`).join('')}</tr>
        <tr>${mainSpecimens.map(() => '<th>ผลประเมิน</th><th>การแปลผล</th>').join('')}</tr></thead>
        <tbody>${testNames.map((testName, index) => `<tr><td>${index + 1}</td><td><strong>${esc(testName)}</strong></td>${mainSpecimens.map((specimen) => {
          const row = mainRows.find((item) => item._specimen === specimen && String(item.test_name || '').trim() === testName);
          if (!row) return '<td class="empty-cell">—</td><td class="official-mark-cell">—</td>';
          return `<td><strong>${esc(officialPrimaryResult(row))}</strong>${officialSecondaryResult(row) ? `<div class="small muted">${esc(officialSecondaryResult(row))}</div>` : ''}</td><td class="official-matrix-assessment">${officialAssessmentCell(row)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </section>` : '<div class="notice warning">ยังไม่มีข้อมูล J-01 ถึง J-05 ในตารางสรุป กรุณากด “5. สร้างสรุปผลอย่างเป็นทางการ” ใหม่</div>';

    const j06 = normalized.filter((row) => row._specimen === 'J-06R');
    const je07 = normalized.filter((row) => row._specimen === 'JE-07');
    const je07r = normalized.filter((row) => row._specimen === 'JE-07R');
    const known = new Set([...mainRows, ...j06, ...je07, ...je07r]);
    const others = normalized.filter((row) => !known.has(row));
    return `<div class="cap-official-form">${matrix}${officialDetailTable('ผล Antigen typing — J-06R', 'Program J', j06)}${officialDetailTable('สรุปผลตัวอย่าง JE-07', 'Program JE', je07)}${officialDetailTable('ผล Antigen typing — JE-07R', 'Program JE', je07r)}${others.length ? officialDetailTable('รายการอื่นจาก Official Evaluation', 'Other', others) : ''}</div>`;
  }

  async function roundOfficial(round) {
    const { data: official } = await state.supabase.from('ec_official_results').select('*').eq('round_id', round.id).maybeSingle();
    const ai = official?.official_payload && typeof official.official_payload === 'object' ? official.official_payload : {};
    const reviewTopics = Array.isArray(ai.review_topics) ? ai.review_topics.join('\n') : String(ai.review_topics || '');
    const specimenRows = Array.isArray(ai.specimen_summaries) ? ai.specimen_summaries : [];
    const evaluationModeLabels = {
      graded: 'มีการให้คะแนน',
      educational: 'Educational Challenge',
      mixed: 'มีทั้ง Graded และ Educational',
      insufficient: 'หลักฐานยังไม่พอ'
    };
    const assessmentLabels = {
      pass: ['ผ่าน', 'success'],
      fail: ['ไม่ผ่าน', 'danger'],
      educational: ['Educational', 'info'],
      not_graded: ['ไม่ให้คะแนน', 'warning'],
      pending: ['รอตรวจ', 'warning']
    };
    const groupedRows = new Map();
    specimenRows.forEach((row) => {
      const key = String(row.program || 'ผลประเมิน');
      if (!groupedRows.has(key)) groupedRows.set(key, []);
      groupedRows.get(key).push(row);
    });
    const genericSpecimenTable = specimenRows.length ? [...groupedRows.entries()].map(([program, rows]) => `
      <section class="official-program-block">
        <div class="official-program-title"><div><span class="section-kicker">${esc(program)}</span><h3>สรุปผลแยกตามตัวอย่างและรายการทดสอบ</h3></div><span class="badge info">${rows.length} รายการ</span></div>
        <div class="official-table-wrap"><table class="official-result-table">
          <thead><tr><th>ตัวอย่าง</th><th>รายการทดสอบ</th><th>ผลที่ห้องรายงาน</th><th>ผลที่ควรเป็น</th><th>เปรียบเทียบผู้เข้าร่วม</th><th>ผลประเมิน</th></tr></thead>
          <tbody>${rows.map((row) => {
            const [label, cls] = assessmentLabels[row.assessment] || assessmentLabels.pending;
            return `<tr>
              <td><strong>${esc(row.specimen || '-')}</strong></td>
              <td>${esc(row.test_name || '-')}</td>
              <td>${esc(row.lab_result || '-')}</td>
              <td>${esc(row.intended_response || '-')}</td>
              <td>${esc([String(row.peer_result || '').trim(), String(row.majority_percent || '').trim()].filter(Boolean).join(' · ') || '-')}</td>
              <td><span class="badge ${cls}">${esc(label)}</span>${isEducationalOfficialRow(row) ? `<div style="margin-top:7px">${educationalReviewBadge(row)}</div>` : ''}${row.note ? `<div class="small muted" style="margin-top:5px">${esc(row.note)}</div>` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`).join('') : '';
    const specimenTable = specimenRows.length
      ? (isLegacyCapJJeARound(round) && !generatedResultSchema(round) ? capOfficialSummaryTables(specimenRows) : genericSpecimenTable)
      : `<div class="notice warning">ยังไม่มีตารางสรุปแบบแยกรายการ กด “5. สร้างสรุปผลอย่างเป็นทางการ” ใหม่หลังอัปเดตระบบ เพื่อให้ AI จัดผลเป็นตารางตามตัวอย่าง</div>`;

    const structuredView = official ? `<div class="official-report-preview">
      <div class="official-report-head">
        <div><span class="eyebrow">External Quality Assessment</span><h2>สรุปผลห้องปฏิบัติการ</h2><p>${esc(round.provider || '')} · ${esc(round.program_name || '')} · ${esc(round.round_code || '')}</p></div>
        <div class="official-overall-result">
          <span class="small muted">ผลรวม</span>
          <strong>${esc(labelFrom(OFFICIAL_OUTCOME_LABELS, official.outcome))}</strong>
          <span>${official.score ?? '-'}${official.score !== null && official.score !== undefined ? ' คะแนน' : ''}</span>
        </div>
      </div>
      ${specimenTable}
      <details class="official-analysis-details">
        <summary>ดูคำอธิบายและหัวข้อทบทวนเพิ่มเติม</summary>
        <div class="official-summary-grid">
          <section class="official-summary-card"><span class="summary-index">1</span><div><h3>ผลของห้องปฏิบัติการ</h3><p>${esc(ai.lab_result_summary || 'ยังไม่มีสรุป')}</p></div></section>
          <section class="official-summary-card"><span class="summary-index">2</span><div><h3>ผลที่ควรเป็น / Intended Response / Participant consensus</h3><p>${esc(ai.intended_response_summary || 'ยังไม่มีสรุป')}</p></div></section>
          <section class="official-summary-card"><span class="summary-index">3</span><div><h3>คะแนนและ Grade</h3><p>${esc(ai.grade_summary || 'ยังไม่มีสรุป')}</p></div></section>
          <section class="official-summary-card"><span class="summary-index">4</span><div><h3>เปรียบเทียบกับผู้เข้าร่วม</h3><p>${esc(ai.peer_comparison_summary || 'ยังไม่มี Participant Summary หรือยังไม่ได้สรุป')}</p></div></section>
          <section class="official-summary-card review"><span class="summary-index">5</span><div><h3>หัวข้อที่ต้องทบทวน</h3>${reviewTopics ? `<ul>${reviewTopics.split('\n').filter(Boolean).map((topic) => `<li>${esc(topic)}</li>`).join('')}</ul>` : '<p>ไม่พบหัวข้อที่ต้องทบทวน</p>'}</div></section>
        </div>
      </details>
    </div>` : '';

    return `<div class="card official-page-card">
      <div class="card-header"><div><h2>ผลประเมินอย่างเป็นทางการ</h2><div class="small muted">สรุปแบบตารางตามตัวอย่างและรายการทดสอบ คล้ายแบบฟอร์มสรุปผลห้องปฏิบัติการ</div></div>${ai.evaluation_mode ? `<span class="badge info">${esc(evaluationModeLabels[ai.evaluation_mode] || ai.evaluation_mode)}</span>` : ''}</div>
      ${canManage() ? `<form id="official-form" class="official-editor-form">
        <div class="official-top-fields">
          <div class="field"><label>คะแนนรวมของห้อง</label><input class="input" type="number" step="0.01" name="score" value="${esc(official?.score ?? '')}"><div class="help">กรอกเฉพาะคะแนนรวมจาก Official Evaluation เท่านั้น</div></div>
          <div class="field"><label>ผลสรุปอย่างเป็นทางการ</label><select class="select" name="outcome"><option value="pending">รอผล / Educational</option><option value="pass" ${official?.outcome==='pass'?'selected':''}>ผ่าน</option><option value="fail" ${official?.outcome==='fail'?'selected':''}>ไม่ผ่าน</option><option value="partial" ${official?.outcome==='partial'?'selected':''}>ผ่านบางส่วน</option></select></div>
          <label class="publish-toggle"><input type="checkbox" name="published" ${official?.published_to_staff?'checked':''}><span><strong>เปิดผลและเฉลยให้บุคลากร</strong><small>บุคลากรจะเห็นหลังส่งคำตอบตามเงื่อนไขของรอบ</small></span></label>
        </div>
        ${structuredView}
        <details class="official-source-editor">
          <summary>แก้ไขข้อความสรุปที่ระบบสร้าง</summary>
          <div class="official-edit-grid">
            <div class="field"><label>1. ผลของห้องปฏิบัติการ</label><textarea class="textarea" name="lab_result_summary">${esc(ai.lab_result_summary || '')}</textarea></div>
            <div class="field"><label>2. ผลที่ควรเป็น / Intended Response / Participant consensus</label><textarea class="textarea" name="intended_response_summary">${esc(ai.intended_response_summary || '')}</textarea></div>
            <div class="field"><label>3. คะแนนและ Grade</label><textarea class="textarea" name="grade_summary">${esc(ai.grade_summary || '')}</textarea></div>
            <div class="field"><label>4. เปรียบเทียบกับผู้เข้าร่วม</label><textarea class="textarea" name="peer_comparison_summary">${esc(ai.peer_comparison_summary || '')}</textarea></div>
            <div class="field" style="grid-column:1/-1"><label>5. หัวข้อที่ต้องทบทวน — 1 บรรทัดต่อ 1 หัวข้อ</label><textarea class="textarea" name="review_topics">${esc(reviewTopics)}</textarea></div>
            <div class="field" style="grid-column:1/-1"><label>สรุปรวมสำหรับรายงาน</label><textarea class="textarea" name="summary">${esc(official?.summary || '')}</textarea></div>
          </div>
        </details>
      </form><div class="modal-footer"><button class="btn btn-primary" id="save-official">บันทึกผลประเมิน</button></div>` : official ? `${structuredView}` : empty('ยังไม่ได้รับผลประเมินอย่างเป็นทางการ')}
    </div>`;
  }

  async function roundCapa(round) {
    const { data: rows, error } = await state.supabase.from('ec_corrective_actions').select('*, ec_profiles!ec_corrective_actions_responsible_user_id_fkey(full_name)').eq('round_id', round.id).order('created_at');
    if (error) throw error;
    return `<div class="card"><div class="card-header"><div><h2>การแก้ไขและป้องกัน</h2><div class="small muted">วิเคราะห์สาเหตุ แก้ไข ป้องกัน และตรวจประสิทธิผล</div></div>${canReview() ? `<button class="btn btn-primary" id="add-capa">＋ เปิดรายการแก้ไข</button>` : ''}</div>
      ${(rows || []).length ? `<div class="table-wrap"><table><thead><tr><th>ปัญหา</th><th>ผู้รับผิดชอบ</th><th>กำหนด</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.issue_description)}</strong><br><span class="small muted">${esc(r.root_cause || 'ยังไม่ระบุสาเหตุ')}</span></td><td>${esc(r.ec_profiles?.full_name || '-')}</td><td>${fmtDate(r.due_date)}</td><td><span class="badge">${esc(labelFrom(CAPA_STATUS_LABELS, r.status))}</span></td><td><button class="btn btn-outline btn-sm" data-edit-capa="${r.id}">เปิด</button></td></tr>`).join('')}</tbody></table></div>` : empty('ไม่มีรายการแก้ไขและป้องกันในรอบนี้')}
    </div>`;
  }

  async function roundCompetency(round) {
    const [
      { data: allQuestions, error: questionError },
      { data: assignments, error: assignmentError },
      { data: documents, error: documentError },
      { data: keys, error: keyError },
      { data: roundRoleAssignments, error: roundRoleError },
      directory
    ] = await Promise.all([
      state.supabase.from('ec_questions').select('*, ec_question_choices(*)').eq('round_id', round.id).order('question_order'),
      state.supabase.from('ec_competency_assignments').select('*').eq('round_id', round.id).neq('status', 'cancelled').order('created_at'),
      state.supabase.from('ec_round_documents').select('id,title,file_name,mime_type,visibility,category,ai_extraction_status,ai_extracted_at').eq('round_id', round.id).is('archived_at', null).order('created_at', { ascending: false }),
      state.supabase.from('ec_question_answer_keys').select('question_id,correct_choice_ids,answer_key_json,explanation'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
      loadDirectory(),
      loadQmDelegations()
    ]);
    if (questionError || assignmentError || documentError || keyError || roundRoleError) {
      throw (questionError || assignmentError || documentError || keyError || roundRoleError);
    }

    const questions = (allQuestions || []).filter((question) => question.generated_by_ai !== true);
    const ignoredAiCount = (allQuestions || []).filter((question) => question.generated_by_ai === true).length;
    const adminImageMap = await loadSignedImageMap(questions.flatMap((question) => questionImageIds(question)));
    const keyMap = new Map((keys || []).map((key) => [key.question_id, key]));
    const name = (id) => directory.find((profile) => profile.id === id)?.full_name || id;
    const sourceDocs = (documents || []).filter((doc) => ['source_document','instruction','official_result','participant_summary'].includes(doc.category));
    const extractedDocs = sourceDocs.filter((doc) => doc.ai_extraction_status === 'completed');
    const evidenceDocs = (documents || []).filter((doc) => ['raw_result_image','antibody_panel','quiz_image'].includes(doc.category));
    const hiddenEvidenceDocs = evidenceDocs.filter((doc) => doc.visibility !== 'staff');
    const assignedQualityApprover = (roundRoleAssignments || []).find((row) => row.assignment_role === 'quality_approver');
    const isAssignedQualityApprover = Boolean(assignedQualityApprover && assignedQualityApprover.user_id === state.user.id);
    const canCreateCompetency = canManage();
    const closePassed = round.competency_close_at && new Date(round.competency_close_at).getTime() < Date.now();
    const windowText = round.competency_close_at
      ? `${round.competency_open_at ? `เปิด ${fmtDate(round.competency_open_at, true)} · ` : ''}ปิด ${fmtDate(round.competency_close_at, true)}`
      : 'ยังไม่ได้กำหนดวันปิด Competency';

    const questionReviewStats = questions.reduce((stats, question) => {
      const answerKey = keyMap.get(question.id);
      const hasKey = Boolean(answerKey?.correct_choice_ids?.length || String(answerKey?.answer_key_json?.text || '').trim());
      stats.total += 1;
      if (!question.published) stats.draft += 1;
      if (!hasKey) stats.missingKey += 1;
      if (!question.published || !hasKey) stats.needsAction += 1;
      return stats;
    }, { total: 0, draft: 0, missingKey: 0, needsAction: 0 });

    const assignmentCounts = (assignments || []).reduce((counts, assignment) => {
      counts.total += 1;
      if (assignment.correction_required) counts.returned += 1;
      else if (assignment.status === 'submitted') counts.waitingReview += 1;
      else if (assignment.status === 'under_review') counts.waitingQm += 1;
      else if (['passed','passed_after_review'].includes(assignment.status)) counts.passed += 1;
      else if (['not_started','in_progress'].includes(assignment.status)) counts.inProgress += 1;
      return counts;
    }, { total: 0, returned: 0, waitingReview: 0, waitingQm: 0, passed: 0, inProgress: 0 });

    const assignmentStatus = (assignment) => assignment.correction_required
      ? '<span class="badge danger">ส่งกลับแก้ไขเฉพาะข้อ</span>'
      : assignmentBadge(assignment.status);

    const actionFor = (assignment) => {
      const actions = [];
      if (hasRole('reviewer')) {
        if (assignment.assignment_type === 'quiz' && assignment.status === 'submitted') {
          actions.push(`<button class="btn btn-primary btn-sm" data-review-competency="${assignment.id}" data-type="quiz">ตรวจรายบุคคล</button>`);
        }
        if (assignment.assignment_type === 'practical' && ['not_started','in_progress','submitted'].includes(assignment.status)) {
          actions.push(`<button class="btn btn-primary btn-sm" data-review-competency="${assignment.id}" data-type="practical">ตรวจประเมิน</button>`);
        }
        if (assignment.status === 'reflection_submitted') {
          actions.push(`<button class="btn btn-primary btn-sm" data-review-reflection="${assignment.id}">ตรวจแบบทบทวน</button>`);
        }
      }
      if (canQualityApprove(round.id) && isAssignedQualityApprover && assignment.status === 'under_review') {
        actions.push(`<button class="btn btn-success btn-sm" data-qm-approve-competency="${assignment.id}">รับรองผล</button>`);
        actions.push(`<button class="btn btn-warning btn-sm" data-qm-return-competency="${assignment.id}">ส่งกลับผู้ทบทวน</button>`);
      }
      if (hasRole('admin')) {
        actions.unshift(`<button class="btn btn-outline btn-sm" data-preview-staff-assignment="${assignment.id}">ดูหน้าที่เจ้าหน้าที่เห็น</button>`);
      }
      return actions.length ? actions.join('') : '<span class="small muted">รอตามลำดับงาน</span>';
    };

    const questionCards = questions.map((question) => {
      const key = keyMap.get(question.id);
      const hasKey = Boolean(key?.correct_choice_ids?.length || String(key?.answer_key_json?.text || '').trim());
      const referenceAnswer = String(key?.answer_key_json?.challenge_type === 'educational'
        ? (key?.answer_key_json?.consensus_result || key?.answer_key_json?.text || '')
        : (key?.answer_key_json?.text || '')).trim();
      const choices = (question.ec_question_choices || []).slice().sort((a,b) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
      const promptParts = questionPromptParts(question.prompt);
      const galleryHtml = questionImageGallery(question, adminImageMap, 'admin');
      const searchable = `${question.question_order} ${question.section || ''} ${promptParts.prompt}`.toLowerCase();
      const needsAction = !question.published || !hasKey;
      return `<article class="admin-question-card" data-question-search="${esc(searchable)}" data-published="${question.published ? '1' : '0'}" data-has-key="${hasKey ? '1' : '0'}" data-manual="1" data-needs-action="${needsAction ? '1' : '0'}">
        <div class="admin-question-top">
          <div class="question-order-badge">${question.question_order}</div>
          <div class="admin-question-title"><span class="question-section">${esc(question.section || 'แบบประเมิน')}</span><h3>${esc(promptParts.prompt)}</h3></div>
          <div class="question-status-stack">
            <span class="badge ${question.published ? 'success' : 'warning'}">${question.published ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}</span>
            <span class="badge ${hasKey ? 'success' : 'warning'}">${hasKey ? 'มีเฉลย' : 'รอเฉลย'}</span>
          </div>
        </div>
        ${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}
        ${galleryHtml || '<div class="notice info small">ข้อนี้ไม่มีรูปประกอบ</div>'}
        ${choices.length ? `<div class="question-choice-preview">${choices.map((choice) => `<div><span class="choice-dot"></span>${esc(choice.choice_text)}</div>`).join('')}</div>` : ''}
        ${referenceAnswer ? `<div class="answer-key-preview"><span class="small muted">แนวคำตอบ/เฉลย</span><strong>${esc(referenceAnswer)}</strong></div>` : ''}
        <div class="admin-question-footer">
          <div class="question-meta"><span>${esc(labelFrom(QUESTION_TYPE_LABELS, question.question_type))}</span><span>${question.points} คะแนน</span>${question.is_critical ? '<span class="danger-text">ข้อสำคัญ</span>' : ''}</div>
          ${canManage() ? `<div class="table-actions"><button class="btn btn-outline btn-sm" data-edit-question="${question.id}">แก้ไข</button><button class="btn btn-danger btn-sm" data-delete-question="${question.id}" data-question-label="${esc(`${question.question_order}. ${question.prompt}`)}">ลบ</button></div>` : ''}
        </div>
      </article>`;
    }).join('');

    return `<div class="competency-admin-layout">
      <div class="card competency-question-manager">
        <div class="card-header">
          <div><h2>สร้างข้อสอบด้วยตนเอง</h2><div class="small muted">รูปแบบคล้าย Microsoft Forms: เพิ่มข้อ แก้คำถาม เพิ่มตัวเลือก และผูกรูปกับแต่ละข้อ</div></div>
          ${canManage() ? '<button class="btn btn-primary" id="add-question">＋ เพิ่มคำถาม</button>' : ''}
        </div>
        <div class="notice info"><strong>AI ใช้เฉพาะอ่านข้อความจากเอกสาร</strong><br>AI จะไม่สร้างข้อสอบ ไม่เลือกเฉลย และไม่นำแบบฟอร์มผู้ให้บริการมาเปิดให้เจ้าหน้าที่โดยอัตโนมัติ มัสเป็นผู้ตั้งคำถามและเลือกรูปเอง</div>
        <div style="height:12px"></div>
        <details class="competency-system-details"><summary>ไฟล์ที่ใช้ในรอบนี้</summary><div class="compact-status">
          <span>เอกสารอ่านข้อความ ${sourceDocs.length}</span><span>อ่านแล้ว ${extractedDocs.length}</span><span>รูป/Antigram ${evidenceDocs.length}</span><span>ข้อสอบ ${questions.length}</span>
        </div>${ignoredAiCount ? `<div class="small muted" style="margin-top:8px">พักคำถามเดิมที่ AI เคยสร้างไว้ ${ignoredAiCount} ข้อ และไม่นำไปให้เจ้าหน้าที่ตอบ</div>` : ''}</details>
        ${hiddenEvidenceDocs.length ? `<div class="notice warning small">มีรูป ${hiddenEvidenceDocs.length} ไฟล์ที่ยังไม่ได้เปิดสิทธิ์ Staff แต่รูปที่ผูกกับข้อสอบจะถูกเปิดให้อัตโนมัติ</div>` : ''}
        ${canManage() ? `<div class="question-review-summary">
          <div><span>ทั้งหมด</span><strong>${questionReviewStats.total}</strong></div>
          <div class="${questionReviewStats.needsAction ? 'warning' : 'success'}"><span>ต้องตรวจ</span><strong>${questionReviewStats.needsAction}</strong></div>
          <div><span>ฉบับร่าง</span><strong>${questionReviewStats.draft}</strong></div>
          <div><span>ยังไม่มีเฉลย</span><strong>${questionReviewStats.missingKey}</strong></div>
        </div>
        <div class="question-review-toolbar">
          <div class="question-review-search"><input class="input" id="question-search" type="search" placeholder="ค้นหาคำถามหรือหัวข้อ"></div>
          <select class="select" id="question-filter"><option value="all">ทุกข้อ</option><option value="action">เฉพาะข้อที่ต้องตรวจ</option><option value="draft">ฉบับร่าง</option><option value="missing-key">ยังไม่มีเฉลย</option><option value="published">เผยแพร่แล้ว</option></select>
          <button class="btn btn-outline" id="read-document-text" ${sourceDocs.length ? '' : 'disabled'}>อ่านข้อความจากเอกสาร</button>
          <button class="btn btn-outline" id="open-extracted-text-bank" ${extractedDocs.length ? '' : 'disabled'}>คลังข้อความที่อ่านแล้ว</button>
          <button class="btn btn-outline" id="preview-question-set" ${questions.length ? '' : 'disabled'}>ดูตัวอย่างผู้ทำแบบประเมิน</button>
        </div>
        <div class="table-actions question-review-secondary">
          <button class="btn btn-outline" id="publish-all-questions" ${questions.length ? '' : 'disabled'}>เผยแพร่ข้อสอบทั้งหมด</button>
          <button class="btn btn-outline" id="unpublish-all-questions" ${questions.length ? '' : 'disabled'}>พักการเผยแพร่ทั้งหมด</button>
          <button class="btn btn-outline" id="review-questions-sequentially" ${questions.length ? '' : 'disabled'}>ตรวจทีละข้อ</button>
        </div>` : ''}
        ${questionCards ? `<div class="admin-question-list">${questionCards}</div>` : empty('ยังไม่มีข้อสอบ กด “เพิ่มคำถาม” แล้วตั้งโจทย์เองได้เลย')}
      </div>

      <div class="card">
        <div class="card-header"><div><h2>ตรวจรายบุคคลและส่งต่อ</h2><div class="small muted">เลือกคนที่ต้องตรวจ ตรวจจากคำตอบกับรูป แล้วส่งกลับเฉพาะข้อที่ต้องแก้</div></div>${canCreateCompetency ? '<button class="btn btn-primary" id="assign-all-competency">สร้างรายการประเมิน</button>' : ''}</div>
        <div class="question-review-summary assignment-review-summary">
          <div><span>ทั้งหมด</span><strong>${assignmentCounts.total}</strong></div>
          <div class="warning"><span>รอตรวจ</span><strong>${assignmentCounts.waitingReview}</strong></div>
          <div class="danger"><span>ส่งกลับแก้ไข</span><strong>${assignmentCounts.returned}</strong></div>
          <div><span>รอผู้รับรอง</span><strong>${assignmentCounts.waitingQm}</strong></div>
          <div class="success"><span>ผ่านแล้ว</span><strong>${assignmentCounts.passed}</strong></div>
        </div>
        <div class="notice ${closePassed ? 'danger' : 'info'}"><strong>${closePassed ? 'ปิดรับคำตอบแล้ว' : 'ช่วงเวลาทำ Competency'}</strong><br>${esc(windowText)}${canManage() ? '<div style="margin-top:8px"><button class="btn btn-outline btn-sm" id="set-competency-window">กำหนด/แก้ไขวันเปิด–ปิด</button></div>' : ''}</div>
        ${hasRole('reviewer') ? `<div class="table-actions assignment-review-toolbar"><button class="btn btn-outline" id="select-all-review-ready">เลือกคนที่รอตรวจทั้งหมด</button><button class="btn btn-primary" id="review-selected-assignments">ตรวจคนที่เลือกทีละคน</button></div>` : ''}
        ${(assignments || []).length ? `<div class="table-wrap"><table style="min-width:880px"><thead><tr>${hasRole('reviewer') ? '<th style="width:42px">เลือก</th>' : ''}<th>ชื่อ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${(assignments || []).map((assignment) => {
          const selectable = hasRole('reviewer') && assignment.assignment_type === 'quiz' && assignment.status === 'submitted';
          return `<tr>${hasRole('reviewer') ? `<td><input type="checkbox" data-review-assignment-check value="${assignment.id}" ${selectable ? '' : 'disabled'} aria-label="เลือก ${esc(name(assignment.user_id))}"></td>` : ''}<td>${esc(name(assignment.user_id))}${assignment.correction_note ? `<div class="small danger-text">${esc(assignment.correction_note)}</div>` : ''}</td><td>${esc(labelFrom(COMPETENCY_TYPE_LABELS, assignment.assignment_type))}</td><td>${assignmentStatus(assignment)}</td><td>${assignment.score ?? '-'}</td><td><div class="table-actions">${actionFor(assignment)}</div></td></tr>`;
        }).join('')}</tbody></table></div>` : empty('ยังไม่ได้สร้างรายการประเมิน')}
      </div>
    </div>`;
  }
  function bindRoundTab(round, tab) {
    if (tab === 'overview') {
      document.getElementById('edit-current-round')?.addEventListener('click', () => openRoundModal(round));
      document.getElementById('record-receipt')?.addEventListener('click', () => openReceiveEqaModal(round));
      document.getElementById('edit-historical-round')?.addEventListener('click', () => openHistoricalRoundModal(round));
      document.getElementById('convert-historical-round')?.addEventListener('click', () => {
        if (!confirm('ใช้เฉพาะกรณีที่รอบนี้ตรวจและส่งผลไปแล้วจริง ระบบจะเปลี่ยนเป็นข้อมูลย้อนหลังและคงเอกสารเดิมไว้ ต้องการดำเนินการต่อหรือไม่')) return;
        openHistoricalRoundModal(round);
      });
    }
    if (tab === 'documents') bindDocuments(round);
    if (tab === 'assignments') bindAssignments(round);
    if (tab === 'individual') {
      if (isHistoricalRound(round)) bindHistoricalIndividual(round);
      else bindIndividual(round);
    }
    if (tab === 'consensus') {
      if (isHistoricalRound(round)) bindHistoricalConsensus(round);
      else bindConsensus(round);
    }
    if (tab === 'approval') {
      if (isHistoricalRound(round)) bindHistoricalApproval(round);
      else bindApproval(round);
    }
    if (tab === 'submission') bindSubmission(round);
    if (tab === 'official') bindOfficial(round);
    if (tab === 'capa') bindCapa(round);
    if (tab === 'competency') { bindCompetencyAdmin(round); bindCompetencyReview(round); }
    bindCapWorkupControls(document);
    document.querySelectorAll('[data-go-historical-step]').forEach((button) => button.addEventListener('click', () => navigate(`round/${round.id}/${button.dataset.goHistoricalStep}`)));
  }

  function bindHistoricalIndividual(round) {
    const ownPanelId = `historical-practical-${state.user.id}`;
    bindWorkEvidencePanel(ownPanelId, { roundId: round.id, contextType: 'practical' });
    document.querySelectorAll('[data-work-evidence-panel^="historical-practical-"]').forEach((panel) => {
      const panelId = panel.dataset.workEvidencePanel;
      if (panelId && panelId !== ownPanelId) bindWorkEvidencePanel(panelId, { roundId: round.id, contextType: 'practical' });
    });
    document.querySelectorAll('[data-enter-historical-individual]').forEach((button) => button.addEventListener('click', () => openHistoricalIndividualEntry(round, button.dataset.enterHistoricalIndividual)));
    document.querySelectorAll('[data-view-individual]').forEach((button) => button.addEventListener('click', async () => {
      const [{ data, error }, { data: evidenceRows, error: evidenceError }] = await Promise.all([
        state.supabase.from('ec_individual_results').select('*').eq('id', button.dataset.viewIndividual).single(),
        state.supabase.from('ec_work_evidence').select('*').eq('round_id', round.id).eq('context_type', 'practical').is('archived_at', null).order('created_at', { ascending: false })
      ]);
      if (error || evidenceError) return toast(friendlyError(error || evidenceError), 'danger');
      const userEvidence = (evidenceRows || []).filter((row) => row.user_id === data.user_id);
      showModal('ผลย้อนหลังของผู้ปฏิบัติ', `${resultForm(data.result_payload, 'viewHistorical', true)}<div style="height:14px"></div>${workEvidencePanelHtml('view-practical-evidence', userEvidence, false)}`, '', true);
      bindCapWorkupControls(document.getElementById('modal-backdrop') || document);
      bindWorkEvidencePanel('view-practical-evidence', { roundId: round.id, contextType: 'practical' });
    }));
    document.querySelectorAll('[data-confirm-historical-result]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('ยืนยันว่าข้อมูลที่ผู้ดูแลระบบหรือผู้จัดการคุณภาพกรอกแทน ตรงกับหลักฐานเดิมของคุณหรือไม่')) return;
      const note = prompt('หมายเหตุเพิ่มเติม (เว้นว่างได้)') || '';
      const { error } = await state.supabase.rpc('ec_confirm_historical_result', { p_round_id: round.id, p_decision: 'confirmed', p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      toast('ยืนยันข้อมูลย้อนหลังแล้ว', 'success'); route();
    }));
    document.querySelectorAll('[data-dispute-historical-result]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('กรุณาระบุว่าข้อมูลส่วนใดไม่ตรงกับหลักฐานเดิม');
      if (!note) return;
      const { error } = await state.supabase.rpc('ec_confirm_historical_result', { p_round_id: round.id, p_decision: 'disputed', p_note: note });
      if (error) return toast(friendlyError(error), 'danger');
      toast('แจ้งข้อมูลไม่ตรงแล้ว ผู้กรอกข้อมูลจะต้องตรวจและแก้ไข', 'warning'); route();
    }));
  }

  function bindHistoricalConsensus(round) {
    document.getElementById('save-historical-consensus')?.addEventListener('click', async () => {
      const form = document.getElementById('historical-consensus-form');
      if (!form?.reportValidity()) return;
      const payload = collectResultPayload(form, 'historicalConsensus');
      if (!payload) return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning');
      const sourceNote = String(new FormData(form).get('source_note') || '').trim();
      setBusy(true);
      const { error } = await state.supabase.rpc('ec_record_historical_consensus', { p_round_id: round.id, p_result_payload: payload, p_source_note: sourceNote });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      toast('บันทึกผลกลางที่ห้องส่งจริงแล้ว กรุณาให้ผู้ปฏิบัติทั้งสองคนตรวจและยืนยันข้อมูลของตน', 'success', 6500); route();
    });
  }

  function bindHistoricalApproval(round) {
    const decide = async (rpcName, decision, note) => {
      const { error } = await state.supabase.rpc(rpcName, { p_round_id: round.id, p_decision: decision, p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      toast(decision === 'approved' ? 'บันทึกการรับรองแล้ว' : 'ส่งกลับแก้ไขแล้ว', 'success'); route();
    };
    document.getElementById('historical-reviewer-approve')?.addEventListener('click', () => decide('ec_reviewer_decide_historical_import', 'approved', document.getElementById('historical-reviewer-note').value));
    document.getElementById('historical-reviewer-return')?.addEventListener('click', () => {
      const note = document.getElementById('historical-reviewer-note').value.trim();
      if (!note) return toast('กรุณาระบุเหตุผลที่ส่งกลับ', 'warning');
      decide('ec_reviewer_decide_historical_import', 'returned', note);
    });
    document.getElementById('historical-qm-approve')?.addEventListener('click', () => decide('ec_qm_decide_historical_import', 'approved', document.getElementById('historical-qm-note').value));
    document.getElementById('historical-qm-return')?.addEventListener('click', () => {
      const note = document.getElementById('historical-qm-note').value.trim();
      if (!note) return toast('กรุณาระบุเหตุผลที่ส่งกลับ', 'warning');
      decide('ec_qm_decide_historical_import', 'returned', note);
    });
  }

  function bindDocuments(round) {
    document.getElementById('go-auto-competency')?.addEventListener('click', () => navigate(`round/${round.id}/competency`));

    const invokeDocumentAI = async (body) => {
      const { data, error } = await state.supabase.functions.invoke('generate-competency', { body });
      if (error) {
        let detail = error.message || 'เรียกบริการ AI ไม่สำเร็จ';
        const status = Number(error?.context?.status || error?.status || 0);
        try {
          const payload = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
          if (payload?.error) detail = payload.error;
        } catch (_) { /* use original message */ }
        if (status === 546 || /546|WORKER_RESOURCE_LIMIT/i.test(detail)) {
          detail = 'ขั้นตอน AI นี้ใช้เวลานานเกินขีดจำกัดของ Supabase ข้อมูลและขั้นตอนที่สำเร็จก่อนหน้าไม่หาย กรุณากดเริ่มใหม่เฉพาะขั้นตอนที่ยังไม่สำเร็จ';
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    };

    const AI_DOCUMENT_CATEGORIES = {
      form: ['source_document', 'instruction'],
      instructions: ['instruction'],
      questions: ['source_document', 'instruction', 'raw_result_image', 'antibody_panel'],
      // Answer keys use only evaluation evidence. Raw-result images and Antigrams were already
      // used when questions were created and must not be re-extracted here.
      answers: ['official_result', 'participant_summary'],
      // The official summary may additionally use the submitted-result evidence, but it does not
      // need to re-read every raw-result image or panel document.
      summary: ['official_result', 'participant_summary'],
      historical: ['source_document', 'instruction', 'raw_result_image', 'antibody_panel', 'submission_form', 'official_result', 'participant_summary'],
    };

    const updateAiProgress = (step, total, title, detail = '') => {
      const target = document.getElementById('document-ai-progress');
      if (!target) return;
      const safeTotal = Math.max(1, Number(total || 1));
      const safeStep = Math.max(0, Math.min(safeTotal, Number(step || 0)));
      const percent = Math.round((safeStep / safeTotal) * 100);
      target.innerHTML = `
        <div class="notice info"><strong>${esc(title)}</strong><br><span class="small">${esc(detail)}</span></div>
        <div style="height:14px"></div>
        <div style="height:12px;border-radius:999px;background:#e8eef5;overflow:hidden">
          <div style="height:100%;width:${percent}%;background:#5aaee6;transition:width .25s ease"></div>
        </div>
        <div class="small muted" style="margin-top:8px">ขั้นตอน ${safeStep}/${safeTotal} · ${percent}%</div>
        <div class="small muted" style="margin-top:12px">กรุณาอย่าปิด รีเฟรช ออกจากระบบ หรืออัปโหลดไฟล์เพิ่มจนกว่าจะเสร็จ</div>`;
    };

    const loadDocumentsForAI = async (mode) => {
      const categories = AI_DOCUMENT_CATEGORIES[mode] || AI_DOCUMENT_CATEGORIES.questions;
      const { data, error } = await state.supabase
        .from('ec_round_documents')
        .select('id,category,title,file_name,file_size,ai_extraction_status,ai_extraction_file_size,ai_extraction')
        .eq('round_id', round.id)
        .is('archived_at', null)
        .in('category', categories)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    };

    const extractDocumentsOneByOne = async (mode, progressState) => {
      const docs = await loadDocumentsForAI(mode);
      const pending = docs.filter((doc) =>
        doc.ai_extraction_status !== 'completed'
        || Number(doc.ai_extraction_file_size || 0) !== Number(doc.file_size || 0)
        || !isAiExtractionCurrent(doc));

      for (let index = 0; index < pending.length; index += 1) {
        const doc = pending[index];
        progressState.step += 1;
        updateAiProgress(
          progressState.step,
          progressState.total,
          `กำลังอ่านเอกสารอ้างอิง ${index + 1}/${pending.length}`,
          `${DOCUMENT_CATEGORY_LABELS[doc.category] || doc.category} · ${doc.file_name}`,
        );
        try {
          await invokeDocumentAI({
            action: 'extract_document',
            round_id: round.id,
            document_id: doc.id,
          });
        } catch (error) {
          const detail = friendlyError(error);
          try {
            await state.supabase.from('ec_round_documents').update({
              ai_extraction_status: 'failed',
              ai_extraction_error: detail,
            }).eq('id', doc.id).eq('round_id', round.id);
          } catch (_) { /* best effort only */ }
          throw new Error(`ไฟล์ “${doc.file_name}” อ่านไม่สำเร็จ: ${detail}`);
        }
      }
      return { docs, extractedCount: pending.length };
    };

    const showAiSuccess = (title, message) => {
      state.instructionExtractionCache.delete(round.id);
      state.instructionExtractions = [];
      showModal(title,
        `<div class="notice success"><strong>ดำเนินการเสร็จแล้ว</strong><br>${esc(message)}</div>
         <div style="height:12px"></div>
         <div class="small muted">ระบบบันทึกผลเรียบร้อย สามารถเปิดหน้าการประเมินความสามารถเพื่อตรวจแบบกรอก ข้อสอบ และเฉลยได้</div>`,
        `<button class="btn btn-outline" data-close-modal>ปิด</button><button class="btn btn-primary" id="open-generated-competency">เปิดผล Competency</button>`,
        true);
      document.getElementById('open-generated-competency')?.addEventListener('click', () => {
        closeModal();
        navigate(`round/${round.id}/competency`);
      });
    };

    const selectEvenly = (items, count) => {
      if (count >= items.length) return [...items];
      if (count <= 0) return [];
      const result = [];
      const used = new Set();
      for (let i = 0; i < count; i += 1) {
        const index = count === 1 ? 0 : Math.round((i * (items.length - 1)) / (count - 1));
        if (!used.has(index)) { used.add(index); result.push(items[index]); }
      }
      return result;
    };
    const chunkArray = (items, size) => {
      const chunks = [];
      for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
      return chunks;
    };
    const questionSpecimenKey = (doc) => {
      const text = `${doc.file_name || ''} ${doc.title || ''}`.toUpperCase();
      const match = text.match(/(JE|J)[-_ ]?0?(\d{1,2})[RS]?/);
      return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : doc.id;
    };
    const isAbIdRawDocument = (doc) => /AB\s*ID|ANTIBODY[\s_-]*ID|ANTIBODY[\s_-]*IDENTIFICATION|PANEL[\s_-]*[A-Z0-9]*[\s_-]*CELL/i.test(`${doc.file_name || ''} ${doc.title || ''}`);
    const planQuestionBatches = (docs, requestedCount) => {
      const rawDocs = docs.filter((doc) => doc.category === 'raw_result_image' && !/antigram/i.test(`${doc.file_name || ''} ${doc.title || ''}`));
      const knowledgeDocs = docs.filter((doc) => ['source_document','instruction'].includes(doc.category));
      const hasProviderQuestions = knowledgeDocs.some((doc) => Array.isArray(doc.ai_extraction?.provider_questions) && doc.ai_extraction.provider_questions.length > 0);
      if (isCapJJeRound(round) && rawDocs.length) {
        const batches = [];
        const used = new Set();
        const abIdGroups = new Map();
        rawDocs.filter(isAbIdRawDocument).forEach((doc) => {
          const key = questionSpecimenKey(doc);
          if (!abIdGroups.has(key)) abIdGroups.set(key, []);
          abIdGroups.get(key).push(doc);
        });
        for (const group of abIdGroups.values()) {
          group.forEach((doc) => used.add(doc.id));
          batches.push({ ids: group.map((doc) => doc.id), count: 1, knowledge: false, label: `Ab ID ${questionSpecimenKey(group[0])}` });
        }
        const remainingRaw = rawDocs.filter((doc) => !used.has(doc.id));
        chunkArray(remainingRaw, 3).forEach((batch) => {
          batches.push({ ids: batch.map((doc) => doc.id), count: Math.min(5, batch.length), knowledge: false, label: `ภาพผลดิบ ${batch.length} ไฟล์` });
        });
        if (hasProviderQuestions) {
          const providerCount = knowledgeDocs.reduce((sum, doc) => sum + (Array.isArray(doc.ai_extraction?.provider_questions) ? doc.ai_extraction.provider_questions.length : 0), 0);
          batches.push({ ids: knowledgeDocs.map((doc) => doc.id), count: Math.max(1, providerCount), knowledge: true, providerImport: true, label: `ข้อสอบต้นฉบับจากแบบฟอร์ม ${providerCount} ข้อ` });
        }
        return batches;
      }
      const reserveKnowledge = !hasProviderQuestions && knowledgeDocs.length && requestedCount >= 4 ? Math.min(2, requestedCount) : 0;
      const rawTarget = Math.min(rawDocs.length, Math.max(0, requestedCount - reserveKnowledge));
      const selectedRaw = selectEvenly(rawDocs, rawTarget);
      const batches = chunkArray(selectedRaw, 3).map((batch) => ({ ids: batch.map((doc) => doc.id), count: batch.length, knowledge: false, providerImport: false }));
      if (hasProviderQuestions) {
        const providerCount = knowledgeDocs.reduce((sum, doc) => sum + (Array.isArray(doc.ai_extraction?.provider_questions) ? doc.ai_extraction.provider_questions.length : 0), 0);
        batches.push({ ids: knowledgeDocs.map((doc) => doc.id), count: Math.max(1, providerCount), knowledge: true, providerImport: true, label: `ข้อสอบต้นฉบับจากแบบฟอร์ม ${providerCount} ข้อ` });
      } else {
        const remaining = Math.max(0, requestedCount - selectedRaw.length);
        if (remaining > 0 && knowledgeDocs.length) batches.push({ ids: knowledgeDocs.map((doc) => doc.id), count: Math.min(5, remaining), knowledge: true, providerImport: false });
        if (!batches.length && knowledgeDocs.length) batches.push({ ids: knowledgeDocs.map((doc) => doc.id), count: Math.min(5, requestedCount), knowledge: true, providerImport: false });
      }
      return batches;
    };

    const pendingFormDocuments = (docs) => {
      const sourceDocs = docs.filter((doc) => doc.category === 'source_document');
      // การกดสร้างแบบกรอกด้วยตนเองหมายถึงให้ประกอบ schema ใหม่จากฟอร์มต้นฉบับที่มีอยู่ทั้งหมด
      // เพื่อไม่ให้ Program J/JE หรือรูปแบบ Wet/Dry จากรอบก่อนค้างปนกับรอบปัจจุบัน
      return { targets: sourceDocs, reset: true };
    };
    const generateFormsOneByOne = async (docs, progressState) => {
      const { targets, reset } = pendingFormDocuments(docs);
      if (!targets.length) throw new Error('ยังไม่มีฟอร์มเปล่าจากผู้ให้บริการ');
      let latest = null;
      for (let index = 0; index < targets.length; index += 1) {
        const doc = targets[index];
        progressState.step += 1;
        updateAiProgress(progressState.step, progressState.total, `กำลังสร้างแบบกรอก ${index + 1}/${targets.length}`, doc.file_name);
        latest = await invokeDocumentAI({ action: 'generate_form_schema', round_id: round.id, document_id: doc.id, reset_form_schema: reset && index === 0 });
      }
      return latest;
    };

    const generateQuestionsInBatches = async (docs, questionCount, replaceDrafts, progressState) => {
      const batches = planQuestionBatches(docs, questionCount);
      if (!batches.length) throw new Error('ยังไม่มีภาพผลหรือเอกสารที่เหมาะสำหรับสร้างข้อสอบ');
      if (progressState.total < progressState.step + batches.length) progressState.total = progressState.step + batches.length;
      let totalCreated = 0;
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        progressState.step += 1;
        updateAiProgress(progressState.step, progressState.total, `กำลังสร้างข้อสอบชุด ${index + 1}/${batches.length}`, batch.knowledge ? (batch.label || 'นำเข้าคำถามจากแบบฟอร์มและเชื่อม Case Study จากคู่มือ') : (batch.label || `ภาพผลดิบ ${batch.ids.length} ไฟล์`));
        const result = await invokeDocumentAI({ action: 'generate_questions_batch', round_id: round.id, document_ids: batch.ids, knowledge_batch: batch.knowledge, provider_import_expected: Boolean(batch.providerImport), question_count: batch.count, replace_ai_drafts: index === 0 ? replaceDrafts : false });
        totalCreated += Number(result.generated_count || 0);
      }
      return { generated_count: totalCreated, batch_count: batches.length };
    };

    const loadAnswerQuestionBatches = async (forceRegenerate = false) => {
      const { data, error } = await state.supabase
        .from('ec_questions')
        .select('id,question_order')
        .eq('round_id', round.id)
        .is('archived_at', null)
        .order('question_order');
      if (error) throw error;
      if (!(data || []).length) throw new Error('ยังไม่มีข้อสอบ กรุณาสร้างข้อสอบก่อนสร้างเฉลย');
      let pending = data || [];
      if (!forceRegenerate) {
        const { data: keys, error: keyError } = await state.supabase
          .from('ec_question_answer_keys')
          .select('question_id,correct_choice_ids,answer_key_json')
          .in('question_id', pending.map((question) => question.id));
        if (keyError) throw keyError;
        const completed = new Set((keys || []).filter((key) =>
          (Array.isArray(key.correct_choice_ids) && key.correct_choice_ids.length)
          || String(key.answer_key_json?.text || '').trim()
        ).map((key) => key.question_id));
        pending = pending.filter((question) => !completed.has(question.id));
      }
      return chunkArray(pending, 5);
    };

    const generateAnswerKeysInBatches = async (progressState, forceRegenerate = false) => {
      const batches = await loadAnswerQuestionBatches(forceRegenerate);
      let generatedCount = 0;
      let deterministicCount = 0;
      let aiCount = 0;
      let manualReviewCount = 0;
      if (progressState.total < progressState.step + batches.length) progressState.total = progressState.step + batches.length;
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        progressState.step += 1;
        updateAiProgress(
          progressState.step,
          progressState.total,
          `กำลังสร้างเฉลยชุด ${index + 1}/${batches.length}`,
          `ข้อ ${batch[0].question_order}–${batch[batch.length - 1].question_order}`,
        );
        const result = await invokeDocumentAI({
          action: 'generate_answer_keys_batch',
          round_id: round.id,
          question_ids: batch.map((question) => question.id),
        });
        generatedCount += Number(result.generated_count || 0);
        deterministicCount += Number(result.deterministic_count || 0);
        aiCount += Number(result.ai_count || 0);
        manualReviewCount += Number(result.manual_review_count || 0);
      }
      return { generated_count: generatedCount, deterministic_count: deterministicCount, ai_count: aiCount, manual_review_count: manualReviewCount, batch_count: batches.length };
    };

    const generateOfficialSummary = async (progressState, releaseAnswersAfterSubmit = false) => {
      progressState.step += 1;
      updateAiProgress(
        progressState.step,
        progressState.total,
        'กำลังสร้างสรุปผลอย่างเป็นทางการ',
        `จัดตารางตามรูปแบบ ${resolveProgramProfile(round).label} โดยไม่เรียก AI`,
      );
      return invokeDocumentAI({
        action: 'generate_official_summary',
        round_id: round.id,
        release_answers_after_submit: releaseAnswersAfterSubmit,
      });
    };

    const openBundleModal = (mode) => {
      const isHistoricalBundle = mode === 'historical';
      const title = mode === 'form'
        ? 'สร้างแบบกรอกจากฟอร์มเปล่า'
        : mode === 'instructions'
          ? 'สร้างคำแนะนำจากคู่มือ'
          : mode === 'questions'
            ? 'สร้างข้อสอบจากภาพและเอกสาร'
            : mode === 'answers'
              ? 'สร้างเฉลยข้อสอบ'
              : mode === 'summary'
                ? 'สร้างสรุปผลอย่างเป็นทางการ'
                : 'สร้างย้อนหลังครบชุดแบบแบ่งขั้นตอน';
      const needsQuestionSettings = mode === 'questions' || isHistoricalBundle;
      const capCompleteNotice = needsQuestionSettings && isCapJJeRound(round)
        ? '<div class="notice info"><strong>CAP J/JE จะสร้างครบตามหลักฐานที่อัปโหลด</strong><br>ภาพผลดิบใช้สร้างคำถามแปลผลตามเดิม ส่วนข้อสอบที่มีโจทย์และตัวเลือกอยู่ใน Blank Result Form จะถูกนำเข้าตามต้นฉบับ และเชื่อม Case Study/ผลตรวจจาก Kit Instruction โดยไม่แต่งโจทย์ใหม่</div>'
        : '';
      const providerQuestionNotice = needsQuestionSettings
        ? '<div class="notice success"><strong>ประหยัด Token หลังอ่านเอกสาร</strong><br>เมื่อระบบพบข้อสอบต้นฉบับ จะใช้ข้อมูลที่สกัดไว้สร้างข้อสอบโดยตรง ไม่เรียก AI รอบสร้างคำถามซ้ำ และไม่กระทบข้อสอบเดิมหรือคำถามจากภาพผลดิบ</div>'
        : '';
      const sharedKitNotice = ['form','instructions','historical'].includes(mode) && isCapJJeRound(round)
        ? '<div class="notice info"><strong>Kit Instruction ใช้ร่วมกันได้</strong><br>อัปโหลดไฟล์คู่มือเพียงครั้งเดียว ระบบจะแยกหัวข้อภายในเป็นข้อมูลร่วม, Part J, Part JXM และ Part JE/JE1 แล้วเลือกใช้เฉพาะส่วนที่ตรงกับ Blank Result Form แต่ละฉบับ</div>'
        : '';
      const countField = needsQuestionSettings && !isCapJJeRound(round)
        ? `<div class="field"><label>จำนวนข้อโดยประมาณ</label><input class="input" type="number" name="question_count" min="3" max="50" value="12" required></div>`
        : '';
      const replaceField = needsQuestionSettings ? `<label><input type="checkbox" name="replace_drafts" checked> แทนที่เฉพาะข้อสอบฉบับร่างที่ AI เคยสร้างไว้</label>` : '';
      const regenerateAnswerField = mode === 'answers' || isHistoricalBundle
        ? '<label><input type="checkbox" name="regenerate_answers"> สร้างเฉลยใหม่ทุกข้อ แม้ข้อที่มีเฉลยแล้ว</label>'
        : '';
      const roleNotice = mode === 'answers'
        ? '<div class="notice info"><strong>สร้างเฉลยแบบเร็ว</strong><br>ระบบอ่านเฉพาะ Official Evaluation และ Participant Summary แล้วสร้างเฉลยครั้งละไม่เกิน 5 ข้อ โดยไม่อ่านภาพผลดิบหรือ Antigram ซ้ำ</div>'
        : mode === 'summary'
          ? '<div class="notice success"><strong>การจัดตารางขั้นนี้ไม่เรียก OpenAI API</strong><br>ระบบใช้ผลที่บันทึกไว้ + Official Evaluation + Participant Summary หากเอกสารสองประเภทนี้เคยอ่านแล้วจะไม่เกิดค่าอ่านไฟล์ซ้ำ</div>'
          : (mode === 'answers' || mode === 'summary' || isHistoricalBundle)
            ? '<div class="notice info">Official Evaluation ใช้ Intended Response/Grade ส่วน Participant Summary ใช้ peer comparison หรือ Educational Challenge</div>'
            : '';
      showModal(title, `<form id="document-ai-bundle-form" class="form-grid">
        ${sharedKitNotice}${capCompleteNotice}${providerQuestionNotice}${countField}${replaceField}${regenerateAnswerField}
        ${isHistoricalBundle ? '<div class="notice info">ระบบจะทำทีละส่วน: ฟอร์ม → คำแนะนำ → ข้อสอบ → เฉลยชุดย่อย → สรุปอย่างเป็นทางการ</div>' : ''}
        <label><input type="checkbox" name="confirm_privacy" required> ยืนยันว่าไฟล์ไม่มีชื่อผู้ป่วย HN หรือข้อมูลส่วนบุคคลที่ไม่ควรส่งไปประมวลผล</label>
        ${roleNotice}
        <div class="notice"><strong>งานแต่ละส่วนบันทึกแยกกัน</strong><br><span class="small">ไฟล์ที่ AI อ่านแล้วจะไม่ถูกอ่านใหม่ ส่วนการจัดสรุปใช้ข้อมูลที่บันทึกไว้และไม่เรียก AI</span></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="confirm-document-ai-bundle">เริ่มสร้าง</button>`, true);

      document.getElementById('confirm-document-ai-bundle')?.addEventListener('click', async () => {
        const form = document.getElementById('document-ai-bundle-form');
        if (!form?.reportValidity()) return;
        const fd = new FormData(form);
        const questionCount = Number(fd.get('question_count') || 50);
        const replaceDrafts = fd.get('replace_drafts') === 'on';
        const forceRegenerateAnswers = fd.get('regenerate_answers') === 'on';
        try {
          setBusy(true);
          const currentDocs = await loadDocumentsForAI(mode);
          const pendingCount = currentDocs.filter((doc) =>
            doc.ai_extraction_status !== 'completed'
            || Number(doc.ai_extraction_file_size || 0) !== Number(doc.file_size || 0)
            || !isAiExtractionCurrent(doc)).length;
          const sourceDocCount = pendingFormDocuments(currentDocs).targets.length;
          const questionBatches = (mode === 'questions' || isHistoricalBundle) ? planQuestionBatches(currentDocs, questionCount) : [];
          const answerBatches = mode === 'answers' ? await loadAnswerQuestionBatches(forceRegenerateAnswers) : [];
          const actionCount = mode === 'form'
            ? sourceDocCount
            : mode === 'instructions'
              ? 1
              : mode === 'questions'
                ? questionBatches.length
                : mode === 'answers'
                  ? answerBatches.length
                  : mode === 'summary'
                    ? 1
                    : sourceDocCount + 1 + questionBatches.length + 1;
          const progressState = { step: 0, total: pendingCount + Math.max(1, actionCount) };
          showModal('กำลังประมวลผล', '<div id="document-ai-progress"></div>', '', true, true);
          const pendingLabel = mode === 'answers'
            ? `พบเอกสารอ้างอิงที่ต้องอ่านใหม่ ${pendingCount} ไฟล์ (เฉพาะ Official Evaluation / Participant Summary)`
            : `พบไฟล์ที่ต้องอ่านใหม่ ${pendingCount} ไฟล์`;
          updateAiProgress(0, progressState.total, 'กำลังเตรียมรายการไฟล์', pendingLabel);
          await extractDocumentsOneByOne(mode, progressState);
          const refreshedDocs = await loadDocumentsForAI(mode);

          let formResult = null;
          let instructionResult = null;
          let questionResult = null;
          if (mode === 'form' || isHistoricalBundle) formResult = await generateFormsOneByOne(refreshedDocs, progressState);
          if (mode === 'instructions' || isHistoricalBundle) {
            progressState.step += 1;
            updateAiProgress(progressState.step, progressState.total, 'กำลังสร้างคำแนะนำภาษาไทย', 'สรุปเฉพาะข้อมูลจากคู่มือผู้ให้บริการ');
            instructionResult = await invokeDocumentAI({ action: 'generate_instruction_summary', round_id: round.id });
          }
          if (mode === 'questions' || isHistoricalBundle) questionResult = await generateQuestionsInBatches(refreshedDocs, questionCount, replaceDrafts, progressState);

          if (mode === 'answers') {
            const answerResult = await generateAnswerKeysInBatches(progressState, forceRegenerateAnswers);
            const manualReviewHint = answerResult.manual_review_count > 0 ? ` มี ${answerResult.manual_review_count} ข้อที่ต้องตรวจเอง` : '';
            setBusy(false);
            showAiSuccess('สร้างเฉลยข้อสอบสำเร็จ', `สร้างเฉลย ${answerResult.generated_count} ข้อ · ใช้ข้อมูลเดิมโดยไม่เรียก AI ${answerResult.deterministic_count} ข้อ · เรียก AI ${answerResult.ai_count} ข้อ.${manualReviewHint}`);
            return;
          }
          if (mode === 'summary') {
            const summaryResult = await generateOfficialSummary(progressState, false);
            setBusy(false);
            showAiSuccess('สร้างสรุปผลอย่างเป็นทางการสำเร็จ', `สร้างตารางสรุป ${summaryResult.row_count || 0} รายการแล้ว`);
            return;
          }
          if (isHistoricalBundle) {
            const answerResult = await generateAnswerKeysInBatches(progressState, forceRegenerateAnswers);
            progressState.total = Math.max(progressState.total, progressState.step + 1);
            const summaryResult = await generateOfficialSummary(progressState, true);
            const manualReviewHint = answerResult.manual_review_count > 0 ? ` มี ${answerResult.manual_review_count} ข้อที่ต้องตรวจเอง` : '';
            setBusy(false);
            showAiSuccess('สร้างย้อนหลังครบชุดสำเร็จ', `สร้างเฉลย ${answerResult.generated_count} ข้อ และตารางสรุป ${summaryResult.row_count || 0} รายการ.${manualReviewHint}`);
            return;
          }

          setBusy(false);
          if (mode === 'form') showAiSuccess('สร้างแบบกรอกสำเร็จ', `รวม ${formResult?.program_count || 0} กลุ่มการทดสอบจากฟอร์มเปล่าแล้ว`);
          else if (mode === 'instructions') showAiSuccess('สร้างคำแนะนำสำเร็จ', 'สร้างคำแนะนำภาษาไทยจากคู่มือแล้ว');
          else showAiSuccess('สร้างข้อสอบสำเร็จ', `สร้างข้อสอบฉบับร่าง ${questionResult?.generated_count || 0} ข้อ จาก ${questionResult?.batch_count || 0} ชุดย่อย`);
        } catch (generationError) {
          setBusy(false);
          const message = friendlyError(generationError);
          showModal('สร้างข้อมูลไม่สำเร็จ', `<div class="notice danger"><strong>ระบบหยุดเฉพาะขั้นตอนปัจจุบัน</strong><br>${esc(message)}</div><div style="height:12px"></div><div class="notice info">ไฟล์และขั้นตอนที่สำเร็จก่อนหน้านี้ถูกบันทึกแล้ว กลับไปกดเฉพาะปุ่มของขั้นตอนที่ยังไม่สำเร็จได้เลย</div>`, `<button class="btn btn-primary" data-close-modal>ปิดและกลับไปตรวจ</button>`, true);
        }
      });
    };

    document.getElementById('go-manual-question-builder')?.addEventListener('click', () => navigate(`round/${round.id}/competency`));
    document.getElementById('generate-form-only')?.addEventListener('click', () => openBundleModal('form'));
    document.getElementById('review-round-structure')?.addEventListener('click', () => openRoundStructureReview(round));
    document.getElementById('generate-instruction-only')?.addEventListener('click', () => openBundleModal('instructions'));
    document.getElementById('generate-questions-only')?.addEventListener('click', () => openBundleModal('questions'));
    document.getElementById('generate-answer-keys')?.addEventListener('click', () => openBundleModal('answers'));
    document.getElementById('generate-official-summary')?.addEventListener('click', () => openBundleModal('summary'));
    document.getElementById('generate-historical-bundle')?.addEventListener('click', () => openBundleModal('historical'));
    const acceptedTypes = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
    const validateFile = (file) => {
      if (!(file instanceof File) || !file.size) return null;
      if (file.size > 20 * 1024 * 1024) return 'ไฟล์เกิน 20 MB';
      if (!acceptedTypes.has(file.type)) return 'รองรับเฉพาะ PDF, JPG, PNG และ WebP';
      return null;
    };
    const makePath = (category, file) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g,'_');
      return `${round.id}/${category}/${crypto.randomUUID()}_${safeName}`;
    };

    document.getElementById('upload-doc-btn')?.addEventListener('click', () => {
      showModal('อัปโหลดเอกสาร/ภาพ', `<form id="doc-form" class="form-grid">
        <div class="field"><label>ประเภท</label><select class="select" id="document-category-select" name="category">${Object.entries(DOCUMENT_CATEGORY_LABELS).filter(([value]) => value !== 'submission_evidence').map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}</select><div class="help" id="document-category-help"></div></div>
        <div class="field"><label>ชื่อเอกสาร</label><input class="input" name="title" required><div class="help" id="document-title-help">ตั้งชื่อให้อ่านรู้เรื่อง เช่น Original Evaluation, Participant Summary หรือผลที่ห้องส่งจริง</div></div>
        <div class="field"><label>ผู้ที่เปิดดูได้</label><select class="select" name="visibility"><option value="restricted">เฉพาะผู้ทบทวน ผู้จัดการคุณภาพ และแพทย์</option><option value="assigned">ผู้ได้รับมอบหมาย</option><option value="staff">บุคลากรทุกคน</option></select></div>
        <div class="field"><label>ไฟล์ PDF/JPG/PNG/WebP ไม่เกิน 20 MB</label><input class="input" id="document-file-input" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><div class="help">ชื่อไฟล์ใช้เครื่องหมาย <code>_</code> แยกส่วน ระบบจะ parse ตัวอย่าง/การทดสอบ/Panel/Cell/Lot เพื่อจับคู่ให้อัตโนมัติ</div><div id="filename-parse-preview" style="margin-top:8px"></div></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="upload-doc-save">อัปโหลด</button>`);
      const categorySelect = document.getElementById('document-category-select');
      const updateCategoryHelp = () => {
        const help = document.getElementById('document-category-help');
        const titleHelp = document.getElementById('document-title-help');
        if (help) help.textContent = DOCUMENT_CATEGORY_HELP[categorySelect?.value] || '';
        if (titleHelp) titleHelp.innerHTML = categorySelect?.value === 'antibody_panel'
          ? 'ตัวอย่าง: <code>CAP-JA-2026_J-01_AbID_PanelA_Lot8RA453_Antigram.png</code> และ Panel ถัดไปใช้ <code>PanelB</code>'
          : categorySelect?.value === 'raw_result_image'
            ? 'กรณีหลาย Panel: <code>CAP-JA-2026_J-01_AbID_PanelA_Cell01-06_RawResult.png</code> และ <code>..._PanelA_Cell07-11_RawResult.png</code> · Extra cell: <code>CAP-JA-2026_J-01_AbID_ExtraCell01_Anti-E_RawResult.jpg</code>'
            : 'ตั้งชื่อให้อ่านรู้เรื่อง เช่น Original Evaluation, Participant Summary หรือผลที่ห้องส่งจริง';
      };
      categorySelect?.addEventListener('change', updateCategoryHelp);
      updateCategoryHelp();
      const documentFileInput = document.getElementById('document-file-input');
      const updateFilenamePreview = () => {
        const preview = document.getElementById('filename-parse-preview');
        const file = documentFileInput?.files?.[0];
        if (preview) preview.innerHTML = file ? filenameParsePreview(file.name) : '';
      };
      documentFileInput?.addEventListener('change', updateFilenamePreview);
      document.getElementById('upload-doc-save').addEventListener('click', async () => {
        const form = document.getElementById('doc-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form); const file = fd.get('file');
        const fileError = validateFile(file); if (fileError) return toast(fileError, 'danger');
        const category = String(fd.get('category')); const path = makePath(category, file);
        const upload = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
        if (upload.error) return toast(friendlyError(upload.error), 'danger');
        const ins = await state.supabase.from('ec_round_documents').insert({ round_id: round.id, category, title: String(fd.get('title')).trim(), file_name: file.name, storage_path: path, mime_type: file.type, file_size: file.size, visibility: String(fd.get('visibility')), uploaded_by: state.user.id });
        if (ins.error) {
          await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([path]);
          return toast(friendlyError(ins.error), 'danger');
        }
        closeModal();
        const nextHint = ['source_document','instruction'].includes(category)
          ? ' อัปโหลดเอกสารต้นทางแล้ว สำหรับข้อสอบให้ไปหัวข้อ 10 แล้วกด “อ่านข้อความจากเอกสาร” จากนั้นเพิ่มคำถาม ตัวเลือก เฉลย และรูปเอง'
          : category === 'raw_result_image'
            ? ' อัปโหลดภาพผลทดสอบดิบแล้ว ระบบจะใช้สร้าง Competency สำหรับเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง'
          : category === 'submission_form'
            ? ' บันทึกหลักฐาน/แบบฟอร์มผลที่ส่งจริงแล้ว ให้นำไฟล์เดียวกันไปเชื่อมกับวันเวลาที่ส่งในหัวข้อ 7 โดยไม่ต้องอัปโหลดซ้ำ และระบบจะไม่ใช้ไฟล์นี้เป็นเฉลย'
          : category === 'official_result'
            ? ' อัปโหลด Official Evaluation แล้ว สามารถสร้างเฉลยข้อสอบและสรุปผลอย่างเป็นทางการแยกกันได้ หากมี Educational Challenge ให้เพิ่ม Participant Summary ด้วย'
          : category === 'participant_summary'
            ? ' อัปโหลด Participant Summary แล้ว ระบบจะใช้เปรียบเทียบกับผู้เข้าร่วมและประเมิน Educational Challenge โดยไม่ใช้ร้อยละเป็นคะแนนของห้อง'
          : category === 'antibody_panel'
            ? ' อัปโหลด Antigram/Panel cell แล้ว ระบบจะใช้ antigen profile จับคู่กับภาพผล Antibody Identification และจะไม่ถือเป็นผลตัวอย่างหรือเฉลย'
            : '';
        toast(`อัปโหลดเรียบร้อย${nextHint}`, 'success'); route();
      });
    });

    document.getElementById('open-evidence-for-staff')?.addEventListener('click', async () => {
      const { data: targets, error: targetError } = await state.supabase.from('ec_round_documents')
        .select('id,category,visibility')
        .eq('round_id', round.id)
        .in('category', ['raw_result_image', 'antibody_panel'])
        .is('archived_at', null)
        .neq('visibility', 'staff');
      if (targetError) return toast(friendlyError(targetError), 'danger');
      if (!(targets || []).length) return toast('ภาพผลดิบและ Panel/Antigram เปิดให้บุคลากรทุกคนแล้ว', 'success');
      if (!confirm(`เปิดสิทธิ์ภาพผลดิบและ Panel/Antigram ${(targets || []).length} ไฟล์ให้บุคลากรทุกคน เพื่อใช้ตอบหัวข้อ 10 หรือไม่`)) return;
      const { error: visibilityError } = await state.supabase.from('ec_round_documents').update({ visibility: 'staff' }).in('id', (targets || []).map((doc) => doc.id)).eq('round_id', round.id);
      if (visibilityError) return toast(friendlyError(visibilityError), 'danger');
      toast(`เปิดภาพสำหรับ Competency แล้ว ${(targets || []).length} ไฟล์`, 'success');
      route();
    });

    document.querySelectorAll('[data-open-doc]').forEach((b) => b.addEventListener('click', async () => {
      const { data, error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(b.dataset.path, 300);
      if (error) return toast(friendlyError(error), 'danger');
      window.open(data.signedUrl, '_blank', 'noopener');
    }));

    document.querySelectorAll('[data-edit-doc]').forEach((button) => button.addEventListener('click', async () => {
      const [{ data: row, error }, { count: linkedQuestionCount }] = await Promise.all([
        state.supabase.from('ec_round_documents').select('*').eq('id', button.dataset.editDoc).eq('round_id', round.id).single(),
        state.supabase.from('ec_questions').select('id', { count: 'exact', head: true }).eq('image_document_id', button.dataset.editDoc)
      ]);
      if (error) return toast(friendlyError(error), 'danger');
      const usedInQuiz = Number(linkedQuestionCount || 0) > 0;
      showModal('แก้ไขเอกสาร/ภาพ', `<form id="edit-doc-form" class="form-grid">
        ${usedInQuiz ? `<div class="notice warning">รูปนี้ถูกใช้ในข้อสอบ Competency แล้ว ระบบจะคงสิทธิ์เป็น “บุคลากรทุกคน” เพื่อให้ผู้ทำแบบทดสอบเปิดรูปได้</div>` : ''}
        <div class="field"><label>ประเภท</label><select class="select" name="category">${Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value,label])=>`<option value="${value}" ${row.category===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
        <div class="field"><label>ชื่อเอกสาร</label><input class="input" name="title" required value="${esc(row.title)}"></div>
        <div class="field"><label>ผู้ที่เปิดดูได้</label><select class="select" name="visibility">${usedInQuiz ? `<option value="staff" selected>บุคลากรทุกคน</option>` : `<option value="restricted" ${row.visibility==='restricted'?'selected':''}>เฉพาะผู้ทบทวน ผู้จัดการคุณภาพ และแพทย์</option><option value="assigned" ${row.visibility==='assigned'?'selected':''}>ผู้ได้รับมอบหมาย</option><option value="staff" ${row.visibility==='staff'?'selected':''}>บุคลากรทุกคน</option>`}</select></div>
        <div class="field"><label>เปลี่ยนไฟล์ (ไม่บังคับ)</label><input class="input" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp"><div class="help">เว้นว่างไว้หากต้องการแก้เฉพาะชื่อ ประเภท หรือสิทธิ์การดู</div></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-edit-doc">บันทึกการแก้ไข</button>`, true);
      document.getElementById('save-edit-doc').addEventListener('click', async () => {
        const form = document.getElementById('edit-doc-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form); const replacement = fd.get('file');
        const hasReplacement = replacement instanceof File && replacement.size > 0;
        if (hasReplacement) { const fileError = validateFile(replacement); if (fileError) return toast(fileError, 'danger'); }
        const category = String(fd.get('category'));
        const payload = {
          category,
          title: String(fd.get('title')).trim(),
          visibility: usedInQuiz ? 'staff' : String(fd.get('visibility')),
          ai_extraction: null,
          ai_extraction_status: 'pending',
          ai_extracted_at: null,
          ai_extraction_model: null,
          ai_extraction_file_size: null,
          ai_extraction_error: null,
        };
        let newPath = null;
        if (hasReplacement) {
          newPath = makePath(category, replacement);
          const upload = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).upload(newPath, replacement, { upsert: false, contentType: replacement.type });
          if (upload.error) return toast(friendlyError(upload.error), 'danger');
          Object.assign(payload, { file_name: replacement.name, storage_path: newPath, mime_type: replacement.type, file_size: replacement.size });
        }
        const { error: updateError } = await state.supabase.from('ec_round_documents').update(payload).eq('id', row.id).eq('round_id', round.id);
        if (updateError) {
          if (newPath) await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([newPath]);
          return toast(friendlyError(updateError), 'danger');
        }
        let oldFileWarning = false;
        if (newPath && row.storage_path !== newPath) {
          const removeOld = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([row.storage_path]);
          oldFileWarning = Boolean(removeOld.error);
        }
        closeModal();
        toast(oldFileWarning ? 'แก้ไขแล้ว แต่ลบไฟล์เดิมไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ' : 'แก้ไขเอกสาร/ภาพแล้ว', oldFileWarning ? 'warning' : 'success');
        route();
      });
    }));

    document.querySelectorAll('[data-delete-doc]').forEach((button) => button.addEventListener('click', async () => {
      const { data: row, error } = await state.supabase.from('ec_round_documents').select('*').eq('id', button.dataset.deleteDoc).eq('round_id', round.id).single();
      if (error) return toast(friendlyError(error), 'danger');
      showModal('ลบเอกสาร/ภาพ', `<div class="notice danger"><strong>ยืนยันลบ “${esc(row.title)}”</strong><br>ไฟล์และข้อมูลรายการนี้จะถูกลบถาวร กู้คืนไม่ได้</div><div style="height:12px"></div><div class="small muted">หากรูปนี้ถูกใช้ในข้อสอบ ระบบจะเอารูปออกจากคำถามนั้น แต่จะไม่ลบตัวคำถาม</div>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-danger" id="confirm-delete-doc">ยืนยันลบ</button>`);
      document.getElementById('confirm-delete-doc').addEventListener('click', async () => {
        const { data, error: deleteError } = await state.supabase.rpc('ec_delete_round_document', { p_document_id: row.id });
        if (deleteError) return toast(friendlyError(deleteError), 'danger');
        const storagePath = data?.storage_path || row.storage_path;
        const storageDelete = storagePath ? await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([storagePath]) : { error: null };
        closeModal();
        toast(storageDelete.error ? 'ลบรายการแล้ว แต่ลบไฟล์ใน Storage ไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ' : 'ลบเอกสาร/ภาพถาวรแล้ว', storageDelete.error ? 'warning' : 'success');
        route();
      });
    }));
  }

  function bindAssignments(round) {
    document.getElementById('manage-assignments')?.addEventListener('click', async () => {
      const [{ data: current }, directory, resultCount] = await Promise.all([
        state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
        loadDirectory(),
        isHistoricalRound(round)
          ? state.supabase.from('ec_individual_results').select('id', { count: 'exact', head: true }).eq('round_id', round.id)
          : Promise.resolve({ count: 0 }),
        loadQmDelegations()
      ]);
      const practitionersLocked = Boolean(resultCount.count);
      const findAssignment = (role, slot = null) => current?.find((a) => a.assignment_role === role && (slot ? a.practitioner_slot === slot : true)) || null;
      const find = (role, slot = null) => findAssignment(role, slot)?.user_id || '';
      const options = (people, selected, blankLabel = 'กรุณาเลือก') => `<option value="">${blankLabel}</option>${people.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.position_title ? ` — ${esc(p.position_title)}` : ''}</option>`).join('')}`;
      const practitioners = directory.filter((p) => personHasRole(p, 'staff') && !personHasRole(p, 'physician'));
      const reviewers = directory.filter((p) => personHasRole(p, 'reviewer'));
      const qualityApprovers = qualityApproverCandidates(directory, round.id, find('quality_approver'));
      const physicians = directory.filter((p) => personHasRole(p, 'physician'));

      showModal('กำหนดผู้รับผิดชอบ', `<form id="assignment-form" class="form-grid cols-2">
        <div class="notice" style="grid-column:1/-1"><strong>ลำดับการทำงาน:</strong> ผู้ปฏิบัติ 2 คน → ผู้ทบทวน → ผู้รับรองคุณภาพ → แพทย์รับทราบ<br><span class="small">คนหนึ่งมีหลาย Role ในระบบได้ แต่ภายในรอบเดียวกัน ผู้ปฏิบัติ ผู้ทบทวน และผู้รับรองคุณภาพต้องไม่ซ้ำกัน</span></div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 1</label><select class="select" name="p1" required ${practitionersLocked ? 'disabled' : ''}>${options(practitioners, find('practitioner',1))}</select>${practitionersLocked ? '<div class="help">ล็อกแล้ว เพราะมีการบันทึกผลรายบุคคล</div>' : ''}</div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 2</label><select class="select" name="p2" required ${practitionersLocked ? 'disabled' : ''}>${options(practitioners, find('practitioner',2))}</select>${practitionersLocked ? '<div class="help">ล็อกแล้ว เพราะมีการบันทึกผลรายบุคคล</div>' : ''}</div>
        <div class="field"><label>ผู้ทบทวนผล</label><select class="select" name="reviewer" required>${options(reviewers, find('reviewer'))}</select><div class="help">ต้องเป็นคนละคนกับผู้ปฏิบัติทั้งสองคน</div></div>
        <div class="field"><label>ผู้รับรองคุณภาพ</label><select class="select" name="quality_approver" required>${options(qualityApprovers, find('quality_approver'))}</select><div class="help">ผู้จัดการคุณภาพรับรองได้ตามปกติ รองผู้จัดการคุณภาพรับรองได้เฉพาะช่วงที่เปิดมอบหมาย และต้องไม่ซ้ำผู้ปฏิบัติหรือผู้ทบทวน</div></div>
        ${isHistoricalRound(round) ? `<div class="field" style="grid-column:1/-1"><label>แพทย์ผู้รับทราบตามหลักฐานเดิม</label><select class="select" name="physician">${options(physicians, find('physician'), 'ยังไม่ระบุ')}</select><div class="help">รอบใหม่ไม่ต้องกำหนดแพทย์ล่วงหน้า เพราะแพทย์ทั้งสองคนมีสิทธิ์เท่าเทียมกันและคนใดคนหนึ่งรับทราบได้</div></div>
        <div class="historical-action-section" style="grid-column:1/-1"><h3>วันเวลาเหตุการณ์จริงตามหลักฐานเดิม</h3><p class="small muted">เว้นว่างได้หากขั้นตอนยังไม่เกิดขึ้น วันเวลาที่บันทึกในระบบยังเก็บอัตโนมัติตามจริง</p>
          ${historicalActionFields('reviewer_action', 'ผู้ทบทวนตรวจผลจริง', findAssignment('reviewer'))}
          ${historicalActionFields('quality_action', 'ผู้รับรองคุณภาพรับรองจริง', findAssignment('quality_approver'))}
          ${historicalActionFields('physician_action', 'แพทย์รับทราบจริง', findAssignment('physician'))}
        </div>` : '<div class="notice info" style="grid-column:1/-1"><strong>แพทย์ผู้รับทราบ</strong><br><span class="small">แพทย์ที่มีบทบาท “แพทย์ผู้รับรอง” ทั้งสองคนมีสิทธิ์เท่าเทียมกัน คนใดคนหนึ่งสามารถรับทราบรอบนี้ได้ ระบบจะบันทึกชื่อและวันเวลาของผู้ที่กดจริง</span></div>'}
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-assignments">บันทึก</button>`, true);

      bindHistoricalTimeControls(document.getElementById('assignment-form'));

      document.getElementById('save-assignments').addEventListener('click', async () => {
        const form = document.getElementById('assignment-form');
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const p1 = String(fd.get('p1') || find('practitioner',1) || '');
        const p2 = String(fd.get('p2') || find('practitioner',2) || '');
        const reviewer = String(fd.get('reviewer') || '');
        const qualityApprover = String(fd.get('quality_approver') || '');
        const physician = String(fd.get('physician') || '') || null;
        if (p1 === p2) return toast('ผู้ปฏิบัติคนที่ 1 และคนที่ 2 ต้องเป็นคนละคน', 'warning');
        if ([p1,p2].includes(reviewer)) return toast('ผู้ทบทวนต้องเป็นคนละคนกับผู้ปฏิบัติจริง', 'warning');
        if ([p1,p2,reviewer].includes(qualityApprover)) return toast('ผู้รับรองคุณภาพต้องเป็นคนละคนกับผู้ปฏิบัติจริงและผู้ทบทวน', 'warning');

        const actionMeta = isHistoricalRound(round) ? {
          reviewer: readHistoricalActionMeta(form, 'reviewer_action'),
          quality_approver: readHistoricalActionMeta(form, 'quality_action'),
          physician: readHistoricalActionMeta(form, 'physician_action')
        } : {};

        setBusy(true);
        const { error } = await state.supabase.rpc('ec_set_round_assignments_v259', {
          p_round_id: round.id,
          p_practitioner_1: p1,
          p_practitioner_2: p2,
          p_reviewer: reviewer,
          p_quality_approver: qualityApprover,
          p_physician: physician,
          p_action_meta: actionMeta
        });
        setBusy(false);
        if (error) return toast(friendlyError(error), 'danger');
        closeModal();
        toast('บันทึกผู้รับผิดชอบแล้ว', 'success');
        route();
      });
    });
  }

    function mergeIndividualCorrectionPayload(existingPayload, editedPayload, correctionScope) {
    const original = existingPayload && typeof existingPayload === 'object'
      ? JSON.parse(JSON.stringify(existingPayload))
      : {};
    const edited = editedPayload && typeof editedPayload === 'object' ? editedPayload : {};
    const sections = new Set(Array.isArray(correctionScope?.sections) ? correctionScope.sections : []);
    if (!sections.size) return edited;

    const merged = { ...original };
    if (edited.schema && !merged.schema) merged.schema = edited.schema;
    if (edited.form_schema_version && !merged.form_schema_version) merged.form_schema_version = edited.form_schema_version;
    if (sections.has('specimen')) merged.specimens = edited.specimens || {};
    if (sections.has('antigen')) merged.antigen_typing = edited.antigen_typing || {};
    if (sections.has('method')) {
      if ('methods_by_program' in edited || 'methods_by_program' in original) merged.methods_by_program = edited.methods_by_program || {};
      if ('methods' in edited || 'methods' in original) merged.methods = edited.methods || {};
    }
    if (sections.has('general')) {
      ['reagents','instrument','overall_note'].forEach((key) => { merged[key] = edited[key] ?? ''; });
    }
    return merged;
  }

    function bindIndividual(round) {
    const ownForm = document.getElementById('individual-result-form');
    if (ownForm?.dataset.isCorrection === '1') {
      let allowed = [];
      try { allowed = JSON.parse(ownForm.dataset.correctionSections || '[]'); } catch (_) { allowed = []; }
      const allowedSet = new Set(allowed);
      ownForm.querySelectorAll('[data-provider-group]').forEach((control) => {
        const group = String(control.dataset.providerGroup || '');
        if (allowedSet.size && !allowedSet.has(group)) control.disabled = true;
      });
      ownForm.querySelectorAll('.provider-test-card, .provider-donor-crossmatch').forEach((section) => {
        const controls = [...section.querySelectorAll('[data-provider-group]')];
        if (controls.length && controls.every((control) => control.disabled)) section.classList.add('question-locked-after-review');
      });
    }

    const save = async (submit) => {
      const form = document.getElementById('individual-result-form');
      if (!form) return;
      const editedPayload = collectResultPayload(form, 'individual');
      if (!editedPayload) return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning');
      const { data: existing, error: existingError } = await state.supabase.from('ec_individual_results').select('id,status,result_payload,correction_scope').eq('round_id', round.id).eq('user_id', state.user.id).maybeSingle();
      if (existingError) return toast(friendlyError(existingError), 'danger');
      const wasReturned = existing?.status === 'returned';
      const payload = wasReturned
        ? mergeIndividualCorrectionPayload(existing.result_payload, editedPayload, existing.correction_scope)
        : editedPayload;
      const row = {
        round_id: round.id,
        user_id: state.user.id,
        result_payload: payload,
        status: submit ? (wasReturned ? 'resubmitted' : 'submitted') : (wasReturned ? 'returned' : 'draft'),
        review_status: submit ? 'pending' : undefined,
        started_at: new Date().toISOString(),
        submitted_at: submit ? new Date().toISOString() : null
      };
      if (row.review_status === undefined) delete row.review_status;
      const res = existing
        ? await state.supabase.from('ec_individual_results').update(row).eq('id', existing.id)
        : await state.supabase.from('ec_individual_results').insert(row);
      if (res.error) return toast(friendlyError(res.error), 'danger');
      toast(submit ? (wasReturned ? 'ส่งกลับตรวจอีกครั้งแล้ว' : 'ส่งผลแล้ว') : 'บันทึกร่างแล้ว', 'success');
      route();
    };

    bindWorkEvidencePanel('practical-current', { roundId: round.id, contextType: 'practical' });
    document.getElementById('save-individual')?.addEventListener('click', () => save(false));
    document.getElementById('submit-individual')?.addEventListener('click', () => {
      if (confirm('ยืนยันส่งผลรายบุคคลให้ผู้ทบทวนตรวจหรือไม่')) save(true);
    });

    const loadIndividualForModal = async (resultId) => {
      const [{ data, error }, { data: evidenceRows, error: evidenceError }] = await Promise.all([
        state.supabase.from('ec_individual_results').select('*,ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('id', resultId).single(),
        state.supabase.from('ec_work_evidence').select('*').eq('round_id', round.id).eq('context_type', 'practical').is('archived_at', null).order('created_at', { ascending: false })
      ]);
      if (error || evidenceError) throw (error || evidenceError);
      return { data, userEvidence: (evidenceRows || []).filter((row) => row.user_id === data.user_id) };
    };

    document.querySelectorAll('[data-view-individual]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const { data, userEvidence } = await loadIndividualForModal(button.dataset.viewIndividual);
        showModal(`ผลของ ${data.ec_profiles?.full_name || ''}`, `${data.reviewer_note ? `<div class="notice warning"><strong>หมายเหตุผู้ทบทวน:</strong> ${esc(data.reviewer_note)}</div><div style="height:12px"></div>` : ''}${resultForm(data.result_payload, 'view', true)}<div style="height:14px"></div>${workEvidencePanelHtml('view-practical-evidence', userEvidence, false)}`, '<button class="btn btn-primary" data-close-modal>ปิด</button>', true);
        bindCapWorkupControls(document.getElementById('modal-backdrop') || document);
        bindWorkEvidencePanel('view-practical-evidence', { roundId: round.id, contextType: 'practical' });
      } catch (loadError) {
        toast(friendlyError(loadError), 'danger');
      }
    }));

    document.querySelectorAll('[data-review-individual]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const { data, userEvidence } = await loadIndividualForModal(button.dataset.reviewIndividual);
        const sections = [
          ['specimen', 'ผลตัวอย่าง การอ่านปฏิกิริยา ABO/Rh/Screen/Iden/Crossmatch'],
          ['method', 'วิธีทดสอบ ผู้ผลิต และรหัสรายงาน'],
          ['antigen', 'Antigen typing'],
          ['general', 'ข้อมูลทั่วไปหรือคำตอบอื่น'],
          ['evidence', 'ภาพหลักฐาน/ไฟล์แนบ']
        ];
        showModal(`ตรวจผลรายบุคคล — ${data.ec_profiles?.full_name || ''}`, `
          <div class="notice info"><strong>ตรวจจากผลที่กรอกและภาพหลักฐาน</strong><br>หากต้องแก้ ให้ติ๊กเฉพาะหัวข้อที่ต้องเปิดกลับไปแก้ ส่วนหัวข้ออื่นจะล็อกไว้</div>
          <div style="height:12px"></div>${resultForm(data.result_payload, 'reviewIndividual', true)}
          <div style="height:14px"></div>${workEvidencePanelHtml('review-individual-evidence', userEvidence, false)}
          <div class="card correction-section-picker"><h3>หัวข้อที่ต้องส่งกลับแก้</h3>${sections.map(([value,label]) => `<label><input type="checkbox" data-individual-correction-section value="${value}"> ${esc(label)}</label>`).join('')}</div>
          <div class="field"><label>หมายเหตุถึงผู้ปฏิบัติ</label><textarea class="textarea" id="individual-review-note" placeholder="จำเป็นเมื่อส่งกลับแก้ไข">${esc(data.reviewer_note || '')}</textarea></div>
        `, '<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-warning" id="return-individual-result">ส่งกลับเฉพาะหัวข้อที่เลือก</button><button class="btn btn-success" id="approve-individual-result">ตรวจผ่าน</button>', true);
        bindCapWorkupControls(document.getElementById('modal-backdrop') || document);
        bindWorkEvidencePanel('review-individual-evidence', { roundId: round.id, contextType: 'practical' });

        const decide = async (decision) => {
          const selected = [...document.querySelectorAll('[data-individual-correction-section]:checked')].map((item) => item.value);
          const note = String(document.getElementById('individual-review-note')?.value || '').trim();
          if (decision === 'returned' && !selected.length) return toast('กรุณาเลือกหัวข้อที่ต้องแก้', 'warning');
          if (decision === 'returned' && !note) return toast('กรุณาระบุคำแนะนำที่ส่งกลับ', 'warning');
          if (!confirm(decision === 'returned' ? 'ยืนยันส่งกลับเฉพาะหัวข้อที่เลือกหรือไม่' : 'ยืนยันว่าผลรายบุคคลนี้ตรวจผ่านหรือไม่')) return;
          const { error } = await state.supabase.rpc('ec_reviewer_decide_individual_v281', {
            p_result_id: data.id,
            p_decision: decision,
            p_sections: selected,
            p_note: note || null
          });
          if (error) return toast(friendlyError(error), 'danger');
          closeModal();
          toast(decision === 'returned' ? 'ส่งกลับให้แก้เฉพาะหัวข้อที่เลือกแล้ว' : 'ตรวจผลรายบุคคลผ่านแล้ว', 'success');
          route();
        };
        document.getElementById('return-individual-result')?.addEventListener('click', () => decide('returned'));
        document.getElementById('approve-individual-result')?.addEventListener('click', () => decide('approved'));
      } catch (loadError) {
        toast(friendlyError(loadError), 'danger');
      }
    }));
  }

  function bindConsensus(round) {
    const reviewerPayload = () => collectResultPayload(document.getElementById('consensus-form'), 'consensus');
    const reviewerNote = () => String(document.getElementById('reviewer-summary-note')?.value || '').trim();

    document.getElementById('save-reviewer-summary')?.addEventListener('click', async () => {
      setBusy(true);
      const payload = reviewerPayload();
      if (!payload) { setBusy(false); return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning'); }
      const { error } = await state.supabase.rpc('ec_reviewer_save_lab_summary', {
        p_round_id: round.id,
        p_result_payload: payload,
        p_note: reviewerNote() || null
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      toast('บันทึกร่างสรุปผลห้องปฏิบัติการแล้ว', 'success'); route();
    });

    document.getElementById('finalize-reviewer-summary')?.addEventListener('click', async () => {
      if (!confirm('ยืนยันว่าตรวจค่าที่ต่างกันครบแล้ว และส่งสรุปผลให้ผู้รับรองคุณภาพหรือไม่')) return;
      setBusy(true);
      const payload = reviewerPayload();
      if (!payload) { setBusy(false); return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning'); }
      const { data, error } = await state.supabase.rpc('ec_reviewer_finalize_lab_summary', {
        p_round_id: round.id,
        p_result_payload: payload,
        p_note: reviewerNote() || null
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      const unresolved = Number(data?.unresolved_count || 0);
      if (unresolved > 0) return toast(`ยังมีรายการที่ต้องตรวจ ${unresolved} รายการ`, 'warning');
      toast('ส่งสรุปผลให้ผู้รับรองคุณภาพแล้ว', 'success'); navigate(`round/${round.id}/approval`);
    });

    document.getElementById('go-individual-review')?.addEventListener('click', () => navigate(`round/${round.id}/individual`));
    document.getElementById('go-approval-from-summary')?.addEventListener('click', () => navigate(`round/${round.id}/approval`));
  }

    function bindApproval(round) {
    const decide = async (rpcName, decision, note) => {
      const { error } = await state.supabase.rpc(rpcName, { p_round_id: round.id, p_decision: decision, p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      const message = decision === 'returned'
        ? 'ส่งกลับแก้ไขแล้ว'
        : decision === 'acknowledged'
          ? 'แพทย์รับทราบแล้ว'
          : 'บันทึกการรับรองแล้ว';
      toast(message, 'success');
      route();
    };
    document.getElementById('go-reviewer-summary')?.addEventListener('click', () => navigate(`round/${round.id}/consensus`));
    document.getElementById('qm-approve')?.addEventListener('click', () => decide('ec_qm_decide_consensus','approved',document.getElementById('qm-note').value));
    document.getElementById('qm-return')?.addEventListener('click', () => {
      const note=document.getElementById('qm-note').value.trim(); if(!note)return toast('กรุณาระบุเหตุผลที่ส่งกลับ','warning'); decide('ec_qm_decide_consensus','returned',note);
    });
    document.getElementById('physician-acknowledge')?.addEventListener('click', () => decide('ec_physician_decide_consensus','acknowledged',document.getElementById('physician-note').value));
    document.getElementById('physician-return')?.addEventListener('click', () => {
      const note=document.getElementById('physician-note').value.trim(); if(!note)return toast('กรุณาระบุเหตุผลที่ส่งกลับ','warning'); decide('ec_physician_decide_consensus','returned',note);
    });
  }

  function bindSubmission(round) {
    document.querySelectorAll('[data-open-submission-path]').forEach((button) => button.addEventListener('click', async () => {
      const { data, error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(button.dataset.openSubmissionPath, 300);
      if (error) return toast(friendlyError(error), 'danger');
      window.open(data.signedUrl, '_blank', 'noopener');
    }));

    document.getElementById('add-submission')?.addEventListener('click', async () => {
      const { data: documents, error: documentError } = await state.supabase
        .from('ec_round_documents')
        .select('id,title,file_name,category,created_at')
        .eq('round_id', round.id)
        .in('category', ['submission_form','submission_evidence'])
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (documentError) return toast(friendlyError(documentError), 'danger');
      if (!(documents || []).length) {
        showModal('ยังไม่มีไฟล์ผลที่ส่ง', `<div class="notice warning"><strong>ให้อัปโหลดไฟล์ก่อนเพียงครั้งเดียว</strong><br>ไปที่หัวข้อ 2 “เอกสาร/ภาพ” แล้วเลือกประเภท “หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ” จากนั้นกลับมาเชื่อมวันเวลาส่งในหน้านี้</div>`, `<button class="btn btn-outline" data-close-modal>ปิด</button><button class="btn btn-primary" id="go-upload-submission-document">ไปหัวข้อเอกสาร/ภาพ</button>`);
        document.getElementById('go-upload-submission-document')?.addEventListener('click', () => { closeModal(); navigate(`round/${round.id}/documents`); });
        return;
      }
      const defaultSubmittedAt = isHistoricalRound(round) && round.actual_submitted_at
        ? new Date(round.actual_submitted_at).toISOString().slice(0,16)
        : new Date().toISOString().slice(0,16);
      const defaultReference = isHistoricalRound(round) ? (round.actual_provider_reference || '') : '';
      showModal('บันทึกการส่งผลและเชื่อมไฟล์หลักฐาน', `<form id="submission-form" class="form-grid">
        <div class="field"><label>วันที่และเวลาที่ส่งจริง</label><input class="input" type="datetime-local" name="submitted_at" required value="${esc(defaultSubmittedAt)}"></div>
        <div class="field"><label>เลขอ้างอิง</label><input class="input" name="reference" value="${esc(defaultReference)}"></div>
        <div class="field" style="grid-column:1/-1"><label>ไฟล์หลักฐาน/แบบฟอร์มผลที่ส่ง</label><select class="select" name="document_id" required><option value="">— เลือกไฟล์ที่อัปโหลดไว้ —</option>${documents.map((doc, index) => `<option value="${doc.id}" ${documents.length === 1 || index === 0 ? 'selected' : ''}>${esc(doc.title || doc.file_name)} — ${esc(doc.file_name)}</option>`).join('')}</select><div class="help">เลือกไฟล์เดิม ไม่ต้องอัปโหลดภาพหลักฐานซ้ำอีกชุด</div></div>
        <div class="field" style="grid-column:1/-1"><label>หมายเหตุ</label><textarea class="textarea" name="note" placeholder="เช่น ส่งผ่าน CAP e-LAB Solutions และได้รับข้อความยืนยัน"></textarea></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-submission">บันทึก</button>`);
      document.getElementById('save-submission')?.addEventListener('click', async () => {
        const form = document.getElementById('submission-form');
        if (!form?.reportValidity()) return;
        const fd = new FormData(form);
        const { error } = await state.supabase.from('ec_submission_evidence').insert({
          round_id: round.id,
          submitted_at: new Date(String(fd.get('submitted_at'))).toISOString(),
          submitted_by: state.user.id,
          provider_reference: String(fd.get('reference') || '').trim() || null,
          note: String(fd.get('note') || '').trim() || null,
          document_id: String(fd.get('document_id'))
        });
        if (error) return toast(friendlyError(error), 'danger');
        await state.supabase.from('ec_eqa_rounds').update({ status:'submitted_to_provider', updated_by:state.user.id, competency_open_at: round.competency_open_at || new Date().toISOString() }).eq('id', round.id);
        closeModal();
        toast('บันทึกการส่งและเชื่อมไฟล์หลักฐานแล้ว', 'success');
        route();
      });
    });
  }

  function bindOfficial(round) {
    document.getElementById('save-official')?.addEventListener('click', async () => {
      const form = document.getElementById('official-form');
      if (!form) return;
      const fd = new FormData(form);
      const { data: existing, error: loadError } = await state.supabase.from('ec_official_results').select('official_payload,received_at').eq('round_id', round.id).maybeSingle();
      if (loadError) return toast(friendlyError(loadError), 'danger');
      const reviewTopics = String(fd.get('review_topics') || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const officialPayload = {
        ...(existing?.official_payload || {}),
        lab_result_summary: String(fd.get('lab_result_summary') || '').trim(),
        intended_response_summary: String(fd.get('intended_response_summary') || '').trim(),
        grade_summary: String(fd.get('grade_summary') || '').trim(),
        peer_comparison_summary: String(fd.get('peer_comparison_summary') || '').trim(),
        review_topics: reviewTopics,
        manually_reviewed_at: new Date().toISOString(),
        manually_reviewed_by: state.user.id,
      };
      const payload = {
        round_id: round.id,
        score: fd.get('score') ? Number(fd.get('score')) : null,
        outcome: String(fd.get('outcome')),
        summary: String(fd.get('summary') || '') || null,
        official_payload: officialPayload,
        published_to_staff: fd.get('published') === 'on',
        recorded_by: state.user.id,
        received_at: existing?.received_at || new Date().toISOString(),
      };
      const { error } = await state.supabase.from('ec_official_results').upsert(payload, { onConflict: 'round_id' });
      if (error) return toast(friendlyError(error), 'danger');
      await state.supabase.from('ec_eqa_rounds').update({
        status: 'official_result_received',
        answer_released_at: payload.published_to_staff ? new Date().toISOString() : null,
        updated_by: state.user.id
      }).eq('id', round.id);
      toast('บันทึกผลอย่างเป็นทางการแล้ว', 'success');
      route();
    });
  }

  function bindCapa(round) {
    const open=(row={})=>{showModal(row.id?'แก้ไขรายการแก้ไขและป้องกัน':'เปิดรายการแก้ไขและป้องกัน',`<form id="capa-form" class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>ปัญหาที่พบ</label><textarea class="textarea" name="issue" required>${esc(row.issue_description||'')}</textarea></div><div class="field"><label>สาเหตุ</label><textarea class="textarea" name="root">${esc(row.root_cause||'')}</textarea></div><div class="field"><label>ผลกระทบ</label><textarea class="textarea" name="impact">${esc(row.impact_assessment||'')}</textarea></div><div class="field"><label>การแก้ไขทันที</label><textarea class="textarea" name="correction">${esc(row.immediate_correction||'')}</textarea></div><div class="field"><label>การป้องกัน</label><textarea class="textarea" name="preventive">${esc(row.preventive_action||'')}</textarea></div><div class="field"><label>กำหนดเสร็จ</label><input class="input" type="date" name="due" value="${fmtDateInput(row.due_date)}"></div><div class="field"><label>สถานะ</label><select class="select" name="status">${Object.entries(CAPA_STATUS_LABELS).map(([value,label])=>`<option value="${value}" ${row.status===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div><input type="hidden" name="id" value="${esc(row.id||'')}"></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-capa">บันทึก</button>`,true);document.getElementById('save-capa').addEventListener('click',async()=>{const f=document.getElementById('capa-form');if(!f.reportValidity())return;const fd=new FormData(f);const id=String(fd.get('id')||'');const p={round_id:round.id,issue_description:String(fd.get('issue')),root_cause:String(fd.get('root')||'')||null,impact_assessment:String(fd.get('impact')||'')||null,immediate_correction:String(fd.get('correction')||'')||null,preventive_action:String(fd.get('preventive')||'')||null,due_date:fd.get('due')||null,status:String(fd.get('status')),updated_by:state.user.id};const res=id?await state.supabase.from('ec_corrective_actions').update(p).eq('id',id):await state.supabase.from('ec_corrective_actions').insert({...p,created_by:state.user.id});if(res.error)return toast(friendlyError(res.error), 'danger');closeModal();toast('บันทึกรายการแก้ไขและป้องกันแล้ว','success');route();});};
    document.getElementById('add-capa')?.addEventListener('click',()=>open());
    document.querySelectorAll('[data-edit-capa]').forEach(b=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_corrective_actions').select('*').eq('id',b.dataset.editCapa).single();if(error)return toast(friendlyError(error), 'danger');open(data);}));
  }

  function bindCompetencyAdmin(round) {
    const invokeCompetencyAI = async (body) => {
      const { data, error } = await state.supabase.functions.invoke('generate-competency', { body });
      if (error) {
        let detail = error.message || 'เรียกบริการสร้าง Competency ไม่สำเร็จ';
        try {
          const payload = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
          if (payload?.error) detail = payload.error;
        } catch (_) { /* use the original error message */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    };

    const openQuestion = async (row = null, prefill = {}) => {
      let choices = [];
      let key = null;
      let answerCount = 0;
      const requests = [state.supabase.from('ec_round_documents').select('id,title,file_name,mime_type,visibility').eq('round_id', round.id).like('mime_type', 'image/%').order('created_at', { ascending: false })];
      if (row?.id) {
        requests.push(state.supabase.from('ec_question_choices').select('*').eq('question_id', row.id).order('choice_order'));
        requests.push(state.supabase.from('ec_question_answer_keys').select('*').eq('question_id', row.id).maybeSingle());
        requests.push(state.supabase.from('ec_competency_answers').select('id', { count: 'exact', head: true }).eq('question_id', row.id));
      }
      const results = await Promise.all(requests);
      const imageDocuments = results[0].data || [];
      if (results[0].error) return toast(friendlyError(results[0].error), 'danger');
      if (row?.id) {
        if (results[1].error || results[2].error || results[3].error) return toast(friendlyError(results[1].error || results[2].error || results[3].error), 'danger');
        choices = results[1].data || [];
        key = results[2].data || null;
        answerCount = Number(results[3].count || 0);
      }
      const choicesLocked = answerCount > 0;
      const existingQuestionImageMap = row?.image_document_id ? await loadSignedImageMap([row.image_document_id]) : new Map();
      const existingQuestionImageUrl = row?.image_document_id ? existingQuestionImageMap.get(row.image_document_id) : '';
      const correctChoiceIds = new Set(key?.correct_choice_ids || []);
      const keyJson = key?.answer_key_json && typeof key.answer_key_json === 'object' ? key.answer_key_json : {};
      const currentReferenceAnswer = String(keyJson.challenge_type === 'educational' ? (keyJson.consensus_result || keyJson.text || '') : (keyJson.text || '')).trim();
      const imageOptions = imageDocuments.length
        ? `<option value="">ไม่ใช้รูปประกอบ</option>${imageDocuments.map((doc) => `<option value="${doc.id}" ${row?.image_document_id===doc.id?'selected':''}>${esc(doc.title)} — ${esc(doc.file_name)}${doc.visibility==='staff'?'':' (ระบบจะเปิดให้บุคลากรทุกคน)'}</option>`).join('')}`
        : '<option value="">ยังไม่มีไฟล์รูปในหัวข้อ 2. เอกสาร/ภาพ</option>';
      const initialChoices = choices.length ? choices : [null, null, null, null];
      const choiceRowsHtml = initialChoices.map((choice, index) => `<div class="question-choice-editor-row" data-choice-row data-choice-id="${esc(choice?.id || '')}">
        <label class="choice-answer-marker" title="ทำเครื่องหมายคำตอบที่ถูก">
          <input type="checkbox" data-choice-correct ${choice && correctChoiceIds.has(choice.id) ? 'checked' : ''}>
          <span>เฉลย</span>
        </label>
        <input class="input" type="text" data-choice-text value="${esc(choice?.choice_text || '')}" placeholder="ตัวเลือก ${index + 1}" ${choicesLocked ? 'readonly' : ''}>
        <button class="btn btn-outline btn-sm" type="button" data-remove-choice ${choicesLocked ? 'disabled' : ''} aria-label="ลบตัวเลือก">ลบ</button>
      </div>`).join('');

      showModal(row?.id ? `ตรวจและแก้ไขข้อ ${row.question_order}` : 'เพิ่มคำถาม', `<form id="question-form" class="question-editor-form">
        <input type="hidden" name="id" value="${esc(row?.id || '')}">
        <div class="question-editor-layout">
          <div class="question-editor-main">
            ${row?.generated_by_ai ? '<div class="notice info"><strong>AI สร้างเป็นร่างเท่านั้น</strong><br>กรุณาตรวจโจทย์ ตัวเลือก รูป และเฉลยก่อนเปิดให้เจ้าหน้าที่</div>' : ''}
            ${choicesLocked ? `<div class="notice warning"><strong>มีผู้ตอบข้อนี้แล้ว ${answerCount} รายการ</strong><br>ระบบล็อกข้อความและลำดับตัวเลือกเพื่อรักษาหลักฐานเดิม แต่ยังเลือกเฉลยที่ถูก แก้คำถาม คำอธิบาย และสถานะเผยแพร่ได้</div>` : ''}
            <div class="question-editor-quick-grid">
              <div class="field"><label>หัวข้อ</label><input class="input" name="section" value="${esc(row?.section || prefill.section || '')}" placeholder="เช่น Antibody Identification"></div>
              <div class="field"><label>ประเภทคำตอบ</label><select class="select" name="type" id="question-type-select">${Object.entries(QUESTION_TYPE_LABELS).map(([value,label])=>`<option value="${value}" ${(row?.question_type || prefill.question_type || 'single_choice')===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
            </div>
            <div class="field"><label>คำถาม</label><textarea class="textarea question-prompt-input" name="prompt" required placeholder="พิมพ์คำถามที่เจ้าหน้าที่จะเห็น">${esc(row?.prompt || prefill.prompt || '')}</textarea></div>
            <div class="field question-image-editor">
              <label>รูปประกอบของข้อนี้</label>
              <select class="select" name="image_document_id" id="question-existing-image">${imageOptions}</select>
              <div class="question-image-or">หรือ</div>
              <input class="input" type="file" name="question_image_file" id="question-image-file" accept="image/jpeg,image/png,image/webp">
              <label class="small"><input type="checkbox" name="remove_image"> ไม่ใช้รูปประกอบ / นำรูปเดิมออกจากข้อนี้</label>
              <div class="help">อัปโหลดรูปตรงนี้ได้เลย ระบบจะเก็บเป็น “รูปประกอบข้อสอบ” และเปิดให้ผู้ทำแบบประเมินเห็นเฉพาะในข้อนี้</div>
              <div id="question-image-preview" class="question-image-upload-preview">${existingQuestionImageUrl ? `<img src="${esc(existingQuestionImageUrl)}" alt="รูปประกอบปัจจุบัน"><div class="small muted">รูปประกอบปัจจุบัน</div>` : ''}</div>
            </div>

            <section class="question-choice-editor">
              <div class="question-choice-editor-head"><div><strong>ตัวเลือกและเฉลย</strong><div class="small muted">ติ๊กคำว่า “เฉลย” ที่หน้าตัวเลือกที่ถูก ไม่ต้องจำเลขลำดับอีกแล้ว</div></div><button class="btn btn-outline btn-sm" type="button" id="add-choice-row" ${choicesLocked ? 'disabled' : ''}>＋ เพิ่มตัวเลือก</button></div>
              <div id="choice-editor-list" data-choices-locked="${choicesLocked ? '1' : '0'}">${choiceRowsHtml}</div>
            </section>

            <div class="field"><label>แนวคำตอบ / คำตอบส่วนใหญ่</label><textarea class="textarea" name="reference_answer" placeholder="ใช้กับคำตอบข้อความ หรือใส่รหัส CAP เช่น 115 │ Anti-E; 124 │ Anti-K">${esc(currentReferenceAnswer)}</textarea><div class="help">ข้อ Antibody Identification ใส่หลายรายการได้โดยคั่นด้วย ; ระบบจะเทียบโดยไม่สนลำดับ</div></div>
            <div class="field"><label>คำอธิบายเฉลย</label><textarea class="textarea compact" name="explanation" placeholder="อธิบายเหตุผลสั้น ๆ เพื่อใช้ตอนเฉลย">${esc(key?.explanation || '')}</textarea></div>

            <details class="question-advanced-settings">
              <summary>การตั้งค่าเพิ่มเติม</summary>
              <div class="form-grid cols-2">
                <div class="field"><label>ลำดับ</label><input class="input" type="number" name="order" required value="${esc(row?.question_order || prefill.order || 1)}"></div>
                <div class="field"><label>คะแนน</label><input class="input" type="number" step="0.1" name="points" value="${esc(row?.points || 1)}"></div>
                <div class="field"><label>ประเภทการประเมิน</label><select class="select" name="challenge_type"><option value="graded" ${keyJson.challenge_type==='graded'?'selected':''}>Graded — มีเฉลยทางการ</option><option value="educational" ${keyJson.challenge_type==='educational'?'selected':''}>Educational — ใช้คำตอบส่วนใหญ่</option><option value="unknown" ${!keyJson.challenge_type||keyJson.challenge_type==='unknown'?'selected':''}>รอตรวจ</option></select></div>
                <div class="field"><label>แหล่งอ้างอิงคำตอบ</label><select class="select" name="answer_basis"><option value="official_intended_response" ${keyJson.answer_basis==='official_intended_response'?'selected':''}>Official Intended Response</option><option value="participant_consensus" ${keyJson.answer_basis==='participant_consensus'?'selected':''}>Participant consensus</option><option value="insufficient" ${!keyJson.answer_basis||keyJson.answer_basis==='insufficient'?'selected':''}>หลักฐานยังไม่พอ</option></select></div>
                <div class="field"><label>ร้อยละของคำตอบส่วนใหญ่</label><input class="input" name="consensus_percent" value="${esc(keyJson.consensus_percent || '')}" placeholder="เช่น 98.0%"></div>
                <div class="question-publish-settings">
                  <label><input type="checkbox" name="critical" ${row?.is_critical?'checked':''}> ข้อสำคัญ</label>
                  <label><input type="checkbox" name="published" ${row?.published?'checked':''}> เปิดให้เจ้าหน้าที่เห็น</label>
                </div>
              </div>
            </details>
          </div>
          <aside class="question-live-preview" aria-live="polite">
            <div class="question-live-preview-label">ตัวอย่างที่เจ้าหน้าที่เห็น</div>
            <div class="question-live-preview-card">
              <span class="question-section" id="question-preview-section">${esc(row?.section || prefill.section || 'แบบประเมิน')}</span>
              <h3 id="question-preview-prompt">${esc(row?.prompt || prefill.prompt || 'คำถามจะแสดงตรงนี้')}</h3>
              <div id="question-preview-choices"></div>
            </div>
            <div class="small muted">หน้าตัวอย่างนี้ไม่บันทึกคำตอบ</div>
          </aside>
        </div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-outline" id="save-question-next">บันทึกและข้อต่อไป</button><button class="btn btn-primary" id="save-question">บันทึก</button>`, true);

      const choiceList = document.getElementById('choice-editor-list');
      const typeSelect = document.getElementById('question-type-select');
      const reindexChoiceRows = () => {
        [...choiceList.querySelectorAll('[data-choice-row]')].forEach((choiceRow, index) => {
          const input = choiceRow.querySelector('[data-choice-text]');
          if (input && !input.value.trim()) input.placeholder = `ตัวเลือก ${index + 1}`;
        });
      };
      const addChoiceRow = (value = '') => {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'question-choice-editor-row';
        choiceRow.dataset.choiceRow = '';
        choiceRow.innerHTML = `<label class="choice-answer-marker" title="ทำเครื่องหมายคำตอบที่ถูก"><input type="checkbox" data-choice-correct><span>เฉลย</span></label><input class="input" type="text" data-choice-text placeholder="ตัวเลือก" value="${esc(value)}"><button class="btn btn-outline btn-sm" type="button" data-remove-choice aria-label="ลบตัวเลือก">ลบ</button>`;
        choiceList.appendChild(choiceRow);
        reindexChoiceRows();
        updateQuestionPreview();
      };
      const enforceSingleChoice = (changedInput) => {
        if (typeSelect?.value !== 'single_choice' || !changedInput?.checked) return;
        choiceList.querySelectorAll('[data-choice-correct]').forEach((input) => { if (input !== changedInput) input.checked = false; });
      };
      const updateQuestionPreview = () => {
        const form = document.getElementById('question-form');
        const section = String(form?.elements.section?.value || '').trim() || 'แบบประเมิน';
        const prompt = String(form?.elements.prompt?.value || '').trim() || 'คำถามจะแสดงตรงนี้';
        const previewSection = document.getElementById('question-preview-section');
        const previewPrompt = document.getElementById('question-preview-prompt');
        const previewChoices = document.getElementById('question-preview-choices');
        if (previewSection) previewSection.textContent = section;
        if (previewPrompt) previewPrompt.textContent = prompt;
        if (previewChoices) {
          const values = [...choiceList.querySelectorAll('[data-choice-text]')].map((input) => input.value.trim()).filter(Boolean);
          previewChoices.innerHTML = values.length
            ? `<div class="question-choice-preview">${values.map((value) => `<div><span class="choice-dot"></span>${esc(value)}</div>`).join('')}</div>`
            : '<div class="small muted">ยังไม่มีตัวเลือก หรือเป็นคำถามแบบข้อความ</div>';
        }
      };
      document.getElementById('add-choice-row')?.addEventListener('click', () => addChoiceRow());
      choiceList?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-choice]');
        if (!removeButton || choicesLocked) return;
        removeButton.closest('[data-choice-row]')?.remove();
        reindexChoiceRows();
        updateQuestionPreview();
      });
      choiceList?.addEventListener('change', (event) => {
        if (event.target.matches('[data-choice-correct]')) enforceSingleChoice(event.target);
        updateQuestionPreview();
      });
      choiceList?.addEventListener('input', updateQuestionPreview);
      document.getElementById('question-form')?.addEventListener('input', updateQuestionPreview);
      typeSelect?.addEventListener('change', () => {
        if (typeSelect.value === 'single_choice') {
          const checked = [...choiceList.querySelectorAll('[data-choice-correct]:checked')];
          checked.slice(1).forEach((input) => { input.checked = false; });
        }
        updateQuestionPreview();
      });
      updateQuestionPreview();

      const imageFileInput = document.getElementById('question-image-file');
      const existingImageSelect = document.getElementById('question-existing-image');
      const removeImageControl = document.querySelector('#question-form [name="remove_image"]');
      const imagePreview = document.getElementById('question-image-preview');
      existingImageSelect?.addEventListener('change', async () => {
        if (!imagePreview || imageFileInput?.files?.length) return;
        const documentId = String(existingImageSelect.value || '');
        if (!documentId) { imagePreview.innerHTML = ''; return; }
        const signedMap = await loadSignedImageMap([documentId]);
        const signedUrl = signedMap.get(documentId);
        imagePreview.innerHTML = signedUrl ? `<img src="${esc(signedUrl)}" alt="รูปประกอบที่เลือก"><div class="small muted">รูปที่เลือกจากเอกสารของรอบ</div>` : '<div class="small muted">ไม่สามารถแสดงตัวอย่างรูปได้</div>';
        if (removeImageControl) removeImageControl.checked = false;
      });
      removeImageControl?.addEventListener('change', () => {
        if (removeImageControl.checked) {
          if (imageFileInput) imageFileInput.value = '';
          if (existingImageSelect) existingImageSelect.value = '';
          if (imagePreview) imagePreview.innerHTML = '<div class="small muted">ข้อนี้จะไม่มีรูปประกอบ</div>';
        }
      });
      imageFileInput?.addEventListener('change', () => {
        const file = imageFileInput.files?.[0];
        if (!imagePreview) return;
        imagePreview.innerHTML = '';
        if (!file) return;
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
          imageFileInput.value = '';
          return toast('รองรับเฉพาะ JPG, PNG และ WebP', 'warning');
        }
        if (file.size > 20 * 1024 * 1024) {
          imageFileInput.value = '';
          return toast('รูปต้องมีขนาดไม่เกิน 20 MB', 'warning');
        }
        if (removeImageControl) removeImageControl.checked = false;
        const objectUrl = URL.createObjectURL(file);
        imagePreview.innerHTML = `<img src="${esc(objectUrl)}" alt="ตัวอย่างรูปใหม่"><div class="small muted">${esc(file.name)}</div>`;
      });

      const saveQuestion = async (goNext = false) => {
        const form = document.getElementById('question-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const id = String(fd.get('id') || '');
        let imageDocumentId = fd.get('remove_image') === 'on' ? null : (String(fd.get('image_document_id') || '') || null);
        const imageFile = fd.get('question_image_file');
        let uploadedImagePath = null;
        let uploadedImageDocumentId = null;
        if (imageFile instanceof File && imageFile.size > 0) {
          if (!['image/jpeg','image/png','image/webp'].includes(imageFile.type)) return toast('รองรับเฉพาะ JPG, PNG และ WebP', 'warning');
          if (imageFile.size > 20 * 1024 * 1024) return toast('รูปต้องมีขนาดไม่เกิน 20 MB', 'warning');
          const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
          uploadedImagePath = `${round.id}/quiz_image/${crypto.randomUUID()}_${safeName}`;
          const uploadResult = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).upload(uploadedImagePath, imageFile, { upsert: false, contentType: imageFile.type });
          if (uploadResult.error) return toast(friendlyError(uploadResult.error), 'danger');
          const title = String(fd.get('prompt') || '').trim().slice(0, 100) || `รูปประกอบข้อ ${String(fd.get('order') || '')}`;
          const { data: imageDoc, error: imageDocError } = await state.supabase.from('ec_round_documents').insert({
            round_id: round.id,
            category: 'quiz_image',
            title,
            file_name: imageFile.name,
            storage_path: uploadedImagePath,
            mime_type: imageFile.type,
            file_size: imageFile.size,
            visibility: 'staff',
            uploaded_by: state.user.id
          }).select('id').single();
          if (imageDocError) {
            await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([uploadedImagePath]);
            return toast(friendlyError(imageDocError), 'danger');
          }
          uploadedImageDocumentId = imageDoc.id;
          imageDocumentId = imageDoc.id;
        }
        if (imageDocumentId) {
          const { data: imageDocument, error: imageError } = await state.supabase.from('ec_round_documents').select('id,mime_type,visibility').eq('id', imageDocumentId).eq('round_id', round.id).single();
          if (imageError) return toast(friendlyError(imageError), 'danger');
          if (!String(imageDocument.mime_type || '').startsWith('image/')) return toast('ไฟล์ที่เลือกไม่ใช่รูปภาพ', 'danger');
          if (imageDocument.visibility !== 'staff') {
            const { error: visibilityError } = await state.supabase.from('ec_round_documents').update({ visibility: 'staff' }).eq('id', imageDocumentId);
            if (visibilityError) return toast(friendlyError(visibilityError), 'danger');
          }
        }
        const payload = {
          round_id: round.id,
          question_order: Number(fd.get('order')),
          section: String(fd.get('section') || '') || null,
          question_type: String(fd.get('type')),
          prompt: String(fd.get('prompt')).trim(),
          image_document_id: imageDocumentId,
          points: Number(fd.get('points') || 1),
          is_critical: fd.get('critical') === 'on',
          published: fd.get('published') === 'on',
          updated_by: state.user.id
        };
        const questionResult = id
          ? await state.supabase.from('ec_questions').update(payload).eq('id', id).select().single()
          : await state.supabase.from('ec_questions').insert({ ...payload, created_by: state.user.id }).select().single();
        if (questionResult.error) {
          if (uploadedImagePath) await state.supabase.storage.from(cfg.PRIVATE_BUCKET).remove([uploadedImagePath]);
          if (uploadedImageDocumentId) await state.supabase.from('ec_round_documents').delete().eq('id', uploadedImageDocumentId);
          return toast(friendlyError(questionResult.error), 'danger');
        }
        const questionId = questionResult.data.id;
        let correctIds = key?.correct_choice_ids || [];
        if (choicesLocked) {
          correctIds = [...choiceList.querySelectorAll('[data-choice-row]')]
            .filter((choiceRow) => choiceRow.querySelector('[data-choice-correct]')?.checked && choiceRow.dataset.choiceId)
            .map((choiceRow) => choiceRow.dataset.choiceId);
        } else {
          const editorRows = [...choiceList.querySelectorAll('[data-choice-row]')]
            .map((choiceRow) => ({ text: choiceRow.querySelector('[data-choice-text]')?.value.trim() || '', correct: Boolean(choiceRow.querySelector('[data-choice-correct]')?.checked) }))
            .filter((choice) => choice.text);
          if (payload.question_type === 'single_choice' && editorRows.filter((choice) => choice.correct).length > 1) {
            let found = false;
            editorRows.forEach((choice) => { if (choice.correct && !found) found = true; else if (choice.correct) choice.correct = false; });
          }
          const deleteChoices = await state.supabase.from('ec_question_choices').delete().eq('question_id', questionId);
          if (deleteChoices.error) return toast(friendlyError(deleteChoices.error), 'danger');
          correctIds = [];
          if (editorRows.length) {
            const { data: inserted, error } = await state.supabase.from('ec_question_choices').insert(editorRows.map((choice, index) => ({ question_id: questionId, choice_order: index + 1, choice_text: choice.text }))).select();
            if (error) return toast(friendlyError(error), 'danger');
            correctIds = (inserted || []).filter((_, index) => editorRows[index]?.correct).map((choice) => choice.id);
          }
        }
        const referenceAnswer = String(fd.get('reference_answer') || '').trim();
        const challengeType = String(fd.get('challenge_type') || 'unknown');
        const answerBasis = String(fd.get('answer_basis') || 'insufficient');
        const isAntibodyKey = isAntibodyIdentificationQuestion({ section: payload.section, prompt: payload.prompt }) && Boolean(referenceAnswer);
        const answerKeyJson = {
          ...(keyJson || {}),
          challenge_type: challengeType,
          answer_basis: answerBasis,
          text: referenceAnswer,
          consensus_result: challengeType === 'educational' ? referenceAnswer : String(keyJson.consensus_result || ''),
          consensus_percent: String(fd.get('consensus_percent') || '').trim(),
          auto_compare: isAntibodyKey ? 'antibody_set' : null,
          needs_manual_review: !(correctIds.length || referenceAnswer),
        };
        const keyResult = await state.supabase.from('ec_question_answer_keys').upsert({ question_id: questionId, correct_choice_ids: correctIds, answer_key_json: answerKeyJson, explanation: String(fd.get('explanation') || '') || null, updated_by: state.user.id }, { onConflict: 'question_id' });
        if (keyResult.error) return toast(friendlyError(keyResult.error), 'danger');
        toast('บันทึกคำถามแล้ว', 'success');
        if (goNext) {
          const { data: orderedQuestions, error: orderError } = await state.supabase.from('ec_questions').select('*').eq('round_id', round.id).order('question_order');
          if (orderError) return toast(friendlyError(orderError), 'danger');
          const visibleQuestions = (orderedQuestions || []).filter((question) => question.generated_by_ai !== true);
          const currentIndex = visibleQuestions.findIndex((question) => question.id === questionId);
          const nextQuestion = currentIndex >= 0 ? visibleQuestions[currentIndex + 1] : null;
          if (nextQuestion) {
            closeModal();
            await openQuestion(nextQuestion);
            return;
          }
          toast('ตรวจถึงข้อสุดท้ายแล้ว', 'success');
        }
        closeModal();
        route();
      };
      document.getElementById('save-question')?.addEventListener('click', () => saveQuestion(false));
      document.getElementById('save-question-next')?.addEventListener('click', () => saveQuestion(true));
    };


    const extractionTextItems = (documentRow) => {
      const extraction = documentRow?.ai_extraction && typeof documentRow.ai_extraction === 'object' ? documentRow.ai_extraction : {};
      const items = [];
      const seen = new Set();
      const add = (text, label = '') => {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value.length < 8 || seen.has(value)) return;
        seen.add(value);
        items.push({ text: value, label: label || documentRow.title || documentRow.file_name || 'ข้อความจากเอกสาร' });
      };
      add(extraction.summary_th || extraction.summary, 'สรุปจากเอกสาร');
      (Array.isArray(extraction.provider_questions) ? extraction.provider_questions : []).forEach((item) => add(item?.prompt || item?.question || item?.text, item?.section || 'คำถามในเอกสาร'));
      (Array.isArray(extraction.document_sections) ? extraction.document_sections : []).forEach((item) => add(item?.text || item?.content || item?.body, item?.title || 'หัวข้อในเอกสาร'));
      (Array.isArray(extraction.case_studies) ? extraction.case_studies : []).forEach((item) => add(item?.text || item?.case_text || item?.content || item, item?.title || 'Case Study'));
      (Array.isArray(extraction.instructions) ? extraction.instructions : []).forEach((item) => add(item?.text || item?.content || item, 'คำแนะนำ'));
      (Array.isArray(extraction.raw_observations) ? extraction.raw_observations : []).forEach((item) => add(item?.text || item?.content || item, 'ข้อความที่อ่านได้'));
      if (!items.length) {
        const walk = (value, key = '') => {
          if (typeof value === 'string') {
            if (!/^(v\d|completed|pending|failed|openai|gpt)/i.test(value.trim())) add(value, key);
            return;
          }
          if (Array.isArray(value)) return value.forEach((item) => walk(item, key));
          if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, childValue]) => walk(childValue, childKey));
        };
        walk(extraction);
      }
      return items.slice(0, 200);
    };

    const openExtractedTextBank = async () => {
      const { data: docs, error } = await state.supabase.from('ec_round_documents')
        .select('id,title,file_name,category,ai_extraction,ai_extraction_status,ai_extracted_at')
        .eq('round_id', round.id)
        .is('archived_at', null)
        .in('category', ['source_document','instruction','official_result','participant_summary'])
        .order('created_at', { ascending: false });
      if (error) return toast(friendlyError(error), 'danger');
      const banks = (docs || []).map((doc) => ({ doc, items: extractionTextItems(doc) })).filter((bank) => bank.items.length);
      if (!banks.length) return toast('ยังไม่มีข้อความที่ AI อ่านไว้ กด “อ่านข้อความจากเอกสาร” ก่อน', 'warning');
      const body = banks.map(({ doc, items }) => `<section class="extracted-text-document">
        <div class="card-header"><div><h3>${esc(doc.title || doc.file_name)}</h3><div class="small muted">${esc(labelFrom(DOCUMENT_CATEGORY_LABELS, doc.category))} · อ่าน ${fmtDate(doc.ai_extracted_at, true)}</div></div><span class="badge success">${items.length} ข้อความ</span></div>
        <div class="extracted-text-list">${items.map((item, index) => `<article class="extracted-text-item">
          <div><span class="small muted">${esc(item.label)}</span><p>${esc(item.text)}</p></div>
          <div class="table-actions"><button class="btn btn-outline btn-sm" type="button" data-copy-extracted="${esc(`${doc.id}:${index}`)}">คัดลอก</button><button class="btn btn-primary btn-sm" type="button" data-use-extracted="${esc(`${doc.id}:${index}`)}">ใช้เป็นคำถาม</button></div>
        </article>`).join('')}</div>
      </section>`).join('');
      showModal('คลังข้อความจากเอกสาร', `<div class="notice info"><strong>AI อ่านข้อความเท่านั้น</strong><br>ข้อความด้านล่างจะไม่กลายเป็นข้อสอบจนกว่ามัสจะกด “ใช้เป็นคำถาม” แล้วตั้งตัวเลือก เฉลย และรูปเอง</div><div class="extracted-text-bank">${body}</div>`, '<button class="btn btn-primary" data-close-modal>ปิด</button>', true);
      const itemMap = new Map();
      banks.forEach(({ doc, items }) => items.forEach((item, index) => itemMap.set(`${doc.id}:${index}`, item)));
      document.querySelectorAll('[data-copy-extracted]').forEach((button) => button.addEventListener('click', async () => {
        const item = itemMap.get(button.dataset.copyExtracted);
        if (!item) return;
        try { await navigator.clipboard.writeText(item.text); toast('คัดลอกข้อความแล้ว', 'success'); }
        catch (_) { toast('คัดลอกอัตโนมัติไม่ได้ กรุณาลากเลือกข้อความ', 'warning'); }
      }));
      document.querySelectorAll('[data-use-extracted]').forEach((button) => button.addEventListener('click', async () => {
        const item = itemMap.get(button.dataset.useExtracted);
        if (!item) return;
        const { data: lastQuestion } = await state.supabase.from('ec_questions').select('question_order').eq('round_id', round.id).eq('generated_by_ai', false).order('question_order', { ascending: false }).limit(1).maybeSingle();
        closeModal();
        await openQuestion(null, { prompt: item.text, section: item.label || 'แบบประเมิน', order: Number(lastQuestion?.question_order || 0) + 1, question_type: 'single_choice' });
      }));
    };

    const readDocumentsAsText = async () => {
      const { data: docs, error } = await state.supabase.from('ec_round_documents')
        .select('id,title,file_name,category,mime_type,ai_extraction_status')
        .eq('round_id', round.id)
        .is('archived_at', null)
        .in('category', ['source_document','instruction','official_result','participant_summary'])
        .order('created_at');
      if (error) return toast(friendlyError(error), 'danger');
      if (!(docs || []).length) return toast('ยังไม่มีเอกสารต้นฉบับ คู่มือ Official Result หรือ Participant Summary', 'warning');
      if (!confirm(`ให้ AI อ่านข้อความจากเอกสาร ${(docs || []).length} ไฟล์หรือไม่ ระบบจะไม่สร้างข้อสอบและไม่ตั้งเฉลย`)) return;
      setBusy(true);
      let completed = 0;
      let failed = 0;
      for (const doc of docs || []) {
        try {
          toast(`กำลังอ่านข้อความ ${completed + failed + 1}/${docs.length}: ${doc.title || doc.file_name}`, 'info', 1800);
          await invokeCompetencyAI({ action: 'extract_document', round_id: round.id, document_id: doc.id, force: false });
          completed += 1;
        } catch (extractError) {
          failed += 1;
          console.error('extract_document failed', doc.id, extractError);
        }
      }
      setBusy(false);
      toast(failed ? `อ่านสำเร็จ ${completed} ไฟล์ ไม่สำเร็จ ${failed} ไฟล์` : `อ่านข้อความสำเร็จ ${completed} ไฟล์`, failed ? 'warning' : 'success', 7000);
      await openExtractedTextBank();
    };

    const openWindowModal = (afterSave = null) => {
      const defaultOpen = round.competency_open_at || new Date().toISOString();
      const defaultClose = round.competency_close_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      showModal(isHistoricalRound(round) ? 'กำหนดวันปิด Competency สำหรับข้อมูลย้อนหลัง' : 'กำหนดช่วงเวลาทำ Competency', `<form id="competency-window-form" class="form-grid cols-2">
        <div class="field"><label>วันและเวลาเปิด</label><input class="input" type="datetime-local" name="open_at" required value="${fmtDateTimeInput(defaultOpen)}"></div>
        <div class="field"><label>วันและเวลาปิดรับคำตอบ</label><input class="input" type="datetime-local" name="close_at" required value="${fmtDateTimeInput(defaultClose)}"></div>
        <div class="notice" style="grid-column:1/-1">เมื่อเลยเวลาปิด เจ้าหน้าที่ที่ยังไม่ส่งจะไม่สามารถเริ่มหรือส่งคำตอบได้ ผู้ดูแลสามารถขยายเวลาได้ภายหลัง</div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-competency-window">บันทึกช่วงเวลา</button>`);
      document.getElementById('save-competency-window').addEventListener('click', async () => {
        const form = document.getElementById('competency-window-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const openAt = new Date(String(fd.get('open_at')));
        const closeAt = new Date(String(fd.get('close_at')));
        if (Number.isNaN(openAt.getTime()) || Number.isNaN(closeAt.getTime())) return toast('วันเวลาไม่ถูกต้อง', 'warning');
        if (closeAt <= openAt) return toast('วันปิดต้องอยู่หลังวันเปิด', 'warning');
        const { error } = await state.supabase.rpc('ec_set_competency_window', { p_round_id: round.id, p_open_at: openAt.toISOString(), p_close_at: closeAt.toISOString() });
        if (error) return toast(friendlyError(error), 'danger');
        closeModal();
        if (typeof afterSave === 'function') await afterSave();
        else { toast('บันทึกช่วงเวลาทำ Competency แล้ว', 'success'); route(); }
      });
    };

    document.getElementById('go-document-ai-tools')?.addEventListener('click', () => navigate(`round/${round.id}/documents`));
    document.getElementById('read-document-text')?.addEventListener('click', readDocumentsAsText);
    document.getElementById('open-extracted-text-bank')?.addEventListener('click', openExtractedTextBank);
    document.getElementById('add-question')?.addEventListener('click', async () => {
      const { data: lastQuestion } = await state.supabase.from('ec_questions').select('question_order').eq('round_id', round.id).eq('generated_by_ai', false).order('question_order', { ascending: false }).limit(1).maybeSingle();
      openQuestion(null, { order: Number(lastQuestion?.question_order || 0) + 1, question_type: 'single_choice' });
    });

    const applyQuestionFilters = () => {
      const query = String(document.getElementById('question-search')?.value || '').trim().toLowerCase();
      const filter = String(document.getElementById('question-filter')?.value || 'all');
      let visibleCount = 0;
      document.querySelectorAll('.admin-question-card').forEach((card) => {
        const textMatch = !query || String(card.dataset.questionSearch || '').includes(query);
        const stateMatch = filter === 'all'
          || (filter === 'action' && card.dataset.needsAction === '1')
          || (filter === 'draft' && card.dataset.published === '0')
          || (filter === 'missing-key' && card.dataset.hasKey === '0')
          || (filter === 'manual' && card.dataset.manual === '1')
          || (filter === 'published' && card.dataset.published === '1');
        const show = textMatch && stateMatch;
        card.hidden = !show;
        if (show) visibleCount += 1;
      });
      const counter = document.getElementById('question-filter-count');
      if (counter) counter.textContent = `แสดง ${visibleCount} ข้อ`;
    };
    document.getElementById('question-search')?.addEventListener('input', applyQuestionFilters);
    document.getElementById('question-filter')?.addEventListener('change', applyQuestionFilters);
    const toolbar = document.querySelector('.question-review-toolbar');
    if (toolbar && !document.getElementById('question-filter-count')) {
      const counter = document.createElement('span');
      counter.id = 'question-filter-count';
      counter.className = 'small muted question-filter-count';
      toolbar.insertAdjacentElement('afterend', counter);
      applyQuestionFilters();
    }
    document.getElementById('review-questions-sequentially')?.addEventListener('click', () => {
      const cards = [...document.querySelectorAll('.admin-question-card')];
      const target = cards.find((card) => card.dataset.needsAction === '1') || cards[0];
      target?.querySelector('[data-edit-question]')?.click();
    });
    document.getElementById('preview-question-set')?.addEventListener('click', () => {
      const source = document.querySelector('.admin-question-list');
      if (!source) return toast('ยังไม่มีข้อสอบให้ดูตัวอย่าง', 'warning');
      const clone = source.cloneNode(true);
      clone.querySelectorAll('.admin-question-card').forEach((card) => { card.hidden = false; });
      clone.querySelectorAll('.question-status-stack, .answer-key-preview, .admin-question-footer, .question-source-chip, .question-catalog-note').forEach((node) => node.remove());
      clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      showModal('ตัวอย่างข้อสอบในมุมผู้ทำแบบประเมิน', `<div class="notice info"><strong>โหมดตัวอย่างเท่านั้น</strong><br>หน้านี้ไม่บันทึกคำตอบ และไม่เปลี่ยนบทบาทที่กำลังทำงานอยู่</div><div class="staff-question-set-preview">${clone.outerHTML}</div>`, '<button class="btn btn-primary" data-close-modal>ปิดตัวอย่าง</button>', true);
    });
    document.querySelectorAll('[data-edit-question]').forEach((button) => button.addEventListener('click', async () => {
      const { data, error } = await state.supabase.from('ec_questions').select('*').eq('id', button.dataset.editQuestion).single();
      if (error) return toast(friendlyError(error), 'danger');
      openQuestion(data);
    }));
    document.querySelectorAll('[data-delete-question]').forEach((button) => button.addEventListener('click', () => {
      showModal('ลบคำถาม', `<div class="notice danger"><strong>ยืนยันลบคำถาม</strong><br>${esc(button.dataset.questionLabel || '')}</div><div style="height:12px"></div><div class="small muted">หากมีเจ้าหน้าที่ตอบข้อนี้แล้ว ระบบจะไม่อนุญาตให้ลบ เพื่อรักษาหลักฐานเดิม</div>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-danger" id="confirm-delete-question">ยืนยันลบ</button>`);
      document.getElementById('confirm-delete-question').addEventListener('click', async () => {
        const { error } = await state.supabase.rpc('ec_delete_question', { p_question_id: button.dataset.deleteQuestion });
        if (error) return toast(friendlyError(error), 'danger');
        closeModal(); toast('ลบคำถามแล้ว', 'success'); route();
      });
    }));

    document.getElementById('ai-generate-questions')?.addEventListener('click', () => {
      showModal('สร้างข้อสอบอัตโนมัติจากไฟล์', `<form id="ai-question-form" class="form-grid">
        <div class="notice info"><strong>ระบบจะอ่านเฉพาะ 3 ประเภทเอกสาร</strong><br>ภาพผลทดสอบดิบ · คู่มือหรือคำแนะนำ · เอกสารต้นฉบับจากผู้ให้บริการ</div>
        <div class="field"><label>จำนวนข้อโดยประมาณ</label><input class="input" type="number" name="question_count" min="3" max="25" value="12" required></div>
        <label><input type="checkbox" name="replace_drafts" checked> แทนที่เฉพาะข้อสอบฉบับร่างที่ AI เคยสร้างไว้ (ไม่แตะข้อที่เพิ่มเองหรือเผยแพร่แล้ว)</label>
        <label><input type="checkbox" name="confirm_privacy" required> ยืนยันว่าไฟล์ไม่มีชื่อผู้ป่วย HN หรือข้อมูลส่วนบุคคลที่ไม่ควรส่งไปประมวลผล</label>
        <label><input type="checkbox" name="generate_answers" ${isHistoricalRound(round) ? 'checked' : ''}> เมื่อสร้างข้อสอบเสร็จ ให้สร้างเฉลยและสรุปต่อทันที หากมี Official Evaluation (และ Participant Summary สำหรับ Educational Challenge)</label>
        <div class="small muted">ข้อสอบที่สร้างจะเป็น “ฉบับร่าง” และยังไม่เปิดให้น้องทำจนกว่าจะกดเผยแพร่</div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="confirm-ai-generate">เริ่มสร้าง</button>`, true);
      document.getElementById('confirm-ai-generate').addEventListener('click', async () => {
        const form = document.getElementById('ai-question-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form);
        try {
          setBusy(true);
          const result = await invokeCompetencyAI({
            action: 'generate_questions',
            round_id: round.id,
            question_count: Number(fd.get('question_count') || 12),
            replace_ai_drafts: fd.get('replace_drafts') === 'on'
          });
          let message = `สร้างข้อสอบฉบับร่าง ${result.generated_count || 0} ข้อแล้ว`;
          if (fd.get('generate_answers') === 'on') {
            try {
              const answerResult = await invokeCompetencyAI({ action: 'generate_answers', round_id: round.id });
              message += ` และสร้างเฉลย ${answerResult.generated_count || 0} ข้อพร้อมสรุปแล้ว${Number(answerResult.manual_review_count || 0) > 0 ? ` โดยมี ${answerResult.manual_review_count} ข้อที่ต้องตรวจเอง` : ''}`;
            } catch (answerError) {
              message += ' แต่ยังสร้างเฉลยไม่ได้ กรุณาตรวจว่ามีรายงานผลประเมินอย่างเป็นทางการแล้ว';
            }
          }
          closeModal(); toast(message, 'success'); route();
        } catch (error) {
          toast(friendlyError(error), 'danger');
        } finally {
          setBusy(false);
        }
      });
    });

    document.getElementById('ai-generate-answers')?.addEventListener('click', async () => {
      if (!confirm('ให้ระบบอ่าน Official Evaluation และ Participant Summary แล้วสร้างเฉลยและสรุปผลหรือไม่? ข้อมูลจะยังไม่เปิดให้น้องเห็นจนกว่าจะกดเปิดผลและเฉลย')) return;
      try {
        setBusy(true);
        const result = await invokeCompetencyAI({ action: 'generate_answers', round_id: round.id });
        toast(`สร้างเฉลย ${result.generated_count || 0} ข้อและสรุปผลแล้ว${Number(result.manual_review_count || 0) > 0 ? ` มี ${result.manual_review_count} ข้อที่หลักฐานไม่พอและต้องตรวจเอง` : ''} กรุณาตรวจทานก่อนเปิดเผย`, Number(result.manual_review_count || 0) > 0 ? 'warning' : 'success', 8500);
        route();
      } catch (error) {
        toast(friendlyError(error), 'danger');
      } finally {
        setBusy(false);
      }
    });

    document.getElementById('unpublish-all-questions')?.addEventListener('click', async () => {
      if (!confirm('พักการเผยแพร่ข้อสอบทั้งหมดชั่วคราวหรือไม่ คำตอบเดิมจะไม่ถูกลบ')) return;
      const { data, error } = await state.supabase.from('ec_questions')
        .update({ published: false, updated_by: state.user.id })
        .eq('round_id', round.id)
        .eq('generated_by_ai', false)
        .is('archived_at', null)
        .select('id');
      if (error) return toast(friendlyError(error), 'danger');
      toast(`พักการเผยแพร่แล้ว ${(data || []).length} ข้อ คำตอบเดิมยังอยู่ครบ`, 'success');
      route();
    });

    document.getElementById('publish-all-questions')?.addEventListener('click', async () => {
      if (!confirm('ยืนยันเผยแพร่ข้อสอบทั้งหมดหรือไม่ เจ้าหน้าที่ที่ได้รับมอบหมายจะเห็นคำถามตามช่วงเวลาที่กำหนด')) return;
      const { data, error } = await state.supabase.from('ec_questions')
        .update({ published: true, updated_by: state.user.id })
        .eq('round_id', round.id)
        .eq('generated_by_ai', false)
        .is('archived_at', null)
        .select('id');
      if (error) return toast(friendlyError(error), 'danger');
      toast(`เผยแพร่ข้อสอบแล้ว ${(data || []).length} ข้อ`, 'success');
      route();
    });

    document.getElementById('set-competency-window')?.addEventListener('click', () => openWindowModal());

    document.getElementById('assign-all-competency')?.addEventListener('click', async () => {
      const { count: publishedCount, error: questionCountError } = await state.supabase.from('ec_questions').select('id', { count: 'exact', head: true }).eq('round_id', round.id).eq('published', true).eq('generated_by_ai', false).is('archived_at', null);
      if (questionCountError) return toast(friendlyError(questionCountError), 'danger');
      if (!publishedCount) return toast('กรุณาเพิ่ม ตรวจ และเผยแพร่ข้อสอบอย่างน้อย 1 ข้อก่อนสร้างรายการประเมิน', 'warning');

      const createAssignments = async () => {
        const { data, error } = await state.supabase.rpc('ec_sync_competency_assignments', { p_round_id: round.id });
        if (error) return toast(friendlyError(error), 'danger');
        const created = Number(data?.created_count || 0);
        const active = Number(data?.active_count || 0);
        const excluded = Number(data?.practitioner_count || 0);
        toast(`จัดรายการหัวข้อ 10 แล้ว ${active} คน${created ? ` (เพิ่มใหม่ ${created} คน)` : ''} · ไม่รวมผู้ปฏิบัติจริง ${excluded} คน เพราะประเมินผ่านหัวข้อ 4`, 'success', 8500);
        route();
      };

      if (!round.competency_close_at) {
        openWindowModal(createAssignments);
        return;
      }
      if (!confirm(`สร้าง/ปรับรายการหัวข้อ 10 ให้เฉพาะเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริงหรือไม่\nผู้ปฏิบัติจริง 2 คนใช้หัวข้อ 4 เท่านั้น\nปิดรับคำตอบ: ${fmtDate(round.competency_close_at, true)}`)) return;
      await createAssignments();
    });

    document.querySelectorAll('[data-preview-staff-assignment]').forEach((button) => button.addEventListener('click', () => openStaffCompetencyPreview(button.dataset.previewStaffAssignment)));

    document.getElementById('select-all-review-ready')?.addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('[data-review-assignment-check]:not(:disabled)')];
      const shouldCheck = boxes.some((box) => !box.checked);
      boxes.forEach((box) => { box.checked = shouldCheck; });
    });

    document.getElementById('review-selected-assignments')?.addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('[data-review-assignment-check]:checked')].map((box) => box.value).filter(Boolean);
      if (!ids.length) return toast('กรุณาเลือกอย่างน้อย 1 คนที่รอตรวจ', 'warning');
      const queue = [...ids];
      const openNext = async () => {
        const next = queue.shift();
        if (!next) {
          toast('ตรวจครบคนที่เลือกแล้ว', 'success');
          route();
          return;
        }
        await openQuizReview(next, openNext);
      };
      await openNext();
    });

    document.querySelectorAll('[data-archive-competency]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      await archiveReportToDrive({
        report_type: 'competency',
        assignment_id: button.dataset.archiveCompetency,
        stage: button.dataset.archiveStage || 'current'
      });
      button.disabled = false;
    }));
  }

  async function openPracticalReview(assignmentId) {
    const [{ data: assignment, error: assignmentError }, { data: assessment, error: assessmentError }, { data: evidenceRows, error: evidenceError }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name)').eq('id', assignmentId).single(),
      state.supabase.from('ec_practical_assessments').select('*').eq('assignment_id', assignmentId).maybeSingle(),
      state.supabase.from('ec_work_evidence').select('*').eq('competency_assignment_id', assignmentId).eq('context_type', 'competency').is('archived_at', null).order('created_at', { ascending: false })
    ]);
    if (assignmentError || assessmentError || evidenceError) return toast(friendlyError(assignmentError || assessmentError || evidenceError), 'danger');
    const fields = [
      ['result_accuracy', 'ความถูกต้องของผล'],
      ['procedure_compliance', 'ปฏิบัติตามวิธีและขั้นตอน'],
      ['method_selection', 'เลือกวิธีตรวจเหมาะสม'],
      ['interpretation', 'การแปลผล'],
      ['documentation', 'การบันทึกข้อมูล'],
      ['problem_solving', 'การแก้ปัญหา']
    ];
    const body = `<div class="notice">ผู้ทบทวนประเมินครบทุกหัวข้อ แล้วส่งต่อให้ผู้รับรองคุณภาพรับรอง</div><div style="height:12px"></div>${workEvidencePanelHtml('review-competency-evidence', evidenceRows || [], false)}<div style="height:12px"></div><form id="practical-review-form" class="form-grid">${fields.map(([key,label]) => `<div class="field"><label>${esc(label)}</label><select class="select" name="${key}" required><option value="">เลือกผล</option><option value="true" ${assessment?.[key]===true?'selected':''}>ผ่าน</option><option value="false" ${assessment?.[key]===false?'selected':''}>ต้องทบทวน</option></select></div>`).join('')}<div class="field"><label>ข้อคิดเห็นผู้ทบทวน</label><textarea class="textarea" name="note">${esc(assessment?.reviewer_note || '')}</textarea></div></form>`;
    showModal(`ประเมินการปฏิบัติจริง — ${assignment.ec_profiles?.full_name || ''}`, body, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-practical-review">ผ่านการทบทวนและส่งให้ผู้รับรองคุณภาพ</button>`, true);
    bindWorkEvidencePanel('review-competency-evidence', { roundId: assignment.round_id, contextType: 'competency', assignmentId });
    document.getElementById('save-practical-review').addEventListener('click', async () => {
      const form = document.getElementById('practical-review-form'); if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = Object.fromEntries(fields.map(([key]) => [key, fd.get(key) === 'true']));
      const { error } = await state.supabase.rpc('ec_reviewer_review_practical', { p_assignment_id: assignmentId, p_assessment: payload, p_note: String(fd.get('note') || '') || null });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: assignmentId, stage: 'reviewed' }, true);
      closeModal(); toast('ตรวจทานแล้ว ส่งให้ผู้รับรองคุณภาพเรียบร้อย', 'success'); route();
    });
  }

  async function openQuizReview(assignmentId, onDone = null) {
    const { data: assignment, error: assignmentError } = await state.supabase
      .from('ec_competency_assignments')
      .select('*,ec_profiles(full_name),ec_eqa_rounds(*)')
      .eq('id', assignmentId)
      .single();
    if (assignmentError) return toast(friendlyError(assignmentError), 'danger');

    const [
      { data: answers, error: answersError },
      { data: questionRows, error: questionsError },
      { data: evidenceRows, error: evidenceError },
      { data: reviewEvidenceRows, error: reviewEvidenceError }
    ] = await Promise.all([
      state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', assignmentId),
      state.supabase.from('ec_questions').select('*').eq('round_id', assignment.round_id).eq('published', true).eq('generated_by_ai', false).is('archived_at', null).order('question_order'),
      state.supabase.from('ec_round_documents').select('id,title,file_name,storage_path,mime_type,category,visibility').eq('round_id', assignment.round_id).is('archived_at', null),
      state.supabase.from('ec_work_evidence').select('*').eq('competency_assignment_id', assignmentId).eq('context_type', 'competency').is('archived_at', null).order('created_at', { ascending: false })
    ]);
    if (answersError || questionsError || evidenceError || reviewEvidenceError) {
      return toast(friendlyError(answersError || questionsError || evidenceError || reviewEvidenceError), 'danger');
    }

    const questionIds = (questionRows || []).map((question) => question.id);
    let choices = [];
    let keys = [];
    if (questionIds.length) {
      const [{ data: choiceRows, error: choicesError }, { data: keyRows, error: keysError }] = await Promise.all([
        state.supabase.from('ec_question_choices').select('*').in('question_id', questionIds).order('choice_order'),
        state.supabase.from('ec_question_answer_keys').select('*').in('question_id', questionIds)
      ]);
      if (choicesError || keysError) return toast(friendlyError(choicesError || keysError), 'danger');
      choices = choiceRows || [];
      keys = keyRows || [];
    }

    const answerMap = new Map((answers || []).map((answer) => [answer.question_id, answer]));
    const keyMap = new Map((keys || []).map((key) => [key.question_id, key]));
    const imageMap = await loadSignedImageMap((questionRows || []).flatMap((question) => questionImageIds(question)));
    const rawEvidence = evidenceRows.filter((doc) => ['raw_result_image','antibody_panel'].includes(doc.category));
    const rawEvidenceMap = await loadSignedImageMap(rawEvidence.map((doc) => doc.id));

    const answerText = (question, answer) => {
      const payload = answer?.answer_payload || {};
      if (question.question_type === 'single_choice') {
        return (choices || []).find((choice) => choice.id === payload.choice_id)?.choice_text || '-';
      }
      if (question.question_type === 'multiple_choice') {
        const selectedIds = new Set(Array.isArray(payload.choice_ids) ? payload.choice_ids.map(String) : []);
        const selectedTexts = (choices || [])
          .filter((choice) => choice.question_id === question.id && selectedIds.has(String(choice.id)))
          .sort((a,b) => Number(a.choice_order || 0) - Number(b.choice_order || 0))
          .map((choice) => choice.choice_text);
        return selectedTexts.join(' / ') || '-';
      }
      return payload.text || '-';
    };
    const correctText = (question) => {
      const key = keyMap.get(question.id);
      const correctIds = new Set(key?.correct_choice_ids || []);
      const choiceTexts = (choices || []).filter((choice) => choice.question_id === question.id && correctIds.has(choice.id)).sort((a,b) => Number(a.choice_order || 0)-Number(b.choice_order || 0)).map((choice) => choice.choice_text);
      return choiceTexts.join(' / ') || key?.answer_key_json?.text || key?.answer_key_json?.consensus_result || '-';
    };

    const questionCards = (questionRows || []).map((question) => {
      const answer = answerMap.get(question.id);
      const currentResult = answer?.is_correct === true ? 'true' : answer?.is_correct === false ? 'false' : '';
      return `<article class="review-person-question" data-review-question="${question.id}">
        <div class="review-person-question-head">
          <div><span class="question-section">${esc(question.section || 'แบบประเมิน')}</span><h3>${question.question_order}. ${esc(displayQuestionPrompt(question.prompt) || question.prompt)}</h3></div>
          <label class="return-question-check"><input type="checkbox" data-needs-correction="${question.id}"> ส่งข้อนี้กลับแก้</label>
        </div>
        ${questionImageGallery(question, imageMap, 'review')}
        <div class="grid cols-2 review-answer-compare">
          <div><span class="small muted">คำตอบของผู้ทำ</span><div class="review-answer-value">${esc(answerText(question, answer))}</div></div>
          <div><span class="small muted">แนวคำตอบ/เฉลย</span><div class="review-answer-value">${esc(correctText(question))}</div></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>ผลการตรวจ</label><select class="select" data-answer-result="${answer?.id || ''}" data-question-id="${question.id}" required>
            <option value="">เลือกผล</option>
            <option value="true" ${currentResult === 'true' ? 'selected' : ''}>ถูก / เหมาะสม</option>
            <option value="false" ${currentResult === 'false' ? 'selected' : ''}>ไม่ถูก / ต้องแก้</option>
          </select></div>
          <div class="field"><label>ข้อคิดเห็นเฉพาะข้อนี้</label><input class="input" data-answer-comment="${answer?.id || ''}" value="${esc(answer?.reviewer_comment || '')}" placeholder="เช่น ตรวจ Cell 7–11 ใหม่"></div>
        </div>
      </article>`;
    }).join('');

    const rawGallery = rawEvidence.length ? `<details class="competency-review-evidence" open><summary><strong>ภาพผลดิบและ Antigram ของรอบนี้</strong></summary><div class="provider-evidence-thumb-grid">${rawEvidence.map((doc) => {
      const url = rawEvidenceMap.get(doc.id);
      return url ? `<figure class="provider-evidence-thumb"><a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(doc.title || doc.file_name)}"></a><figcaption>${esc(doc.title || doc.file_name)}</figcaption></figure>` : '';
    }).join('')}</div></details>` : '';

    showModal(`ตรวจรายบุคคล — ${assignment.ec_profiles?.full_name || ''}`, `
      <div class="notice info"><strong>ตรวจทีละคน</strong><br>เทียบคำตอบกับรูปผลดิบและเฉลย จากนั้นเลือกเฉพาะข้อที่ต้องส่งกลับแก้ ข้อที่ไม่เลือกจะถูกล็อกไว้เมื่อเจ้าหน้าที่กลับมาแก้</div>
      ${rawGallery}
      <div style="height:12px"></div>
      <div id="quiz-review-list" class="review-person-question-list">${questionCards || empty('ยังไม่มีข้อสอบที่เผยแพร่')}</div>
      <div style="height:12px"></div>
      ${workEvidencePanelHtml('review-competency-evidence', reviewEvidenceRows || [], false)}
      <div class="field"><label>หมายเหตุรวมถึงผู้ทำแบบประเมิน</label><textarea class="textarea" id="quiz-review-note" placeholder="จำเป็นเมื่อส่งกลับแก้ไข">${esc(assignment.correction_note || assignment.reviewer_note || '')}</textarea></div>
    `, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-warning" id="return-quiz-correction">ส่งกลับเฉพาะข้อที่เลือก</button><button class="btn btn-success" id="approve-quiz-review">ผ่านและส่งต่อผู้รับรองคุณภาพ</button>`, true);
    bindWorkEvidencePanel('review-competency-evidence', { roundId: assignment.round_id, contextType: 'competency', assignmentId });

    document.querySelectorAll('[data-answer-result]').forEach((select) => {
      select.addEventListener('change', () => {
        if (select.value === 'false') {
          document.querySelector(`[data-needs-correction="${select.dataset.questionId}"]`)?.setAttribute('checked', 'checked');
          const checkbox = document.querySelector(`[data-needs-correction="${select.dataset.questionId}"]`);
          if (checkbox) checkbox.checked = true;
        }
      });
    });

    const collectReviews = () => {
      return (questionRows || []).map((question) => {
        const answer = answerMap.get(question.id);
        const result = document.querySelector(`[data-answer-result="${answer?.id || ''}"]`);
        const comment = document.querySelector(`[data-answer-comment="${answer?.id || ''}"]`);
        const correction = document.querySelector(`[data-needs-correction="${question.id}"]`);
        return {
          answer_id: answer?.id || '',
          question_id: question.id,
          is_correct: result?.value || '',
          comment: String(comment?.value || '').trim(),
          needs_correction: Boolean(correction?.checked)
        };
      });
    };

    const decide = async (decision) => {
      const reviews = collectReviews();
      if (reviews.some((review) => !review.answer_id || !review.is_correct)) return toast('กรุณาตรวจคำตอบทุกข้อให้ครบ', 'warning');
      const note = String(document.getElementById('quiz-review-note')?.value || '').trim();
      if (decision === 'returned' && !reviews.some((review) => review.needs_correction)) return toast('กรุณาเลือกอย่างน้อย 1 ข้อที่ต้องแก้', 'warning');
      if (decision === 'returned' && !note) return toast('กรุณาระบุคำแนะนำก่อนส่งกลับ', 'warning');
      const confirmation = decision === 'returned'
        ? 'ยืนยันส่งกลับเฉพาะข้อที่เลือกให้เจ้าหน้าที่แก้หรือไม่'
        : 'ยืนยันว่าตรวจครบและส่งต่อผู้รับรองคุณภาพหรือไม่';
      if (!confirm(confirmation)) return;
      setBusy(true);
      const { data, error } = await state.supabase.rpc('ec_reviewer_decide_quiz_v281', {
        p_assignment_id: assignmentId,
        p_reviews: reviews,
        p_decision: decision,
        p_note: note || null
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal();
      toast(decision === 'returned' ? `ส่งกลับให้แก้ ${data?.question_count || 0} ข้อแล้ว` : 'ตรวจผ่านและส่งต่อผู้รับรองคุณภาพแล้ว', 'success');
      if (typeof onDone === 'function') await onDone();
      else route();
    };

    document.getElementById('return-quiz-correction')?.addEventListener('click', () => decide('returned'));
    document.getElementById('approve-quiz-review')?.addEventListener('click', () => decide('approved'));
  }

  async function openReflectionReview(assignmentId) {
    const [{ data: assignment, error: assignmentError }, { data: reflections, error: reflectionError }, { data: answers }, { data: questions }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name)').eq('id', assignmentId).single(),
      state.supabase.from('ec_reflections').select('*').eq('assignment_id', assignmentId).order('created_at'),
      state.supabase.from('ec_competency_answers').select('id,question_id').eq('assignment_id', assignmentId),
      state.supabase.from('ec_questions').select('id,question_order,prompt')
    ]);
    if (assignmentError || reflectionError) return toast(friendlyError(assignmentError || reflectionError), 'danger');
    const answerMap = new Map((answers || []).map((row) => [row.id, row]));
    const questionMap = new Map((questions || []).map((row) => [row.id, row]));
    const rows = (reflections || []).map((row) => {
      const answer = answerMap.get(row.answer_id);
      const question = answer ? questionMap.get(answer.question_id) : null;
      const heading = row.answer_id ? `${question?.question_order || '-'}. ${question?.prompt || 'รายการทบทวน'}` : 'การทบทวนผลประเมินจากการปฏิบัติจริง';
      return `<div class="card" style="box-shadow:none;border:1px solid var(--line)"><h3>${esc(heading)}</h3><div class="grid cols-3"><div><span class="small muted">เหตุผลหรือปัจจัยที่ทำให้ตอบต่าง/ตอบไม่ถูก</span><p>${esc(row.reason_for_error)}</p></div><div><span class="small muted">ผลการทบทวนและข้อสรุปที่เหมาะสม</span><p>${esc(row.corrected_understanding)}</p></div><div><span class="small muted">การนำไปใช้</span><p>${esc(row.application_to_work)}</p></div></div></div>`;
    }).join('');
    showModal(`ตรวจแบบทบทวน — ${assignment.ec_profiles?.full_name || ''}`, `<div class="notice info">ตรวจว่าผู้รับการประเมินอธิบายเหตุผล ผลการทบทวน และการนำไปใช้ครบถ้วน รวมถึงกรณี Educational ที่ตอบต่างจากกลุ่มส่วนใหญ่</div><div style="height:12px"></div>${rows || empty('ไม่พบแบบทบทวน')}<div class="field"><label>ข้อคิดเห็นผู้ทบทวน</label><textarea class="textarea" id="reflection-review-note"></textarea></div>`, `<button class="btn btn-warning" id="return-reflection">ส่งกลับแก้ไข</button><button class="btn btn-success" id="accept-reflection">รับรองและปิดการประเมิน</button>`, true);
    document.getElementById('return-reflection').addEventListener('click', async () => {
      const note = String(document.getElementById('reflection-review-note').value || '').trim();
      if (!note) return toast('กรุณาระบุเหตุผลที่ส่งกลับ', 'warning');
      const { error } = await state.supabase.rpc('ec_reviewer_decide_reflection', { p_assignment_id: assignmentId, p_decision: 'returned', p_note: note });
      if (error) return toast(friendlyError(error), 'danger');
      closeModal(); toast('ส่งแบบทบทวนกลับให้แก้ไขแล้ว', 'success'); route();
    });
    document.getElementById('accept-reflection').addEventListener('click', async () => {
      const note = String(document.getElementById('reflection-review-note').value || '').trim() || null;
      const { error } = await state.supabase.rpc('ec_reviewer_decide_reflection', { p_assignment_id: assignmentId, p_decision: 'accepted', p_note: note });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: assignmentId, stage: 'final' }, true);
      closeModal(); toast('รับรองแบบทบทวนและปิดการประเมินแล้ว', 'success'); route();
    });
  }

  async function openStaffCompetencyPreview(assignmentId) {
    const { data: assignment, error } = await state.supabase.from('ec_competency_assignments').select('*,ec_profiles(full_name),ec_eqa_rounds(*)').eq('id', assignmentId).single();
    if (error) return toast(friendlyError(error), 'danger');
    const [{ data: questions, error: questionError }, { data: choices, error: choiceError }] = await Promise.all([
      state.supabase.from('ec_questions').select('*').eq('round_id', assignment.round_id).eq('published', true).eq('generated_by_ai', false).is('archived_at', null).order('question_order'),
      state.supabase.from('ec_question_choices').select('*')
    ]);
    if (questionError || choiceError) return toast(friendlyError(questionError || choiceError), 'danger');
    const imageMap = await loadSignedImageMap((questions || []).flatMap((question) => questionImageIds(question)));
    let previousSection = '';
    const html = (questions || []).map((question) => {
      const section = String(question.section || 'แบบประเมิน');
      const divider = section !== previousSection ? `<div class="quiz-section-divider"><span>${esc(section)}</span></div>` : '';
      previousSection = section;
      const questionChoices = (choices || []).filter((choice) => choice.question_id === question.id).sort((a,b) => Number(a.choice_order || 0)-Number(b.choice_order || 0));
      const promptParts = questionPromptParts(question.prompt);
      const input = question.question_type === 'single_choice'
        ? `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice"><input type="radio" disabled><span class="quiz-radio-ui"></span><span>${esc(choice.choice_text)}</span></label>`).join('')}</div>`
        : question.question_type === 'multiple_choice'
          ? `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice"><input type="checkbox" disabled><span class="quiz-checkbox-ui"></span><span>${esc(choice.choice_text)}</span></label>`).join('')}</div>`
          : '<textarea class="textarea quiz-text-answer" disabled placeholder="ช่องคำตอบของเจ้าหน้าที่"></textarea>';
      return `${divider}<article class="quiz-question-card"><div class="quiz-question-head"><span class="quiz-question-number">${question.question_order}</span><div><span class="small muted">${esc(section)}</span><h3>${esc(promptParts.prompt)}</h3></div></div>${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}${questionImageGallery(question, imageMap, 'quiz')}${input}</article>`;
    }).join('');
    showModal(`ตัวอย่างหน้าของ ${assignment.ec_profiles?.full_name || 'เจ้าหน้าที่'}`, `<div class="notice info"><strong>โหมดตัวอย่างเท่านั้น</strong><br>ไม่บันทึกคำตอบและไม่เปลี่ยนบทบาทที่กำลังใช้งาน</div><div class="quiz-form-shell staff-question-set-preview">${html || empty('ยังไม่มีข้อสอบที่เผยแพร่')}</div>`, '<button class="btn btn-primary" data-close-modal>ปิดตัวอย่าง</button>', true);
  }

  function bindCompetencyReview(round) {
    document.querySelectorAll('[data-review-competency]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.type === 'practical') openPracticalReview(button.dataset.reviewCompetency);
      else openQuizReview(button.dataset.reviewCompetency);
    }));
    document.querySelectorAll('[data-review-reflection]').forEach((button) => button.addEventListener('click', () => openReflectionReview(button.dataset.reviewReflection)));
    document.querySelectorAll('[data-qm-approve-competency]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('หมายเหตุผู้รับรองคุณภาพ (เว้นว่างได้)') || '';
      const { data, error } = await state.supabase.rpc('ec_qm_decide_competency', { p_assignment_id: button.dataset.qmApproveCompetency, p_decision: 'approved', p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: button.dataset.qmApproveCompetency, stage: data?.status === 'passed' ? 'certified' : 'certified' }, true);
      toast(data?.status === 'needs_reflection' ? 'รับรองผลแล้ว และส่งให้เจ้าหน้าที่ทำแบบทบทวน' : 'ผู้รับรองคุณภาพรับรองผลแล้ว', 'success'); route();
    }));
    document.querySelectorAll('[data-qm-return-competency]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('กรุณาระบุเหตุผลที่ส่งกลับผู้ทบทวน');
      if (!note) return;
      const { error } = await state.supabase.rpc('ec_qm_decide_competency', { p_assignment_id: button.dataset.qmReturnCompetency, p_decision: 'returned', p_note: note });
      if (error) return toast(friendlyError(error), 'danger');
      toast('ส่งกลับผู้ทบทวนแล้ว', 'success'); route();
    }));
  }

  async function renderMyCompetency() {
    if (!isCompetencyParticipant()) {
      const content = `<section class="page my-competency-page"><div class="page-header"><div><h1>งานของฉัน</h1></div></div><div class="notice">บัญชีนี้ไม่มีงานสำหรับบทบาทเจ้าหน้าที่</div></section>`;
      appEl.innerHTML = shell(content, 'งานของฉัน');
      bindShell();
      return;
    }

    const [competencyRes, practitionerRes, individualRes, confirmationRes] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(*)').eq('user_id', state.user.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
      state.supabase.from('ec_round_assignments').select('*, ec_eqa_rounds(*)').eq('user_id', state.user.id).eq('assignment_role', 'practitioner').eq('active', true).order('assigned_at', { ascending: false }),
      state.supabase.from('ec_individual_results').select('*').eq('user_id', state.user.id),
      state.supabase.from('ec_historical_result_confirmations').select('*').eq('user_id', state.user.id)
    ]);
    const firstError = competencyRes.error || practitionerRes.error || individualRes.error || confirmationRes.error;
    if (firstError) return renderError(firstError);

    const practitionerRows = practitionerRes.data || [];
    const practitionerRoundIds = new Set(practitionerRows.map((row) => row.round_id));
    const individualMap = new Map((individualRes.data || []).map((row) => [row.round_id, row]));
    const confirmationMap = new Map((confirmationRes.data || []).map((row) => [row.round_id, row]));
    const competencyAssignments = (competencyRes.data || []).filter((assignment) => !practitionerRoundIds.has(assignment.round_id));

    const practicalCards = practitionerRows.map((assignment) => {
      const round = assignment.ec_eqa_rounds || {};
      const result = individualMap.get(assignment.round_id);
      const confirmation = confirmationMap.get(assignment.round_id);
      const historical = isHistoricalRound(round);
      let badge = '<span class="badge info">รอเริ่ม</span>';
      let actionLabel = 'กรอกผลการปฏิบัติจริง';
      let disabled = false;
      let detail = '';

      if (historical) {
        if (!result) {
          badge = '<span class="badge warning">ยังไม่บันทึกย้อนหลัง</span>';
          actionLabel = 'กรอกผลย้อนหลังของฉัน';
          detail = '<div class="notice info small">กรอกตามผลและหลักฐานเดิม พร้อมระบุวันเวลาปฏิบัติจริงและวันเวลาที่ส่งให้แพทย์</div>';
        } else if (result.status === 'draft') {
          badge = '<span class="badge info">มีร่างย้อนหลัง</span>';
          actionLabel = 'ทำต่อ';
        } else if (round.historical_review_status === 'awaiting_practitioner_confirmation' && !confirmation && result.entry_mode === 'entered_on_behalf') {
          badge = '<span class="badge warning">รอคุณยืนยัน</span>';
          actionLabel = 'ตรวจและยืนยันข้อมูลย้อนหลัง';
        } else if (confirmation?.decision === 'disputed') {
          badge = '<span class="badge danger">แจ้งข้อมูลไม่ตรง</span>';
          actionLabel = 'เปิดดูรายละเอียด';
        } else if (confirmation?.decision === 'confirmed') {
          badge = '<span class="badge success">ยืนยันแล้ว</span>';
          actionLabel = 'เปิดดูข้อมูล';
        } else {
          badge = `<span class="badge info">${esc(labelFrom(RESULT_STATUS_LABELS, result.status))}</span>`;
          actionLabel = 'เปิดดูข้อมูล';
        }
      } else if (!result) {
        badge = '<span class="badge info">ยังไม่เริ่ม</span>';
      } else if (result.status === 'draft' || result.status === 'returned') {
        badge = result.status === 'returned'
          ? '<span class="badge danger">ส่งกลับแก้ไข</span>'
          : `<span class="badge info">${esc(labelFrom(RESULT_STATUS_LABELS, result.status))}</span>`;
        actionLabel = result.status === 'returned' ? 'แก้เฉพาะหัวข้อที่ส่งกลับ' : 'ทำต่อ';
        if (result.status === 'returned') {
          const returnedSections = Array.isArray(result.correction_scope?.sections) ? result.correction_scope.sections : [];
          const sectionNames = { specimen: 'ผลตัวอย่าง/การอ่านปฏิกิริยา', method: 'วิธีทดสอบและผู้ผลิต', antigen: 'Antigen typing', general: 'ข้อมูลทั่วไป', evidence: 'รูปหรือหลักฐาน' };
          detail = `<div class="correction-card-note"><strong>ผู้ทบทวนส่งกลับ:</strong> ${esc(result.reviewer_note || 'กรุณาแก้หัวข้อที่เปิดให้แก้')}<br><span class="small">แก้ได้เฉพาะ: ${esc(returnedSections.map((key) => sectionNames[key] || key).join(', ') || 'หัวข้อที่ผู้ทบทวนเลือก')}</span></div>`;
        }
      } else {
        badge = `<span class="badge success">${esc(labelFrom(RESULT_STATUS_LABELS, result.status))}</span>`;
        actionLabel = 'เปิดดูผลที่ส่ง';
      }

      const performedText = result?.performed_date
        ? `${fmtDate(result.performed_date)}${result.performed_time_known === false ? ' · ไม่ทราบเวลา' : result.performed_time ? ` · ${String(result.performed_time).slice(0,5)} น.` : ''}`
        : result?.performed_at ? fmtDate(result.performed_at, true) : '-';
      const sentPhysicianText = result?.sent_to_physician_date
        ? `${fmtDate(result.sent_to_physician_date)}${result.sent_to_physician_time_known === false ? ' · ไม่ทราบเวลา' : result.sent_to_physician_time ? ` · ${String(result.sent_to_physician_time).slice(0,5)} น.` : ''}`
        : '-';

      return `<article class="my-competency-card my-work-practical-card">
        <div class="my-competency-card-head">
          <div><span class="my-work-kicker">หัวข้อ 4 · ผู้ปฏิบัติจริง คนที่ ${assignment.practitioner_slot || '-'}</span><h2>${esc(round.provider || '')} ${esc(round.round_code || '')}</h2><div class="my-competency-type">บันทึกผลจากการปฏิบัติจริง</div></div>
          ${badge}
        </div>
        <div class="my-competency-meta">
          <div><span>วันครบกำหนดรอบ</span><strong>${fmtDate(round.due_date)}</strong></div>
          <div><span>วันที่ปฏิบัติจริง</span><strong>${performedText}</strong></div>
          ${historical ? `<div><span>วันที่ส่งให้แพทย์</span><strong>${sentPhysicianText}</strong></div>` : ''}
        </div>
        ${detail}
        <button class="btn btn-primary my-competency-open" data-open-practitioner-round="${assignment.round_id}" ${disabled ? 'disabled' : ''}>${actionLabel}</button>
      </article>`;
    }).join('');

    const competencyCards = competencyAssignments.map((a) => {
      const closeAt = a.ec_eqa_rounds?.competency_close_at;
      const expired = closeAt && new Date(closeAt).getTime() < Date.now() && ['not_started','in_progress'].includes(a.status);
      const typeText = a.assignment_type === 'quiz' ? 'แบบประเมินที่แอดมินจัดคำถามและผูกรูปเอง' : labelFrom(COMPETENCY_TYPE_LABELS, a.assignment_type);
      const correctionQuestionIds = Array.isArray(a.correction_scope?.question_ids) ? a.correction_scope.question_ids : [];
      return `<article class="my-competency-card">
        <div class="my-competency-card-head">
          <div><span class="my-work-kicker">หัวข้อ 10 · การประเมินความสามารถ</span><h2>${esc(a.ec_eqa_rounds?.provider || '')} ${esc(a.ec_eqa_rounds?.round_code || '')}</h2><div class="my-competency-type">${esc(typeText)}</div></div>
          ${a.correction_required ? '<span class="badge danger">ส่งกลับแก้ไข</span>' : assignmentBadge(a.status)}
        </div>
        <div class="my-competency-meta">
          <div><span>ปิดรับคำตอบ</span><strong>${closeAt ? fmtDate(closeAt, true) : '-'}</strong></div>
          <div><span>คะแนน</span><strong>${a.score ?? '-'}</strong></div>
        </div>
        ${a.correction_required ? `<div class="correction-card-note"><strong>ผู้ทบทวนส่งกลับ ${correctionQuestionIds.length || ''} ข้อ</strong><br>${esc(a.correction_note || 'กรุณาแก้เฉพาะข้อที่เปิดให้แก้')}</div>` : ''}
        ${expired ? '<div class="notice danger small">ปิดรับคำตอบแล้ว</div>' : ''}
        <button class="btn btn-primary my-competency-open" data-open-assignment="${a.id}" ${expired ? 'disabled' : ''}>${a.correction_required ? 'แก้เฉพาะข้อที่ส่งกลับ' : a.status === 'in_progress' ? 'ทำต่อ' : a.status === 'not_started' ? 'เริ่มทำ' : 'เปิดดูผล'}</button>
      </article>`;
    }).join('');

    const hasWork = practitionerRows.length || competencyAssignments.length;
    const content = `<section class="page my-competency-page">
      <div class="page-header"><div><h1>งานของฉัน</h1><p>รวมงานที่ต้องทำจากหัวข้อ 4 และหัวข้อ 10 ไว้หน้าเดียว</p></div></div>
      ${practitionerRows.length ? `<section class="my-work-section"><div class="my-work-section-head"><h2>งานจากการปฏิบัติจริง</h2><span class="badge info">หัวข้อ 4</span></div><div class="my-competency-list">${practicalCards}</div></section>` : ''}
      ${competencyAssignments.length ? `<section class="my-work-section"><div class="my-work-section-head"><h2>การประเมินความสามารถ</h2><span class="badge info">หัวข้อ 10</span></div><div class="my-competency-list">${competencyCards}</div></section>` : ''}
      ${hasWork ? '' : empty('ยังไม่มีงานที่ได้รับมอบหมาย')}
    </section>`;
    appEl.innerHTML = shell(content, 'งานของฉัน');
    bindShell();
    document.querySelectorAll('[data-open-practitioner-round]:not([disabled])').forEach((button) => button.addEventListener('click', () => navigate(`round/${button.dataset.openPractitionerRound}/individual`)));
    document.querySelectorAll('[data-open-assignment]:not([disabled])').forEach((button) => button.addEventListener('click', () => navigate(`assignment/${button.dataset.openAssignment}`)));
  }

  async function renderAssignment(id) {
    const assignedStaff = hasAssignedRole('staff') && !hasAssignedRole('physician');
    if (!assignedStaff) return navigate('dashboard');

    const { data: assignment, error } = await state.supabase.from('ec_competency_assignments').select('*,ec_eqa_rounds(*)').eq('id', id).eq('user_id', state.user.id).single();
    if (error) return renderError(error);
    const { data: competencyEvidenceRows, error: competencyEvidenceError } = await state.supabase.from('ec_work_evidence')
      .select('*').eq('competency_assignment_id', id).eq('context_type', 'competency').is('archived_at', null).order('created_at', { ascending: false });
    if (competencyEvidenceError) return renderError(competencyEvidenceError);

    state.currentRound = assignment.ec_eqa_rounds;
    await loadRoundInstructionExtractions(assignment.round_id);

    const { data: practitionerLink, error: practitionerLinkError } = await state.supabase.from('ec_round_assignments')
      .select('id').eq('round_id', assignment.round_id).eq('user_id', state.user.id).eq('assignment_role', 'practitioner').eq('active', true).maybeSingle();
    if (practitionerLinkError) return renderError(practitionerLinkError);
    if (practitionerLink) {
      const content = `<section class="page"><div class="page-header"><div><h1>ไม่ต้องทำหัวข้อ 10</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><button class="btn btn-outline" id="back-my">กลับ</button></div><div class="notice success"><strong>คุณเป็นผู้ปฏิบัติจริงของรอบนี้</strong><br>ระบบใช้ผลรายบุคคลในหัวข้อ 4 เป็นการประเมินแล้ว จึงไม่ต้องทำ Competency ซ้ำในหัวข้อ 10</div></section>`;
      appEl.innerHTML = shell(content, 'การประเมินของฉัน');
      bindShell();
      document.getElementById('back-my').onclick = () => navigate('my-competency');
      return;
    }

    const openAt = assignment.ec_eqa_rounds?.competency_open_at;
    const closeAt = assignment.ec_eqa_rounds?.competency_close_at;
    const notOpened = openAt && new Date(openAt).getTime() > Date.now();
    const deadlinePassed = closeAt && new Date(closeAt).getTime() < Date.now();
    const windowNotice = notOpened
      ? `<div class="notice warning">การประเมินจะเปิดวันที่ ${fmtDate(openAt, true)}</div>`
      : deadlinePassed
        ? `<div class="notice danger">ปิดรับคำตอบเมื่อ ${fmtDate(closeAt, true)} แล้ว กรุณาติดต่อผู้จัดการคุณภาพหากต้องขยายเวลา</div>`
        : closeAt ? `<div class="notice info">กรุณาส่งคำตอบภายใน ${fmtDate(closeAt, true)}</div>` : '';

    if (assignment.assignment_type === 'practical') {
      const content = `<section class="page">
        <div class="page-header"><div><h1>การประเมินจากการปฏิบัติจริง</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${assignmentBadge(assignment.status)}<button class="btn btn-outline" id="back-my">กลับ</button></div></div>
        ${windowNotice}<div style="height:12px"></div>
        <div class="card"><h2>ผลการปฏิบัติจริงอยู่ในหัวข้อ 4</h2><p class="muted">เปิดรอบ EQA เพื่อดูหรือแก้ผลรายบุคคลตามรายการที่ผู้ทบทวนส่งกลับ</p>${assignment.reviewer_note ? `<div class="notice warning"><strong>หมายเหตุผู้ทบทวน:</strong> ${esc(assignment.reviewer_note)}</div>` : ''}<button class="btn btn-primary" id="open-round-practical">เปิดผลรายบุคคล</button></div>
        <div style="height:16px"></div>${workEvidencePanelHtml('competency-assignment', competencyEvidenceRows || [], ['not_started','in_progress'].includes(assignment.status) && !deadlinePassed && !notOpened)}
      </section>`;
      appEl.innerHTML = shell(content, 'การประเมินจากการปฏิบัติจริง');
      bindShell();
      bindWorkEvidencePanel('competency-assignment', { roundId: assignment.round_id, contextType: 'competency', assignmentId: id });
      document.getElementById('back-my').onclick = () => navigate('my-competency');
      document.getElementById('open-round-practical').onclick = () => navigate(`round/${assignment.round_id}/individual`);
      return;
    }

    const [
      { data: questions, error: questionError },
      { data: choices, error: choiceError },
      { data: answers, error: answerError }
    ] = await Promise.all([
      state.supabase.from('ec_questions').select('id,round_id,question_order,section,question_type,prompt,image_document_id,ai_source_document_ids,points,is_critical,published,generated_by_ai')
        .eq('round_id', assignment.round_id).eq('published', true).eq('generated_by_ai', false).is('archived_at', null).order('question_order'),
      state.supabase.from('ec_question_choices_public').select('*'),
      state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', id)
    ]);
    if (questionError || choiceError || answerError) return renderError(questionError || choiceError || answerError);

    const imageMap = await loadSignedImageMap((questions || []).flatMap((question) => questionImageIds(question)));
    const answerMap = new Map((answers || []).map((answer) => [answer.question_id, answer]));
    const correctionRequired = Boolean(assignment.correction_required);
    const correctionQuestionIds = new Set(Array.isArray(assignment.correction_scope?.question_ids) ? assignment.correction_scope.question_ids.map(String) : []);
    const baseEditable = ['not_started','in_progress'].includes(assignment.status) && !deadlinePassed && !notOpened;
    const canEditQuestion = (question) => baseEditable && (!correctionRequired || correctionQuestionIds.has(String(question.id)));

    let releasedReview = null;
    if (!baseEditable && assignment.ec_eqa_rounds?.answer_released_at) {
      const { data: reviewData, error: reviewError } = await state.supabase.rpc('ec_get_my_competency_review', { p_assignment_id: id });
      if (!reviewError) releasedReview = reviewData;
    }

    let reflections = [];
    if (['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)) {
      const { data: reflectionData, error: reflectionError } = await state.supabase.from('ec_reflections').select('*').eq('assignment_id', id).order('created_at');
      if (!reflectionError) reflections = reflectionData || [];
    }

    let previousSection = '';
    const questionHtml = (questions || []).map((question) => {
      const answerPayload = answerMap.get(question.id)?.answer_payload || {};
      const questionChoices = (choices || []).filter((choice) => choice.question_id === question.id).sort((a,b) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
      const questionEditable = canEditQuestion(question);
      const lockedByCorrection = correctionRequired && !correctionQuestionIds.has(String(question.id));
      const galleryHtml = questionImageGallery(question, imageMap, 'quiz');
      const promptParts = questionPromptParts(question.prompt);
      const section = String(question.section || 'แบบประเมิน');
      const sectionDivider = section !== previousSection ? `<div class="quiz-section-divider"><span>${esc(section)}</span></div>` : '';
      previousSection = section;
      let input = '';
      if (isAntibodyIdentificationQuestion(question) && question.question_type !== 'single_choice') {
        input = quizAntibodyPicker(question, answerPayload.text || '', questionEditable);
      } else if (question.question_type === 'single_choice') {
        input = `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice ${questionEditable ? '' : 'disabled'}">
          <input type="radio" name="q_${question.id}" value="${choice.id}" ${answerPayload.choice_id === choice.id ? 'checked' : ''} ${questionEditable ? '' : 'disabled'}>
          <span class="quiz-radio-ui"></span><span>${esc(choice.choice_text)}</span>
        </label>`).join('')}</div>`;
      } else if (question.question_type === 'multiple_choice') {
        const selectedIds = new Set(Array.isArray(answerPayload.choice_ids) ? answerPayload.choice_ids.map(String) : []);
        input = `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice ${questionEditable ? '' : 'disabled'}">
          <input type="checkbox" name="q_${question.id}" value="${choice.id}" ${selectedIds.has(String(choice.id)) ? 'checked' : ''} ${questionEditable ? '' : 'disabled'}>
          <span class="quiz-checkbox-ui"></span><span>${esc(choice.choice_text)}</span>
        </label>`).join('')}</div>`;
      } else {
        input = `<textarea class="textarea quiz-text-answer" name="q_${question.id}" ${questionEditable ? '' : 'disabled'} placeholder="พิมพ์คำตอบของคุณ">${esc(answerPayload.text || '')}</textarea>`;
      }
      return `${sectionDivider}<article class="quiz-question-card ${lockedByCorrection ? 'question-locked-after-review' : ''}" data-question-id="${question.id}" data-question-editable="${questionEditable ? '1' : '0'}">
        <div class="quiz-question-head">
          <span class="quiz-question-number">${question.question_order}</span>
          <div><span class="small muted">${esc(section)}</span><h3>${esc(promptParts.prompt)}</h3></div>
          ${lockedByCorrection ? '<span class="badge success">ผ่านแล้ว · ล็อกไว้</span>' : question.is_critical ? '<span class="badge danger">ข้อสำคัญ</span>' : ''}
        </div>
        ${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}
        ${galleryHtml}
        ${input}
      </article>`;
    }).join('');

    const correctionBanner = correctionRequired ? `<div class="notice warning correction-banner"><strong>ผู้ทบทวนส่งกลับให้แก้ ${correctionQuestionIds.size} ข้อ</strong><br>${esc(assignment.correction_note || 'กรุณาแก้เฉพาะข้อที่เปิดให้แก้ แล้วส่งกลับตรวจอีกครั้ง')}<div class="small" style="margin-top:6px">ข้อที่ผ่านแล้วถูกล็อกเพื่อป้องกันการแก้คำตอบส่วนอื่นโดยไม่ตั้งใจ</div></div>` : '';

    const reviewQuestions = Array.isArray(releasedReview?.questions) ? releasedReview.questions : [];
    const releasedReviewHtml = releasedReview ? `<div style="height:16px"></div><div class="card"><div class="card-header"><h2>ผลเปรียบเทียบและเฉลยหลังส่งคำตอบ</h2>${releasedReview?.score === null || releasedReview?.score === undefined ? '' : `<span class="badge info">คะแนน ${esc(releasedReview.score)}%</span>`}</div>${reviewQuestions.map((item) => {
      const [statusLabel, statusClass] = competencyReviewStatus(item);
      const comparisonText = [item.consensus_result, item.consensus_percent].filter(Boolean).join(' · ') || item.correct_answer || '-';
      return `<div class="answer-review-row"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${item.question_order}. ${esc(item.prompt || '')}</strong><span class="badge ${esc(statusClass)}">${esc(statusLabel)}</span></div><div class="grid cols-2"><div><span class="small muted">คำตอบของคุณ</span><div>${esc(item.user_answer || '-')}</div></div><div><span class="small muted">เฉลย/คำตอบอ้างอิง</span><div>${esc(comparisonText)}</div></div></div>${item.comparison_note ? `<div class="small"><strong>ข้อคิดเห็น:</strong> ${esc(item.comparison_note)}</div>` : ''}</div>`;
    }).join('')}</div>` : '';

    const reflectionMap = new Map((reflections || []).map((row) => [row.answer_id, row]));
    const incorrectReviewQuestions = reviewQuestions.filter((item) => item.is_correct === false);
    const reflectionEditable = assignment.status === 'needs_reflection';
    const reflectionHtml = ['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)
      ? `<div style="height:16px"></div><div class="card"><div class="card-header"><h2>แบบทบทวนและชี้แจง</h2>${assignmentBadge(assignment.status)}</div>${!releasedReview ? '<div class="notice warning">ผู้จัดการคุณภาพยังไม่ได้เปิดผล</div>' : incorrectReviewQuestions.map((item) => {
          const answer = answerMap.get(item.question_id);
          const reflection = answer ? reflectionMap.get(answer.id) : null;
          return `<div class="reflection-item" data-reflection-answer="${answer?.id || ''}"><h3>${item.question_order}. ${esc(item.prompt || '')}</h3><div class="form-grid"><div class="field"><label>สาเหตุที่ตอบไม่ถูก</label><textarea class="textarea" data-reflection-field="reason_for_error" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.reason_for_error || '')}</textarea></div><div class="field"><label>ความเข้าใจที่ถูกต้องหลังทบทวน</label><textarea class="textarea" data-reflection-field="corrected_understanding" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.corrected_understanding || '')}</textarea></div><div class="field"><label>สิ่งที่จะนำไปใช้กับงานจริง</label><textarea class="textarea" data-reflection-field="application_to_work" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.application_to_work || '')}</textarea></div></div></div>`;
        }).join('')}${reflectionEditable && releasedReview ? '<div class="modal-footer"><button class="btn btn-primary" id="submit-reflection">ส่งแบบทบทวน</button></div>' : ''}</div>` : '';

    const answeredCount = (questions || []).filter((question) => {
      const payload = answerMap.get(question.id)?.answer_payload || {};
      return Boolean(payload.choice_id || (Array.isArray(payload.choice_ids) && payload.choice_ids.length) || payload.text);
    }).length;

    const content = `<section class="page quiz-page">
      <div class="page-header"><div><h1>แบบทดสอบ EQA Competency</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${correctionRequired ? '<span class="badge danger">ส่งกลับแก้ไข</span>' : assignmentBadge(assignment.status)}<button class="btn btn-outline" id="back-my">กลับ</button></div></div>
      ${windowNotice}${correctionBanner}<div style="height:12px"></div>
      <div class="quiz-intro-card"><div><span class="eyebrow">แบบประเมินที่แอดมินจัดเอง</span><h2>ตอบคำถามทีละข้อจากรูปและข้อมูลประกอบ</h2><p>รูปแต่ละรูปผูกกับคำถามโดยตรงเหมือน Microsoft Forms</p></div><div class="quiz-progress-box"><strong>${answeredCount}/${(questions || []).length}</strong><span>ข้อที่บันทึกแล้ว</span></div></div>
      <form id="quiz-form" class="quiz-form-shell">${questionHtml || empty('ยังไม่มีข้อสอบที่เผยแพร่')}</form>
      <div style="height:16px"></div>${workEvidencePanelHtml('competency-assignment', competencyEvidenceRows || [], baseEditable)}
      ${baseEditable && questions?.length ? `<div class="quiz-submit-bar"><button class="btn btn-secondary" id="save-quiz">บันทึกร่าง</button><button class="btn btn-primary" id="submit-quiz">${correctionRequired ? 'ส่งกลับตรวจอีกครั้ง' : 'ยืนยันและส่งคำตอบ'}</button></div>` : ''}
      ${releasedReviewHtml}${reflectionHtml}
    </section>`;

    appEl.innerHTML = shell(content, 'แบบทดสอบ');
    bindShell();
    bindWorkEvidencePanel('competency-assignment', { roundId: assignment.round_id, contextType: 'competency', assignmentId: id });

    const updateQuizProgress = () => {
      const count = (questions || []).filter((question) => {
        if (question.question_type === 'single_choice') return Boolean(document.querySelector(`input[name="q_${question.id}"]:checked`));
        if (question.question_type === 'multiple_choice') return document.querySelectorAll(`input[name="q_${question.id}"]:checked`).length > 0;
        return Boolean(String(document.querySelector(`[name="q_${question.id}"]`)?.value || '').trim());
      }).length;
      const progress = document.querySelector('.quiz-progress-box strong');
      if (progress) progress.textContent = `${count}/${(questions || []).length}`;
    };

    document.querySelectorAll('[data-antibody-picker]').forEach((picker) => {
      const search = picker.querySelector('[data-antibody-search]');
      const selected = picker.querySelector('[data-antibody-selected]');
      const hidden = picker.querySelector('input[type="hidden"]');
      const sync = () => {
        const values = [...selected.querySelectorAll('[data-antibody-value]')].map((chip) => chip.dataset.antibodyValue).filter(Boolean);
        hidden.value = values.join('; ');
        if (!values.length && !selected.querySelector('[data-antibody-empty]')) selected.innerHTML = '<span class="small muted" data-antibody-empty>ยังไม่ได้เลือก antibody</span>';
        updateQuizProgress();
      };
      const addValue = () => {
        if (search?.disabled) return;
        const typed = String(search?.value || '').trim();
        if (!typed) return;
        const value = resolveCapAntibodyEntry(typed);
        if (!value) return toast('กรุณาเลือกชื่อ antibody จาก CAP Master List', 'warning');
        if ([...selected.querySelectorAll('[data-antibody-value]')].some((chip) => chip.dataset.antibodyValue === value)) { search.value = ''; return; }
        selected.querySelector('[data-antibody-empty]')?.remove();
        selected.insertAdjacentHTML('beforeend', `<span class="antibody-chip" data-antibody-value="${esc(value)}"><span>${esc(value)}</span><button type="button" data-remove-antibody aria-label="ลบ">×</button></span>`);
        search.value = '';
        sync();
      };
      picker.querySelector('[data-add-antibody]')?.addEventListener('click', addValue);
      search?.addEventListener('change', addValue);
      search?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addValue(); } });
      selected?.addEventListener('click', (event) => {
        if (hidden?.disabled) return;
        const remove = event.target.closest('[data-remove-antibody]');
        if (!remove) return;
        remove.closest('[data-antibody-value]')?.remove();
        sync();
      });
      sync();
    });
    document.querySelectorAll('#quiz-form input, #quiz-form textarea, #quiz-form select').forEach((control) => {
      control.addEventListener('change', updateQuizProgress);
      control.addEventListener('input', updateQuizProgress);
    });
    updateQuizProgress();

    document.getElementById('back-my').onclick = () => navigate('my-competency');

    document.getElementById('submit-reflection')?.addEventListener('click', async () => {
      const items = [...document.querySelectorAll('[data-reflection-answer]')].map((card) => ({
        answer_id: card.dataset.reflectionAnswer,
        reason_for_error: String(card.querySelector('[data-reflection-field="reason_for_error"]')?.value || '').trim(),
        corrected_understanding: String(card.querySelector('[data-reflection-field="corrected_understanding"]')?.value || '').trim(),
        application_to_work: String(card.querySelector('[data-reflection-field="application_to_work"]')?.value || '').trim()
      }));
      if (!items.length || items.some((item) => !item.answer_id || !item.reason_for_error || !item.corrected_understanding || !item.application_to_work)) return toast('กรุณากรอกแบบทบทวนให้ครบทุกช่อง', 'warning');
      if (!confirm('ยืนยันส่งแบบทบทวนให้ผู้ทบทวนตรวจหรือไม่')) return;
      const { error: reflectionError } = await state.supabase.rpc('ec_submit_reflection', { p_assignment_id: id, p_items: items });
      if (reflectionError) return toast(friendlyError(reflectionError), 'danger');
      toast('ส่งแบบทบทวนแล้ว', 'success');
      route();
    });

    if (baseEditable) {
      const startResult = await state.supabase.rpc('ec_start_competency', { p_assignment_id: id });
      if (startResult.error) toast(friendlyError(startResult.error), 'danger');

      const save = async () => {
        const rows = [];
        (questions || []).filter(canEditQuestion).forEach((question) => {
          let answerPayload = {};
          if (question.question_type === 'single_choice') {
            const checked = document.querySelector(`input[name="q_${question.id}"]:checked`);
            answerPayload = checked ? { choice_id: checked.value } : {};
          } else if (question.question_type === 'multiple_choice') {
            const choiceIds = [...document.querySelectorAll(`input[name="q_${question.id}"]:checked`)].map((control) => control.value);
            answerPayload = choiceIds.length ? { choice_ids: choiceIds } : {};
          } else {
            answerPayload = { text: String(document.querySelector(`[name="q_${question.id}"]`)?.value || '').trim() };
          }
          rows.push({ assignment_id: id, question_id: question.id, answer_payload: answerPayload });
        });
        if (!rows.length) throw new Error('ไม่มีข้อที่เปิดให้แก้');
        const { error: saveError } = await state.supabase.from('ec_competency_answers').upsert(rows, { onConflict: 'assignment_id,question_id' });
        if (saveError) throw saveError;
      };

      document.getElementById('save-quiz')?.addEventListener('click', async () => {
        try { await save(); toast('บันทึกร่างแล้ว', 'success'); } catch (saveError) { toast(friendlyError(saveError), 'danger'); }
      });
      document.getElementById('submit-quiz')?.addEventListener('click', async () => {
        const message = correctionRequired ? 'ยืนยันส่งข้อที่แก้กลับให้ผู้ทบทวนตรวจอีกครั้งหรือไม่' : 'ยืนยันส่งคำตอบหรือไม่ หลังส่งจะแก้ไขเองไม่ได้';
        if (!confirm(message)) return;
        try {
          await save();
          const { error: submitError } = await state.supabase.rpc('ec_submit_competency', { p_assignment_id: id });
          if (submitError) throw submitError;
          toast(correctionRequired ? 'ส่งกลับตรวจอีกครั้งแล้ว' : 'ส่งคำตอบแล้ว', 'success');
          navigate('my-competency');
        } catch (submitError) {
          toast(friendlyError(submitError), 'danger');
        }
      });
    }
  }
  async function renderReports() {
    const content = `<section class="page report-redesign-page">
      <div class="page-header"><div><h1>รายงาน / ทะเบียน EQA</h1></div></div>
      <div class="card report-redesign-card">
        <div class="report-redesign-icon" aria-hidden="true">▤</div>
        <div>
          <h2>อยู่ระหว่างปรับรูปแบบเอกสารคุณภาพใหม่</h2>
          <p>ปิดระบบพิมพ์ PDF และทะเบียนไฟล์รุ่นเดิมชั่วคราว เพื่อออกแบบรายงานให้เป็นระเบียบและเหมาะกับการตรวจประเมิน</p>
          <div class="notice success"><strong>ข้อมูลรอบ EQA ผลการปฏิบัติงาน การทบทวน การรับรอง และ Audit Log ยังจัดเก็บตามปกติ</strong><br>การปิดส่วนนี้ไม่ลบข้อมูลการทำงานของบุคลากร</div>
        </div>
      </div>
    </section>`;
    appEl.innerHTML = shell(content, 'รายงาน');
    bindShell();
  }

  function parseDayList(value, fallback = []) {
    const values = String(value || '').split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 0 && item <= 365);
    return values.length ? [...new Set(values)] : fallback;
  }

  async function renderAutomation() {
    if (!hasRole('admin') && !canManage()) {
      const content = `<section class="page"><div class="page-header"><div><h1>แจ้งเตือน</h1></div></div><div class="notice warning">หน้านี้ตั้งค่าได้เฉพาะโหมดผู้ดูแลระบบหรือผู้จัดการคุณภาพ กรุณาเปลี่ยนบทบาทจากเมนูด้านซ้าย</div></section>`;
      appEl.innerHTML = shell(content, 'แจ้งเตือน'); bindShell(); return;
    }
    const [{ data: settings, error: settingsError }, { data: logs, error: logError }] = await Promise.all([
      state.supabase.from('ec_notification_settings').select('*').eq('id', 1).single(),
      state.supabase.from('ec_notification_logs').select('*').order('created_at', { ascending: false }).limit(50)
    ]);
    if (settingsError || logError) return renderError(settingsError || logError);
    const categoryLabel = {
      eqa_due: 'EQA ใกล้ครบกำหนด', competency_due: 'Competency ใกล้ครบกำหนด', reflection_due: 'แบบทบทวนใกล้ครบกำหนด',
      reviewer_pending: 'รอผู้ทบทวน', qm_pending: 'รอผู้รับรองคุณภาพ', reflection_review_pending: 'รอตรวจแบบทบทวน',
      daily_chat_summary: 'สรุปรายวัน', system_test: 'ทดสอบระบบ'
    };
    const channelLabel = { email: 'Email', google_chat: 'Google Chat' };
    const logBadge = (status) => `<span class="badge ${status === 'sent' ? 'success' : status === 'failed' ? 'danger' : status === 'skipped' ? '' : 'warning'}">${esc({ sent: 'ส่งสำเร็จ', failed: 'ส่งไม่สำเร็จ', pending: 'กำลังส่ง', skipped: 'ข้าม' }[status] || status || '-')}</span>`;
    const content = `<section class="page">
      <div class="page-header"><div><h1>แจ้งเตือน</h1><p>ติดตาม EQA, Competency, Reflection, Reviewer และผู้รับรองคุณภาพ</p></div><div class="header-actions"><button class="btn btn-outline" id="automation-health">ตรวจการเชื่อมต่อ</button><button class="btn btn-secondary" id="automation-test">ส่งข้อความทดสอบ</button><button class="btn btn-primary" id="automation-run">ตรวจและส่งตอนนี้</button></div></div>
      <div id="automation-result"></div>
      <div class="grid cols-2 automation-grid">
        <div class="card">
          <div class="card-header"><div><h2>เปิด–ปิดการทำงาน</h2><div class="small muted">ค่าตั้งนี้ใช้กับการตรวจอัตโนมัติทุกวัน</div></div></div>
          <form id="automation-settings-form" class="form-grid">
            <label class="toggle-row"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}><span><strong>เปิดระบบแจ้งเตือน</strong><small>ปิดไว้ได้ชั่วคราวโดยไม่ลบ Trigger</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="send_email" ${settings.send_email ? 'checked' : ''}><span><strong>ส่ง Email</strong><small>ส่งถึงผู้รับผิดชอบตามขั้นตอน</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="send_google_chat" ${settings.send_google_chat ? 'checked' : ''}><span><strong>ส่ง Google Chat</strong><small>ส่งภาพรวมเข้าห้องหน่วยงาน</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="chat_include_person_names" ${settings.chat_include_person_names ? 'checked' : ''}><span><strong>แสดงชื่อบุคลากรใน Google Chat</strong><small>แนะนำให้ปิด เพื่อคงความเป็นส่วนตัวของผลประเมินรายบุคคล</small></span></label>
            <div class="field"><label>ลิงก์หน้าเว็บ</label><input class="input" name="app_url" type="url" value="${esc(settings.app_url || cfg.DEFAULT_DOMAIN || '')}" required></div>
            <div class="field"><label>เขตเวลา</label><input class="input" name="timezone" value="${esc(settings.timezone || 'Asia/Bangkok')}" required></div>
            <button class="btn btn-primary" type="submit">บันทึกการตั้งค่า</button>
          </form>
        </div>
        <div class="card">
          <div class="card-header"><div><h2>ระยะเวลาแจ้งเตือน</h2><div class="small muted">กรอกหลายวันโดยคั่นด้วยเครื่องหมายจุลภาค</div></div></div>
          <form id="automation-days-form" class="form-grid cols-2">
            <div class="field"><label>EQA ก่อนครบกำหนด</label><input class="input" name="eqa_before_days" value="${esc((settings.eqa_before_days || [7,3,1,0]).join(', '))}"><small>เช่น 7, 3, 1, 0</small></div>
            <div class="field"><label>Competency ก่อนครบกำหนด</label><input class="input" name="competency_before_days" value="${esc((settings.competency_before_days || [7,3,1,0]).join(', '))}"></div>
            <div class="field"><label>Reflection ก่อนครบกำหนด</label><input class="input" name="reflection_before_days" value="${esc((settings.reflection_before_days || [3,1,0]).join(', '))}"></div>
            <div class="field"><label>แจ้งเมื่อเลยกำหนด</label><input class="input" name="overdue_days" value="${esc((settings.overdue_days || [1,3,7]).join(', '))}"></div>
            <div class="field"><label>หลังจากนั้นเตือนซ้ำทุกกี่วัน</label><input class="input" type="number" min="1" max="60" name="overdue_repeat_days" value="${settings.overdue_repeat_days || 7}" required></div>
            <div class="field"><label>Reviewer: เตือนภายในกี่วัน</label><input class="input" type="number" min="1" max="60" name="reviewer_reminder_days" value="${settings.reviewer_reminder_days || 3}" required></div>
            <div class="field"><label>Reviewer: ส่งต่อ QM เมื่อค้างกี่วัน</label><input class="input" type="number" min="1" max="60" name="reviewer_escalation_days" value="${settings.reviewer_escalation_days || 5}" required></div>
            <div class="field"><label>QM: เตือนภายในกี่วัน</label><input class="input" type="number" min="1" max="60" name="qm_reminder_days" value="${settings.qm_reminder_days || 3}" required></div>
            <div class="field"><label>กำหนดเวลาทำ Reflection กี่วัน</label><input class="input" type="number" min="1" max="60" name="reflection_due_days" value="${settings.reflection_due_days || 7}" required></div>
            <div style="grid-column:1/-1"><button class="btn btn-primary" type="submit">บันทึกระยะเวลา</button></div>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div><h2>ประวัติการแจ้งเตือนล่าสุด</h2><div class="small muted">ระบบป้องกันข้อความซ้ำด้วยรหัสการแจ้งเตือนแต่ละช่วง</div></div><span class="badge info">${(logs || []).length} รายการ</span></div>
        ${(logs || []).length ? `<div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>ประเภท</th><th>ช่องทาง</th><th>ผู้รับ</th><th>หัวข้อ</th><th>ผล</th></tr></thead><tbody>${logs.map((row) => `<tr><td>${fmtDate(row.created_at, true)}</td><td>${esc(categoryLabel[row.category] || row.category)}</td><td>${esc(channelLabel[row.channel] || row.channel)}</td><td>${esc(row.target || '-')}</td><td>${esc(row.subject || '-')} ${row.error_message ? `<div class="small danger-text">${esc(row.error_message)}</div>` : ''}</td><td>${logBadge(row.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่มีประวัติการแจ้งเตือน')}
      </div>
    </section>`;
    appEl.innerHTML = shell(content, 'แจ้งเตือน');
    bindShell();
    const showResult = (message, type = 'info') => {
      const box = document.getElementById('automation-result');
      box.innerHTML = `<div class="notice ${type}">${message}</div><div style="height:12px"></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const saveSettings = async (payload, successMessage) => {
      const { error } = await state.supabase.from('ec_notification_settings').update({ ...payload, updated_by: state.user.id, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return toast(friendlyError(error), 'danger');
      toast(successMessage, 'success'); route();
    };
    document.getElementById('automation-settings-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const fd = new FormData(event.currentTarget);
      await saveSettings({ enabled: fd.get('enabled') === 'on', send_email: fd.get('send_email') === 'on', send_google_chat: fd.get('send_google_chat') === 'on', auto_archive: false, chat_include_person_names: fd.get('chat_include_person_names') === 'on', app_url: String(fd.get('app_url') || '').trim().replace(/\/$/, ''), timezone: String(fd.get('timezone') || 'Asia/Bangkok').trim() }, 'บันทึกการตั้งค่าแล้ว');
    });
    document.getElementById('automation-days-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const fd = new FormData(event.currentTarget);
      await saveSettings({
        eqa_before_days: parseDayList(fd.get('eqa_before_days'), [7,3,1,0]), competency_before_days: parseDayList(fd.get('competency_before_days'), [7,3,1,0]), reflection_before_days: parseDayList(fd.get('reflection_before_days'), [3,1,0]), overdue_days: parseDayList(fd.get('overdue_days'), [1,3,7]),
        overdue_repeat_days: Number(fd.get('overdue_repeat_days')), reviewer_reminder_days: Number(fd.get('reviewer_reminder_days')), reviewer_escalation_days: Number(fd.get('reviewer_escalation_days')), qm_reminder_days: Number(fd.get('qm_reminder_days')), reflection_due_days: Number(fd.get('reflection_due_days'))
      }, 'บันทึกระยะเวลาแจ้งเตือนแล้ว');
    });
    document.getElementById('automation-health').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { const result = await invokeAutomation({ action: 'health' }); showResult(`<strong>เชื่อมต่อสำเร็จ</strong><br>Edge Function: พร้อมใช้งาน<br>Apps Script: ${esc(result?.apps_script?.message || 'พร้อมใช้งาน')}`, 'success'); }
      catch (error) { showResult(`<strong>เชื่อมต่อไม่สำเร็จ</strong><br>${esc(friendlyError(error))}`, 'danger'); }
      finally { event.currentTarget.disabled = false; }
    });
    document.getElementById('automation-test').addEventListener('click', async (event) => {
      if (!confirm('ระบบจะส่งอีเมลทดสอบถึงคุณ และส่งข้อความเข้าห้อง Google Chat หากเปิดใช้งาน ยืนยันหรือไม่')) return;
      event.currentTarget.disabled = true;
      try { const result = await invokeAutomation({ action: 'test_notification' }); const ok = (result.results || []).filter((row) => row.ok).length; showResult(`<strong>ส่งข้อความทดสอบแล้ว</strong><br>สำเร็จ ${ok} จาก ${(result.results || []).length} ช่องทาง`, ok ? 'success' : 'warning'); setTimeout(() => route(), 1400); }
      catch (error) { showResult(`<strong>ส่งข้อความทดสอบไม่สำเร็จ</strong><br>${esc(friendlyError(error))}`, 'danger'); }
      finally { event.currentTarget.disabled = false; }
    });
    document.getElementById('automation-run').addEventListener('click', async (event) => {
      if (!confirm('ตรวจรายการค้างและส่งการแจ้งเตือนที่ถึงกำหนดตอนนี้หรือไม่')) return;
      event.currentTarget.disabled = true;
      try {
        const result = await invokeAutomation({ action: 'run_now' });
        showResult(`<strong>ตรวจรอบปัจจุบันเสร็จแล้ว</strong><br>รายการที่เข้าเงื่อนไข ${result.candidate_notifications || 0} · ส่งใหม่ ${result.sent_now || 0} · ข้ามข้อความซ้ำ ${result.skipped_duplicate || 0}`, 'success');
        setTimeout(() => route(), 1400);
      } catch (error) { showResult(`<strong>ตรวจรายการไม่สำเร็จ</strong><br>${esc(friendlyError(error))}`, 'danger'); }
      finally { event.currentTarget.disabled = false; }
    });
  }

  async function invokeAdminUserAction(body) {
    const { data, error } = await state.supabase.functions.invoke('admin-users', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function renderUsers() {
    if (!hasRole('admin')) {
      const content = `<section class="page">
        <div class="page-header"><div><h1>ผู้ใช้งานและสิทธิ์</h1><p>กำลังทำงานในบทบาท ${esc(ROLE_LABELS[state.activeRole] || 'ไม่ระบุบทบาท')}</p></div></div>
        <div class="notice warning">หน้านี้จัดการได้เฉพาะโหมดผู้ดูแลระบบ กรุณาเลือกโหมดการทำงานจากเมนูด้านซ้าย</div>
      </section>`;
      appEl.innerHTML = shell(content, 'ผู้ใช้งาน');
      bindShell();
      return;
    }

    const [{ data: profiles, error }, { data: roles }, { data: requests }] = await Promise.all([
      state.supabase.from('ec_profiles').select('*').order('full_name'),
      state.supabase.from('ec_user_roles').select('*'),
      state.supabase.from('ec_profile_change_requests').select('*,ec_profiles!ec_profile_change_requests_profile_id_fkey(full_name)').eq('status', 'pending').order('created_at')
    ]);
    if (error) return renderError(error);

    const roleMap = new Map();
    (roles || []).forEach((row) => {
      if (!roleMap.has(row.profile_id)) roleMap.set(row.profile_id, []);
      roleMap.get(row.profile_id).push(row.role);
    });

    const content = `<section class="page">
      <div class="page-header">
        <div>
          <h1>ผู้ใช้งานและสิทธิ์</h1>
          <p>กำหนดได้ทั้งบทบาทที่ผู้ใช้ทำงานได้ และสถานะเปิด/ปิดบัญชี โดยระบบไม่แสดงรหัสผ่านปัจจุบันให้ผู้ดูแลระบบเห็น</p>
        </div>
        <div class="header-actions"><button class="btn btn-primary" id="create-user">＋ สร้างผู้ใช้</button></div>
      </div>
      ${requests?.length ? `<div class="card">
        <div class="card-header"><h2>คำขอเปลี่ยนข้อมูล</h2><span class="badge warning">${requests.length} รายการ</span></div>
        ${requests.map((request) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
          <strong>${esc(request.ec_profiles?.full_name)}</strong>
          <div class="small muted">ขอเปลี่ยนเป็น ${esc(request.requested_full_name || '-')} · ${esc(request.requested_email || '-')}</div>
          <div class="table-actions" style="margin-top:8px">
            <button class="btn btn-success btn-sm" data-approve-request="${request.id}">อนุมัติ</button>
            <button class="btn btn-danger btn-sm" data-reject-request="${request.id}">ไม่อนุมัติ</button>
          </div>
        </div>`).join('')}
      </div><div style="height:16px"></div>` : ''}
      <div class="card">
        <div class="table-wrap">
          <table style="min-width:980px">
            <thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้ / อีเมล</th><th>รหัสพนักงาน</th><th>บทบาทที่ได้รับ</th><th>สถานะบัญชี</th><th>จัดการ</th></tr></thead>
            <tbody>${(profiles || []).map((profile) => {
              const userRoles = roleMap.get(profile.id) || [];
              return `<tr>
                <td><strong>${esc(profile.full_name)}</strong><br><span class="small muted">${esc(profile.position_title || '-')}</span></td>
                <td>${esc(profile.username)}<br><span class="small muted">${esc(profile.email)}</span></td>
                <td>${esc(profile.employee_id)}</td>
                <td><div class="role-badges">${userRoles.map((role) => `<span class="badge ${role === 'admin' ? 'info' : ''}">${esc(ROLE_LABELS[role] || 'บทบาทอื่น')}</span>`).join('')}</div></td>
                <td>${profile.active ? '<span class="badge success">เปิดใช้งาน</span>' : '<span class="badge danger">ปิดใช้งาน</span>'}</td>
                <td><div class="table-actions">
                  <button class="btn btn-primary btn-sm" data-manage-user="${profile.id}">กำหนดบทบาท / สถานะ</button>
                  <button class="btn btn-warning btn-sm" data-reset-user="${profile.id}">รีเซ็ตรหัสผ่าน</button>
                </div></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
    </section>`;

    appEl.innerHTML = shell(content, 'ผู้ใช้งาน');
    bindShell();
    document.getElementById('create-user').onclick = () => openCreateUser();

    document.querySelectorAll('[data-manage-user]').forEach((button) => button.addEventListener('click', () => {
      const target = (profiles || []).find((profile) => profile.id === button.dataset.manageUser);
      if (!target) return;
      const currentRoles = roleMap.get(target.id) || [];
      const isSelf = target.id === state.user.id;
      showModal('กำหนดบทบาทและสถานะบัญชี', `
        <form id="manage-user-form" class="form-grid">
          <div class="notice"><strong>${esc(target.full_name)}</strong><br><span class="small">${esc(target.email)} · รหัสพนักงาน ${esc(target.employee_id)}</span></div>
          <div class="field">
            <label>บทบาทที่อนุญาตให้ปฏิบัติงาน</label>
            <div class="role-choice-grid">${roleChoices(currentRoles, isSelf && currentRoles.includes('admin') ? ['admin'] : [])}</div>
          </div>
          <div class="account-status-row">
            <div class="field">
              <label>สถานะบัญชี</label>
              <select class="select" name="active" ${isSelf ? 'disabled' : ''}>
                <option value="true" ${target.active ? 'selected' : ''}>เปิดใช้งาน</option>
                <option value="false" ${!target.active ? 'selected' : ''}>ปิดใช้งาน</option>
              </select>
              <div class="help">${isSelf ? 'ไม่อนุญาตให้ปิดบัญชีที่กำลังใช้งานอยู่' : 'บัญชีที่ปิดใช้งานจะเข้าสู่ระบบไม่ได้'}</div>
            </div>
            <div class="field">
              <label>เหตุผลเมื่อเปลี่ยนสถานะ</label>
              <textarea class="textarea" name="reason" placeholder="จำเป็นเมื่อเปลี่ยนจากเปิดเป็นปิด หรือปิดเป็นเปิด"></textarea>
            </div>
          </div>
        </form>`, `
        <button class="btn btn-outline" data-close-modal>ยกเลิก</button>
        <button class="btn btn-primary" id="save-user-access">บันทึกบทบาทและสถานะ</button>`, true);

      bindRoleDependencies(document.getElementById('manage-user-form'));

      document.getElementById('save-user-access').onclick = async () => {
        const form = document.getElementById('manage-user-form');
        const selectedRoles = normalizedRoles([...form.querySelectorAll('input[name="roles"]:checked')].map((input) => input.value));
        if (!selectedRoles.length) return toast('กรุณาเลือกอย่างน้อย 1 บทบาท', 'warning');
        const nextActive = isSelf ? Boolean(target.active) : form.elements.active.value === 'true';
        const reason = String(form.elements.reason.value || '').trim();
        if (nextActive !== Boolean(target.active) && !reason) return toast('กรุณาระบุเหตุผลที่เปลี่ยนสถานะบัญชี', 'warning');
        try {
          setBusy(true);
          await invokeAdminUserAction({ action: 'update_roles', user_id: target.id, roles: selectedRoles });
          if (nextActive !== Boolean(target.active)) {
            await invokeAdminUserAction({ action: 'set_active', user_id: target.id, active: nextActive, reason });
          }
          if (isSelf) await loadIdentity();
          closeModal();
          toast('บันทึกบทบาทและสถานะแล้ว', 'success');
          await route();
        } catch (err) {
          toast(friendlyError(err), 'danger');
        } finally {
          setBusy(false);
        }
      };
    }));

    document.querySelectorAll('[data-reset-user]').forEach((button) => button.addEventListener('click', async () => {
      const reason = prompt('กรุณาระบุเหตุผลที่รีเซ็ตรหัสผ่าน');
      if (!reason) return;
      try {
        await invokeAdminUserAction({ action: 'reset_password', user_id: button.dataset.resetUser, reason });
        toast('รีเซ็ตรหัสผ่านเป็น CNMI@รหัสพนักงานแล้ว', 'success');
      } catch (err) {
        toast(friendlyError(err), 'danger');
      }
    }));

    document.querySelectorAll('[data-approve-request]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('หมายเหตุการอนุมัติ') || '';
      try {
        await invokeAdminUserAction({ action: 'approve_profile_change', request_id: button.dataset.approveRequest, note });
        toast('อนุมัติคำขอแล้ว', 'success');
        await route();
      } catch (err) {
        toast(friendlyError(err), 'danger');
      }
    }));

    document.querySelectorAll('[data-reject-request]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('เหตุผลที่ไม่อนุมัติ');
      if (!note) return;
      try {
        await invokeAdminUserAction({ action: 'reject_profile_change', request_id: button.dataset.rejectRequest, note });
        toast('ไม่อนุมัติคำขอแล้ว', 'success');
        await route();
      } catch (err) {
        toast(friendlyError(err), 'danger');
      }
    }));
  }

  function openCreateUser() {
    showModal('สร้างบัญชีผู้ใช้', `
      <form id="create-user-form" class="form-grid cols-2">
        <div class="field"><label>ชื่อ-สกุล</label><input class="input" name="full_name" required></div>
        <div class="field"><label>รหัสพนักงาน</label><input class="input" name="employee_id" required></div>
        <div class="field"><label>อีเมลมหิดล</label><input class="input" type="email" name="email" required placeholder="name@mahidol.ac.th"></div>
        <div class="field"><label>ชื่อผู้ใช้</label><input class="input" name="username" placeholder="เว้นว่าง = ส่วนหน้าอีเมล"></div>
        <div class="field"><label>ตำแหน่งงาน</label><input class="input" name="position_title"></div>
        <div class="field"><label>สถานะเริ่มต้น</label><select class="select" name="active"><option value="true">เปิดใช้งาน</option><option value="false">ปิดใช้งานไว้ก่อน</option></select></div>
        <div class="field" style="grid-column:1/-1">
          <label>เลือกบทบาทที่ผู้ใช้งานทำได้</label>
          <div class="role-choice-grid">${roleChoices([])}</div>
        </div>
      </form>`, `
      <button class="btn btn-outline" data-close-modal>ยกเลิก</button>
      <button class="btn btn-primary" id="create-user-save">สร้างบัญชี</button>`, true);

    bindRoleDependencies(document.getElementById('create-user-form'));

    document.getElementById('create-user-save').onclick = async () => {
      const form = document.getElementById('create-user-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const roles = normalizedRoles([...form.querySelectorAll('input[name="roles"]:checked')].map((input) => input.value));
      if (!roles.length) return toast('กรุณาเลือกอย่างน้อย 1 บทบาท', 'warning');
      const active = String(fd.get('active')) === 'true';
      try {
        setBusy(true);
        const data = await invokeAdminUserAction({
          action: 'create_user',
          full_name: String(fd.get('full_name')),
          employee_id: String(fd.get('employee_id')),
          email: String(fd.get('email')),
          username: String(fd.get('username') || ''),
          position_title: String(fd.get('position_title') || ''),
          roles
        });
        if (!active && data?.user_id) {
          await invokeAdminUserAction({
            action: 'set_active',
            user_id: data.user_id,
            active: false,
            reason: 'สร้างบัญชีในสถานะปิดใช้งาน'
          });
        }
        closeModal();
        toast(`สร้างบัญชีแล้ว รหัสเริ่มต้นคือ CNMI@รหัสพนักงาน${active ? '' : ' และปิดใช้งานไว้ก่อน'}`, 'success');
        await route();
      } catch (err) {
        toast(friendlyError(err), 'danger');
      } finally {
        setBusy(false);
      }
    };
  }

  async function renderAudit(){if(!hasRole('admin','qm','viewer')){const content=`<section class="page"><div class="notice warning">บัญชีนี้ไม่มีสิทธิ์ดูประวัติการใช้งาน</div></section>`;appEl.innerHTML=shell(content,'ประวัติการใช้งาน');bindShell();return;}const {data,error}=await state.supabase.from('ec_audit_logs').select('*').order('occurred_at',{ascending:false}).limit(300);if(error)return renderError(error);const content=`<section class="page"><div class="page-header"><div><h1>ประวัติการใช้งาน</h1><p>ตรวจสอบว่าใครทำรายการอะไร เมื่อใด และแก้ไขข้อมูลส่วนใด</p></div></div><div class="card"><div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>รายการที่ทำ</th><th>ส่วนของระบบ</th><th>รหัสรายการ</th><th>เหตุผล</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${fmtDate(x.occurred_at,true)}</td><td>${esc(labelFrom(AUDIT_ACTION_LABELS,x.action,'รายการอื่น'))}</td><td>${esc(labelFrom(AUDIT_TABLE_LABELS,x.table_name,'ส่วนอื่นของระบบ'))}</td><td><code>${esc(x.record_id||'-')}</code></td><td>${esc(x.reason||'-')}</td></tr>`).join('')}</tbody></table></div></div></section>`;appEl.innerHTML=shell(content,'ประวัติการใช้งาน');bindShell();}

  async function renderSettings(){
    const {data:factors}=await state.supabase.auth.mfa.listFactors();
    const totp=factors?.totp||[];
    const mfaStatus=totp.length
      ? `<div class="notice success">เปิดใช้งานแล้ว</div>`
      : `<button class="btn btn-primary" id="enroll-mfa">ตั้งค่าการยืนยันสองขั้นตอน</button>`;
    const content=`<section class="page">
      <div class="page-header"><div><h1>ตั้งค่าของฉัน</h1></div></div>
      <div class="grid cols-2">
        <div class="card"><h2>เปลี่ยนรหัสผ่าน</h2><form id="password-form" class="form-grid"><div class="field"><label>รหัสผ่านใหม่</label><input class="input" type="password" name="password" minlength="8" required></div><div class="field"><label>ยืนยันรหัสผ่าน</label><input class="input" type="password" name="confirm" minlength="8" required></div><button class="btn btn-primary">บันทึกรหัสผ่าน</button></form></div>
        <div class="card"><h2>ข้อมูลส่วนตัว</h2><p><strong>${esc(state.profile.full_name)}</strong><br>${esc(state.profile.email)}<br>ชื่อผู้ใช้: ${esc(state.profile.username)}</p><button class="btn btn-outline" id="request-profile-change">ส่งคำขอแก้ไขข้อมูล</button></div>
        <div class="card"><h2>การยืนยันตัวตนสองขั้นตอน</h2><p class="muted">ผู้ใช้งานทุกคนสามารถเปิดใช้งานได้</p>${mfaStatus}<div style="margin-top:10px"><button class="text-link" type="button" data-nav="help">ดูวิธีตั้งค่า</button></div></div>
      </div>
    </section>`;
    appEl.innerHTML=shell(content,'ตั้งค่า');
    bindShell();
    document.getElementById('password-form').onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.currentTarget);const p=String(fd.get('password'));if(p!==String(fd.get('confirm')))return toast('รหัสผ่านไม่ตรงกัน','danger');const {error}=await state.supabase.auth.updateUser({password:p});if(error)return toast(friendlyError(error), 'danger');toast('เปลี่ยนรหัสผ่านแล้ว','success');e.currentTarget.reset();};
    document.getElementById('request-profile-change').onclick=()=>{showModal('ขอเปลี่ยนข้อมูลส่วนตัว',`<form id="profile-change-form" class="form-grid"><div class="field"><label>ชื่อ-สกุลใหม่</label><input class="input" name="full_name" value="${esc(state.profile.full_name)}"></div><div class="field"><label>อีเมลใหม่</label><input class="input" type="email" name="email" value="${esc(state.profile.email)}"></div><div class="field"><label>ชื่อผู้ใช้ใหม่</label><input class="input" name="username" value="${esc(state.profile.username)}"></div><div class="field"><label>เหตุผล</label><textarea class="textarea" name="reason" required></textarea></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-profile-request">ส่งคำขอ</button>`);document.getElementById('save-profile-request').onclick=async()=>{const f=document.getElementById('profile-change-form');if(!f.reportValidity())return;const fd=new FormData(f);const {error}=await state.supabase.rpc('ec_request_profile_change',{p_full_name:String(fd.get('full_name')),p_email:String(fd.get('email')),p_username:String(fd.get('username')),p_reason:String(fd.get('reason'))});if(error)return toast(friendlyError(error), 'danger');closeModal();toast('ส่งคำขอให้ผู้ดูแลระบบแล้ว','success');};};
    document.getElementById('enroll-mfa')?.addEventListener('click',async()=>{const {data,error}=await state.supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'CNMI EQA'});if(error)return toast(friendlyError(error), 'danger');showModal('ตั้งค่าการยืนยันตัวตนสองขั้นตอน',`<div style="text-align:center">${data.totp.qr_code}<p>รหัสตั้งค่า: <code>${esc(data.totp.secret)}</code></p></div><form id="mfa-verify-form" class="form-grid"><div class="field"><label>รหัส 6 หลักจากแอปยืนยันตัวตน</label><input class="input" name="code" inputmode="numeric" required></div></form>`,`<button class="btn btn-primary" id="verify-mfa">ยืนยัน</button>`);document.getElementById('verify-mfa').onclick=async()=>{const code=new FormData(document.getElementById('mfa-verify-form')).get('code');const ch=await state.supabase.auth.mfa.challenge({factorId:data.id});if(ch.error)return toast(friendlyError(ch.error), 'danger');const vr=await state.supabase.auth.mfa.verify({factorId:data.id,challengeId:ch.data.id,code:String(code)});if(vr.error)return toast(friendlyError(vr.error), 'danger');closeModal();toast('เปิดการยืนยันตัวตนสองขั้นตอนแล้ว','success');route();};});
  }

  function renderHelp(){
    const content=`<section class="page">
      <div class="page-header"><div><h1>คู่มือการใช้งาน</h1><p>รวมคำอธิบายและลำดับงานของระบบไว้ในหน้านี้</p></div></div>
      <div class="guide-list">
        <details open><summary>เริ่มต้นใช้งานและเลือกบทบาทที่กำลังทำงาน</summary><div class="guide-body"><p>เลือกจากกล่อง <strong>ทำงานในบทบาท</strong> ด้านล่างของแถบเมนู ระบบจะแสดงเมนูและปุ่มให้ตรงกับงานที่กำลังทำ</p><p><strong>สิทธิ์บัญชี</strong> เป็นสิทธิ์จริงที่ผู้ดูแลกำหนด ส่วนบทบาทที่เลือกเป็นเพียงโหมดการทำงานในขณะนั้น การสลับบทบาทไม่เปลี่ยนสิทธิ์ในฐานข้อมูลและไม่เปลี่ยนเจ้าของคำตอบ</p><p>ผู้ดูแลระบบ ผู้จัดการคุณภาพ รองผู้จัดการคุณภาพ และผู้ทบทวนสามารถเลือกบทบาทเจ้าหน้าที่เพื่อทำ Competency ของตนเองได้</p></div></details>
        <details><summary>ลำดับงานของรอบ EQA</summary><div class="guide-body"><ol><li>บันทึกข้อมูลการรับรอบและกำหนดผู้รับผิดชอบ</li><li>ผู้ปฏิบัติจริงบันทึกผลรายบุคคล</li><li>ระบบเทียบผลและสร้างสรุปผลห้องปฏิบัติการ</li><li>ผู้ทบทวนตรวจและส่งให้ผู้รับรองคุณภาพ</li><li>ผู้รับรองคุณภาพรับรอง และแพทย์รับทราบ</li></ol></div></details>
        <details><summary>เอกสารและภาพ</summary><div class="guide-body">
          <p>ไฟล์เก็บในพื้นที่ส่วนตัวของระบบ ไม่ได้เก็บใน GitHub ระบบใช้ <strong>ประเภทเอกสาร</strong> เป็นหลัก และใช้ชื่อไฟล์ช่วยจับคู่เท่านั้น</p>
          <p><strong>เอกสารต้นฉบับจากผู้ให้บริการ</strong> ใช้สร้างรายการตัวอย่าง รายการทดสอบ ช่องกรอก หน่วย จำนวนทศนิยม และโครงสร้างฟอร์ม</p>
          <p><strong>คู่มือหรือคำแนะนำ</strong> ใช้แปลวิธีปฏิบัติ ข้อควรระวัง และ Master List คู่มือไม่ถือเป็นเฉลยทางการ</p>
          <p><strong>ภาพผลทดสอบดิบ</strong> ใช้สร้าง Competency สำหรับเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง ภาพ Ab screen รวม RT/IAT ได้ โดยถามผลรวม Positive/Negative</p>
          <p><strong>แผงเซลล์ Antibody Identification / Antigram</strong> ใช้เก็บ antigen profile ของ screening cells และ panel cells เพื่อเทียบกับภาพผล Ab ID ต้องอัปโหลดแยกจากภาพผลดิบ และไม่ถือเป็นผลของตัวอย่างหรือเฉลย</p>
          <p><strong>แบบฟอร์มผลที่ส่งผู้ให้บริการ</strong> ใช้ยืนยันว่าห้องปฏิบัติการส่งคำตอบอะไร แต่ระบบห้ามใช้เป็นเฉลย</p>
          <p><strong>รายงานผลประเมินอย่างเป็นทางการ (Official Evaluation)</strong> ใช้ Intended Response, Grade และคะแนนเป็นแหล่งหลักของเฉลย</p>
          <p><strong>รายงานเปรียบเทียบผู้เข้าร่วม (Participant Summary)</strong> ใช้ดูสัดส่วน/consensus ของห้องอื่น และใช้ประเมิน Educational Challenge หรือรายการ See Note [26] เท่านั้น ร้อยละในเอกสารนี้ไม่ใช่คะแนนของห้องเรา</p>
          <p><strong>กรณีหนึ่งตัวอย่างมีหลายการทดสอบ</strong></p><ul><li><strong>ฟอร์มเปล่าจากผู้ให้บริการเป็นตัวกำหนดโครงสร้าง จำนวนช่อง และรายการทดสอบ</strong> แบบฟอร์มที่ห้องส่งและรายงานผลใช้ตรวจคำตอบภายหลัง แต่ห้ามนำมาสร้างช่องหรือบอกคำตอบล่วงหน้า</li><li>ระบบแยกเป็นกลุ่มการทดสอบ เช่น ABO/Rh, Antibody screen, Antibody identification, Eluate identification, Crossmatch, DAT, CBC, WBC count, Titer และ Antigen typing</li><li>ตัวอย่างเดียวกันปรากฏในหลายกลุ่มได้ ไม่ถือว่าซ้ำ</li><li>ต้องยึดฟอร์มต้นฉบับว่าแต่ละตัวอย่างทำอะไร ห้ามนำทุกการทดสอบไปใส่ทุกตัวอย่าง</li><li>ผลเชิงตัวเลขต้องคงหน่วยและจำนวนทศนิยมตามฟอร์ม</li><li>Antigen typing แบบเลือกชนิด antigen ต้องมีช่อง “ชื่อ antigen” คู่กับ “ผล” ตามจำนวนตำแหน่งจริง ผู้ปฏิบัติเป็นผู้เลือก antigen เอง และเว้นช่องที่ไม่ได้ใช้ได้</li></ul>
          <p><strong>กติกาชื่อไฟล์มาตรฐานที่ระบบใช้ parse</strong></p>
          <div class="notice info"><code>&lt;ProviderRound&gt;_&lt;Specimen&gt;_&lt;Test&gt;_[Qualifier...]_&lt;FileRole&gt;.&lt;ext&gt;</code><br>คั่นส่วนหลักด้วย <code>_</code> เท่านั้น ไม่เว้นวรรค ไม่ใช้ภาษาไทยในชื่อไฟล์ และวางบทบาทไฟล์ไว้ท้ายชื่อก่อนนามสกุล</div>
          <p><strong>ชนิดการทดสอบที่ใช้เป็นคำมาตรฐาน</strong></p>
          <ul><li><code>ABO</code></li><li><code>Rh</code></li><li><code>AbScreen</code></li><li><code>AbID</code></li><li><code>Crossmatch</code></li><li><code>AgTyping</code></li><li><code>EluateAbID</code></li><li><code>DAT</code></li><li><code>CBC</code></li><li><code>WBCCount</code></li><li><code>AntibodyTiter</code></li><li><code>MultiTest</code> เฉพาะภาพเดียวที่มีหลายการทดสอบจริง</li></ul>
          <p><strong>บทบาทไฟล์ที่ใช้เป็นคำมาตรฐาน</strong></p>
          <ul><li><code>RawResult</code> ภาพผลดิบ</li><li><code>Antigram</code> antigen profile ของ panel</li><li><code>BlankResultForm</code> แบบฟอร์มเปล่า</li><li><code>SubmittedResultForm</code> หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ</li><li><code>OfficialEvaluation</code> ผลประเมินทางการ</li><li><code>ParticipantSummary</code> รายงานเปรียบเทียบผู้เข้าร่วม</li><li><code>KitInstruction</code> คู่มือ/คำแนะนำ</li></ul>
          <p><strong>Qualifier ที่ระบบอ่านได้</strong></p>
          <ul><li><code>PanelA</code>, <code>PanelB</code>, <code>PanelC</code> ระบุชุด Panel</li><li><code>Cell01-06</code> ระบุช่วง cell</li><li><code>Lot8RA453</code> ระบุ Lot ของ Antigram</li><li><code>DonorJ-06R</code> ระบุ donor สำหรับ Crossmatch</li><li><code>C-c-E-e-K</code> ระบุ antigen ใน Ag typing</li><li><code>RT</code>, <code>IAT</code>, <code>IS</code>, <code>AHG</code>, <code>ENZYME</code> ระบุ phase เมื่อจำเป็น</li><li><code>ExtraCell01</code> ระบุ selected/extra cell</li></ul>
          <p><strong>ตัวอย่างชื่อภาพผลตามชนิดการทดสอบ</strong></p>
          <ul><li>ABO: <code>CAP-JA-2026_J-01_ABO_RawResult.png</code></li><li>Rh: <code>CAP-JA-2026_J-01_Rh_RawResult.png</code></li><li>Antibody screen: <code>CAP-JA-2026_J-01_AbScreen_RawResult.png</code></li><li>Crossmatch: <code>CAP-JA-2026_JE-07_Crossmatch_DonorJ-06R_RawResult.png</code></li><li>Antigen typing: <code>CAP-JA-2026_J-06R_AgTyping_C-c-E-e-K_RawResult.png</code></li></ul>
          <p><strong>Ab ID หลาย Panel ในตัวอย่างเดียว</strong></p>
          <ul><li><code>CAP-JA-2026_J-01_AbID_PanelA_Cell01-06_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelA_Cell07-11_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelA_Lot8RA453_Antigram.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelB_Cell01-06_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelB_Cell07-11_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelB_Lot8RA454_Antigram.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelC_Cell01-06_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelC_Cell07-11_RawResult.png</code></li><li><code>CAP-JA-2026_J-01_AbID_PanelC_Lot8RA455_Antigram.png</code></li></ul>
          <p>ระบบรวมไฟล์ด้วย <strong>ProviderRound + Specimen + Test + Donor</strong> เป็นหนึ่งชุด แล้วจับภาพผลกับ Antigram ด้วย <strong>Panel ID</strong> จากนั้นเรียง Panel A → B → C และ Cell จากเลขน้อยไปมาก ดังนั้นหนึ่งตัวอย่างทำได้หลาย Panel โดยไม่ต้องบังคับให้มีเพียง Panel A</p>
          <p><strong>เอกสารทั้งฉบับ</strong> ใช้รูปแบบ <code>&lt;ProviderRound&gt;_&lt;Program&gt;_&lt;DocumentRole&gt;.pdf</code> เช่น <code>CAP-JA-2026_J_BlankResultForm.pdf</code>, <code>CAP-JA-2026_J-JE1_KitInstruction.pdf</code>, <code>CAP-JA-2026_J_SubmittedResultForm.pdf</code>, <code>CAP-JA-2026_J_OfficialEvaluation.pdf</code> และ <code>CAP-JA-2026_ALL_ParticipantSummary.pdf</code></p>
          <p><strong>หลักฐานการส่งผลกับแบบฟอร์มผลที่ส่งเป็นไฟล์เดียวกัน</strong> ให้อัปโหลดเพียงครั้งเดียวในประเภท “หลักฐาน/แบบฟอร์มผลที่ส่งผู้ให้บริการ” แล้วในหัวข้อ 7 เลือกไฟล์เดิมเพื่อผูกกับวันเวลา ผู้ส่ง และเลขอ้างอิง ระบบไม่สร้างไฟล์ซ้ำและไม่ใช้ไฟล์นี้เป็นเฉลย</p>
          <p>ชื่อไฟล์ไม่ตรงมาตรฐานยังอัปโหลดได้ แต่ระบบจะแจ้งเตือนและอาจต้องใช้ประเภทเอกสาร/เนื้อหาไฟล์ช่วยจับคู่เอง สำหรับ CAP ตัวเลือกผลแสดงเป็น <strong>เลข CAP │ คำตอบ</strong> และห้ามสร้างรหัสขึ้นเอง</p>
        </div></details>
        <details><summary>ผลรายบุคคลและสรุปผลห้องปฏิบัติการ</summary><div class="guide-body"><p>ผู้ปฏิบัติแต่ละคนบันทึกผลของตนเองแยกกัน เมื่อส่งครบ ระบบจะเติมค่าที่ตรงกันในสรุปผลห้องให้อัตโนมัติ</p><p>ค่าที่ไม่ตรงกันจะถูกทำเครื่องหมายให้ผู้ทบทวนตรวจและเลือกผลที่ถูกต้องก่อนส่งให้ผู้รับรองคุณภาพ</p></div></details>
        <details><summary>การตรวจ รับรอง และรับทราบ</summary><div class="guide-body"><p>ผู้ทบทวนตรวจผลห้องและหลักฐาน จากนั้นส่งให้ผู้รับรองคุณภาพรับรอง เมื่อรับรองแล้วแพทย์จึงกดรับทราบได้</p><p>แต่ละรอบต้องกำหนดผู้รับรองคุณภาพเป็นผู้จัดการคุณภาพหรือรองผู้จัดการคุณภาพ โดยต้องเป็นคนละคนกับผู้ปฏิบัติจริงทั้งสองคนและผู้ทบทวนผล</p><p>บุคคลเดียวกันมีหลายบทบาทในระบบได้และทำหน้าที่ต่างกันในคนละรอบ แต่ระบบจะป้องกันหน้าที่ที่ขัดกันภายในรอบเดียวกัน ประวัติการอนุมัติจะแสดงชื่อ บทบาท และวันเวลาที่บันทึกจริง</p><p>การส่งกลับต้องระบุเหตุผล เพื่อให้ผู้เกี่ยวข้องแก้ไขเฉพาะจุด</p></div></details>
        <details><summary>การสร้างแบบกรอก ข้อสอบ และรายงานผล</summary><div class="guide-body"><p><strong>แบบกรอกผลห้องปฏิบัติการ (หัวข้อ 4–5)</strong> ยังสร้างโครงสร้างจาก Blank Result Form ได้ เพื่อช่วยจัดช่องผลตามตัวอย่างจริง แต่ผู้ดูแลต้องตรวจ Preview ก่อนใช้งาน</p><p><strong>ข้อสอบ Competency (หัวข้อ 10) จัดเองทั้งหมด</strong> AI มีหน้าที่อ่านข้อความจากเอกสารให้เป็นคลังข้อความเท่านั้น ระบบจะไม่สร้างคำถาม ตัวเลือก เฉลย หรือผูกรูปให้อัตโนมัติ</p><p>ผู้ดูแลกด “ใช้เป็นคำถาม” หรือเพิ่มคำถามใหม่ แล้วกำหนดข้อความ ชนิดคำตอบ ตัวเลือก เฉลย คะแนน และรูปประกอบเฉพาะข้อนั้นได้เหมือน Microsoft Forms</p><p>ก่อนเผยแพร่ให้ใช้ปุ่ม “ดูตัวอย่างผู้ทำแบบประเมิน” และพักการเผยแพร่ได้โดยไม่ลบคำตอบเดิม</p><p><strong>การตรวจผลเป็นรายบุคคล</strong> ผู้ทบทวนตรวจทีละคน เทียบกับภาพผลดิบ/Antigram แล้วส่งกลับเฉพาะข้อหรือเฉพาะหัวข้อที่ต้องแก้ ส่วนที่ผ่านแล้วถูกล็อกไว้</p><p>Official Evaluation และ Participant Summary ยังใช้เป็นเอกสารอ้างอิงสำหรับผู้ทบทวนและการสรุปผลทางการ แต่ไม่ถูกนำไปสร้างเฉลยข้อสอบโดยอัตโนมัติ</p></div></details>
        <details><summary>การแจ้งเตือน EQA และ Competency</summary><div class="guide-body"><p>ผู้ดูแลระบบหรือผู้จัดการคุณภาพตั้งค่าได้ที่เมนู <strong>แจ้งเตือน</strong> ระบบตรวจรายการ EQA ใกล้ครบกำหนด แบบทดสอบที่ยังไม่ส่ง แบบทบทวน ผู้ทบทวนที่ยังไม่ตรวจ และรายการรอผู้รับรองคุณภาพ</p><p>Email ส่งถึงผู้เกี่ยวข้องตามหน้าที่ ส่วน Google Chat ใช้แจ้งภาพรวมของหน่วยงาน โดยค่าเริ่มต้นไม่แสดงชื่อผู้รับการประเมินรายบุคคล</p><p>ปุ่ม <strong>ตรวจและส่งตอนนี้</strong> ใช้ทดสอบหรือตรวจรายการทันที ส่วน Trigger ใน Google Apps Script จะเรียกตรวจอัตโนมัติทุกวัน</p></div></details>
        <details><summary>แบบทบทวนหลังตอบไม่ถูกหรือ Educational เป็นคำตอบส่วนน้อย</summary><div class="guide-body"><p>เมื่อผู้รับรองคุณภาพรับรองแล้วพบข้อที่ตอบไม่ถูก หรือ Educational Challenge ที่คำตอบต่างจากกลุ่มผู้เข้าร่วมส่วนใหญ่ ระบบจะเปลี่ยนสถานะเป็น <strong>ต้องทบทวน</strong> โดย Educational ไม่ถูกนับเป็นคะแนนทางการ</p><p>เจ้าหน้าที่บันทึกเหตุผลที่เลือกคำตอบเดิม ผลการทบทวนว่าคำตอบของห้องเหมาะสมหรือควรแก้ไข และสิ่งที่จะนำไปใช้กับงาน จากนั้นส่งให้ผู้ทบทวนรับรองหรือส่งกลับแก้ไข</p></div></details>
        <details><summary>รายงานและเอกสารคุณภาพ</summary><div class="guide-body"><p>ระบบ PDF รุ่นเดิมถูกปิดชั่วคราวระหว่างออกแบบรายงานใหม่ให้เหมาะกับ ISO 15189, HA และระบบควบคุมเอกสาร</p><p>ข้อมูลรอบ ผลตรวจ การรับรอง และ Audit log ยังถูกเก็บตามปกติ การลบทะเบียน PDF เดิมไม่กระทบข้อมูลเหล่านี้</p></div></details>
        <details><summary>การยืนยันตัวตนสองขั้นตอน</summary><div class="guide-body"><p>ผู้ใช้งานทุกคนเปิดใช้งานได้จากเมนู ตั้งค่าของฉัน โดยสแกน QR Code ด้วยแอปยืนยันตัวตน แล้วกรอกรหัส 6 หลักเพื่อยืนยัน</p><p>ควรเก็บบัญชีและโทรศัพท์ที่ใช้สร้างรหัสไว้กับเจ้าของบัญชีเท่านั้น</p></div></details>
        <details><summary>การลบข้อมูล</summary><div class="guide-body"><p>ปุ่มลบที่ระบุว่าเป็นการลบถาวรจะลบข้อมูลจริงและกู้คืนไม่ได้ ควรตรวจชื่อรอบ เอกสาร หรือคำถามก่อนยืนยันทุกครั้ง</p></div></details>
      </div>
    </section>`;
    appEl.innerHTML=shell(content,'คู่มือการใช้งาน');
    bindShell();
  }

  function renderError(error){const content=`<section class="page"><div class="notice danger"><strong>ระบบดำเนินการไม่สำเร็จ</strong><br>${esc(friendlyError(error))}</div></section>`;appEl.innerHTML=shell(content,'ข้อผิดพลาด');bindShell();}

  async function route(){
    if(!state.user){renderLogin();return;}
    if(state.profile?.must_change_password){await renderForcePassword();return;}
    const parts=currentRoute().split('/');
    const requestedRoute = parts[0] || 'dashboard';
    if (!canViewRoute(requestedRoute)) {
      if (requestedRoute !== 'dashboard') { navigate('dashboard'); return; }
    }
    try{
      if(parts[0]==='dashboard')await renderDashboard();
      else if(parts[0]==='rounds')await renderRounds();
      else if(parts[0]==='round')await renderRound(parts);
      else if(parts[0]==='my-competency')await renderMyCompetency();
      else if(parts[0]==='assignment')await renderAssignment(parts[1]);
      else if(parts[0]==='reports')await renderReports();
      else if(parts[0]==='users')await renderUsers();
      else if(parts[0]==='audit')await renderAudit();
      else if(parts[0]==='automation')await renderAutomation();
      else if(parts[0]==='settings')await renderSettings();
      else if(parts[0]==='help')renderHelp();
      else navigate('dashboard');
    }catch(e){renderError(e);}
  }

  async function init(){
    if(!configReady()){renderSetup();return;}
    if(!window.supabase?.createClient){appEl.innerHTML='<div class="boot-screen"><div class="notice danger">โหลดส่วนเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต</div></div>';return;}
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    await loadIdentity();
    state.supabase.auth.onAuthStateChange(async(event,session)=>{
      state.session=session;state.user=session?.user||null;
      if(event==='SIGNED_OUT'||!session){state.profile=null;state.roles=[];state.activeRole=null;renderLogin();return;}
      await loadIdentity();await route();
    });
    window.addEventListener('hashchange',route);
    await route();
  }

  init();
})();
