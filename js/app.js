/* CNMI EQA and Competency Management System v2.4.7
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
    currentRound: null,
    busy: false,
  };

  const SIDEBAR_COLLAPSED_KEY = 'cnmi-eqa-sidebar-collapsed';
  const AI_EXTRACTION_SCHEMA_VERSION = 'v2.4.5';

  function isAiExtractionCurrent(doc) {
    const version = String(doc?.ai_extraction?.schema_version || '');
    if (version === AI_EXTRACTION_SCHEMA_VERSION) return true;
    const category = String(doc?.category || '');
    if (version === 'v2.4.2') return category !== 'instruction';
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
    physician: 'แพทย์ผู้รับรอง',
    admin: 'ผู้ดูแลระบบ',
    viewer: 'ผู้ตรวจติดตาม'
  };
  const ROLE_HELP = {
    staff: 'รับ EQA เข้าระบบ ปฏิบัติงานตามที่ได้รับมอบหมาย และทำการประเมินความสามารถ',
    reviewer: 'ตรวจเทียบผลรายบุคคล ตรวจสรุปผลห้องปฏิบัติการที่ระบบสร้าง และส่งให้ผู้จัดการคุณภาพรับรอง',
    qm: 'บริหารรอบ EQA และอนุมัติด้านคุณภาพหลังผู้ทบทวนตรวจแล้ว',
    physician: 'รับทราบสรุปผลห้องปฏิบัติการหลังผู้จัดการคุณภาพรับรอง ไม่ต้องทำแบบทดสอบบุคลากร',
    admin: 'จัดการผู้ใช้งาน สิทธิ์ และการตั้งค่าระบบ',
    viewer: 'อ่านรายงานและประวัติการใช้งานโดยไม่แก้ไขข้อมูล'
  };
  const ROLE_PRIORITY = ['admin', 'qm', 'reviewer', 'physician', 'viewer', 'staff'];
  const SIGNING_ROLE_LABELS = {
    staff: 'นักเทคนิคการแพทย์ / เจ้าหน้าที่ผู้ปฏิบัติ',
    reviewer: 'ผู้ทบทวนผล',
    qm: 'ผู้จัดการคุณภาพ',
    physician: 'แพทย์ผู้รับทราบ',
    admin: 'ผู้ดูแลระบบ',
    viewer: 'ผู้ตรวจติดตาม'
  };
  const STATUS_LABELS = {
    preparing: 'เตรียมดำเนินการ',
    in_progress: 'กำลังดำเนินการ',
    awaiting_review: 'ระบบสรุปแล้ว รอผู้ทบทวน',
    returned_for_revision: 'ส่งกลับแก้ไข',
    awaiting_qm_approval: 'รอผู้จัดการคุณภาพอนุมัติ',
    qm_approved: 'ผู้จัดการคุณภาพอนุมัติแล้ว',
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
    awaiting_qm_certification: 'รอผู้จัดการคุณภาพรับรอง',
    returned_by_qm: 'ผู้จัดการคุณภาพส่งกลับแก้ไข',
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
    physician: 'แพทย์ผู้รับทราบ'
  };
  const RESULT_STATUS_LABELS = {
    draft: 'ฉบับร่าง',
    submitted: 'ส่งแล้ว',
    returned: 'ส่งกลับแก้ไข',
    resubmitted: 'ส่งใหม่แล้ว',
    awaiting_practitioner_confirmations: 'กำลังจัดทำสรุปผลห้องปฏิบัติการ',
    practitioners_confirmed: 'ระบบสรุปผลแล้ว รอผู้ทบทวน',
    awaiting_qm_review: 'ผู้ทบทวนผ่านแล้ว รอผู้จัดการคุณภาพ',
    qm_approved: 'ผู้จัดการคุณภาพรับรองแล้ว รอแพทย์รับทราบ',
    awaiting_physician_approval: 'รอแพทย์รับทราบ',
    physician_approved: 'แพทย์รับทราบแล้ว',
    locked: 'ล็อกข้อมูลแล้ว'
  };
  const APPROVAL_STAGE_LABELS = {
    practitioner_confirm: 'ผู้ปฏิบัติทั้งสองคนยืนยันผลกลาง',
    reviewer_review: 'ผู้ทบทวนตรวจผลของผู้ปฏิบัติและผลกลาง',
    qm_review: 'ผู้จัดการคุณภาพตรวจและอนุมัติ',
    physician_approval: 'แพทย์รับทราบสรุปผลห้องปฏิบัติการ',
    closure_acknowledgement: 'แพทย์รับทราบการปิดรอบ',
    historical_practitioner_confirm: 'ผู้ปฏิบัติยืนยันข้อมูลย้อนหลัง',
    historical_reviewer_review: 'ผู้ทบทวนตรวจข้อมูลย้อนหลัง',
    historical_qm_certification: 'ผู้จัดการคุณภาพรับรองข้อมูลย้อนหลัง'
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
    reject_profile_change: 'ไม่อนุมัติการเปลี่ยนข้อมูลส่วนตัว'
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
    ec_report_archives: 'ทะเบียนไฟล์ Google Drive'
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

  function roleStorageKey() {
    return `cnmi_eqa_active_role_${state.user?.id || 'anonymous'}`;
  }

  function syncActiveRole() {
    const saved = localStorage.getItem(roleStorageKey());
    const fallback = ROLE_PRIORITY.find((role) => state.roles.includes(role)) || state.roles[0] || 'staff';
    state.activeRole = saved && state.roles.includes(saved) ? saved : fallback;
    localStorage.setItem(roleStorageKey(), state.activeRole);
  }

  function hasAssignedRole(...roles) { return roles.some((r) => state.roles.includes(r)); }
  function hasRole(...roles) { return roles.includes(state.activeRole); }
  function canManage() { return hasRole('admin', 'qm'); }
  function canDeleteRound() { return hasRole('admin'); }
  function canReview() { return hasRole('admin', 'qm', 'reviewer'); }
  function isPhysician() { return hasRole('physician'); }
  function canReceiveEqa() { return hasRole('staff', 'qm', 'admin'); }
  function canImportHistoricalEqa() { return hasRole('admin', 'qm'); }
  function isHistoricalRound(round) { return round?.round_mode === 'historical_import'; }
  function isCompetencyParticipant() { return hasAssignedRole('staff') && !hasAssignedRole('physician'); }
  function personHasRole(person, role) { return Array.isArray(person?.roles) && person.roles.includes(role); }
  function normalizedRoles(roles) {
    const result = [...new Set((roles || []).filter(Boolean))];
    if ((result.includes('reviewer') || result.includes('qm')) && !result.includes('staff')) result.unshift('staff');
    return result;
  }

  function roleOptions(selected = state.activeRole) {
    return state.roles.map((role) => `<option value="${esc(role)}" ${role === selected ? 'selected' : ''}>${esc(ROLE_LABELS[role] || 'บทบาทอื่น')}</option>`).join('');
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
        ? ' · จำเป็นสำหรับผู้ทบทวนและผู้จัดการคุณภาพ แต่แพทย์ไม่จำเป็นต้องมีบทบาทนี้'
        : (role === 'reviewer' || role === 'qm') ? ' · ระบบจะเพิ่มบทบาทเจ้าหน้าที่ให้อัตโนมัติ' : '';
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
    const sync = () => {
      const needsStaff = Boolean(reviewer?.checked || qm?.checked);
      if (needsStaff && staff) staff.checked = true;
      if (staff) staff.disabled = needsStaff;
    };
    reviewer?.addEventListener('change', sync);
    qm?.addEventListener('change', sync);
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
      not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', submitted: 'รอผู้ทบทวน', under_review: 'ผู้ทบทวนผ่านแล้ว รอผู้จัดการคุณภาพ',
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
          ${navItem('dashboard', '⌂', 'ภาพรวม', route)}
          ${isCompetencyParticipant() ? navItem('my-competency', '✓', 'การประเมินของฉัน', route) : ''}
          <div class="nav-section">งาน EQA</div>
          ${navItem('rounds', '▦', 'รอบ EQA', route)}
          ${roundSubmenu(route)}
          ${navItem('reports', '▤', 'รายงาน / ทะเบียน', route)}
          <div class="nav-section">การจัดการ</div>
          ${navItem('users', '♙', 'ผู้ใช้งานและสิทธิ์', route)}
          ${navItem('audit', '◷', 'ประวัติการใช้งาน', route)}
          ${canManage() ? navItem('automation', '◉', 'แจ้งเตือน / Google Drive', route) : ''}
          ${navItem('settings', '⚙', 'ตั้งค่าของฉัน', route)}
          <div class="nav-section">ช่วยเหลือ</div>
          ${navItem('help', '?', 'คู่มือการใช้งาน', route)}
          <div class="sidebar-footer">
            <div class="user-mini">
              <div class="user-name-row">
                <strong>${esc(state.profile?.full_name)}</strong>
                <span class="badge info">ออนไลน์</span>
              </div>
              <div class="role-switcher">
                <label for="active-role-select">ใช้งานในบทบาท</label>
                <select class="role-select" id="active-role-select" data-role-switch ${state.roles.length <= 1 ? 'disabled' : ''}>
                  ${roleOptions()}
                </select>
              </div>
              <div class="small muted">สิทธิ์ที่ได้รับทั้งหมด</div>
              <div class="user-role-list">${assignedRoleBadges || '<span class="badge">ยังไม่ได้รับบทบาท</span>'}</div>
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
              <span class="active-role-badge">โหมด: ${esc(ROLE_LABELS[state.activeRole] || 'ไม่ระบุบทบาท')}</span>
              <span class="small topbar-username">${esc(state.profile?.username || '')}</span>
            </div>
          </header>
          ${content}
        </main>
      </div>`;
  }

  function bindShell() {
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
      if (!state.roles.includes(nextRole)) return;
      state.activeRole = nextRole;
      localStorage.setItem(roleStorageKey(), nextRole);
      closeSidebar();
      toast(`เปลี่ยนโหมดเป็น ${ROLE_LABELS[nextRole] || 'บทบาทที่เลือก'} แล้ว`, 'success');
      await route();
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

    async function renderDashboard() {
    const [roundsRes, assignmentRes] = await Promise.all([
      state.supabase.from('ec_eqa_rounds').select('*').order('created_at', { ascending: false }).limit(8),
      state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(round_code,provider)').eq('user_id', state.user.id).order('created_at', { ascending: false })
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
            <div class="card-header"><h2>${isCompetencyParticipant() ? 'การประเมินของฉัน' : 'หน้าที่ของแพทย์ผู้รับรอง'}</h2>${isCompetencyParticipant() ? `<button class="btn btn-outline btn-sm" data-nav-inline="my-competency">ดูทั้งหมด</button>` : ''}</div>
            ${isCompetencyParticipant() ? (assignments.length ? assignments.slice(0, 6).map((a) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
              <strong>${esc(a.ec_eqa_rounds?.provider || '')} ${esc(a.ec_eqa_rounds?.round_code || '')}</strong>
              <span style="float:right">${assignmentBadge(a.status)}</span>
            </div>`).join('') : empty('ยังไม่มีการประเมินที่ได้รับมอบหมาย')) : `<div class="notice">แพทย์ไม่ต้องทำแบบทดสอบบุคลากร หน้าที่ในระบบคืออนุมัติผล EQA ขั้นสุดท้าย รับทราบผลประเมิน และรับรองการปิดรอบ</div>`}
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
    try { directory = await loadDirectory(); } catch (error) { return toast(friendlyError(error), 'danger'); }
    const [{ data: currentAssignments }, resultCount] = round?.id
      ? await Promise.all([
          state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
          state.supabase.from('ec_individual_results').select('id', { count: 'exact', head: true }).eq('round_id', round.id)
        ])
      : [{ data: [] }, { count: 0 }];
    const assigned = currentAssignments || [];
    const practitionersLocked = Boolean(resultCount.count);
    const findAssigned = (role, slot = null) => assigned.find((a) => a.assignment_role === role && (slot ? a.practitioner_slot === slot : true))?.user_id || '';
    const practitioners = directory.filter((person) => personHasRole(person, 'staff') && !personHasRole(person, 'physician'));
    const reviewers = directory.filter((person) => personHasRole(person, 'reviewer'));
    const people = directory.filter((person) => person.active !== false && personHasRole(person, 'staff') && !personHasRole(person, 'physician'));
    const options = (rows, selected, blank = 'กรุณาเลือก') => `<option value="">${blank}</option>${rows.map((person) => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${esc(person.full_name)}${person.position_title ? ` — ${esc(person.position_title)}` : ''}</option>`).join('')}`;
    const defaultYear = round?.survey_year || new Date().getFullYear();
    const convertingExistingRound = Boolean(round?.id && !isHistoricalRound(round));
    showModal(convertingExistingRound ? 'เปลี่ยนรอบนี้เป็นข้อมูลย้อนหลัง' : (round ? 'แก้ไขข้อมูลรอบที่ดำเนินการแล้ว' : 'นำเข้ารอบ EQA ที่ดำเนินการแล้ว'), `
      <form id="historical-round-form" class="form-grid cols-2">
        <div class="notice" style="grid-column:1/-1"><strong>${convertingExistingRound ? 'กำลังเปลี่ยนรอบที่มีอยู่ให้เป็นข้อมูลย้อนหลัง' : 'ใช้สำหรับ EQA ที่ห้องปฏิบัติการตรวจและส่งผลไปแล้ว'}</strong><br><span class="small">ผู้ดูแลระบบหรือผู้จัดการคุณภาพจะกรอกข้อมูลจากหลักฐานเดิมแทนผู้ปฏิบัติ โดยระบบแยกผู้ปฏิบัติจริงออกจากผู้บันทึกข้อมูลเข้าระบบอย่างชัดเจน${convertingExistingRound ? ' เอกสารที่อัปโหลดไว้ในรอบนี้จะยังอยู่เหมือนเดิม' : ''}</span></div>
        <div class="field"><label>ผู้ให้บริการ</label><input class="input" name="provider" required value="${esc(round?.provider || 'CAP')}"></div>
        <div class="field"><label>ชื่อโปรแกรม</label><input class="input" name="program_name" required value="${esc(round?.program_name || 'Comprehensive Transfusion Medicine')}"></div>
        <div class="field"><label>รหัสโปรแกรม</label><input class="input" name="program_code" value="${esc(round?.program_code || 'J')}"></div>
        <div class="field"><label>ชื่อรอบ</label><input class="input" name="round_code" required value="${esc(round?.round_code || '')}" placeholder="เช่น J-A 2026"></div>
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
        <div class="field" style="grid-column:1/-1"><label>ผู้ทบทวนข้อมูลย้อนหลัง</label><select class="select" name="reviewer" required>${options(reviewers, findAssigned('reviewer'))}</select><div class="help">ผู้ทบทวนต้องเป็นคนละคนกับผู้ปฏิบัติทั้งสองคน</div></div>
        <div class="field"><label>เลขเอกสาร</label><input class="input" name="document_number" value="${esc(round?.document_number || '')}"></div>
        <div class="field"><label>ผู้บันทึกข้อมูลเข้าระบบ</label><input class="input" value="${esc(state.profile.full_name)}" disabled><div class="help">ระบบบันทึกชื่อและวันเวลาปัจจุบันอัตโนมัติ ไม่ใช้แทนชื่อผู้ปฏิบัติจริง</div></div>
        <div class="field" style="grid-column:1/-1"><label>แหล่งข้อมูล/หลักฐานที่ใช้กรอกย้อนหลัง</label><textarea class="textarea" name="historical_source_note" required placeholder="เช่น แบบบันทึกผลเดิม สำเนาผลที่ส่ง CAP และภาพหน้าจอหลักฐานการส่ง">${esc(round?.historical_source_note || '')}</textarea></div>
        <div class="field" style="grid-column:1/-1"><label>หมายเหตุเพิ่มเติม</label><textarea class="textarea" name="notes">${esc(round?.notes || '')}</textarea></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-historical-round">${convertingExistingRound ? 'เปลี่ยนเป็นข้อมูลย้อนหลังและไปกรอกผล' : 'บันทึกและไปกรอกผลย้อนหลัง'}</button>`, true);

    document.getElementById('save-historical-round').addEventListener('click', async () => {
      const form = document.getElementById('historical-round-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const p1 = String(fd.get('p1') || findAssigned('practitioner', 1) || '');
      const p2 = String(fd.get('p2') || findAssigned('practitioner', 2) || '');
      const reviewer = String(fd.get('reviewer') || '');
      if (p1 === p2) return toast('ผู้ปฏิบัติจริงทั้งสองคนต้องเป็นคนละคน', 'warning');
      if ([p1, p2].includes(reviewer)) return toast('ผู้ทบทวนต้องเป็นคนละคนกับผู้ปฏิบัติจริง', 'warning');
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
      setBusy(true);
      const { data, error } = await state.supabase.rpc('ec_save_historical_round', {
        p_round_id: round?.id || null,
        p_payload: payload,
        p_practitioner_1: p1,
        p_practitioner_2: p2,
        p_reviewer: reviewer
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal();
      toast('บันทึกรอบย้อนหลังแล้ว ขั้นต่อไปกรอกผลแทนผู้ปฏิบัติทั้งสองคนจากหลักฐานเดิม', 'success', 6500);
      navigate(`round/${data}/individual`);
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
          <div style="height:10px"></div><div class="notice">4) ผู้ทบทวนตรวจสอบ → ผู้จัดการคุณภาพรับรองและเปิดการประเมินความสามารถ</div>
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
        <div style="height:10px"></div><div class="notice">3) ผู้ทบทวนตรวจและกดส่ง → ผู้จัดการคุณภาพรับรอง → แพทย์รับทราบ โดยผู้ปฏิบัติไม่ต้องมานั่งทำผลกลางซ้ำ</div>
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
    if (!match) return document?.category === 'antibody_panel' ? 'Panel / Antigram' : 'ภาพผลดิบอื่น';
    const prefix = String(match[1] || '').toUpperCase();
    const number = String(match[2] || '').padStart(2, '0');
    const suffix = String(match[3] || '').toUpperCase();
    return `${prefix}-${number}${suffix}`;
  }

  function competencyEvidenceTest(document) {
    const source = `${document?.title || ''} ${document?.file_name || ''}`.toLowerCase();
    if (document?.category === 'antibody_panel' || /antigram|antigen profile/.test(source)) return 'Panel / Antigram';
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
      <div class="compact-status"><span>แบบกรอก <strong>${round.generated_result_form_schema ? 'สร้างแล้ว' : 'ยังไม่สร้าง'}</strong></span><span>คำแนะนำ <strong>${round.generated_instruction_th ? 'สร้างแล้ว' : 'ยังไม่สร้าง'}</strong></span>${generatedAt ? `<span>อัปเดตแบบกรอก <strong>${esc(generatedAt)}</strong></span>` : ''}</div>
      ${round.generated_instruction_th ? `<details class="notice success" style="margin-top:10px"><summary><strong>เปิดดูคำแนะนำภาษาไทย</strong></summary><div class="small" style="white-space:pre-wrap;margin-top:8px">${esc(round.generated_instruction_th)}</div></details>` : ''}`;
    return `<div class="card">
      <div class="card-header"><div><h2>เอกสารและภาพ</h2></div>
      <div class="table-actions">${uploadAllowed ? `<button class="btn btn-primary" id="upload-doc-btn">＋ อัปโหลดไฟล์</button>` : ''}<button class="btn btn-outline" id="go-auto-competency">จัดการข้อสอบ</button></div></div>
      ${canManage() ? `<div class="ai-action-grid">
        <button class="btn btn-primary" id="generate-form-only" ${formReady ? '' : 'disabled'}>1. สร้างแบบกรอกจากฟอร์มเปล่า</button>
        <button class="btn btn-outline" id="generate-instruction-only" ${instructionReady ? '' : 'disabled'}>2. สร้างคำแนะนำจากคู่มือ</button>
        <button class="btn btn-secondary" id="generate-questions-only" ${round.generated_result_form_schema ? 'disabled' : (questionReady ? '' : 'disabled')}>${round.generated_result_form_schema ? '3. ไม่ต้องสร้าง — Part 10 ใช้แบบกรอกและภาพผลดิบ' : '3. สร้างข้อสอบจากภาพ/เอกสาร'}</button>
        <button class="btn btn-success" id="generate-answer-keys" ${answerBundleReady ? '' : 'disabled'}>4. สร้างเฉลยข้อสอบ</button>
        <button class="btn btn-outline" id="generate-official-summary" ${answerBundleReady ? '' : 'disabled'}>5. สร้างสรุปผลอย่างเป็นทางการ</button>
        <button class="btn btn-outline" id="generate-historical-bundle" ${historicalBundleReady ? '' : 'disabled'}>สร้างย้อนหลังครบชุดอัตโนมัติ</button>
      </div><div class="small muted" style="margin:8px 0 14px">ระบบแยกเฉลยข้อสอบออกจากสรุปผลอย่างเป็นทางการ และสร้างเฉลยครั้งละชุดย่อย เพื่อลดปัญหา Supabase รหัส 546</div>` : ''}
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
    const canChange = canManage() && (!isHistoricalRound(round) || !resultCount.count);
    return `<div class="card">
      <div class="card-header"><div><h2>ผู้รับผิดชอบ</h2><div class="small muted">ผู้ปฏิบัติจริง 2 คนต้องมีบทบาทเจ้าหน้าที่ ผู้ทบทวนต้องมีบทบาทผู้ทบทวน ส่วนผู้จัดการคุณภาพต้องรับรองทุกรอบตามหน้าที่ แม้เป็นหนึ่งในผู้ปฏิบัติจริง</div></div>${canChange ? `<button class="btn btn-primary" id="manage-assignments">กำหนดผู้รับผิดชอบ</button>` : ''}</div>
      <div class="notice info">บุคคลเดียวกันมีหลายบทบาทได้ แต่ต้องเลือก “ใช้งานในบทบาท” ให้ตรงกับงานที่กำลังทำ เช่น กรอกผลในบทบาทเจ้าหน้าที่ และรับรองในบทบาทผู้จัดการคุณภาพ ระบบจะแสดงบทบาทที่ใช้ลงนามในประวัติการอนุมัติ</div><div style="height:12px"></div>
      ${isHistoricalRound(round) && resultCount.count ? `<div class="notice warning">มีการกรอกผลย้อนหลังแล้ว ระบบจึงล็อกชื่อผู้ปฏิบัติจริงเพื่อไม่ให้หลักฐานเปลี่ยนบุคคล หากเลือกผิดให้แก้ก่อนกรอกผลย้อนหลัง</div><div style="height:12px"></div>` : ''}
      ${(assignments || []).length ? `<div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>ชื่อ</th><th>ลำดับผู้ปฏิบัติ</th><th>วันที่มอบหมาย</th></tr></thead><tbody>
        ${(assignments || []).map((assignment) => `<tr><td>${esc(labelFrom(ASSIGNMENT_ROLE_LABELS, assignment.assignment_role))}</td><td>${esc(name(assignment.user_id))}</td><td>${assignment.practitioner_slot || '-'}</td><td>${fmtDate(assignment.assigned_at, true)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('ยังไม่ได้มอบหมายผู้ปฏิบัติ ผู้ทบทวนผล หรือแพทย์')}
    </div>`;
  }

  function selectOptions(options, value) {
    return options.map(([optionValue, label]) => `<option value="${esc(optionValue)}" ${String(value || '') === optionValue ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }

  function generatedResultSchema(round = state.currentRound) {
    const schema = round?.generated_result_form_schema;
    return schema && typeof schema === 'object' && Array.isArray(schema.programs) ? schema : null;
  }

  function generatedOptionLabel(option) {
    const label = String(option?.label || option?.value || '').trim();
    const code = String(option?.code || '').trim();
    if (!code) return label;
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanLabel = label
      .replace(new RegExp(`^\\s*${escapedCode}\\s*(?:[|│:–—-]+)\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*\\(?\\s*CAP\\s*${escapedCode}\\s*\\)?\\s*$`, 'i'), '')
      .trim();
    return `${code} │ ${cleanLabel || label}`;
  }

  function generatedFieldControl(field, value, attributes, disabled) {
    const inputType = String(field?.input_type || 'text');
    const required = field?.required ? 'required' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    const placeholder = field?.placeholder ? `placeholder="${esc(field.placeholder)}"` : '';
    const options = Array.isArray(field?.options) ? field.options : [];
    if (inputType === 'select' || options.length) {
      return `<select class="select" ${attributes} ${required} ${disabledAttr}><option value="">— เลือก —</option>${options.map((option) => {
        const optionValue = String(option?.value ?? option?.code ?? option?.label ?? '');
        return `<option value="${esc(optionValue)}" ${String(value || '') === optionValue ? 'selected' : ''}>${esc(generatedOptionLabel(option))}</option>`;
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

  function providerGeneratedResultForm(payload, prefix, disabled) {
    const schema = generatedResultSchema();
    if (!schema) return '';
    const p = payload && payload.schema === PROVIDER_GENERATED_SCHEMA ? payload : {};
    const specimens = p.specimens || {};
    const antigenTyping = p.antigen_typing || {};
    const methodsByProgram = p.methods_by_program || {};
    const instruction = String(state.currentRound?.generated_instruction_th || '').trim();
    const hasEducationalProgram = (schema.programs || []).some((program) => String(program?.challenge_mode || '').toLowerCase() === 'dry'
      || /(?:JE1|educational|dry\s*challenge)/i.test(`${program?.key || ''} ${program?.title || ''} ${program?.description || ''}`));
    const programHtml = schema.programs.map((program) => {
      const programKey = String(program.key || 'PROGRAM');
      const specimenRows = Array.isArray(program.specimens) ? program.specimens : [];
      const specimenFields = Array.isArray(program.specimen_fields) ? program.specimen_fields : [];
      const methodFields = Array.isArray(program.method_fields) ? program.method_fields : [];
      const challengeMode = String(program.challenge_mode || '').toLowerCase();
      const relationships = Array.isArray(program.relationships) ? program.relationships : [];
      const isProviderCase = (challengeMode === 'dry' || /(?:JE1|educational|dry\s*challenge)/i.test(`${programKey} ${program.title || ''} ${program.description || ''}`))
        && specimenRows.length === 1
        && specimenFields.length >= 2
        && specimenFields.every((field) => Array.isArray(field.options) && field.options.length >= 2);
      const table = specimenRows.length && specimenFields.length ? (isProviderCase ? (() => {
        const specimen = specimenRows[0];
        const specimenId = String(specimen.id || specimen.label || '');
        const values = specimens[specimenId] || {};
        return `<div class="provider-case-form"><div class="provider-case-id"><span class="badge info">${esc(specimen.label || specimenId)}</span><span>ตอบตามโจทย์และรหัสตัวเลือกของผู้ให้บริการ</span></div><div class="provider-case-question-list">${specimenFields.map((field, index) => {
          const fieldKey = String(field.key || '');
          const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(specimenId)}" data-provider-field="${esc(fieldKey)}"`;
          return `<div class="provider-case-question"><div class="provider-case-question-head"><span class="question-number">${index + 1}</span><label>${esc(field.label || fieldKey)}</label></div>${generatedFieldControl(field, values[fieldKey], attrs, disabled)}</div>`;
        }).join('')}</div></div>`;
      })() : `<div class="table-wrap"><table class="compact-table cap-entry-table" style="min-width:${Math.max(720, 180 + specimenFields.length * 190)}px"><thead><tr><th>ตัวอย่าง</th>${specimenFields.map((field) => `<th>${esc(field.label || field.key)}</th>`).join('')}</tr></thead><tbody>${specimenRows.map((specimen) => {
        const specimenId = String(specimen.id || specimen.label || '');
        const values = specimens[specimenId] || {};
        return `<tr><td><strong>${esc(specimen.label || specimenId)}</strong></td>${specimenFields.map((field) => {
          const fieldKey = String(field.key || '');
          const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="specimen" data-provider-item="${esc(specimenId)}" data-provider-field="${esc(fieldKey)}"`;
          return `<td>${generatedFieldControl(field, values[fieldKey], attrs, disabled)}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table></div>`) : '<div class="notice warning">แบบกรอกส่วนนี้ยังไม่มีรายการตัวอย่างหรือช่องกรอก กรุณาตรวจเอกสารต้นทางแล้วสร้างใหม่</div>';
      const methods = methodFields.length ? `<details class="result-method-details"><summary>${esc(program.title || programKey)} — วิธีตรวจและรหัสที่ใช้</summary><div class="form-grid cols-3" style="margin-top:12px">${methodFields.map((field) => {
        const fieldKey = String(field.key || '');
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="method" data-provider-item="${esc(programKey)}" data-provider-field="${esc(fieldKey)}"`;
        return `<div class="field"><label>${esc(field.label || fieldKey)}</label>${generatedFieldControl(field, methodsByProgram?.[programKey]?.[fieldKey], attrs, disabled)}</div>`;
      }).join('')}</div></details>` : '';
      const modeLabel = challengeMode === 'dry' ? 'Dry challenge'
        : challengeMode === 'wet' ? 'ตัวอย่างจริง / Wet challenge'
          : challengeMode === 'mixed' ? 'Mixed challenge'
            : '';
      const relationshipHtml = relationships.length ? `<div class="notice info small" style="margin:8px 0 12px"><strong>ความสัมพันธ์ของตัวอย่าง</strong><br>${relationships.map((relationship) => {
        const from = String(relationship?.from_specimen || '').trim();
        const to = String(relationship?.to_specimen || '').trim();
        const type = String(relationship?.type || '').trim();
        const note = String(relationship?.note || '').trim();
        return esc([from && `จาก ${from}`, to && `กับ ${to}`, type, note].filter(Boolean).join(' · '));
      }).join('<br>')}</div>` : '';
      return `<div class="subcard"><div class="provider-program-heading"><h3>${esc(program.title || programKey)}</h3>${modeLabel ? `<span class="badge info">${esc(modeLabel)}</span>` : ''}</div>${program.description ? `<p class="small muted">${esc(program.description)}</p>` : ''}${relationshipHtml}${table}${methods}</div>`;
    }).join('');

    const antigenHtml = (Array.isArray(schema.antigen_sections) ? schema.antigen_sections : []).map((section) => {
      const specimenId = String(section.specimen_id || '');
      const fields = Array.isArray(section.fields) ? section.fields : [];
      const values = antigenTyping[specimenId] || {};
      return `<div class="subcard"><h3>${esc(section.title || `การตรวจแอนติเจน — ${specimenId}`)}</h3><div class="form-grid cols-3">${fields.map((field) => {
        const fieldKey = String(field.key || '');
        const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="antigen" data-provider-item="${esc(specimenId)}" data-provider-field="${esc(fieldKey)}"`;
        return `<div class="field"><label>${esc(field.label || fieldKey)}</label>${generatedFieldControl(field, values[fieldKey], attrs, disabled)}</div>`;
      }).join('')}</div></div>`;
    }).join('');

    const generalFields = Array.isArray(schema.general_fields)
      ? schema.general_fields
      : [
          { key: 'reagents', label: 'น้ำยา / เลขรุ่นผลิต', input_type: 'textarea' },
          { key: 'instrument', label: 'เครื่องมือ', input_type: 'textarea' },
          { key: 'overall_note', label: 'หมายเหตุรวม', input_type: 'textarea' }
        ];
    const generalHtml = generalFields.length ? `<div class="form-grid cols-2">${generalFields.map((field, index) => {
      const fieldKey = String(field.key || '');
      const attrs = `data-provider-prefix="${esc(prefix)}" data-provider-group="general" data-provider-field="${esc(fieldKey)}"`;
      const full = index === generalFields.length - 1 && generalFields.length % 2 === 1 ? ' style="grid-column:1/-1"' : '';
      return `<div class="field"${full}><label>${esc(field.label || fieldKey)}</label>${generatedFieldControl(field, p[fieldKey], attrs, disabled)}</div>`;
    }).join('')}</div>` : '';

    return `<div class="result-grid provider-generated-result-form">
      <div class="notice info"><strong>${esc(schema.title || 'แบบกรอกที่สร้างจากเอกสารผู้ให้บริการ')}</strong><br><span class="small">โครงสร้าง จำนวนช่อง หน่วย และตัวเลือกสร้างจากแบบฟอร์มเปล่าของผู้ให้บริการ ส่วนคู่มือใช้ประกอบคำอธิบาย ผู้จัดการคุณภาพต้องตรวจทานก่อนใช้งาน</span>${instruction ? `<details class="provider-instruction-details" style="margin-top:8px" ${hasEducationalProgram ? 'open' : ''}><summary>${hasEducationalProgram ? 'รายละเอียด Case Study และคำแนะนำ' : 'ดูคำแนะนำภาษาไทย'}</summary><div class="small" style="white-space:pre-wrap;margin-top:8px">${esc(instruction)}</div></details>` : ''}</div>
      ${programHtml}${antigenHtml}${generalHtml}
    </div>`;
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
          <div class="field"><label>ชื่อ Antigen / รหัส antisera</label><input class="input" name="${prefix}_antigen_${specimen}_other_${index}_antigen" value="${esc(row.antigen || '')}" ${disabled ? 'disabled' : ''} placeholder="เช่น 124 │ Anti-K"></div>
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

  function resultForm(payload, prefix = 'result', disabled = false, preferCurrentGeneratedForm = false) {
    // ถ้ารอบมี schema ที่สร้างจากแบบฟอร์มจริง ให้ใช้ก่อนเสมอ เพื่อแยก Program J, JE1 และโปรแกรมอื่นตามเอกสารของรอบนั้น
    // ผลที่ส่งแล้วจากฟอร์มรุ่นเก่ายังคงเปิดอ่านด้วยรูปแบบเดิม แต่ฉบับร่าง/ผลว่างจะเปลี่ยนมาใช้ฟอร์มจริงของรอบแม้กำลังเปิดดูด้วยบทบาทอื่น
    if (preferCurrentGeneratedForm && generatedResultSchema(state.currentRound)) {
      const currentPayload = payload?.schema === PROVIDER_GENERATED_SCHEMA ? payload : defaultResultPayload(state.currentRound);
      return providerGeneratedResultForm(currentPayload, prefix, disabled);
    }
    if (payload?.schema === CAP_J_JE_SCHEMA && (!generatedResultSchema(state.currentRound) || disabled)) return capJJeResultForm(payload, prefix, disabled);
    if (payload?.schema === PROVIDER_GENERATED_SCHEMA || generatedResultSchema(state.currentRound)) return providerGeneratedResultForm(payload, prefix, disabled);
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
    const [{ data: rows, error }, { data: assignments }, { data: confirmations }, { data: consensus }, directory] = await Promise.all([
      state.supabase.from('ec_individual_results').select('*').eq('round_id', round.id).order('updated_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('assignment_role', 'practitioner').eq('active', true).order('practitioner_slot'),
      state.supabase.from('ec_historical_result_confirmations').select('*').eq('round_id', round.id),
      state.supabase.from('ec_consensus_results').select('id,status').eq('round_id', round.id).maybeSingle(),
      loadDirectory()
    ]);
    if (error) throw error;
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const cards = (assignments || []).map((assignment) => {
      const row = (rows || []).find((item) => item.user_id === assignment.user_id);
      const confirmation = row ? (confirmations || []).find((item) => item.individual_result_id === row.id && item.user_id === assignment.user_id) : null;
      const enteredBy = row?.entered_by ? name(row.entered_by) : '-';
      const isOwn = assignment.user_id === state.user.id;
      const mayConfirm = isOwn && hasRole('staff') && row && consensus && round.historical_review_status === 'awaiting_practitioner_confirmation';
      return `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
        <div class="card-header"><div><h3>ผู้ปฏิบัติจริง คนที่ ${assignment.practitioner_slot}: ${esc(name(assignment.user_id))}</h3><div class="small muted">ข้อมูลนี้ต้องอ้างอิงหลักฐานเดิม ไม่ใช่การให้ผู้ปฏิบัติทำผลใหม่</div></div>${historicalConfirmationBadge(confirmation)}</div>
        ${row ? `<div class="grid cols-2">
          <div><strong>วิธีบันทึก</strong><p><span class="badge info">กรอกแทนผู้ปฏิบัติ</span></p></div>
          <div><strong>ผู้กรอกข้อมูลแทน</strong><p>${esc(enteredBy)}<br><span class="small muted">${fmtDate(row.entered_at, true)}</span></p></div>
          <div><strong>วันที่ปฏิบัติจริง</strong><p>${fmtDate(row.performed_at || row.submitted_at, true)}</p></div>
          <div><strong>หลักฐานผลรายบุคคล</strong><p>${row.no_individual_evidence ? '<span class="badge warning">ไม่มีหลักฐานผลรายบุคคลแยก</span>' : '<span class="badge success">มีหลักฐานเดิมสำหรับกรอกผล</span>'}</p></div>
        </div>
        <p><strong>ที่มาของข้อมูล:</strong> ${esc(row.evidence_note || '-')}</p>
        ${row.no_individual_evidence ? `<div class="notice warning">ไม่ได้สร้างคำตอบย้อนหลังแทนบุคลากร ระบบเก็บเฉพาะว่าบุคคลนี้เป็นผู้ร่วมปฏิบัติจริง</div>` : `<button class="btn btn-outline btn-sm" data-view-individual="${row.id}">ดูผลที่กรอกแทน</button>`}
        ` : `<div class="notice warning">ยังไม่ได้กรอกข้อมูลย้อนหลังแทนผู้ปฏิบัติคนนี้</div>`}
        <div class="table-actions" style="margin-top:12px">
          ${canImportHistoricalEqa() ? `<button class="btn btn-primary btn-sm" data-enter-historical-individual="${assignment.user_id}">${row ? 'แก้ไขข้อมูลที่กรอกแทน' : 'กรอกผลย้อนหลังแทนผู้ปฏิบัติ'}</button>` : ''}
          ${mayConfirm ? `<button class="btn btn-success btn-sm" data-confirm-historical-result>ยืนยันว่าข้อมูลตรงกับหลักฐานเดิม</button><button class="btn btn-warning btn-sm" data-dispute-historical-result>แจ้งว่าข้อมูลไม่ตรง</button>` : ''}
        </div>
        ${confirmation?.note ? `<div class="notice ${confirmation.decision === 'confirmed' ? 'success' : 'warning'}" style="margin-top:12px">หมายเหตุจากผู้ปฏิบัติ: ${esc(confirmation.note)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="card">
      <div class="card-header"><div><h2>ผลย้อนหลังของผู้ปฏิบัติจริง</h2><div class="small muted">ผู้ดูแลระบบหรือผู้จัดการคุณภาพกรอกจากหลักฐานเดิมแทนผู้ปฏิบัติ จากนั้นเจ้าตัวตรวจสอบและยืนยัน</div></div><span class="badge info">ข้อมูลย้อนหลัง</span></div>
      <div class="notice"><strong>ห้ามให้ผู้ปฏิบัติทำผล EQA ใหม่เพื่อแทนข้อมูลในอดีต</strong> หากไม่มีผลแยกรายบุคคล ให้เลือก “ไม่มีหลักฐานผลรายบุคคล” และเก็บเฉพาะผลกลางที่ห้องส่งจริง</div>
      <div style="height:14px"></div><div class="grid cols-2">${cards || empty('ยังไม่ได้กำหนดผู้ปฏิบัติจริง')}</div>
      ${(rows || []).length === 2 ? `<div class="modal-footer"><button class="btn btn-primary" data-go-historical-step="consensus">ขั้นต่อไป: กรอกผลกลางที่ห้องส่งจริง</button></div>` : ''}
    </div>`;
  }

  async function openHistoricalIndividualEntry(round, userId) {
    if (!canImportHistoricalEqa()) return toast('เฉพาะผู้ดูแลระบบหรือผู้จัดการคุณภาพเท่านั้น', 'warning');
    const [{ data: existing }, directory] = await Promise.all([
      state.supabase.from('ec_individual_results').select('*').eq('round_id', round.id).eq('user_id', userId).maybeSingle(),
      loadDirectory()
    ]);
    const person = directory.find((item) => item.id === userId);
    const noEvidence = Boolean(existing?.no_individual_evidence);
    showModal(`กรอกผลย้อนหลังแทน — ${person?.full_name || ''}`, `
      <form id="historical-individual-form" class="form-grid">
        <div class="notice"><strong>ผู้ปฏิบัติจริง:</strong> ${esc(person?.full_name || userId)}<br><strong>ผู้กรอกแทน:</strong> ${esc(state.profile.full_name)}<br><span class="small">ระบบเก็บชื่อผู้กรอกแทนและเวลาปัจจุบันอัตโนมัติ</span></div>
        <div class="field"><label>วันที่และเวลาที่ปฏิบัติจริง</label><input class="input" type="datetime-local" name="performed_at" required value="${fmtDateTimeInput(existing?.performed_at || round.actual_submitted_at || round.received_at)}"></div>
        <label style="display:flex;gap:9px;align-items:flex-start"><input type="checkbox" id="no-individual-evidence" name="no_evidence" ${noEvidence ? 'checked' : ''}><span><strong>ไม่มีหลักฐานผลรายบุคคลแยก</strong><br><span class="small muted">เลือกข้อนี้เมื่อมีเพียงผลกลางที่ห้องส่ง ห้ามคาดเดาหรือสร้างผลรายบุคคลย้อนหลัง</span></span></label>
        <div class="field"><label>แหล่งข้อมูล/หลักฐาน</label><textarea class="textarea" name="evidence_note" required placeholder="เช่น แบบบันทึกผลเดิม ลงชื่อผู้ปฏิบัติ 2 คน หน้า...">${esc(existing?.evidence_note || '')}</textarea></div>
        <div id="historical-individual-result-fields">${resultForm(existing?.result_payload, 'historicalIndividual', noEvidence)}</div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-historical-individual">บันทึกข้อมูลที่กรอกแทน</button>`, true);
    bindCapWorkupControls(document.getElementById('historical-individual-form'));
    const checkbox = document.getElementById('no-individual-evidence');
    const toggle = () => {
      document.querySelectorAll('#historical-individual-result-fields input, #historical-individual-result-fields textarea, #historical-individual-result-fields select').forEach((field) => { field.disabled = checkbox.checked; });
      document.querySelectorAll('#historical-individual-result-fields [data-add-workup-panel], #historical-individual-result-fields [data-add-workup-extra], #historical-individual-result-fields [data-remove-workup-row]').forEach((button) => { button.disabled = checkbox.checked; });
    };
    checkbox.addEventListener('change', toggle); toggle();
    document.getElementById('save-historical-individual').addEventListener('click', async () => {
      const form = document.getElementById('historical-individual-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = checkbox.checked ? defaultResultPayload() : collectResultPayload(form, 'historicalIndividual');
      if (!payload) return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning');
      setBusy(true);
      const { error } = await state.supabase.rpc('ec_record_historical_individual_result', {
        p_round_id: round.id,
        p_user_id: userId,
        p_result_payload: payload,
        p_performed_at: new Date(String(fd.get('performed_at'))).toISOString(),
        p_evidence_note: String(fd.get('evidence_note') || '').trim(),
        p_no_individual_evidence: checkbox.checked
      });
      setBusy(false);
      if (error) return toast(friendlyError(error), 'danger');
      closeModal(); toast('บันทึกข้อมูลย้อนหลังแทนผู้ปฏิบัติแล้ว', 'success'); route();
    });
  }

  async function roundIndividual(round) {
    if (isHistoricalRound(round)) return roundHistoricalIndividual(round);
    const { data: rows, error } = await state.supabase.from('ec_individual_results').select('*, ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('round_id', round.id).order('updated_at');
    if (error) throw error;
    const own = (rows || []).find((r) => r.user_id === state.user.id);
    const practitioner = await isPractitioner(round.id);
    const canEditOwn = practitioner && hasRole('staff') && (!own || ['draft','returned'].includes(own.status));
    const useCurrentGeneratedForm = Boolean(generatedResultSchema(round) && (!own || ['draft','returned'].includes(own.status)));
    return `<div class="grid ${canReview() ? 'cols-2' : ''}">
      <div class="card"><div class="card-header"><div><h2>ผลที่ฉันบันทึก</h2><div class="small muted">ระบบเก็บประวัติฉบับเดิมทุกครั้งที่แก้ไข</div></div>${own ? `<span class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, own.status))} · ฉบับที่ ${own.version}</span>` : ''}</div>
        ${practitioner ? `<form id="individual-result-form">${resultForm(own?.result_payload, 'individual', !canEditOwn, useCurrentGeneratedForm)}</form>
          ${canEditOwn ? `<div class="modal-footer"><button class="btn btn-secondary" id="save-individual">บันทึกร่าง</button><button class="btn btn-primary" id="submit-individual">ยืนยันและส่งผล</button></div>` : practitioner && !hasRole('staff') && (!own || ['draft','returned'].includes(own.status)) ? `<div class="notice warning">คุณได้รับมอบหมายเป็นผู้ปฏิบัติจริง กรุณาเปลี่ยน “ใช้งานในบทบาท” เป็นเจ้าหน้าที่ก่อนบันทึกหรือส่งผล</div>` : `<div class="notice">ผลถูกส่งแล้วและล็อกการแก้ไข หากต้องแก้ระบบจะส่งกลับทั้งชุดผ่านขั้นผู้ทบทวนหรือผู้จัดการคุณภาพ</div>`}` : `<div class="notice">หน้านี้ใช้สำหรับผู้ปฏิบัติจริงที่ได้รับมอบหมายเท่านั้น</div>`}
      </div>
      ${canReview() ? `<div class="card"><h2>ผลของผู้ปฏิบัติทั้งหมด</h2>${(rows || []).length ? (rows || []).map((r) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><strong>${esc(r.ec_profiles?.full_name || r.user_id)}</strong><span style="float:right" class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, r.status))} · ฉบับที่ ${r.version}</span><br><span class="small muted">ส่ง ${fmtDate(r.submitted_at, true)}</span><div style="margin-top:8px"><button class="btn btn-outline btn-sm" data-view-individual="${r.id}">ดูผล</button></div></div>`).join('') : empty('ยังไม่มีผู้ปฏิบัติส่งผล')}</div>` : ''}
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
      const rows = fieldDefinitions.map((field) => {
        const raw = x[field.key] || '';
        const option = (field.options || []).find((item) => String(item.value ?? item.code ?? item.label ?? '') === String(raw));
        const shown = option ? generatedOptionLabel(option) : raw;
        return `${esc(field.label || field.key)}: ${esc(shown || '-')}`;
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
      ${unresolved ? `<br><strong>ผู้ทบทวนต้องตรวจและเลือกผลสรุปอีก ${unresolved} รายการก่อนส่งให้ผู้จัดการคุณภาพ</strong>` : '<br>ค่าที่ต่างกันได้รับการตรวจครบแล้ว'}
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
      loadDirectory()
    ]);
    const name = (id) => directory.find((person) => person.id === id)?.full_name || id;
    const reviewer = (assignments || []).find((assignment) => assignment.assignment_role === 'reviewer');
    const isAssignedReviewer = reviewer?.user_id === state.user.id;
    const reviewerCanAct = hasRole('reviewer') && isAssignedReviewer && round.historical_review_status === 'awaiting_reviewer';
    const qmCanAct = hasRole('qm') && round.historical_review_status === 'awaiting_qm_certification';
    const stages = [
      ['historical_practitioner_confirm','ผู้ปฏิบัติจริงตรวจและยืนยันข้อมูลของตน'],
      ['historical_reviewer_review','ผู้ทบทวนตรวจข้อมูลและหลักฐานย้อนหลัง'],
      ['historical_qm_certification','ผู้จัดการคุณภาพรับรองและเปิดการประเมิน']
    ];
    return `<div class="grid cols-2">
      <div class="card"><h2>ลำดับการตรวจข้อมูลย้อนหลัง</h2><div class="timeline">${stages.map(([stage,label]) => {
        const found = (approvals || []).filter((item) => item.stage === stage);
        return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(label)}</strong><br>${found.length ? found.map((item) => `${esc(approvalSignerText(name(item.approver_id), item))} — ${esc(labelFrom(DECISION_LABELS, item.decision))} (${fmtDate(item.signed_at, true)})${item.note ? `<br><span class="small muted">${esc(item.note)}</span>` : ''}`).join('<br>') : '<span class="muted">ยังไม่มีการรับรอง</span>'}</div></div>`;
      }).join('')}</div></div>
      <div class="card"><h2>ดำเนินการตามลำดับ</h2>
        <div class="notice">สถานะปัจจุบัน: <strong>${esc(labelFrom(HISTORICAL_REVIEW_LABELS, round.historical_review_status))}</strong></div>
        ${reviewerCanAct ? `<div class="form-grid"><div class="field"><label>ข้อคิดเห็นของผู้ทบทวน</label><textarea class="textarea" id="historical-reviewer-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="historical-reviewer-approve">ตรวจผ่านและส่งให้ผู้จัดการคุณภาพ</button><button class="btn btn-warning" id="historical-reviewer-return">ส่งกลับให้แก้ข้อมูลย้อนหลัง</button></div></div>` : ''}
        ${qmCanAct ? `<div class="form-grid"><div class="notice success">ผู้ทบทวนตรวจผ่านแล้ว ผู้จัดการคุณภาพสามารถรับรองและเปิดการประเมินความสามารถได้</div><div class="field"><label>หมายเหตุผู้จัดการคุณภาพ</label><textarea class="textarea" id="historical-qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="historical-qm-approve">รับรองข้อมูลและเปิดการประเมิน</button><button class="btn btn-warning" id="historical-qm-return">ส่งกลับแก้ไข</button></div></div>` : ''}
        ${round.historical_review_status === 'qm_certified' ? `<div class="notice success"><strong>รับรองข้อมูลย้อนหลังแล้ว</strong><br>สามารถไปหัวข้อ 10 เพื่อสร้างรายการประเมิน ผู้ปฏิบัติจริง 2 คนจะได้แบบประเมินการปฏิบัติงาน ส่วนเจ้าหน้าที่คนอื่นจะได้แบบทดสอบ</div><div class="modal-footer"><button class="btn btn-primary" data-go-historical-step="competency">ไปเปิดการประเมินความสามารถ</button></div>` : ''}
        ${hasRole('reviewer') && reviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนเป็น ${esc(name(reviewer.user_id))} คุณเปิดดูได้แต่กดตรวจผ่านไม่ได้</div>` : ''}
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
    const pairComplete = practitionerAssignments.length === 2 && practitionerAssignments.every((row) => submittedIds.has(row.user_id));
    const isAssignedReviewer = Boolean(assignedReviewer && assignedReviewer.user_id === state.user.id);
    const reviewerCanEdit = Boolean(consensus && hasRole('reviewer') && isAssignedReviewer && ['practitioners_confirmed','returned'].includes(consensus.status));
    const canSeeComparison = pairComplete && (practitioner || canReview() || hasRole('physician','viewer'));
    const sentForward = consensus && ['awaiting_qm_review','qm_approved','awaiting_physician_approval','physician_approved','submitted','locked'].includes(consensus.status);
    return `<div class="card"><div class="card-header"><div><h2>สรุปผลห้องปฏิบัติการ</h2><div class="small muted">เมื่อผู้ปฏิบัติทั้งสองคนส่งผลครบ ระบบจะเทียบผลและเติมค่าที่ตรงกันให้อัตโนมัติ ผู้ทบทวนตรวจเฉพาะค่าที่ต่างกันแล้วส่งให้ผู้จัดการคุณภาพ</div></div>${consensus ? `<span class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status))} · ฉบับที่ ${consensus.version}</span>` : ''}</div>
      ${!pairComplete ? `<div class="notice warning">ยังสร้างสรุปไม่ได้ ต้องรอผู้ปฏิบัติจริงทั้ง 2 คนกด “ยืนยันและส่งผล” ให้ครบก่อน</div>` : ''}
      ${pairComplete && !consensus ? `<div class="notice warning">ผู้ปฏิบัติส่งครบแล้ว ระบบกำลังสร้างสรุปผลห้องปฏิบัติการ กรุณารีเฟรชหน้านี้อีกครั้ง</div>` : ''}
      ${canSeeComparison ? `<h3>เปรียบเทียบผลของผู้ปฏิบัติ</h3>${resultComparison((individualRows || []).filter((row) => submittedIds.has(row.user_id)), consensus)}<div style="height:18px"></div>` : ''}
      ${consensus && canSeeComparison ? `${autoLabSummaryPanel(consensus)}<div style="height:18px"></div><h3>สรุปผลที่ใช้ส่งต่อ</h3><form id="consensus-form">${resultForm(consensus.result_payload, 'consensus', !reviewerCanEdit)}</form>
        ${reviewerCanEdit ? `<div class="field"><label>หมายเหตุผู้ทบทวน</label><textarea class="textarea" id="reviewer-summary-note" placeholder="ระบุเหตุผลเมื่อเลือกผลสรุปต่างจากผู้ปฏิบัติ หรือหมายเหตุเพิ่มเติม">${esc(consensus.reviewer_note || '')}</textarea></div>` : consensus.reviewer_note ? `<div class="notice"><strong>หมายเหตุผู้ทบทวน:</strong> ${esc(consensus.reviewer_note)}</div>` : ''}
        <div class="modal-footer">
          ${reviewerCanEdit ? `<button class="btn btn-secondary" id="save-reviewer-summary">บันทึกร่างสรุป</button><button class="btn btn-primary" id="finalize-reviewer-summary">ตรวจเสร็จและส่งให้ผู้จัดการคุณภาพ</button>` : ''}
          ${canReview() ? `<button class="btn btn-outline" id="print-consensus">พิมพ์สรุปผล</button>` : ''}
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
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true)
    ]);
    const assignedReviewer = (assignments || []).find((a) => a.assignment_role === 'reviewer');
    const isAssignedReviewer = Boolean(assignedReviewer && assignedReviewer.user_id === state.user.id);
    const reviewerCanAct = consensus && hasRole('reviewer') && isAssignedReviewer && ['practitioners_confirmed','returned'].includes(consensus.status);
    const qmCanAct = consensus && hasRole('qm') && ['awaiting_qm_review'].includes(consensus.status);
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
        ${qmCanAct ? `<div class="form-grid"><div class="notice">ผู้ทบทวนตรวจสรุปและส่งมาแล้ว ผู้จัดการคุณภาพจึงสามารถรับรองได้</div><div class="field"><label>หมายเหตุผู้จัดการคุณภาพ</label><textarea class="textarea" id="qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="qm-approve">ผู้จัดการคุณภาพรับรอง</button><button class="btn btn-warning" id="qm-return">ส่งกลับให้ผู้ทบทวนแก้สรุป</button></div></div>` : ''}
        ${physicianCanAct ? `<div class="form-grid"><div class="notice">ผู้จัดการคุณภาพรับรองแล้ว แพทย์ตรวจดูและกดรับทราบ</div><div class="field"><label>หมายเหตุแพทย์</label><textarea class="textarea" id="physician-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="physician-acknowledge">แพทย์รับทราบ</button><button class="btn btn-warning" id="physician-return">ส่งกลับผู้จัดการคุณภาพ</button></div></div>` : ''}
        ${consensus && !reviewerCanAct && !qmCanAct && !physicianCanAct ? `<div class="notice">สถานะปัจจุบัน: ${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status, consensus.status))}<br>ระบบจะเปิดปุ่มให้เฉพาะผู้มีหน้าที่ในลำดับปัจจุบันเท่านั้น</div>` : ''}
        ${hasRole('reviewer') && assignedReviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนคนอื่น คุณเปิดดูได้แต่ไม่สามารถส่งสรุปได้</div>` : ''}
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
      { data: questions, error: questionError },
      { data: assignments, error: assignmentError },
      { data: documents, error: documentError },
      { data: keys, error: keyError },
      { data: generationRuns, error: runError },
      directory
    ] = await Promise.all([
      state.supabase.from('ec_questions').select('*, ec_question_choices(*)').eq('round_id', round.id).order('question_order'),
      state.supabase.from('ec_competency_assignments').select('*').eq('round_id', round.id).neq('status', 'cancelled').order('created_at'),
      state.supabase.from('ec_round_documents').select('id,title,file_name,mime_type,visibility,category').eq('round_id', round.id).is('archived_at', null).order('created_at', { ascending: false }),
      state.supabase.from('ec_question_answer_keys').select('question_id,correct_choice_ids,answer_key_json,explanation'),
      state.supabase.from('ec_ai_generation_runs').select('*').eq('round_id', round.id).order('created_at', { ascending: false }).limit(5),
      loadDirectory()
    ]);
    if (questionError || assignmentError || documentError || keyError || runError) throw (questionError || assignmentError || documentError || keyError || runError);

    const adminImageMap = await loadSignedImageMap((questions || []).flatMap((question) => questionImageIds(question)));
    const name = (id) => directory.find((p) => p.id === id)?.full_name || id;
    const imageName = (id) => (documents || []).find((doc) => doc.id === id)?.title || '';
    const keyMap = new Map((keys || []).map((key) => [key.question_id, key]));
    const sourceCategories = new Set(['source_document','instruction','raw_result_image','antibody_panel']);
    const sourceDocs = (documents || []).filter((doc) => sourceCategories.has(doc.category));
    const officialDocs = (documents || []).filter((doc) => doc.category === 'official_result');
    const participantSummaryDocs = (documents || []).filter((doc) => doc.category === 'participant_summary');
    const formBasedCompetency = Boolean(generatedResultSchema(round));
    const supplementalQuestions = formBasedCompetency
      ? (questions || []).filter((question) => !question.generated_by_ai)
      : (questions || []);
    const parkedAiQuestions = formBasedCompetency
      ? (questions || []).filter((question) => question.generated_by_ai)
      : [];
    const evidenceDocs = (documents || []).filter((doc) => ['raw_result_image','antibody_panel'].includes(doc.category));
    const hiddenEvidenceDocs = evidenceDocs.filter((doc) => doc.visibility !== 'all_staff');
    const latestRun = generationRuns?.[0] || null;
    const canCreateCompetency = canManage() && (!isHistoricalRound(round) || round.historical_review_status === 'qm_certified');
    const closePassed = round.competency_close_at && new Date(round.competency_close_at).getTime() < Date.now();
    const windowText = round.competency_close_at
      ? `${round.competency_open_at ? `เปิด ${fmtDate(round.competency_open_at, true)} · ` : ''}ปิด ${fmtDate(round.competency_close_at, true)}`
      : 'ยังไม่ได้กำหนดวันปิด Competency';

    const actionFor = (assignment) => {
      const actions = [];
      if (hasRole('reviewer')) {
        const canReviewQuiz = assignment.assignment_type === 'quiz' && assignment.status === 'submitted';
        const canReviewPractical = assignment.assignment_type === 'practical' && ['not_started','in_progress','submitted'].includes(assignment.status);
        if (canReviewQuiz || canReviewPractical) actions.push(`<button class="btn btn-primary btn-sm" data-review-competency="${assignment.id}" data-type="${assignment.assignment_type}">ตรวจประเมิน</button>`);
        if (assignment.status === 'reflection_submitted') actions.push(`<button class="btn btn-primary btn-sm" data-review-reflection="${assignment.id}">ตรวจแบบทบทวน</button>`);
      }
      if (hasRole('qm') && assignment.status === 'under_review') {
        actions.push(`<button class="btn btn-success btn-sm" data-qm-approve-competency="${assignment.id}">รับรองผล</button>`);
        actions.push(`<button class="btn btn-warning btn-sm" data-qm-return-competency="${assignment.id}">ส่งกลับผู้ทบทวน</button>`);
      }
      if (!['not_started','in_progress','cancelled'].includes(assignment.status) && canReview()) {
        actions.push(`<button class="btn btn-outline btn-sm" data-archive-competency="${assignment.id}" data-archive-stage="${assignment.status}">เก็บ PDF ใน Drive</button>`);
      }
      return actions.length ? actions.join('') : '<span class="small muted">รอตามลำดับงาน</span>';
    };

    const aiNotice = canManage() ? `<div class="compact-status">
      <span>ไฟล์ต้นทาง <strong>${sourceDocs.length}</strong></span>
      <span>Official Evaluation <strong>${officialDocs.length}</strong></span>
      <span>Participant Summary <strong>${participantSummaryDocs.length}</strong></span>
      <span>ภาพสำหรับ Competency <strong>${evidenceDocs.length}</strong></span>
      <span>คำถามเสริม <strong>${supplementalQuestions.length}</strong></span>
      <span>รูปแบบ <strong>${formBasedCompetency ? 'แบบกรอกเดียวกับผลรายบุคคล' : esc(resolveProgramProfile(round).label)}</strong></span>
      <button class="text-link" type="button" data-nav="help">ดูคู่มือ</button>
    </div>` : '';

    return `<div class="competency-admin-layout">
      <div class="card competency-question-manager">
        <div class="card-header"><div><h2>${formBasedCompetency ? 'แบบประเมินของเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง' : 'ข้อสอบ'}</h2></div></div>
        ${aiNotice}
        ${formBasedCompetency ? `<div class="notice success"><strong>หัวข้อ 10 ใช้เฉพาะเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง</strong><br>ผู้ปฏิบัติจริง 2 คนถูกประเมินผ่านผลรายบุคคลในหัวข้อ 4 แล้ว จึงไม่ต้องทำซ้ำในหัวข้อ 10 ส่วนเจ้าหน้าที่คนอื่นจะใช้ภาพผลดิบสำหรับ Part J/JE แบบ Wet และใช้ Case Study/คำถามในแบบฟอร์มสำหรับ JE แบบ Dry</div>
        <div style="height:10px"></div>${hiddenEvidenceDocs.length ? `<div class="notice warning"><strong>มี ${hiddenEvidenceDocs.length} ไฟล์ที่เจ้าหน้าที่ทั่วไปอาจเปิดดูไม่ได้</strong><br>ไปที่หัวข้อ 2 แล้วแก้สิทธิ์ภาพผลดิบ/Panel ที่จำเป็นเป็น “บุคลากรทุกคน”</div><div style="height:10px"></div>` : ''}
        ${parkedAiQuestions.length ? `<details class="notice info"><summary><strong>พักคำถามที่ AI สร้างไว้ ${parkedAiQuestions.length} ข้อ</strong></summary><div class="small" style="margin-top:8px">คำถามเหล่านี้ไม่ถูกใช้ซ้ำ เพราะเนื้อหาอยู่ในแบบกรอกหลักแล้ว จึงไม่ทำให้เจ้าหน้าที่ต้องตอบซ้ำ</div></details><div style="height:10px"></div>` : ''}` : ''}
        ${canManage() ? `<div class="table-actions" style="margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-outline" id="go-document-ai-tools">${formBasedCompetency ? 'ตรวจเอกสารและภาพผลดิบ' : 'สร้างจากเอกสาร'}</button>
          <button class="btn btn-outline" id="publish-all-questions" ${supplementalQuestions.length ? '' : 'disabled'}>เผยแพร่คำถามเสริม</button>
          <button class="btn btn-outline" id="add-question">＋ เพิ่มคำถามเสริม</button>
        </div>` : ''}
        ${latestRun ? (() => { const stale = latestRun.status === 'processing' && Date.now() - new Date(latestRun.created_at).getTime() > 5 * 60 * 1000; const statusText = latestRun.status === 'completed' ? 'สำเร็จ' : latestRun.status === 'failed' || stale ? 'ไม่สำเร็จ/หมดเวลา' : 'กำลังประมวลผล'; return `<div class="small muted" style="margin-bottom:10px">การสร้างล่าสุด: ${latestRun.generation_type === 'document_extract' ? 'อ่านเอกสาร' : latestRun.generation_type === 'form_instructions' ? 'แบบกรอก/คำแนะนำ' : latestRun.generation_type === 'questions' ? 'ข้อสอบ' : 'เฉลยและสรุป'} · ${statusText} · ${fmtDate(latestRun.created_at, true)}${latestRun.generated_summary ? `<br>${esc(latestRun.generated_summary)}` : ''}${latestRun.error_message ? `<br>${esc(latestRun.error_message)}` : ''}</div>`; })() : ''}
        ${supplementalQuestions.length ? `<div class="admin-question-list">${supplementalQuestions.map((q) => {
          const key = keyMap.get(q.id);
          const hasKey = Boolean(key?.correct_choice_ids?.length || key?.answer_key_json?.text);
          const needsManualReview = Boolean(key?.answer_key_json?.needs_manual_review);
          const answerBasisLabel = {
            official_intended_response: 'อิง Intended Response',
            participant_consensus: 'อิง Participant consensus',
            insufficient: 'หลักฐานไม่พอ'
          }[key?.answer_key_json?.answer_basis] || '';
          const referenceAnswer = String(key?.answer_key_json?.challenge_type === 'educational'
            ? (key?.answer_key_json?.consensus_result || key?.answer_key_json?.text || '')
            : (key?.answer_key_json?.text || '')).trim();
          const referencePercent = String(key?.answer_key_json?.consensus_percent || '').trim();
          const sortedChoices = (q.ec_question_choices || []).slice().sort((a, b) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
          const galleryHtml = questionImageGallery(q, adminImageMap, 'admin');
          const promptParts = questionPromptParts(q.prompt);
          return `<article class="admin-question-card">
            <div class="admin-question-top">
              <div class="question-order-badge">${q.question_order}</div>
              <div class="admin-question-title"><span class="question-section">${esc(q.section || 'การแปลผล EQA')}</span><h3>${esc(promptParts.prompt)}</h3></div>
              <div class="question-status-stack">
                <span class="badge ${q.published?'success':'warning'}">${q.published?'เผยแพร่แล้ว':'ฉบับร่าง'}</span>
                <span class="badge ${hasKey?'success':'warning'}">${hasKey?'มีเฉลย':'รอเฉลย'}</span>
              </div>
            </div>
            ${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}
            ${galleryHtml || `<div class="notice warning small">คำถามนี้ยังไม่ได้ผูกกับภาพผลดิบ</div>`}
            ${questionImageIds(q).length ? `<div class="question-source-chip">เอกสาร/รูปประกอบ ${questionImageIds(q).length} ไฟล์</div>` : ''}
            ${isAntibodyIdentificationQuestion(q) && q.question_type !== 'single_choice'
              ? `<div class="question-catalog-note"><strong>ตัวอย่างช่องที่ผู้ทำข้อสอบจะเห็น</strong><span>พิมพ์ Anti-K แล้วเลือกรายการจาก CAP Master List ได้มากกว่า 1 รายการ</span><input class="input" type="search" list="cap-antibody-preview-${q.id}" placeholder="พิมพ์ Anti- หรือรหัส CAP เช่น 124" autocomplete="off">${capAntibodyDatalist(`cap-antibody-preview-${q.id}`)}</div>`
              : sortedChoices.length ? `<div class="question-choice-preview">${sortedChoices.map((choice) => `<div><span class="choice-dot"></span>${esc(choice.choice_text)}</div>`).join('')}</div>` : ''}
            ${referenceAnswer ? `<div class="answer-key-preview"><span class="small muted">${key?.answer_key_json?.challenge_type === 'educational' ? 'คำตอบของผู้เข้าร่วมส่วนใหญ่' : 'แนวคำตอบ/เฉลย'}</span><strong>${esc(referenceAnswer)}</strong>${referencePercent ? `<span class="badge info">${esc(referencePercent)}</span>` : ''}</div>` : ''}
            <div class="admin-question-footer">
              <div class="question-meta">
                <span>${esc(labelFrom(QUESTION_TYPE_LABELS, q.question_type))}</span>
                <span>${q.points} คะแนน</span>
                ${q.is_critical ? '<span class="danger-text">ข้อสำคัญ</span>' : ''}
                ${needsManualReview ? '<span class="danger-text">ต้องตรวจเอง</span>' : ''}
                ${answerBasisLabel ? `<span>${esc(answerBasisLabel)}</span>` : ''}
              </div>
              ${canManage()?`<div class="table-actions"><button class="btn btn-outline btn-sm" data-edit-question="${q.id}">แก้ไข</button><button class="btn btn-danger btn-sm" data-delete-question="${q.id}" data-question-label="${esc(`${q.question_order}. ${q.prompt}`)}">ลบ</button></div>`:''}
            </div>
          </article>`;
        }).join('')}</div>` : (formBasedCompetency ? `<div class="notice info">ยังไม่มีคำถามเสริม ซึ่งไม่เป็นปัญหา แบบประเมินหลักจะใช้แบบกรอกผลและภาพผลดิบโดยตรง</div>` : empty('ยังไม่มีคำถาม'))}
      </div>
      <div class="card">
        <div class="card-header"><div><h2>การมอบหมายและตรวจประเมิน</h2></div>${canCreateCompetency?`<button class="btn btn-primary" id="assign-all-competency">สร้างรายการประเมิน</button>`:''}</div>
        <div class="notice ${closePassed ? 'danger' : 'info'}"><strong>${closePassed ? 'ปิดรับคำตอบแล้ว' : 'ช่วงเวลาทำ Competency'}</strong><br>${esc(windowText)}${canManage() ? `<div style="margin-top:8px"><button class="btn btn-outline btn-sm" id="set-competency-window">กำหนด/แก้ไขวันเปิด–ปิด</button></div>` : ''}</div>
        <div style="height:12px"></div>
        ${isHistoricalRound(round) && round.historical_review_status !== 'qm_certified' ? `<div class="notice warning">ต้องให้ผู้ปฏิบัติ ผู้ทบทวน และผู้จัดการคุณภาพรับรองข้อมูลย้อนหลังให้ครบก่อน จึงจะสร้างรายการประเมินได้</div><div style="height:12px"></div>` : ''}
        ${isHistoricalRound(round) && round.historical_review_status === 'qm_certified' && !round.competency_close_at ? `<div class="notice warning">กรุณากำหนดวันปิด Competency ก่อนสร้างรายการประเมิน</div><div style="height:12px"></div>` : ''}
        ${(assignments || []).length ? `<div class="table-wrap"><table style="min-width:760px"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${assignments.map((a)=>`<tr><td>${esc(name(a.user_id))}</td><td>${esc(a.assignment_type === 'quiz' && formBasedCompetency ? 'ประเมินจากภาพผลดิบ' : labelFrom(COMPETENCY_TYPE_LABELS, a.assignment_type))}</td><td>${assignmentBadge(a.status)}</td><td>${a.score ?? '-'}</td><td><div class="table-actions">${actionFor(a)}</div></td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่ได้สร้างรายการประเมิน')}
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
    document.querySelectorAll('[data-enter-historical-individual]').forEach((button) => button.addEventListener('click', () => openHistoricalIndividualEntry(round, button.dataset.enterHistoricalIndividual)));
    document.querySelectorAll('[data-view-individual]').forEach((button) => button.addEventListener('click', async () => {
      const { data, error } = await state.supabase.from('ec_individual_results').select('*').eq('id', button.dataset.viewIndividual).single();
      if (error) return toast(friendlyError(error), 'danger');
      showModal('ผลย้อนหลังที่กรอกแทนผู้ปฏิบัติ', resultForm(data.result_payload, 'viewHistorical', true), '', true);
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

    document.getElementById('generate-form-only')?.addEventListener('click', () => openBundleModal('form'));
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
          ? ' อัปโหลดเอกสารต้นทางแล้ว เมื่อไฟล์ครบให้กด “สร้างแบบกรอก คำแนะนำ และข้อสอบจากเอกสาร”'
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
      const [{ data: current }, directory] = await Promise.all([
        state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true), loadDirectory()
      ]);
      const find = (role, slot) => current?.find((a) => a.assignment_role === role && (slot ? a.practitioner_slot === slot : true))?.user_id || '';
      const options = (people, selected, blankLabel = 'กรุณาเลือก') => `<option value="">${blankLabel}</option>${people.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name)}${p.position_title ? ` — ${esc(p.position_title)}` : ''}</option>`).join('')}`;
      const practitioners = directory.filter((p) => personHasRole(p, 'staff') && !personHasRole(p, 'physician'));
      const reviewers = directory.filter((p) => personHasRole(p, 'reviewer'));
      const physicians = directory.filter((p) => personHasRole(p, 'physician'));
      showModal('กำหนดผู้รับผิดชอบ', `<form id="assignment-form" class="form-grid cols-2">
        <div class="notice" style="grid-column:1/-1"><strong>ลำดับการทำงาน:</strong> ผู้ปฏิบัติ 2 คนส่งผล → ระบบสร้างสรุปอัตโนมัติ → ผู้ทบทวนตรวจ/ส่ง → ผู้จัดการคุณภาพรับรอง → แพทย์รับทราบ<br><span class="small">ผู้จัดการคุณภาพสามารถเป็นหนึ่งในผู้ปฏิบัติจริงได้ แต่ต้องสลับบทบาทให้ตรงกับการกระทำแต่ละขั้น ระบบจะบันทึกบทบาทที่ใช้ลงนามแยกกัน ผู้ทบทวนยังต้องเป็นคนละคนกับผู้ปฏิบัติทั้งสองคน</span></div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 1</label><select class="select" name="p1" required>${options(practitioners, find('practitioner',1))}</select></div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 2</label><select class="select" name="p2" required>${options(practitioners, find('practitioner',2))}</select></div>
        <div class="field"><label>ผู้ทบทวนผล</label><select class="select" name="reviewer" required>${options(reviewers, find('reviewer'))}</select><div class="help">ต้องเป็นคนละคนกับผู้ปฏิบัติทั้งสองคน</div></div>
        <div class="field"><label>แพทย์ผู้รับทราบที่คาดไว้</label><select class="select" name="physician">${options(physicians, find('physician'), 'ยังไม่ระบุ — แพทย์ผู้รับรองคนใดก็ได้สามารถรับทราบ')}</select><div class="help">แพทย์ไม่ต้องมีบทบาทเจ้าหน้าที่และไม่ถูกมอบหมายแบบทดสอบ</div></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-assignments">บันทึก</button>`);
      document.getElementById('save-assignments').addEventListener('click', async () => {
        const form = document.getElementById('assignment-form');
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const p1=String(fd.get('p1')||''), p2=String(fd.get('p2')||''), reviewer=String(fd.get('reviewer')||''), physician=String(fd.get('physician')||'');
        if (p1 === p2) return toast('ผู้ปฏิบัติคนที่ 1 และคนที่ 2 ต้องเป็นคนละคน', 'warning');
        if ([p1,p2].includes(reviewer)) return toast('ผู้ทบทวนต้องเป็นคนละคนกับผู้ปฏิบัติจริง', 'warning');
        await state.supabase.from('ec_round_assignments').update({active:false}).eq('round_id', round.id).eq('active', true);
        const rows=[
          {round_id:round.id,user_id:p1,assignment_role:'practitioner',practitioner_slot:1,assigned_by:state.user.id},
          {round_id:round.id,user_id:p2,assignment_role:'practitioner',practitioner_slot:2,assigned_by:state.user.id},
          {round_id:round.id,user_id:reviewer,assignment_role:'reviewer',practitioner_slot:null,assigned_by:state.user.id}
        ];
        if(physician) rows.push({round_id:round.id,user_id:physician,assignment_role:'physician',practitioner_slot:null,assigned_by:state.user.id});
        const {error}=await state.supabase.from('ec_round_assignments').insert(rows);
        if(error)return toast(friendlyError(error), 'danger');
        closeModal();toast('บันทึกผู้รับผิดชอบแล้ว','success');route();
      });
    });
  }

    function bindIndividual(round) {
    const save = async (submit) => {
      const form=document.getElementById('individual-result-form'); if(!form)return;
      const payload=collectResultPayload(form,'individual');
      if (!payload) return toast('กรุณาสร้างแบบกรอกจากฟอร์มเปล่าของรอบนี้ก่อนบันทึกผล', 'warning');
      const {data: existing}=await state.supabase.from('ec_individual_results').select('id,status').eq('round_id',round.id).eq('user_id',state.user.id).maybeSingle();
      const row={round_id:round.id,user_id:state.user.id,result_payload:payload,status:submit?'submitted':'draft',started_at:new Date().toISOString(),submitted_at:submit?new Date().toISOString():null};
      const res=existing?await state.supabase.from('ec_individual_results').update(row).eq('id',existing.id):await state.supabase.from('ec_individual_results').insert(row);
      if(res.error)return toast(friendlyError(res.error), 'danger'); toast(submit?'ส่งผลแล้ว':'บันทึกร่างแล้ว','success'); route();
    };
    document.getElementById('save-individual')?.addEventListener('click',()=>save(false));
    document.getElementById('submit-individual')?.addEventListener('click',()=>{ if(confirm('ยืนยันส่งผลรายบุคคลหรือไม่ หลังส่งจะแก้ไขเองไม่ได้')) save(true); });
    document.querySelectorAll('[data-view-individual]').forEach((b)=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_individual_results').select('*,ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('id',b.dataset.viewIndividual).single();if(error)return toast(friendlyError(error), 'danger');showModal(`ผลของ ${data.ec_profiles?.full_name||''}`,resultForm(data.result_payload,'view',true),'',true);}));
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
      if (!confirm('ยืนยันว่าตรวจค่าที่ต่างกันครบแล้ว และส่งสรุปผลให้ผู้จัดการคุณภาพหรือไม่')) return;
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
      toast('ส่งสรุปผลให้ผู้จัดการคุณภาพแล้ว', 'success'); navigate(`round/${round.id}/approval`);
    });

    document.getElementById('print-consensus')?.addEventListener('click', () => window.print());
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

    const openQuestion = async (row = null) => {
      let choices = [];
      let key = null;
      const requests = [state.supabase.from('ec_round_documents').select('id,title,file_name,mime_type,visibility').eq('round_id', round.id).like('mime_type', 'image/%').order('created_at', { ascending: false })];
      if (row?.id) {
        requests.push(state.supabase.from('ec_question_choices').select('*').eq('question_id', row.id).order('choice_order'));
        requests.push(state.supabase.from('ec_question_answer_keys').select('*').eq('question_id', row.id).maybeSingle());
      }
      const results = await Promise.all(requests);
      const imageDocuments = results[0].data || [];
      if (results[0].error) return toast(friendlyError(results[0].error), 'danger');
      if (row?.id) {
        choices = results[1].data || [];
        key = results[2].data || null;
      }
      const correctIndex = choices.findIndex((choice) => (key?.correct_choice_ids || []).includes(choice.id));
      const keyJson = key?.answer_key_json && typeof key.answer_key_json === 'object' ? key.answer_key_json : {};
      const currentReferenceAnswer = String(keyJson.challenge_type === 'educational' ? (keyJson.consensus_result || keyJson.text || '') : (keyJson.text || '')).trim();
      const imageOptions = imageDocuments.length
        ? `<option value="">ไม่ใช้รูปประกอบ</option>${imageDocuments.map((doc) => `<option value="${doc.id}" ${row?.image_document_id===doc.id?'selected':''}>${esc(doc.title)} — ${esc(doc.file_name)}${doc.visibility==='staff'?'':' (ระบบจะเปิดให้บุคลากรทุกคน)'}</option>`).join('')}`
        : '<option value="">ยังไม่มีไฟล์รูปในหัวข้อ 2. เอกสาร/ภาพ</option>';
      showModal(row ? 'แก้ไขคำถาม' : 'เพิ่มคำถาม', `<form id="question-form" class="form-grid cols-2">
        <input type="hidden" name="id" value="${esc(row?.id || '')}">
        ${row?.generated_by_ai ? '<div class="notice info" style="grid-column:1/-1">คำถามนี้สร้างจากไฟล์อัตโนมัติ กรุณาตรวจข้อความ ตัวเลือก และเฉลยก่อนเผยแพร่</div>' : ''}
        <div class="field"><label>ลำดับ</label><input class="input" type="number" name="order" required value="${esc(row?.question_order || 1)}"></div>
        <div class="field"><label>หัวข้อ</label><input class="input" name="section" value="${esc(row?.section || '')}"></div>
        <div class="field"><label>ประเภท</label><select class="select" name="type">${Object.entries(QUESTION_TYPE_LABELS).map(([value,label])=>`<option value="${value}" ${row?.question_type===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div>
        <div class="field"><label>คะแนน</label><input class="input" type="number" step="0.1" name="points" value="${esc(row?.points || 1)}"></div>
        <div class="field" style="grid-column:1/-1"><label>คำถาม</label><textarea class="textarea" name="prompt" required>${esc(row?.prompt || '')}</textarea></div>
        <div class="field" style="grid-column:1/-1"><label>รูปประกอบจากหัวข้อ 2. เอกสาร/ภาพ</label><select class="select" name="image_document_id">${imageOptions}</select><div class="help">เมื่อใช้เป็นรูปข้อสอบ ระบบจะตั้งสิทธิ์ไฟล์เป็น “บุคลากรทุกคน”</div></div>
        <div class="field" style="grid-column:1/-1"><label>ตัวเลือก (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</label><textarea class="textarea" name="choices">${esc(choices.map((choice) => choice.choice_text).join('\n'))}</textarea></div>
        <div class="field"><label>ลำดับตัวเลือกที่ถูก</label><input class="input" type="number" name="correct" min="1" value="${correctIndex >= 0 ? correctIndex + 1 : ''}"><div class="help">ใช้สำหรับข้อเลือกคำตอบเดียว</div></div>
        <div class="field"><label>ประเภทการประเมิน</label><select class="select" name="challenge_type"><option value="graded" ${keyJson.challenge_type==='graded'?'selected':''}>Graded — มีเฉลยทางการ</option><option value="educational" ${keyJson.challenge_type==='educational'?'selected':''}>Educational — ใช้คำตอบส่วนใหญ่</option><option value="unknown" ${!keyJson.challenge_type||keyJson.challenge_type==='unknown'?'selected':''}>รอตรวจ</option></select></div>
        <div class="field"><label>แหล่งอ้างอิงคำตอบ</label><select class="select" name="answer_basis"><option value="official_intended_response" ${keyJson.answer_basis==='official_intended_response'?'selected':''}>Official Intended Response</option><option value="participant_consensus" ${keyJson.answer_basis==='participant_consensus'?'selected':''}>Participant consensus</option><option value="insufficient" ${!keyJson.answer_basis||keyJson.answer_basis==='insufficient'?'selected':''}>หลักฐานยังไม่พอ</option></select></div>
        <div class="field"><label>ร้อยละของคำตอบส่วนใหญ่</label><input class="input" name="consensus_percent" value="${esc(keyJson.consensus_percent || '')}" placeholder="เช่น 98.0%"></div>
        <div class="field" style="grid-column:1/-1"><label>แนวคำตอบ / คำตอบส่วนใหญ่</label><textarea class="textarea" name="reference_answer" placeholder="เช่น 115 │ Anti-E; 124 │ Anti-K">${esc(currentReferenceAnswer)}</textarea><div class="help">ข้อ Antibody Identification ใส่ได้หลายรายการ คั่นด้วย ; ระบบจะเทียบโดยไม่สนลำดับ</div></div>
        <div class="field" style="grid-column:1/-1"><label>คำอธิบายเฉลย</label><input class="input" name="explanation" value="${esc(key?.explanation || '')}"></div>
        <label><input type="checkbox" name="critical" ${row?.is_critical?'checked':''}> ข้อสำคัญ</label>
        <label><input type="checkbox" name="published" ${row?.published?'checked':''}> เผยแพร่คำถาม</label>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-question">บันทึก</button>`, true);
      document.getElementById('save-question').addEventListener('click', async () => {
        const form = document.getElementById('question-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const id = String(fd.get('id') || '');
        const imageDocumentId = String(fd.get('image_document_id') || '') || null;
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
        if (questionResult.error) return toast(friendlyError(questionResult.error), 'danger');
        const questionId = questionResult.data.id;
        const deleteChoices = await state.supabase.from('ec_question_choices').delete().eq('question_id', questionId);
        if (deleteChoices.error) return toast(friendlyError(deleteChoices.error), 'danger');
        const lines = String(fd.get('choices') || '').split('\n').map((value) => value.trim()).filter(Boolean);
        const correct = Number(fd.get('correct') || 0);
        let correctIds = [];
        if (lines.length) {
          const { data: inserted, error } = await state.supabase.from('ec_question_choices').insert(lines.map((text, index) => ({ question_id: questionId, choice_order: index + 1, choice_text: text }))).select();
          if (error) return toast(friendlyError(error), 'danger');
          if (correct > 0 && inserted?.[correct - 1]) correctIds = [inserted[correct - 1].id];
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
        closeModal(); toast('บันทึกคำถามแล้ว', 'success'); route();
      });
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
    document.getElementById('add-question')?.addEventListener('click', () => openQuestion());
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

    document.getElementById('publish-all-questions')?.addEventListener('click', async () => {
      const formBased = Boolean(generatedResultSchema(round));
      if (!confirm(formBased
        ? 'ยืนยันเผยแพร่คำถามเสริมหรือไม่ แบบกรอกผลหลักไม่ต้องกดเผยแพร่'
        : 'ยืนยันเผยแพร่ข้อสอบทั้งหมดหรือไม่ เจ้าหน้าที่ที่ได้รับมอบหมายจะเห็นคำถามทันทีตามช่วงเวลาที่กำหนด')) return;
      if (formBased) {
        const { data, error } = await state.supabase.from('ec_questions')
          .update({ published: true, updated_by: state.user.id })
          .eq('round_id', round.id)
          .eq('generated_by_ai', false)
          .is('archived_at', null)
          .select('id');
        if (error) return toast(friendlyError(error), 'danger');
        toast(`เผยแพร่คำถามเสริมแล้ว ${(data || []).length} ข้อ`, 'success'); route();
        return;
      }
      const { data, error } = await state.supabase.rpc('ec_publish_all_questions', { p_round_id: round.id });
      if (error) return toast(friendlyError(error), 'danger');
      toast(`เผยแพร่ข้อสอบแล้ว ${data || 0} ข้อ`, 'success'); route();
    });

    document.getElementById('set-competency-window')?.addEventListener('click', () => openWindowModal());

    document.getElementById('assign-all-competency')?.addEventListener('click', async () => {
      if (isHistoricalRound(round) && round.historical_review_status !== 'qm_certified') return toast('ต้องให้ผู้จัดการคุณภาพรับรองข้อมูลย้อนหลังให้ครบก่อน', 'warning');
      const formBased = Boolean(generatedResultSchema(round));
      if (!formBased) {
        const { count: publishedCount, error: questionCountError } = await state.supabase.from('ec_questions').select('id', { count: 'exact', head: true }).eq('round_id', round.id).eq('published', true).is('archived_at', null);
        if (questionCountError) return toast(friendlyError(questionCountError), 'danger');
        if (!publishedCount) return toast('กรุณาตรวจและเผยแพร่ข้อสอบอย่างน้อย 1 ข้อก่อนสร้างรายการประเมิน', 'warning');
      }

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
    const [{ data: assignment, error: assignmentError }, { data: assessment, error: assessmentError }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name)').eq('id', assignmentId).single(),
      state.supabase.from('ec_practical_assessments').select('*').eq('assignment_id', assignmentId).maybeSingle()
    ]);
    if (assignmentError || assessmentError) return toast(friendlyError(assignmentError || assessmentError), 'danger');
    const fields = [
      ['result_accuracy', 'ความถูกต้องของผล'],
      ['procedure_compliance', 'ปฏิบัติตามวิธีและขั้นตอน'],
      ['method_selection', 'เลือกวิธีตรวจเหมาะสม'],
      ['interpretation', 'การแปลผล'],
      ['documentation', 'การบันทึกข้อมูล'],
      ['problem_solving', 'การแก้ปัญหา']
    ];
    const body = `<div class="notice">ผู้ทบทวนประเมินครบทุกหัวข้อ แล้วส่งต่อให้ผู้จัดการคุณภาพรับรอง</div><div style="height:12px"></div><form id="practical-review-form" class="form-grid">${fields.map(([key,label]) => `<div class="field"><label>${esc(label)}</label><select class="select" name="${key}" required><option value="">เลือกผล</option><option value="true" ${assessment?.[key]===true?'selected':''}>ผ่าน</option><option value="false" ${assessment?.[key]===false?'selected':''}>ต้องทบทวน</option></select></div>`).join('')}<div class="field"><label>ข้อคิดเห็นผู้ทบทวน</label><textarea class="textarea" name="note">${esc(assessment?.reviewer_note || '')}</textarea></div></form>`;
    showModal(`ประเมินการปฏิบัติจริง — ${assignment.ec_profiles?.full_name || ''}`, body, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-practical-review">ผ่านการทบทวนและส่งให้ผู้จัดการคุณภาพ</button>`, true);
    document.getElementById('save-practical-review').addEventListener('click', async () => {
      const form = document.getElementById('practical-review-form'); if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = Object.fromEntries(fields.map(([key]) => [key, fd.get(key) === 'true']));
      const { error } = await state.supabase.rpc('ec_reviewer_review_practical', { p_assignment_id: assignmentId, p_assessment: payload, p_note: String(fd.get('note') || '') || null });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: assignmentId, stage: 'reviewed' }, true);
      closeModal(); toast('ตรวจทานแล้ว ส่งให้ผู้จัดการคุณภาพเรียบร้อย', 'success'); route();
    });
  }

  async function openQuizReview(assignmentId) {
    const [{ data: assignment, error: assignmentError }, { data: answers, error: answersError }, { data: questions }, { data: choices }, { data: keys }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name), ec_eqa_rounds(*)').eq('id', assignmentId).single(),
      state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', assignmentId),
      state.supabase.from('ec_questions').select('*').order('question_order'),
      state.supabase.from('ec_question_choices').select('*').order('choice_order'),
      state.supabase.from('ec_question_answer_keys').select('*')
    ]);
    if (assignmentError || answersError) return toast(friendlyError(assignmentError || answersError), 'danger');

    state.currentRound = assignment.ec_eqa_rounds;
    if (generatedResultSchema(assignment.ec_eqa_rounds) && resultPayloadHasData(assignment.result_payload)) {
      const supplementalQuestions = (questions || []).filter((question) => question.round_id === assignment.round_id && !question.generated_by_ai && question.published);
      const { data: evidenceDocuments, error: evidenceError } = await state.supabase.from('ec_round_documents')
        .select('id,title,file_name,storage_path,mime_type,visibility,category')
        .eq('round_id', assignment.round_id)
        .in('category', ['raw_result_image','antibody_panel'])
        .is('archived_at', null)
        .order('created_at');
      if (evidenceError) return toast(friendlyError(evidenceError), 'danger');
      const evidenceMap = await loadSignedImageMap((evidenceDocuments || []).map((document) => document.id), 1800);
      const answerMap = new Map((answers || []).map((answer) => [answer.question_id, answer]));
      const keyMap = new Map((keys || []).map((key) => [key.question_id, key]));
      const choiceName = (id) => (choices || []).find((choice) => choice.id === id)?.choice_text || id || '-';
      const supplementalRows = supplementalQuestions.map((question) => {
        const answer = answerMap.get(question.id);
        const payload = answer?.answer_payload || {};
        const userAnswer = payload.choice_id ? choiceName(payload.choice_id) : (payload.text || '-');
        const key = keyMap.get(question.id);
        const correctText = (key?.correct_choice_ids || []).map(choiceName).join(', ') || key?.answer_key_json?.text || key?.explanation || 'ให้ผู้ทบทวนพิจารณา';
        return `<div class="card" style="box-shadow:none;border:1px solid var(--line)"><h3>${question.question_order}. ${esc(displayQuestionPrompt(question.prompt) || question.prompt)}</h3><div class="grid cols-2"><div><strong>คำตอบของผู้ทำ</strong><p>${esc(userAnswer)}</p></div><div><strong>แนวคำตอบ/เฉลย</strong><p>${esc(correctText)}</p></div></div><div class="form-grid cols-2"><div class="field"><label>ผลการตรวจ</label><select class="select" data-answer-result="${answer?.id || ''}" required><option value="">เลือกผล</option><option value="true" ${answer?.is_correct===true?'selected':''}>ถูก</option><option value="false" ${answer?.is_correct===false?'selected':''}>ไม่ถูก</option></select></div><div class="field"><label>ข้อคิดเห็น</label><input class="input" data-answer-comment="${answer?.id || ''}" value="${esc(answer?.reviewer_comment || '')}"></div></div></div>`;
      }).join('');
      const formReviewValue = assignment.result_form_review_pass === true ? 'true' : assignment.result_form_review_pass === false ? 'false' : '';
      const body = `<div class="notice info"><strong>ตรวจผลที่เจ้าหน้าที่แปลจากภาพผลดิบ</strong><br>แบบกรอกนี้แยกจากผลรายบุคคลของผู้ปฏิบัติจริง 2 คน ผู้ทบทวนตรวจความถูกต้องโดยเทียบกับหลักฐานและผลกลางของห้อง</div><div style="height:12px"></div>
        <details class="competency-review-evidence"><summary><strong>เปิดดูภาพผลดิบที่ใช้ทำ Competency</strong></summary>${competencyEvidenceGallery(evidenceDocuments || [], evidenceMap)}</details>
        <div style="height:12px"></div><div class="card" style="box-shadow:none;border:1px solid var(--line)"><div class="card-header"><h3>แบบผลที่เจ้าหน้าที่กรอก</h3></div>${resultForm(assignment.result_payload, 'reviewCompetencyResult', true, true)}</div>
        <div style="height:12px"></div><div class="field"><label>ผลการตรวจแบบกรอกหลัก</label><select class="select" id="result-form-review-pass" required><option value="">เลือกผล</option><option value="true" ${formReviewValue==='true'?'selected':''}>ผ่าน — แปลผลเหมาะสม</option><option value="false" ${formReviewValue==='false'?'selected':''}>ต้องทบทวน — มีผลไม่ถูกต้อง/ไม่ครบ</option></select></div>
        ${supplementalRows ? `<div style="height:12px"></div><h3>คำถามเสริม</h3><div id="quiz-review-list" class="grid">${supplementalRows}</div>` : ''}
        <div class="field"><label>หมายเหตุรวมของผู้ทบทวน</label><textarea class="textarea" id="quiz-review-note">${esc(assignment.result_form_review_note || '')}</textarea></div>`;
      showModal(`ตรวจการแปลผลจากภาพ — ${assignment.ec_profiles?.full_name || ''}`, body, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-quiz-review">ผ่านการทบทวนและส่งให้ผู้จัดการคุณภาพ</button>`, true);
      document.getElementById('save-quiz-review').addEventListener('click', async () => {
        const passValue = document.getElementById('result-form-review-pass').value;
        if (!passValue) return toast('กรุณาเลือกผลการตรวจแบบกรอกหลัก', 'warning');
        const reviewRows = [...document.querySelectorAll('[data-answer-result]')].map((select) => ({
          answer_id: select.dataset.answerResult,
          is_correct: select.value === 'true' ? true : select.value === 'false' ? false : null,
          comment: document.querySelector(`[data-answer-comment="${select.dataset.answerResult}"]`)?.value || ''
        }));
        if (reviewRows.some((row) => !row.answer_id || row.is_correct === null)) return toast('กรุณาตรวจคำถามเสริมให้ครบ', 'warning');
        const note = document.getElementById('quiz-review-note').value || null;
        if (reviewRows.length) {
          const { error: quizError } = await state.supabase.rpc('ec_reviewer_review_quiz', { p_assignment_id: assignmentId, p_reviews: reviewRows, p_note: note });
          if (quizError) return toast(friendlyError(quizError), 'danger');
        }
        const { error: formError } = await state.supabase.rpc('ec_reviewer_review_result_form', {
          p_assignment_id: assignmentId,
          p_pass: passValue === 'true',
          p_note: note
        });
        if (formError) return toast(friendlyError(formError), 'danger');
        await archiveReportToDrive({ report_type: 'competency', assignment_id: assignmentId, stage: 'reviewed' }, true);
        closeModal(); toast('ตรวจแบบผลแล้ว ส่งให้ผู้จัดการคุณภาพเรียบร้อย', 'success'); route();
      });
      return;
    }

    const roundQuestions = (questions || []).filter((question) => question.round_id === assignment.round_id);
    const imageMap = await loadSignedImageMap(roundQuestions.flatMap((question) => questionImageIds(question)));
    const answerMap = new Map((answers || []).map((answer) => [answer.question_id, answer]));
    const keyMap = new Map((keys || []).map((key) => [key.question_id, key]));
    const choiceName = (id) => (choices || []).find((choice) => choice.id === id)?.choice_text || id || '-';
    const rows = roundQuestions.map((question) => {
      const answer = answerMap.get(question.id);
      const payload = answer?.answer_payload || {};
      const userAnswer = payload.choice_id ? choiceName(payload.choice_id) : (payload.text || '-');
      const key = keyMap.get(question.id);
      const isEducational = String(key?.answer_key_json?.challenge_type || '').toLowerCase() === 'educational'
        || String(key?.answer_key_json?.answer_basis || '').toLowerCase() === 'participant_consensus';
      const consensusText = [key?.answer_key_json?.consensus_result, key?.answer_key_json?.consensus_percent].filter(Boolean).join(' · ');
      const correctText = consensusText || (key?.correct_choice_ids || []).map(choiceName).join(', ') || key?.answer_key_json?.text || key?.explanation || 'ให้ผู้ทบทวนพิจารณา';
      const galleryHtml = questionImageGallery(question, imageMap, 'review');
      return `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
        <h3>${question.question_order}. ${esc(displayQuestionPrompt(question.prompt) || question.prompt)} ${isEducational ? '<span class="badge info">Educational</span>' : ''}</h3>
        ${galleryHtml}
        <div class="grid cols-2"><div><strong>คำตอบของผู้ทำ</strong><p>${esc(userAnswer)}</p></div><div><strong>${isEducational ? 'คำตอบของผู้เข้าร่วมส่วนใหญ่' : 'แนวคำตอบ/เฉลย'}</strong><p>${esc(correctText)}</p></div></div>
        ${isEducational && key?.answer_key_json?.comparison_note ? `<div class="notice info small">${esc(key.answer_key_json.comparison_note)}</div>` : ''}
        <div class="form-grid cols-2">
          <div class="field"><label>${isEducational ? 'ผลการเปรียบเทียบ' : 'ผลการตรวจ'}</label><select class="select" data-answer-result="${answer?.id || ''}" required><option value="">เลือกผล</option><option value="true" ${answer?.is_correct===true?'selected':''}>${isEducational ? 'สอดคล้องกับกลุ่มส่วนใหญ่' : 'ถูก'}</option><option value="false" ${answer?.is_correct===false?'selected':''}>${isEducational ? 'คำตอบส่วนน้อย — ต้องชี้แจง' : 'ไม่ถูก'}</option></select></div>
          <div class="field"><label>ข้อคิดเห็น</label><input class="input" data-answer-comment="${answer?.id || ''}" value="${esc(answer?.reviewer_comment || '')}"></div>
        </div>
      </div>`;
    }).join('');
    showModal(`ตรวจแบบทดสอบ — ${assignment.ec_profiles?.full_name || ''}`, `<div class="notice">ผู้ทบทวนเป็นผู้ตรวจด่านแรก เมื่อบันทึกแล้วระบบจะส่งต่อให้ผู้จัดการคุณภาพรับรอง</div><div style="height:12px"></div><div id="quiz-review-list" class="grid">${rows || empty('ไม่พบคำตอบ')}</div><div class="field"><label>หมายเหตุรวมของผู้ทบทวน</label><textarea class="textarea" id="quiz-review-note"></textarea></div>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-quiz-review">ผ่านการทบทวนและส่งให้ผู้จัดการคุณภาพ</button>`, true);
    document.getElementById('save-quiz-review').addEventListener('click', async () => {
      const reviewRows = [...document.querySelectorAll('[data-answer-result]')].map((select) => ({
        answer_id: select.dataset.answerResult,
        is_correct: select.value === 'true' ? true : select.value === 'false' ? false : null,
        comment: document.querySelector(`[data-answer-comment="${select.dataset.answerResult}"]`)?.value || ''
      }));
      if (reviewRows.some((row) => !row.answer_id || row.is_correct === null)) return toast('กรุณาตรวจทุกข้อให้ครบ', 'warning');
      const { error } = await state.supabase.rpc('ec_reviewer_review_quiz', { p_assignment_id: assignmentId, p_reviews: reviewRows, p_note: document.getElementById('quiz-review-note').value || null });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: assignmentId, stage: 'reviewed' }, true);
      closeModal(); toast('ตรวจทานแล้ว ส่งให้ผู้จัดการคุณภาพเรียบร้อย', 'success'); route();
    });
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

  function bindCompetencyReview(round) {
    document.querySelectorAll('[data-review-competency]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.type === 'practical') openPracticalReview(button.dataset.reviewCompetency);
      else openQuizReview(button.dataset.reviewCompetency);
    }));
    document.querySelectorAll('[data-review-reflection]').forEach((button) => button.addEventListener('click', () => openReflectionReview(button.dataset.reviewReflection)));
    document.querySelectorAll('[data-qm-approve-competency]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('หมายเหตุผู้จัดการคุณภาพ (เว้นว่างได้)') || '';
      const { data, error } = await state.supabase.rpc('ec_qm_decide_competency', { p_assignment_id: button.dataset.qmApproveCompetency, p_decision: 'approved', p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: button.dataset.qmApproveCompetency, stage: data?.status === 'passed' ? 'certified' : 'certified' }, true);
      toast(data?.status === 'needs_reflection' ? 'รับรองผลแล้ว และส่งให้เจ้าหน้าที่ทำแบบทบทวน' : 'ผู้จัดการคุณภาพรับรองผลแล้ว', 'success'); route();
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
      const content=`<section class="page"><div class="page-header"><div><h1>การประเมินของฉัน</h1></div></div><div class="notice">แพทย์ผู้รับรองและบัญชีที่ไม่มีบทบาทเจ้าหน้าที่ไม่ต้องทำแบบทดสอบบุคลากร</div></section>`;
      appEl.innerHTML=shell(content,'การประเมินของฉัน');bindShell();return;
    }
    const [{ data: assignments, error }, { data: practitionerRows, error: practitionerError }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(*)').eq('user_id', state.user.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
      state.supabase.from('ec_round_assignments').select('round_id').eq('user_id', state.user.id).eq('assignment_role', 'practitioner').eq('active', true)
    ]);
    if (error || practitionerError) return renderError(error || practitionerError);
    const practitionerRoundIds = new Set((practitionerRows || []).map((row) => row.round_id));
    const visibleAssignments = (assignments || []).filter((assignment) => !practitionerRoundIds.has(assignment.round_id));
    const content=`<section class="page"><div class="page-header"><div><h1>การประเมินของฉัน</h1><p>คำตอบถูกเก็บแยก และหลังส่งแล้วจะแก้ไขไม่ได้</p></div></div><div class="notice info">หากคุณเป็นผู้ปฏิบัติจริงของรอบนั้น ระบบจะใช้ผลรายบุคคลในหัวข้อ 4 เป็นการประเมิน และจะไม่แสดงหัวข้อ 10 ซ้ำ</div><div style="height:12px"></div><div class="card">${visibleAssignments.length?`<div class="table-wrap"><table><thead><tr><th>รอบ</th><th>ประเภท</th><th>ปิดรับคำตอบ</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${visibleAssignments.map(a=>{
      const closeAt = a.ec_eqa_rounds?.competency_close_at;
      const expired = closeAt && new Date(closeAt).getTime() < Date.now() && ['not_started','in_progress'].includes(a.status);
      return `<tr><td><strong>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</strong></td><td>${esc(a.assignment_type === 'quiz' && generatedResultSchema(a.ec_eqa_rounds) ? 'ประเมินจากภาพผลดิบ / Case Study' : labelFrom(COMPETENCY_TYPE_LABELS, a.assignment_type))}</td><td>${closeAt ? fmtDate(closeAt, true) : '-'}${expired ? '<br><span class="badge danger">ปิดแล้ว</span>' : ''}</td><td>${assignmentBadge(a.status)}</td><td>${a.score??'-'}</td><td><button class="btn btn-primary btn-sm" data-open-assignment="${a.id}" ${expired ? 'disabled' : ''}>เปิด</button></td></tr>`;
    }).join('')}</tbody></table></div>`:empty('ยังไม่มีรายการประเมิน')}</div></section>`;
    appEl.innerHTML=shell(content,'การประเมินของฉัน');bindShell();document.querySelectorAll('[data-open-assignment]:not([disabled])').forEach(b=>b.addEventListener('click',()=>navigate(`assignment/${b.dataset.openAssignment}`)));
  }

  async function renderAssignment(id) {
    if (!isCompetencyParticipant()) return navigate('dashboard');
    const { data: assignment, error } = await state.supabase.from('ec_competency_assignments').select('*,ec_eqa_rounds(*)').eq('id', id).single();
    if (error) return renderError(error);
    const { data: practitionerLink, error: practitionerLinkError } = await state.supabase.from('ec_round_assignments')
      .select('id')
      .eq('round_id', assignment.round_id)
      .eq('user_id', state.user.id)
      .eq('assignment_role', 'practitioner')
      .eq('active', true)
      .maybeSingle();
    if (practitionerLinkError) return renderError(practitionerLinkError);
    if (practitionerLink) {
      const content = `<section class="page"><div class="page-header"><div><h1>ไม่ต้องทำหัวข้อ 10</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><button class="btn btn-outline" id="back-my">กลับ</button></div><div class="notice success"><strong>คุณเป็นผู้ปฏิบัติจริงของรอบนี้</strong><br>ระบบใช้ผลรายบุคคลที่บันทึกในหัวข้อ 4 เป็นการประเมินแล้ว จึงไม่ต้องทำ Competency ซ้ำในหัวข้อ 10</div></section>`;
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
      let practicalReflections = [];
      if (['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)) {
        const { data: reflectionData, error: reflectionError } = await state.supabase.from('ec_reflections').select('*').eq('assignment_id', id).is('answer_id', null).order('created_at');
        if (!reflectionError) practicalReflections = reflectionData || [];
      }
      const reflection = practicalReflections[0] || null;
      const reflectionEditable = assignment.status === 'needs_reflection';
      const reflectionDue = assignment.reflection_due_at ? `<div class="notice info">กรุณาส่งแบบทบทวนภายใน ${fmtDate(assignment.reflection_due_at, true)}</div><div style="height:12px"></div>` : '';
      const reflectionHtml = ['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status) ? `
        <div class="card">
          <div class="card-header"><div><h2>แบบทบทวนการปฏิบัติจริง</h2><div class="small muted">ใช้เมื่อมีหัวข้อประเมินที่ต้องปรับปรุง</div></div>${assignmentBadge(assignment.status)}</div>
          ${reflectionDue}
          <div class="reflection-item" data-practical-reflection>
            <div class="form-grid">
              <div class="field"><label>สาเหตุหรือปัจจัยที่ทำให้หัวข้อนี้ไม่ผ่าน</label><textarea class="textarea" data-practical-reflection-field="reason_for_error" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.reason_for_error || '')}</textarea></div>
              <div class="field"><label>ความเข้าใจหรือวิธีปฏิบัติที่ถูกต้อง</label><textarea class="textarea" data-practical-reflection-field="corrected_understanding" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.corrected_understanding || '')}</textarea></div>
              <div class="field"><label>แผนการนำไปใช้กับงานจริง</label><textarea class="textarea" data-practical-reflection-field="application_to_work" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.application_to_work || '')}</textarea></div>
              ${reflection?.reviewer_note ? `<div class="notice warning"><strong>ข้อคิดเห็นผู้ทบทวน:</strong> ${esc(reflection.reviewer_note)}</div>` : ''}
            </div>
          </div>
          ${reflectionEditable ? `<div class="modal-footer"><button class="btn btn-primary" id="submit-practical-reflection">ส่งแบบทบทวน</button></div>` : ''}
        </div>` : '';
      const driveButton = !['not_started','in_progress'].includes(assignment.status) ? `<button class="btn btn-outline" id="archive-practical-competency">เก็บ PDF ใน Google Drive</button>` : '';
      const content = `<section class="page"><div class="page-header"><div><h1>การประเมินจากการปฏิบัติจริง</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${driveButton}<button class="btn btn-outline" id="back-my">กลับ</button></div></div>${windowNotice}<div style="height:12px"></div><div class="card"><div class="card-header"><div><h2>การประเมินผู้ปฏิบัติจริง</h2><p class="muted">ผลเชื่อมจากการทำ EQA รายบุคคล วิธีตรวจ การแปลผล การบันทึก และการแก้ปัญหา</p></div>${assignmentBadge(assignment.status)}</div>${assignment.reviewer_note ? `<div class="notice info"><strong>หมายเหตุจากผู้ประเมิน:</strong> ${esc(assignment.reviewer_note)}</div><div style="height:12px"></div>` : ''}<button class="btn btn-primary" id="open-round-practical">เปิดรอบ EQA</button></div><div style="height:16px"></div>${reflectionHtml}</section>`;
      appEl.innerHTML = shell(content, 'การประเมินจากการปฏิบัติจริง');
      bindShell();
      document.getElementById('back-my').onclick = () => navigate('my-competency');
      document.getElementById('open-round-practical').onclick = () => navigate(`round/${assignment.round_id}/individual`);
      document.getElementById('archive-practical-competency')?.addEventListener('click', async () => {
        await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: assignment.status });
      });
      document.getElementById('submit-practical-reflection')?.addEventListener('click', async () => {
        const item = {
          answer_id: null,
          reason_for_error: String(document.querySelector('[data-practical-reflection-field="reason_for_error"]')?.value || '').trim(),
          corrected_understanding: String(document.querySelector('[data-practical-reflection-field="corrected_understanding"]')?.value || '').trim(),
          application_to_work: String(document.querySelector('[data-practical-reflection-field="application_to_work"]')?.value || '').trim()
        };
        if (!item.reason_for_error || !item.corrected_understanding || !item.application_to_work) return toast('กรุณากรอกแบบทบทวนให้ครบทุกช่อง', 'warning');
        if (!confirm('ยืนยันส่งแบบทบทวนการปฏิบัติจริงให้ผู้ทบทวนตรวจหรือไม่')) return;
        const { error: reflectionError } = await state.supabase.rpc('ec_submit_reflection', { p_assignment_id: id, p_items: [item] });
        if (reflectionError) return toast(friendlyError(reflectionError), 'danger');
        await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: 'reflection' }, true);
        toast('ส่งแบบทบทวนแล้ว', 'success'); route();
      });
      return;
    }
    state.currentRound = assignment.ec_eqa_rounds;

    if (generatedResultSchema(assignment.ec_eqa_rounds)) {
      const [
        { data: formQuestions, error: formQuestionError },
        { data: formChoices, error: formChoiceError },
        { data: formAnswers, error: formAnswerError },
        { data: evidenceDocuments, error: evidenceError }
      ] = await Promise.all([
        state.supabase.from('ec_questions')
          .select('id,round_id,question_order,section,question_type,prompt,image_document_id,ai_source_document_ids,points,is_critical,published,generated_by_ai')
          .eq('round_id', assignment.round_id)
          .eq('published', true)
          .eq('generated_by_ai', false)
          .is('archived_at', null)
          .order('question_order'),
        state.supabase.from('ec_question_choices_public').select('*'),
        state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', id),
        state.supabase.from('ec_round_documents')
          .select('id,title,file_name,storage_path,mime_type,visibility,category')
          .eq('round_id', assignment.round_id)
          .in('category', ['raw_result_image','antibody_panel'])
          .is('archived_at', null)
          .order('created_at')
      ]);
      if (formQuestionError || formChoiceError || formAnswerError || evidenceError) {
        return renderError(formQuestionError || formChoiceError || formAnswerError || evidenceError);
      }

      const editable = ['not_started','in_progress'].includes(assignment.status) && !deadlinePassed && !notOpened;
      const evidenceMap = await loadSignedImageMap((evidenceDocuments || []).map((document) => document.id), 1800);
      const supplementalImageMap = await loadSignedImageMap((formQuestions || []).flatMap((question) => questionImageIds(question)), 1800);
      const answerMap = new Map((formAnswers || []).map((answer) => [answer.question_id, answer]));
      const formHtml = resultForm(assignment.result_payload, 'competencyResult', !editable, true);

      let previousSection = '';
      const supplementalHtml = (formQuestions || []).map((question) => {
        const answerPayload = answerMap.get(question.id)?.answer_payload || {};
        const questionChoices = (formChoices || [])
          .filter((choice) => choice.question_id === question.id)
          .sort((a, b) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
        const promptParts = questionPromptParts(question.prompt);
        const section = String(question.section || 'คำถามเสริม');
        const divider = section !== previousSection ? `<div class="quiz-section-divider"><span>${esc(section)}</span></div>` : '';
        previousSection = section;
        const input = question.question_type === 'single_choice'
          ? `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice"><input type="radio" name="q_${question.id}" value="${choice.id}" ${answerPayload.choice_id === choice.id ? 'checked' : ''} ${editable ? '' : 'disabled'}><span class="quiz-radio-ui"></span><span>${esc(choice.choice_text)}</span></label>`).join('')}</div>`
          : `<textarea class="textarea quiz-text-answer" name="q_${question.id}" ${editable ? '' : 'disabled'} placeholder="พิมพ์คำตอบของคุณ">${esc(answerPayload.text || '')}</textarea>`;
        return `${divider}<article class="quiz-question-card"><div class="quiz-question-head"><span class="quiz-question-number">${question.question_order}</span><div><span class="small muted">${esc(section)}</span><h3>${esc(promptParts.prompt)}</h3></div>${question.is_critical ? '<span class="badge danger">ข้อสำคัญ</span>' : ''}</div>${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}${questionImageGallery(question, supplementalImageMap, 'quiz')}${input}</article>`;
      }).join('');

      let reflectionRows = [];
      if (['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)) {
        const { data: rows } = await state.supabase.from('ec_reflections').select('*').eq('assignment_id', id).is('answer_id', null).order('created_at');
        reflectionRows = rows || [];
      }
      const reflection = reflectionRows[0] || null;
      const reflectionEditable = assignment.status === 'needs_reflection';
      const reflectionHtml = ['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)
        ? `<div style="height:16px"></div><div class="card"><div class="card-header"><div><h2>แบบทบทวนผลการแปลจากภาพ</h2><div class="small muted">ใช้เมื่อผลที่กรอกต้องแก้ไขหรืออธิบายเพิ่มเติม</div></div>${assignmentBadge(assignment.status)}</div><div class="form-grid"><div class="field"><label>สาเหตุที่แปลผลไม่ตรงหรือจุดที่ต้องทบทวน</label><textarea class="textarea" data-form-reflection="reason_for_error" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.reason_for_error || '')}</textarea></div><div class="field"><label>ความเข้าใจที่ถูกต้องหลังทบทวน</label><textarea class="textarea" data-form-reflection="corrected_understanding" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.corrected_understanding || '')}</textarea></div><div class="field"><label>สิ่งที่จะนำไปใช้กับงานจริง</label><textarea class="textarea" data-form-reflection="application_to_work" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.application_to_work || '')}</textarea></div>${reflection?.reviewer_note ? `<div class="notice warning"><strong>ข้อคิดเห็นผู้ทบทวน:</strong> ${esc(reflection.reviewer_note)}</div>` : ''}</div>${reflectionEditable ? `<div class="modal-footer"><button class="btn btn-primary" id="submit-form-reflection">ส่งแบบทบทวน</button></div>` : ''}</div>`
        : '';

      const completedLabel = resultPayloadHasData(assignment.result_payload) ? 'มีร่างที่บันทึกแล้ว' : 'ยังไม่ได้บันทึก';
      const driveButton = !['not_started','in_progress'].includes(assignment.status) ? `<button class="btn btn-outline" id="archive-my-competency">เก็บ PDF ใน Google Drive</button>` : '';
      const content = `<section class="page competency-result-page"><div class="page-header"><div><h1>ประเมิน EQA จากภาพผลดิบและ Case Study</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${assignmentBadge(assignment.status)}${driveButton}<button class="btn btn-outline" id="back-my">กลับ</button></div></div>${windowNotice}<div style="height:12px"></div>
        <div class="quiz-intro-card"><div><span class="eyebrow">สำหรับเจ้าหน้าที่ที่ไม่ได้เป็นผู้ปฏิบัติจริง</span><h2>ทำแบบประเมินตามชนิดของรอบ</h2><p>Part J และ JE แบบ Wet ใช้ภาพผลดิบจากผู้ปฏิบัติจริง 2 คน ส่วน JE แบบ Dry ใช้ Case Study และคำถามจากแบบฟอร์มผู้ให้บริการ ระบบไม่แสดงคำตอบของผู้ปฏิบัติจริงหรือคำตอบของเจ้าหน้าที่คนอื่นก่อนส่ง</p></div><div class="quiz-progress-box"><strong>${esc(completedLabel)}</strong><span>สถานะแบบกรอก</span></div></div>
        <div class="card"><div class="card-header"><div><h2>1. ภาพผลดิบและ Panel/Antigram</h2><div class="small muted">กดรูปเพื่อเปิดขนาดเต็ม ภาพที่ตั้งสิทธิ์เฉพาะผู้ทบทวนจะไม่ปรากฏในหน้านี้</div></div></div>${competencyEvidenceGallery(evidenceDocuments || [], evidenceMap)}</div>
        <div style="height:16px"></div>
        <div class="card"><div class="card-header"><div><h2>2. แบบบันทึกผลสำหรับ Competency</h2><div class="small muted">โครงสร้างเดียวกับผลรายบุคคลในหัวข้อ 4 แต่บันทึกแยกจากผลของผู้ปฏิบัติจริง</div></div></div><form id="competency-result-form">${formHtml}</form></div>
        ${supplementalHtml ? `<div style="height:16px"></div><div class="card"><div class="card-header"><div><h2>3. คำถามเสริม</h2><div class="small muted">มีเฉพาะข้อที่ผู้จัดการคุณภาพเพิ่มเอง</div></div></div><form id="competency-supplement-form" class="quiz-form-shell">${supplementalHtml}</form></div>` : ''}
        ${editable ? `<div class="quiz-submit-bar"><button class="btn btn-secondary" id="save-competency-form">บันทึกร่าง</button><button class="btn btn-primary" id="submit-competency-form">ยืนยันและส่งผล</button></div>` : `<div style="height:16px"></div><div class="notice info">${assignment.reviewer_note ? `<strong>หมายเหตุผู้ประเมิน:</strong> ${esc(assignment.reviewer_note)}` : 'แบบประเมินถูกส่งแล้วและล็อกการแก้ไข'}</div>`}
        ${reflectionHtml}
      </section>`;
      appEl.innerHTML = shell(content, 'ประเมินจากภาพผลดิบ / Case Study');
      bindShell();
      bindCapWorkupControls(document.getElementById('competency-result-form') || document);

      document.getElementById('back-my').onclick = () => navigate('my-competency');
      document.getElementById('archive-my-competency')?.addEventListener('click', async () => {
        await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: assignment.status });
      });
      document.getElementById('submit-form-reflection')?.addEventListener('click', async () => {
        const item = {
          answer_id: null,
          reason_for_error: String(document.querySelector('[data-form-reflection="reason_for_error"]')?.value || '').trim(),
          corrected_understanding: String(document.querySelector('[data-form-reflection="corrected_understanding"]')?.value || '').trim(),
          application_to_work: String(document.querySelector('[data-form-reflection="application_to_work"]')?.value || '').trim()
        };
        if (!item.reason_for_error || !item.corrected_understanding || !item.application_to_work) return toast('กรุณากรอกแบบทบทวนให้ครบทุกช่อง', 'warning');
        const { error: reflectionError } = await state.supabase.rpc('ec_submit_reflection', { p_assignment_id: id, p_items: [item] });
        if (reflectionError) return toast(friendlyError(reflectionError), 'danger');
        toast('ส่งแบบทบทวนแล้ว', 'success'); route();
      });

      if (editable) {
        const startResult = await state.supabase.rpc('ec_start_competency', { p_assignment_id: id });
        if (startResult.error) toast(friendlyError(startResult.error), 'danger');

        const saveForm = async () => {
          const form = document.getElementById('competency-result-form');
          if (!form?.reportValidity()) throw new Error('กรุณากรอกช่องบังคับในแบบผลให้ครบ');
          const payload = collectResultPayload(form, 'competencyResult');
          if (!payload || !resultPayloadHasData(payload)) throw new Error('กรุณากรอกผลอย่างน้อย 1 รายการก่อนบันทึก');
          const { error: resultError } = await state.supabase.rpc('ec_save_competency_result', { p_assignment_id: id, p_result_payload: payload });
          if (resultError) throw resultError;

          const answerRows = (formQuestions || []).map((question) => {
            let answerPayload = {};
            if (question.question_type === 'single_choice') {
              const checked = document.querySelector(`input[name="q_${question.id}"]:checked`);
              answerPayload = checked ? { choice_id: checked.value } : {};
            } else {
              answerPayload = { text: String(document.querySelector(`[name="q_${question.id}"]`)?.value || '').trim() };
            }
            return { assignment_id: id, question_id: question.id, answer_payload: answerPayload };
          });
          if (answerRows.length) {
            const { error: answerError } = await state.supabase.from('ec_competency_answers').upsert(answerRows, { onConflict: 'assignment_id,question_id' });
            if (answerError) throw answerError;
          }
        };

        document.getElementById('save-competency-form').onclick = async () => {
          try { await saveForm(); toast('บันทึกร่างแบบประเมินแล้ว', 'success'); } catch (saveError) { toast(friendlyError(saveError), 'danger'); }
        };
        document.getElementById('submit-competency-form').onclick = async () => {
          if (!confirm('ยืนยันส่งผลการแปลจากภาพหรือไม่ หลังส่งจะแก้ไขไม่ได้')) return;
          try {
            await saveForm();
            const { error: submitError } = await state.supabase.rpc('ec_submit_competency', { p_assignment_id: id });
            if (submitError) throw submitError;
            await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: 'submitted' }, true);
            toast('ส่งผลการประเมินแล้ว', 'success');
            navigate('my-competency');
          } catch (submitError) {
            toast(friendlyError(submitError), 'danger');
          }
        };
      }
      return;
    }

    const [{ data: questions }, { data: choices }, { data: answers }] = await Promise.all([
      state.supabase.from('ec_questions').select('id,round_id,question_order,section,question_type,prompt,image_document_id,ai_source_document_ids,points,is_critical,published').eq('round_id', assignment.round_id).eq('published', true).is('archived_at', null).order('question_order'),
      state.supabase.from('ec_question_choices_public').select('*'),
      state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', id)
    ]);
    const imageMap = await loadSignedImageMap((questions || []).flatMap((question) => questionImageIds(question)));
    const answerMap = new Map((answers || []).map((answer) => [answer.question_id, answer]));
    const editable = ['not_started','in_progress'].includes(assignment.status) && !deadlinePassed && !notOpened;
    let releasedReview = null;
    if (!editable && assignment.ec_eqa_rounds?.answer_released_at) {
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
      const questionChoices = (choices || [])
        .filter((choice) => choice.question_id === question.id)
        .sort((a, b) => Number(a.choice_order || 0) - Number(b.choice_order || 0));
      const galleryHtml = questionImageGallery(question, imageMap, 'quiz');
      const promptParts = questionPromptParts(question.prompt);
      const section = String(question.section || 'การแปลผล EQA');
      const sectionDivider = section !== previousSection
        ? `<div class="quiz-section-divider"><span>${esc(section)}</span></div>`
        : '';
      previousSection = section;
      let input = '';
      if (isAntibodyIdentificationQuestion(question) && question.question_type !== 'single_choice') {
        input = quizAntibodyPicker(question, answerPayload.text || '', editable);
      } else if (question.question_type === 'single_choice') {
        input = `<div class="quiz-choice-list">${questionChoices.map((choice) => `<label class="quiz-choice">
          <input type="radio" name="q_${question.id}" value="${choice.id}" ${answerPayload.choice_id===choice.id?'checked':''} ${editable?'':'disabled'}>
          <span class="quiz-radio-ui"></span><span>${esc(choice.choice_text)}</span>
        </label>`).join('')}</div>`;
      } else {
        input = `<textarea class="textarea quiz-text-answer" name="q_${question.id}" ${editable?'':'disabled'} placeholder="พิมพ์คำตอบของคุณ">${esc(answerPayload.text || '')}</textarea>`;
      }
      return `${sectionDivider}<article class="quiz-question-card">
        <div class="quiz-question-head">
          <span class="quiz-question-number">${question.question_order}</span>
          <div><span class="small muted">${esc(section)}</span><h3>${esc(promptParts.prompt)}</h3></div>
          ${question.is_critical?'<span class="badge danger">ข้อสำคัญ</span>':''}
        </div>
        ${promptParts.context ? `<div class="quiz-case-context"><strong>ข้อมูลประกอบโจทย์</strong><div>${esc(promptParts.context)}</div></div>` : ''}
        ${galleryHtml}
        ${input}
      </article>`;
    }).join('');
    const reviewQuestions = Array.isArray(releasedReview?.questions) ? releasedReview.questions : [];
    const releasedScoreBadge = releasedReview?.score === null || releasedReview?.score === undefined
      ? '<span class="badge info">ไม่มีคะแนนทางการสำหรับ Educational</span>'
      : `<span class="badge info">คะแนน Graded ${esc(releasedReview.score)}%</span>`;
    const releasedReviewHtml = releasedReview ? `<div style="height:16px"></div><div class="card"><div class="card-header"><div><h2>ผลเปรียบเทียบและเฉลยหลังส่งคำตอบ</h2><div class="small muted">รายการ Graded แสดงเฉลยทางการ ส่วน Educational แสดงคำตอบของผู้เข้าร่วมส่วนใหญ่เพื่อทบทวนภายใน</div></div>${releasedScoreBadge}</div>${releasedReview.official_summary ? `<div class="notice info">${esc(releasedReview.official_summary)}</div><div style="height:12px"></div>` : ''}${reviewQuestions.map((item) => {
      const educational = isEducationalCompetencyReview(item);
      const [statusLabel, statusClass] = competencyReviewStatus(item);
      const comparisonText = [item.consensus_result, item.consensus_percent].filter(Boolean).join(' · ') || item.correct_answer || '-';
      return `<div class="answer-review-row ${!educational && item.is_correct === true ? 'correct' : !educational && item.is_correct === false ? 'incorrect' : ''}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><strong>${item.question_order}. ${esc(item.prompt || '')}</strong><span class="badge ${esc(statusClass)}">${esc(statusLabel)}</span></div><div class="grid cols-2" style="margin-top:8px"><div><span class="small muted">คำตอบของคุณ</span><div>${esc(item.user_answer || '-')}</div></div><div><span class="small muted">${educational ? 'คำตอบของผู้เข้าร่วมส่วนใหญ่' : 'เฉลย'}</span><div>${esc(comparisonText)}</div></div></div>${item.comparison_note ? `<div class="small" style="margin-top:8px"><strong>ผลการเปรียบเทียบ:</strong> ${esc(item.comparison_note)}</div>` : ''}${item.explanation ? `<div class="small" style="margin-top:8px"><strong>${educational ? 'คำอธิบายประกอบ:' : 'คำอธิบาย:'}</strong> ${esc(item.explanation)}</div>` : ''}</div>`;
    }).join('')}</div>` : '';
    const reflectionMap = new Map((reflections || []).map((row) => [row.answer_id, row]));
    const incorrectReviewQuestions = reviewQuestions.filter((item) => item.is_correct === false);
    const reflectionEditable = assignment.status === 'needs_reflection';
    const reflectionHtml = ['needs_reflection','reflection_submitted','passed_after_review'].includes(assignment.status)
      ? `<div style="height:16px"></div><div class="card"><div class="card-header"><div><h2>แบบทบทวนและชี้แจง</h2><div class="small muted">ใช้ทั้งข้อที่ตอบไม่ถูกและ Educational ที่คำตอบต่างจากกลุ่มส่วนใหญ่</div></div>${assignmentBadge(assignment.status)}</div>${!releasedReview ? `<div class="notice warning">ผู้จัดการคุณภาพยังไม่ได้เปิดผล จึงยังกรอกแบบทบทวนไม่ได้</div>` : incorrectReviewQuestions.map((item) => {
          const answer = answerMap.get(item.question_id);
          const reflection = answer ? reflectionMap.get(answer.id) : null;
          const educational = isEducationalCompetencyReview(item);
          const referenceText = [item.consensus_result, item.consensus_percent].filter(Boolean).join(' · ') || item.correct_answer || '-';
          return `<div class="reflection-item" data-reflection-answer="${answer?.id || ''}"><h3>${item.question_order}. ${esc(item.prompt || '')} ${educational ? '<span class="badge info">Educational</span>' : ''}</h3><div class="grid cols-2"><div><span class="small muted">คำตอบของคุณ</span><div>${esc(item.user_answer || '-')}</div></div><div><span class="small muted">${educational ? 'คำตอบของผู้เข้าร่วมส่วนใหญ่' : 'เฉลย'}</span><div>${esc(referenceText)}</div></div></div><div class="form-grid" style="margin-top:12px"><div class="field"><label>${educational ? 'เหตุผลที่เลือกคำตอบต่างจากกลุ่มส่วนใหญ่' : 'สาเหตุที่ตอบไม่ถูก'}</label><textarea class="textarea" data-reflection-field="reason_for_error" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.reason_for_error || '')}</textarea></div><div class="field"><label>${educational ? 'ทบทวนแล้ว คำตอบของห้องเหมาะสมหรือควรแก้ไข เพราะเหตุใด' : 'ความเข้าใจที่ถูกต้องหลังทบทวน'}</label><textarea class="textarea" data-reflection-field="corrected_understanding" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.corrected_understanding || '')}</textarea></div><div class="field"><label>สิ่งที่จะตรวจสอบหรือปรับใช้กับงาน</label><textarea class="textarea" data-reflection-field="application_to_work" ${reflectionEditable ? '' : 'disabled'} required>${esc(reflection?.application_to_work || '')}</textarea></div>${reflection?.reviewer_note ? `<div class="notice warning"><strong>ข้อคิดเห็นผู้ทบทวน:</strong> ${esc(reflection.reviewer_note)}</div>` : ''}</div></div>`;
        }).join('')}${reflectionEditable && releasedReview ? `<div class="modal-footer"><button class="btn btn-primary" id="submit-reflection">ส่งแบบทบทวน</button></div>` : ''}</div>`
      : '';
    const driveButton = !['not_started','in_progress'].includes(assignment.status) ? `<button class="btn btn-outline" id="archive-my-competency">เก็บ PDF ใน Google Drive</button>` : '';
    const answeredCount = (questions || []).filter((question) => {
      const payload = answerMap.get(question.id)?.answer_payload || {};
      return Boolean(payload.choice_id || payload.text);
    }).length;
    const content = `<section class="page quiz-page"><div class="page-header"><div><h1>แบบทดสอบ EQA Competency</h1><p>${esc(assignment.ec_eqa_rounds?.provider)} ${esc(assignment.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${assignmentBadge(assignment.status)}${driveButton}<button class="btn btn-outline" id="back-my">กลับ</button></div></div>${windowNotice}<div style="height:12px"></div>
      <div class="quiz-intro-card"><div><span class="eyebrow">แบบประเมินจากผลทดสอบจริง</span><h2>อ่านภาพและเลือกคำตอบที่ถูกต้องที่สุด</h2><p>คำถามแยกตามหมวดเหมือน Google Form สามารถบันทึกร่างแล้วกลับมาทำต่อได้ก่อนวันปิดรับคำตอบ</p></div><div class="quiz-progress-box"><strong>${answeredCount}/${(questions || []).length}</strong><span>ข้อที่บันทึกแล้ว</span></div></div>
      <form id="quiz-form" class="quiz-form-shell">${questionHtml || empty('ผู้จัดการคุณภาพยังไม่ได้เผยแพร่คำถาม')}</form>${editable && questions?.length ? `<div class="quiz-submit-bar"><button class="btn btn-secondary" id="save-quiz">บันทึกร่าง</button><button class="btn btn-primary" id="submit-quiz">ยืนยันและส่งคำตอบ</button></div>` : ''}${releasedReviewHtml}${reflectionHtml}</section>`;
    appEl.innerHTML = shell(content, 'แบบทดสอบ');
    bindShell();

    const updateQuizProgress = () => {
      const count = (questions || []).filter((question) => {
        if (question.question_type === 'single_choice') return Boolean(document.querySelector(`input[name="q_${question.id}"]:checked`));
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
        const typed = String(search?.value || '').trim();
        if (!typed) return;
        const value = resolveCapAntibodyEntry(typed);
        if (!value) return toast('กรุณาเลือกชื่อ antibody จาก CAP Master List', 'warning');
        const duplicate = [...selected.querySelectorAll('[data-antibody-value]')].some((chip) => chip.dataset.antibodyValue === value);
        if (duplicate) { search.value = ''; return; }
        selected.querySelector('[data-antibody-empty]')?.remove();
        selected.insertAdjacentHTML('beforeend', `<span class="antibody-chip" data-antibody-value="${esc(value)}"><span>${esc(value)}</span><button type="button" data-remove-antibody aria-label="ลบ">×</button></span>`);
        search.value = '';
        sync();
      };
      picker.querySelector('[data-add-antibody]')?.addEventListener('click', addValue);
      search?.addEventListener('change', addValue);
      search?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addValue(); } });
      selected.addEventListener('click', (event) => {
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
    document.getElementById('archive-my-competency')?.addEventListener('click', async () => {
      await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: assignment.status });
    });
    document.getElementById('submit-reflection')?.addEventListener('click', async () => {
      const items = [...document.querySelectorAll('[data-reflection-answer]')].map((card) => ({
        answer_id: card.dataset.reflectionAnswer,
        reason_for_error: String(card.querySelector('[data-reflection-field="reason_for_error"]')?.value || '').trim(),
        corrected_understanding: String(card.querySelector('[data-reflection-field="corrected_understanding"]')?.value || '').trim(),
        application_to_work: String(card.querySelector('[data-reflection-field="application_to_work"]')?.value || '').trim()
      }));
      if (!items.length || items.some((item) => !item.answer_id || !item.reason_for_error || !item.corrected_understanding || !item.application_to_work)) return toast('กรุณากรอกแบบทบทวนให้ครบทุกข้อและทุกช่อง', 'warning');
      if (!confirm('ยืนยันส่งแบบทบทวนให้ผู้ทบทวนตรวจหรือไม่')) return;
      const { error: reflectionError } = await state.supabase.rpc('ec_submit_reflection', { p_assignment_id: id, p_items: items });
      if (reflectionError) return toast(friendlyError(reflectionError), 'danger');
      await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: 'reflection' }, true);
      toast('ส่งแบบทบทวนแล้ว', 'success'); route();
    });
    if (editable) {
      const startResult = await state.supabase.rpc('ec_start_competency', { p_assignment_id: id });
      if (startResult.error) toast(friendlyError(startResult.error), 'danger');
      const save = async () => {
        const rows = [];
        (questions || []).forEach((question) => {
          let answerPayload = {};
          if (question.question_type === 'single_choice') {
            const checked = document.querySelector(`input[name="q_${question.id}"]:checked`);
            answerPayload = checked ? { choice_id: checked.value } : {};
          } else {
            answerPayload = { text: String(document.querySelector(`[name="q_${question.id}"]`)?.value || '').trim() };
          }
          rows.push({ assignment_id: id, question_id: question.id, answer_payload: answerPayload });
        });
        const { error: saveError } = await state.supabase.from('ec_competency_answers').upsert(rows, { onConflict: 'assignment_id,question_id' });
        if (saveError) throw saveError;
      };
      document.getElementById('save-quiz').onclick = async () => {
        try { await save(); toast('บันทึกร่างแล้ว', 'success'); } catch (saveError) { toast(friendlyError(saveError), 'danger'); }
      };
      document.getElementById('submit-quiz').onclick = async () => {
        if (!confirm('ยืนยันส่งคำตอบหรือไม่ หลังส่งจะแก้ไขไม่ได้')) return;
        try {
          await save();
          const { error: submitError } = await state.supabase.rpc('ec_submit_competency', { p_assignment_id: id });
          if (submitError) throw submitError;
          await archiveReportToDrive({ report_type: 'competency', assignment_id: id, stage: 'submitted' }, true);
          toast('ส่งคำตอบแล้ว', 'success');
          if (assignment.ec_eqa_rounds?.answer_released_at) route();
          else navigate('my-competency');
        } catch (submitError) { toast(friendlyError(submitError), 'danger'); }
      };
    }
  }
  async function renderReports() {
    const [{ data: rounds, error: roundError }, { data: archives, error: archiveError }] = await Promise.all([
      state.supabase.from('ec_eqa_rounds').select('*').order('survey_year', { ascending: false }).order('due_date', { ascending: false }),
      state.supabase.from('ec_report_archives').select('*').order('generated_at', { ascending: false }).limit(100)
    ]);
    if (roundError || archiveError) return renderError(roundError || archiveError);
    const archiveRows = archives || [];
    const roundArchiveMap = new Map();
    archiveRows.filter((row) => row.report_type === 'round_summary' && row.round_id).forEach((row) => {
      if (!roundArchiveMap.has(row.round_id)) roundArchiveMap.set(row.round_id, row);
    });
    const reportTypeLabel = { registry: 'ทะเบียน EQA', round_summary: 'สรุปรอบ EQA', competency: 'รายงาน Competency' };
    const sourceLabel = { manual: 'สร้างด้วยตนเอง', automatic: 'ระบบสร้างอัตโนมัติ' };
    const canArchiveAll = hasRole('admin','qm','reviewer','physician','viewer');
    const content = `<section class="page">
      <div class="page-header">
        <div><h1>รายงาน / ทะเบียน EQA</h1><p>พิมพ์จากหน้าเว็บ หรือสร้าง PDF ที่มีทะเบียนและลิงก์เก็บใน Google Drive</p></div>
        <div class="header-actions no-print">
          ${canArchiveAll ? '<button class="btn btn-secondary" id="archive-registry">เก็บทะเบียนใน Google Drive</button>' : ''}
          <button class="btn btn-primary" id="print-report">พิมพ์ / บันทึกเป็น PDF</button>
        </div>
      </div>
      <div class="print-only"><h1>ทะเบียน EQA ประจำปี</h1><p>${esc(cfg.ORGANIZATION_NAME)}</p></div>
      <div class="card">
        <div class="card-header"><div><h2>ทะเบียนรอบ EQA</h2><div class="small muted">ปุ่มเก็บ PDF จะสร้างไฟล์ฉบับใหม่ ไม่เขียนทับไฟล์เดิม</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>ปี</th><th>ผู้ให้บริการ / รอบ</th><th>ประเภทข้อมูล</th><th>โปรแกรม</th><th>วันครบกำหนด</th><th>สถานะ</th><th>เลขเอกสาร</th><th class="no-print">Google Drive</th></tr></thead><tbody>${(rounds || []).map((r) => {
          const latest = roundArchiveMap.get(r.id);
          return `<tr><td>${r.survey_year}</td><td><strong>${esc(r.provider)} ${esc(r.round_code)}</strong></td><td>${isHistoricalRound(r) ? 'ข้อมูลย้อนหลัง' : 'รอบใหม่'}</td><td>${esc(r.program_name)}</td><td>${fmtDate(r.due_date)}</td><td>${statusBadge(r.status)}${isHistoricalRound(r) ? `<br><span class="small muted">${esc(labelFrom(HISTORICAL_REVIEW_LABELS, r.historical_review_status))}</span>` : ''}</td><td>${esc(r.document_number || '-')} ฉบับแก้ไขที่ ${esc(r.document_revision || '1')}</td><td class="no-print"><div class="table-actions">${canArchiveAll ? `<button class="btn btn-outline btn-sm" data-archive-round="${r.id}" data-stage="${esc(r.status || 'current')}">เก็บ PDF รอบ</button>` : ''}${latest ? `<a class="btn btn-outline btn-sm" href="${esc(latest.drive_url)}" target="_blank" rel="noopener">เปิดไฟล์ล่าสุด</a>` : '<span class="small muted">ยังไม่มีไฟล์</span>'}</div></td></tr>`;
        }).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:12px">พิมพ์จากระบบวันที่ ${fmtDate(new Date(), true)}</div>
      </div>
      <div class="card no-print">
        <div class="card-header"><div><h2>ไฟล์ที่เก็บใน Google Drive</h2><div class="small muted">แสดงสูงสุด 100 ไฟล์ล่าสุดตามสิทธิ์ของบัญชี</div></div><span class="badge info">${archiveRows.length} ไฟล์</span></div>
        ${archiveRows.length ? `<div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>ประเภท</th><th>ชื่อไฟล์</th><th>ขั้นตอน / ฉบับ</th><th>แหล่งที่มา</th><th>เปิดไฟล์</th></tr></thead><tbody>${archiveRows.map((row) => `<tr><td>${fmtDate(row.generated_at, true)}</td><td>${esc(reportTypeLabel[row.report_type] || row.report_type)}</td><td><strong>${esc(row.file_name)}</strong><div class="small muted">${esc(row.drive_folder_path || '-')}</div></td><td>${esc(row.stage || '-')} · v${row.version || 1}</td><td>${esc(sourceLabel[row.source] || row.source || '-')}</td><td><a class="btn btn-outline btn-sm" href="${esc(row.drive_url)}" target="_blank" rel="noopener">เปิดใน Drive</a></td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่มีไฟล์ที่เก็บใน Google Drive')}
      </div>
    </section>`;
    appEl.innerHTML = shell(content, 'รายงาน');
    bindShell();
    document.getElementById('print-report').onclick = () => window.print();
    document.getElementById('archive-registry')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const archive = await archiveReportToDrive({ report_type: 'registry', stage: `registry_${new Date().getFullYear()}` });
      event.currentTarget.disabled = false;
      if (archive) route();
    });
    document.querySelectorAll('[data-archive-round]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      const archive = await archiveReportToDrive({ report_type: 'round_summary', round_id: button.dataset.archiveRound, stage: button.dataset.stage || 'current' });
      button.disabled = false;
      if (archive) route();
    }));
  }

  function parseDayList(value, fallback = []) {
    const values = String(value || '').split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 0 && item <= 365);
    return values.length ? [...new Set(values)] : fallback;
  }

  async function renderAutomation() {
    if (!canManage()) {
      const content = `<section class="page"><div class="page-header"><div><h1>แจ้งเตือน / Google Drive</h1></div></div><div class="notice warning">หน้านี้ตั้งค่าได้เฉพาะโหมดผู้ดูแลระบบหรือผู้จัดการคุณภาพ กรุณาเปลี่ยนบทบาทจากเมนูด้านซ้าย</div></section>`;
      appEl.innerHTML = shell(content, 'แจ้งเตือน / Google Drive'); bindShell(); return;
    }
    const [{ data: settings, error: settingsError }, { data: logs, error: logError }, { data: archives, error: archiveError }] = await Promise.all([
      state.supabase.from('ec_notification_settings').select('*').eq('id', 1).single(),
      state.supabase.from('ec_notification_logs').select('*').order('created_at', { ascending: false }).limit(50),
      state.supabase.from('ec_report_archives').select('*').order('generated_at', { ascending: false }).limit(20)
    ]);
    if (settingsError || logError || archiveError) return renderError(settingsError || logError || archiveError);
    const categoryLabel = {
      eqa_due: 'EQA ใกล้ครบกำหนด', competency_due: 'Competency ใกล้ครบกำหนด', reflection_due: 'แบบทบทวนใกล้ครบกำหนด',
      reviewer_pending: 'รอผู้ทบทวน', qm_pending: 'รอผู้จัดการคุณภาพ', reflection_review_pending: 'รอตรวจแบบทบทวน',
      daily_chat_summary: 'สรุปรายวัน', system_test: 'ทดสอบระบบ'
    };
    const channelLabel = { email: 'Email', google_chat: 'Google Chat' };
    const logBadge = (status) => `<span class="badge ${status === 'sent' ? 'success' : status === 'failed' ? 'danger' : status === 'skipped' ? '' : 'warning'}">${esc({ sent: 'ส่งสำเร็จ', failed: 'ส่งไม่สำเร็จ', pending: 'กำลังส่ง', skipped: 'ข้าม' }[status] || status || '-')}</span>`;
    const content = `<section class="page">
      <div class="page-header"><div><h1>แจ้งเตือน / Google Drive</h1><p>ติดตาม EQA, Competency, Reflection, Reviewer และ QM พร้อมสำรองรายงาน PDF</p></div><div class="header-actions"><button class="btn btn-outline" id="automation-health">ตรวจการเชื่อมต่อ</button><button class="btn btn-secondary" id="automation-test">ส่งข้อความทดสอบ</button><button class="btn btn-primary" id="automation-run">ตรวจและส่งตอนนี้</button></div></div>
      <div id="automation-result"></div>
      <div class="grid cols-2 automation-grid">
        <div class="card">
          <div class="card-header"><div><h2>เปิด–ปิดการทำงาน</h2><div class="small muted">ค่าตั้งนี้ใช้กับการตรวจอัตโนมัติทุกวัน</div></div></div>
          <form id="automation-settings-form" class="form-grid">
            <label class="toggle-row"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}><span><strong>เปิดระบบแจ้งเตือน</strong><small>ปิดไว้ได้ชั่วคราวโดยไม่ลบ Trigger</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="send_email" ${settings.send_email ? 'checked' : ''}><span><strong>ส่ง Email</strong><small>ส่งถึงผู้รับผิดชอบตามขั้นตอน</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="send_google_chat" ${settings.send_google_chat ? 'checked' : ''}><span><strong>ส่ง Google Chat</strong><small>ส่งภาพรวมเข้าห้องหน่วยงาน</small></span></label>
            <label class="toggle-row"><input type="checkbox" name="auto_archive" ${settings.auto_archive ? 'checked' : ''}><span><strong>เก็บ PDF อัตโนมัติใน Google Drive</strong><small>สร้างเมื่อสถานะสำคัญเปลี่ยนและไม่เขียนทับฉบับเดิม</small></span></label>
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
      <div class="card">
        <div class="card-header"><div><h2>PDF ที่ระบบสำรองล่าสุด</h2><div class="small muted">เปิดดูไฟล์จริงจาก Google Drive ได้โดยตรง</div></div><a class="btn btn-outline btn-sm" href="#/reports">ดูทั้งหมด</a></div>
        ${(archives || []).length ? `<div class="archive-list">${archives.map((row) => `<a class="archive-row" href="${esc(row.drive_url)}" target="_blank" rel="noopener"><span><strong>${esc(row.file_name)}</strong><small>${fmtDate(row.generated_at, true)} · ${esc(row.source === 'automatic' ? 'อัตโนมัติ' : 'สร้างด้วยตนเอง')}</small></span><span>เปิดไฟล์ ↗</span></a>`).join('')}</div>` : empty('ยังไม่มีไฟล์ PDF ในทะเบียน')}
      </div>
    </section>`;
    appEl.innerHTML = shell(content, 'แจ้งเตือน / Google Drive');
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
      await saveSettings({ enabled: fd.get('enabled') === 'on', send_email: fd.get('send_email') === 'on', send_google_chat: fd.get('send_google_chat') === 'on', auto_archive: fd.get('auto_archive') === 'on', chat_include_person_names: fd.get('chat_include_person_names') === 'on', app_url: String(fd.get('app_url') || '').trim().replace(/\/$/, ''), timezone: String(fd.get('timezone') || 'Asia/Bangkok').trim() }, 'บันทึกการตั้งค่าแล้ว');
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
      if (!confirm('ตรวจรายการค้าง ส่งการแจ้งเตือนที่ถึงกำหนด และสำรอง PDF ตอนนี้หรือไม่')) return;
      event.currentTarget.disabled = true;
      try {
        const result = await invokeAutomation({ action: 'run_now' });
        showResult(`<strong>ตรวจรอบปัจจุบันเสร็จแล้ว</strong><br>รายการที่เข้าเงื่อนไข ${result.candidate_notifications || 0} · ส่งใหม่ ${result.sent_now || 0} · ข้ามข้อความซ้ำ ${result.skipped_duplicate || 0} · สร้าง PDF ${result.archives_created || 0}`, 'success');
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
        <div class="page-header"><div><h1>ผู้ใช้งานและสิทธิ์</h1><p>ขณะนี้อยู่ในโหมด ${esc(ROLE_LABELS[state.activeRole] || 'ไม่ระบุบทบาท')}</p></div></div>
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
        <details open><summary>เริ่มต้นใช้งานและเลือกบทบาท</summary><div class="guide-body"><p>เลือกบทบาทจากกล่องด้านล่างของแถบเมนู ระบบจะแสดงปุ่มตามบทบาทที่เลือก โดยไม่เปลี่ยนสิทธิ์จริงของบัญชี</p><p>หากมีหลายบทบาท ให้เลือกบทบาทให้ตรงกับงานที่กำลังทำ เช่น เจ้าหน้าที่ ผู้ทบทวน ผู้จัดการคุณภาพ แพทย์ หรือผู้ดูแลระบบ</p></div></details>
        <details><summary>ลำดับงานของรอบ EQA</summary><div class="guide-body"><ol><li>บันทึกข้อมูลการรับรอบและกำหนดผู้รับผิดชอบ</li><li>ผู้ปฏิบัติจริงบันทึกผลรายบุคคล</li><li>ระบบเทียบผลและสร้างสรุปผลห้องปฏิบัติการ</li><li>ผู้ทบทวนตรวจและส่งให้ผู้จัดการคุณภาพ</li><li>ผู้จัดการคุณภาพรับรอง และแพทย์รับทราบ</li></ol></div></details>
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
        <details><summary>ผลรายบุคคลและสรุปผลห้องปฏิบัติการ</summary><div class="guide-body"><p>ผู้ปฏิบัติแต่ละคนบันทึกผลของตนเองแยกกัน เมื่อส่งครบ ระบบจะเติมค่าที่ตรงกันในสรุปผลห้องให้อัตโนมัติ</p><p>ค่าที่ไม่ตรงกันจะถูกทำเครื่องหมายให้ผู้ทบทวนตรวจและเลือกผลที่ถูกต้องก่อนส่งให้ผู้จัดการคุณภาพ</p></div></details>
        <details><summary>การตรวจ รับรอง และรับทราบ</summary><div class="guide-body"><p>ผู้ทบทวนตรวจผลห้องและหลักฐาน จากนั้นส่งให้ผู้จัดการคุณภาพรับรอง เมื่อรับรองแล้วแพทย์จึงกดรับทราบได้</p><p>ผู้จัดการคุณภาพต้องรับรองทุกรอบ แม้เป็นหนึ่งในผู้ปฏิบัติจริง โดยต้องสลับ “ใช้งานในบทบาท” ให้ตรงกับขั้นตอน เช่น กรอกผลในบทบาทเจ้าหน้าที่ และรับรองในบทบาทผู้จัดการคุณภาพ</p><p>ประวัติการอนุมัติจะแสดงชื่อพร้อมบทบาทที่ใช้ลงนามในแต่ละครั้ง ส่วนผู้ทบทวนยังต้องเป็นคนละคนกับผู้ปฏิบัติจริงทั้งสองคน</p><p>การส่งกลับต้องระบุเหตุผล เพื่อให้ผู้เกี่ยวข้องแก้ไขเฉพาะจุด</p></div></details>
        <details><summary>การสร้างจากเอกสารและรายงานผล</summary><div class="guide-body"><p><strong>ระบบอ่านไฟล์ทีละฉบับ</strong> และบันทึกสถานะ “รออ่าน / กำลังอ่าน / AI อ่านแล้ว / อ่านไม่สำเร็จ” ไว้ในตาราง หากเกิดรหัส 546 ให้กดสร้างใหม่ ระบบจะทำต่อเฉพาะไฟล์ที่เหลือ</p><p><strong>สร้างแบบกรอก คำแนะนำ และข้อสอบจากเอกสาร</strong> อ่านฟอร์มเปล่า คู่มือ ภาพผลดิบ และ Antigram/Panel cell แล้วสร้างฉบับร่างให้ QM ตรวจ</p><p><strong>สร้างเฉลยและสรุปจาก Evaluation / Participant Summary</strong> ต้องมี Official Evaluation ก่อน ระบบใช้ Intended Response เป็นเฉลยของรายการ graded และใช้ Participant Summary เฉพาะ Educational Challenge</p><p>ระบบแยกสรุปเป็น 5 ส่วน: ผลของห้อง, ผลที่ควรเป็น, คะแนน/Grade, เปรียบเทียบผู้เข้าร่วม และหัวข้อทบทวน</p><p>Educational Challenge ไม่คิดเป็นคะแนนทางการ แต่ระบบต้องเทียบคำตอบของห้อง/บุคลากรกับ participant consensus: ถ้าสอดคล้องให้ระบุว่าเหมาะสม ถ้าเป็นคำตอบส่วนน้อยให้สถานะ “ต้องทบทวน/ชี้แจง” และบันทึกเหตุผลว่าทำไมจึงตอบต่าง หากไม่มี Participant Summary หรือ consensus ไม่ชัด ระบบจะไม่เดาและให้ QM ตรวจเอง</p><p><strong>สร้างย้อนหลังครบชุด</strong> ใช้กับรอบที่ได้รับผลแล้ว ระบบสร้างแบบกรอก คำแนะนำ ข้อสอบ เฉลย และสรุป พร้อมตั้งให้เห็นเฉลยหลังส่งคำตอบ</p><p>ข้อสอบทุกข้อยังเป็นฉบับร่างจนกว่า QM จะตรวจและกดเผยแพร่</p></div></details>
        <details><summary>การแจ้งเตือน EQA และ Competency</summary><div class="guide-body"><p>ผู้ดูแลระบบหรือผู้จัดการคุณภาพตั้งค่าได้ที่เมนู <strong>แจ้งเตือน / Google Drive</strong> ระบบตรวจรายการ EQA ใกล้ครบกำหนด แบบทดสอบที่ยังไม่ส่ง แบบทบทวน ผู้ทบทวนที่ยังไม่ตรวจ และรายการรอผู้จัดการคุณภาพ</p><p>Email ส่งถึงผู้เกี่ยวข้องตามหน้าที่ ส่วน Google Chat ใช้แจ้งภาพรวมของหน่วยงาน โดยค่าเริ่มต้นไม่แสดงชื่อผู้รับการประเมินรายบุคคล</p><p>ปุ่ม <strong>ตรวจและส่งตอนนี้</strong> ใช้ทดสอบหรือตรวจรายการทันที ส่วน Trigger ใน Google Apps Script จะเรียกตรวจอัตโนมัติทุกวัน</p></div></details>
        <details><summary>แบบทบทวนหลังตอบไม่ถูกหรือ Educational เป็นคำตอบส่วนน้อย</summary><div class="guide-body"><p>เมื่อผู้จัดการคุณภาพรับรองแล้วพบข้อที่ตอบไม่ถูก หรือ Educational Challenge ที่คำตอบต่างจากกลุ่มผู้เข้าร่วมส่วนใหญ่ ระบบจะเปลี่ยนสถานะเป็น <strong>ต้องทบทวน</strong> โดย Educational ไม่ถูกนับเป็นคะแนนทางการ</p><p>เจ้าหน้าที่บันทึกเหตุผลที่เลือกคำตอบเดิม ผลการทบทวนว่าคำตอบของห้องเหมาะสมหรือควรแก้ไข และสิ่งที่จะนำไปใช้กับงาน จากนั้นส่งให้ผู้ทบทวนรับรองหรือส่งกลับแก้ไข</p></div></details>
        <details><summary>การเก็บ PDF ใน Google Drive</summary><div class="guide-body"><p>รายงานทะเบียน รอบ EQA และ Competency สามารถกดเก็บใน Google Drive ได้จากหน้า รายงาน / ทะเบียน หรือหน้าการประเมิน ระบบจะสร้างไฟล์ฉบับใหม่พร้อมเลขเวอร์ชัน และเก็บลิงก์ไว้ในระบบ</p><p>เมื่อเปิดการเก็บอัตโนมัติ ระบบจะสำรองไฟล์ในจุดสำคัญ เช่น ส่งคำตอบ ผู้ทบทวนตรวจ ผู้จัดการคุณภาพรับรอง ส่ง Reflection และปิดรอบ โดยไม่เขียนทับไฟล์เดิม</p></div></details>
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
