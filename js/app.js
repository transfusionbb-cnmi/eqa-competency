/* CNMI EQA and Competency Management System
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
    reviewer: 'ตรวจทานผลของผู้ปฏิบัติและผลกลาง ก่อนส่งให้ผู้จัดการคุณภาพอนุมัติ',
    qm: 'บริหารรอบ EQA และอนุมัติด้านคุณภาพหลังผู้ทบทวนตรวจแล้ว',
    physician: 'อนุมัติผล EQA ขั้นสุดท้าย ไม่ต้องทำแบบทดสอบบุคลากร',
    admin: 'จัดการผู้ใช้งาน สิทธิ์ และการตั้งค่าระบบ',
    viewer: 'อ่านรายงานและประวัติการใช้งานโดยไม่แก้ไขข้อมูล'
  };
  const ROLE_PRIORITY = ['admin', 'qm', 'reviewer', 'physician', 'viewer', 'staff'];
  const STATUS_LABELS = {
    preparing: 'เตรียมดำเนินการ',
    in_progress: 'กำลังดำเนินการ',
    awaiting_review: 'รอตรวจทาน',
    returned_for_revision: 'ส่งกลับแก้ไข',
    awaiting_qm_approval: 'รอผู้จัดการคุณภาพอนุมัติ',
    qm_approved: 'ผู้จัดการคุณภาพอนุมัติแล้ว',
    awaiting_physician_approval: 'รอแพทย์อนุมัติ',
    physician_approved: 'แพทย์อนุมัติแล้ว',
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
    submission_form: 'แบบฟอร์มส่งผล',
    submission_evidence: 'หลักฐานการส่งผล',
    official_result: 'รายงานผลประเมินอย่างเป็นทางการ',
    corrective_action: 'หลักฐานการแก้ไขและป้องกัน',
    closure_report: 'รายงานสรุปปิดรอบ',
    other: 'เอกสารอื่น ๆ'
  };
  const VISIBILITY_LABELS = {
    restricted: 'เฉพาะผู้ทบทวน ผู้จัดการคุณภาพ และแพทย์',
    assigned: 'เฉพาะผู้ได้รับมอบหมาย',
    staff: 'บุคลากรทุกคน'
  };
  const ASSIGNMENT_ROLE_LABELS = {
    practitioner: 'ผู้ปฏิบัติจริง',
    reviewer: 'ผู้ทบทวนผล',
    physician: 'แพทย์ผู้อนุมัติ'
  };
  const RESULT_STATUS_LABELS = {
    draft: 'ฉบับร่าง',
    submitted: 'ส่งแล้ว',
    returned: 'ส่งกลับแก้ไข',
    resubmitted: 'ส่งใหม่แล้ว',
    awaiting_practitioner_confirmations: 'รอผู้ปฏิบัติทั้งสองคนยืนยัน',
    practitioners_confirmed: 'ผู้ปฏิบัติยืนยันครบ รอผู้ทบทวน',
    awaiting_qm_review: 'ผู้ทบทวนผ่านแล้ว รอผู้จัดการคุณภาพ',
    qm_approved: 'ผู้จัดการคุณภาพอนุมัติแล้ว รอแพทย์',
    awaiting_physician_approval: 'รอแพทย์อนุมัติ',
    physician_approved: 'แพทย์อนุมัติแล้ว',
    locked: 'ล็อกข้อมูลแล้ว'
  };
  const APPROVAL_STAGE_LABELS = {
    practitioner_confirm: 'ผู้ปฏิบัติทั้งสองคนยืนยันผลกลาง',
    reviewer_review: 'ผู้ทบทวนตรวจผลของผู้ปฏิบัติและผลกลาง',
    qm_review: 'ผู้จัดการคุณภาพตรวจและอนุมัติ',
    physician_approval: 'แพทย์อนุมัติขั้นสุดท้าย',
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
    ec_consensus_results: 'ผลกลางของห้อง',
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
    ec_historical_result_confirmations: 'การยืนยันข้อมูลย้อนหลัง'
  };
  const METHOD_LABELS = {
    abo: 'หมู่เลือด ABO',
    rh: 'หมู่เลือด Rh',
    screen: 'การคัดกรองแอนติบอดี',
    antibody: 'การระบุชนิดแอนติบอดี',
    crossmatch: 'การทดสอบความเข้ากันได้',
    antigen: 'การตรวจแอนติเจน'
  };

  const RESULT_SPECIMENS = ['J-08', 'J-09', 'J-10', 'J-11', 'J-12'];

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

  function showModal(title, bodyHtml, footerHtml = '', large = false) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal ${large ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header"><h2>${esc(title)}</h2><button class="close-btn" data-close-modal>×</button></div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close-modal]')) closeModal();
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
    return `<button class="nav-btn ${active ? 'active' : ''}" data-nav="${route}"><span class="nav-icon">${icon}</span><span>${esc(label)}</span></button>`;
  }

  function currentRoute() {
    const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
    return raw;
  }

  function shell(content, title = '') {
    const route = currentRoute();
    const assignedRoleBadges = state.roles.map((role) => `<span class="badge">${esc(ROLE_LABELS[role] || 'บทบาทอื่น')}</span>`).join('');
    return `
      <div class="app-shell">
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
          ${navItem('reports', '▤', 'รายงาน / ทะเบียน', route)}
          <div class="nav-section">การจัดการ</div>
          ${navItem('users', '♙', 'ผู้ใช้งานและสิทธิ์', route)}
          ${navItem('audit', '◷', 'ประวัติการใช้งาน', route)}
          ${navItem('settings', '⚙', 'ตั้งค่าของฉัน', route)}
          <div class="sidebar-footer">
            <div class="user-mini">
              <div class="user-name-row">
                <strong>${esc(state.profile?.full_name)}</strong>
                <span class="badge info">ออนไลน์</span>
              </div>
              <div class="role-switcher">
                <label for="active-role-select">โหมดการทำงาน</label>
                <select class="role-select" id="active-role-select" data-role-switch ${state.roles.length <= 1 ? 'disabled' : ''}>
                  ${roleOptions()}
                </select>
                <div class="role-hint">เลือกบทบาทที่กำลังปฏิบัติงาน ระบบจะเปิดปุ่มตามโหมดนี้ โดยไม่เปลี่ยนสิทธิ์จริงที่ผู้ดูแลระบบกำหนด</div>
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
              <button class="btn btn-outline mobile-menu" id="mobile-menu" aria-label="เปิดเมนู">☰</button>
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
    document.getElementById('mobile-menu')?.addEventListener('click', () => {
      const isOpen = sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('show', Boolean(isOpen));
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
    ['individual', '4. ผลรายบุคคล'], ['consensus', '5. ผลกลางของห้อง'], ['approval', '6. ตรวจ/อนุมัติ'],
    ['submission', '7. หลักฐานการส่ง'], ['official', '8. ผลประเมินกลับ'], ['capa', '9. การแก้ไขและป้องกัน'], ['competency', '10. การประเมินความสามารถ']
  ];

  function roundTabs(roundId, active) {
    return `<div class="tabs">${ROUND_TABS.map(([key, label]) => `<button class="tab-btn ${active === key ? 'active' : ''}" data-round-tab="${key}">${label}</button>`).join('')}</div>`;
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
      ${roundTabs(round.id, tab)}
      ${tabContent}
    </section>`;
    appEl.innerHTML = shell(content, `${round.provider} ${round.round_code}`); bindShell();
    document.getElementById('back-rounds')?.addEventListener('click', () => navigate('rounds'));
    document.querySelectorAll('[data-round-tab]').forEach((b) => b.addEventListener('click', () => navigate(`round/${round.id}/${b.dataset.roundTab}`)));
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
        <div style="height:10px"></div><div class="notice">2) เมื่อส่งครบ ทั้งสองคนเปรียบเทียบผล ร่วมกันเลือกผลกลาง และกดยืนยันคนละหนึ่งครั้ง</div>
        <div style="height:10px"></div><div class="notice">3) ส่งให้ผู้ทบทวนตรวจ → ผู้จัดการคุณภาพอนุมัติ → แพทย์อนุมัติขั้นสุดท้าย</div>
        <div style="height:10px"></div><div class="notice">4) แพทย์ไม่ต้องทำแบบทดสอบบุคลากร ส่วนเจ้าหน้าที่คนอื่นทำการประเมินหลังห้องส่งผลแล้วและก่อนเปิดเฉลย</div>
        ${round.notes ? `<div style="height:14px"></div><h3>หมายเหตุ</h3><p>${esc(round.notes)}</p>` : ''}
      </div>
    </div>`;
  }

    async function roundDocuments(round) {
    const { data: docs, error } = await state.supabase.from('ec_round_documents').select('*').eq('round_id', round.id).order('created_at', { ascending: false });
    if (error) throw error;
    const uploadAllowed = canManage() || canReview() || round.receiver_id === state.user.id || await isAssigned(round.id);
    return `<div class="card">
      <div class="card-header"><div><h2>เอกสารและภาพ</h2><div class="small muted">ไฟล์เก็บไว้ในพื้นที่ส่วนตัวของระบบ ไม่ได้เก็บไว้ใน GitHub</div></div>
      ${uploadAllowed ? `<button class="btn btn-primary" id="upload-doc-btn">＋ อัปโหลดไฟล์</button>` : ''}</div>
      ${(docs || []).length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ชื่อ</th><th>ผู้ที่เปิดดูได้</th><th>วันที่อัปโหลด</th><th>จัดการ</th></tr></thead><tbody>
        ${(docs || []).map((d) => `<tr><td>${esc(labelFrom(DOCUMENT_CATEGORY_LABELS, d.category))}</td><td><strong>${esc(d.title)}</strong><br><span class="small muted">${esc(d.file_name)}</span></td><td>${esc(labelFrom(VISIBILITY_LABELS, d.visibility))}</td><td>${fmtDate(d.created_at, true)}</td><td><button class="btn btn-outline btn-sm" data-open-doc="${d.id}" data-path="${esc(d.storage_path)}">เปิดไฟล์</button></td></tr>`).join('')}
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
      <div class="card-header"><div><h2>ผู้รับผิดชอบ</h2><div class="small muted">ผู้ปฏิบัติจริง 2 คนต้องเป็นเจ้าหน้าที่ ผู้ทบทวนต้องมีบทบาทผู้ทบทวน และแพทย์ไม่ต้องมีบทบาทเจ้าหน้าที่</div></div>${canChange ? `<button class="btn btn-primary" id="manage-assignments">กำหนดผู้รับผิดชอบ</button>` : ''}</div>
      ${isHistoricalRound(round) && resultCount.count ? `<div class="notice warning">มีการกรอกผลย้อนหลังแล้ว ระบบจึงล็อกชื่อผู้ปฏิบัติจริงเพื่อไม่ให้หลักฐานเปลี่ยนบุคคล หากเลือกผิดให้แก้ก่อนกรอกผลย้อนหลัง</div><div style="height:12px"></div>` : ''}
      ${(assignments || []).length ? `<div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>ชื่อ</th><th>ลำดับผู้ปฏิบัติ</th><th>วันที่มอบหมาย</th></tr></thead><tbody>
        ${(assignments || []).map((assignment) => `<tr><td>${esc(labelFrom(ASSIGNMENT_ROLE_LABELS, assignment.assignment_role))}</td><td>${esc(name(assignment.user_id))}</td><td>${assignment.practitioner_slot || '-'}</td><td>${fmtDate(assignment.assigned_at, true)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('ยังไม่ได้มอบหมายผู้ปฏิบัติ ผู้ทบทวนผล หรือแพทย์')}
    </div>`;
  }

  function defaultResultPayload() {
    return {
      specimens: Object.fromEntries(RESULT_SPECIMENS.map((s) => [s, { abo: '', rh: '', screen: '', antibody: '', crossmatch: '', strength: '', notes: '' }])),
      methods: { abo: '', rh: '', screen: '', antibody: '', crossmatch: '', antigen: '' },
      reagents: '', instrument: '', overall_note: ''
    };
  }

  function resultForm(payload, prefix = 'result', disabled = false) {
    const p = { ...defaultResultPayload(), ...(payload || {}) };
    p.specimens = { ...defaultResultPayload().specimens, ...(payload?.specimens || {}) };
    return `<div class="result-grid">
      <div class="result-row"><strong>ตัวอย่าง</strong><span>ABO</span><span>Rh</span><span>คัดกรองแอนติบอดี</span><span>ระบุชนิดแอนติบอดี</span><span>ความเข้ากันได้ / ความแรงปฏิกิริยา</span></div>
      ${RESULT_SPECIMENS.map((s) => { const x = p.specimens[s] || {}; return `<div class="result-row"><strong>${s}</strong>
        <input class="input" name="${prefix}_${s}_abo" value="${esc(x.abo)}" ${disabled?'disabled':''} placeholder="A/B/O/AB">
        <input class="input" name="${prefix}_${s}_rh" value="${esc(x.rh)}" ${disabled?'disabled':''} placeholder="บวก / ลบ">
        <input class="input" name="${prefix}_${s}_screen" value="${esc(x.screen)}" ${disabled?'disabled':''} placeholder="พบ / ไม่พบ">
        <input class="input" name="${prefix}_${s}_antibody" value="${esc(x.antibody)}" ${disabled?'disabled':''} placeholder="เช่น แอนติ-K">
        <div class="form-grid"><input class="input" name="${prefix}_${s}_crossmatch" value="${esc(x.crossmatch)}" ${disabled?'disabled':''} placeholder="เข้ากันได้ / เข้ากันไม่ได้"><input class="input" name="${prefix}_${s}_strength" value="${esc(x.strength)}" ${disabled?'disabled':''} placeholder="0–4+"></div>
      </div>`; }).join('')}
      <div class="form-grid cols-3">
        ${['abo','rh','screen','antibody','crossmatch','antigen'].map((m) => `<div class="field"><label>วิธีตรวจ: ${esc(METHOD_LABELS[m] || m)}</label><input class="input" name="${prefix}_method_${m}" value="${esc(p.methods?.[m] || '')}" ${disabled?'disabled':''}></div>`).join('')}
      </div>
      <div class="form-grid cols-2"><div class="field"><label>น้ำยา / เลขรุ่นผลิต</label><textarea class="textarea" name="${prefix}_reagents" ${disabled?'disabled':''}>${esc(p.reagents || '')}</textarea></div><div class="field"><label>เครื่องมือ</label><textarea class="textarea" name="${prefix}_instrument" ${disabled?'disabled':''}>${esc(p.instrument || '')}</textarea></div></div>
      <div class="field"><label>หมายเหตุรวม</label><textarea class="textarea" name="${prefix}_overall_note" ${disabled?'disabled':''}>${esc(p.overall_note || '')}</textarea></div>
    </div>`;
  }

  function collectResultPayload(form, prefix = 'result') {
    const fd = new FormData(form);
    const specimens = {};
    RESULT_SPECIMENS.forEach((s) => {
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
    const checkbox = document.getElementById('no-individual-evidence');
    const toggle = () => document.querySelectorAll('#historical-individual-result-fields input, #historical-individual-result-fields textarea, #historical-individual-result-fields select').forEach((field) => { field.disabled = checkbox.checked; });
    checkbox.addEventListener('change', toggle); toggle();
    document.getElementById('save-historical-individual').addEventListener('click', async () => {
      const form = document.getElementById('historical-individual-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = checkbox.checked ? defaultResultPayload() : collectResultPayload(form, 'historicalIndividual');
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
    const canEditOwn = practitioner && (!own || ['draft','returned'].includes(own.status));
    return `<div class="grid ${canReview() ? 'cols-2' : ''}">
      <div class="card"><div class="card-header"><div><h2>ผลที่ฉันบันทึก</h2><div class="small muted">ระบบเก็บประวัติฉบับเดิมทุกครั้งที่แก้ไข</div></div>${own ? `<span class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, own.status))} · ฉบับที่ ${own.version}</span>` : ''}</div>
        ${practitioner ? `<form id="individual-result-form">${resultForm(own?.result_payload, 'individual', !canEditOwn)}</form>
          ${canEditOwn ? `<div class="modal-footer"><button class="btn btn-secondary" id="save-individual">บันทึกร่าง</button><button class="btn btn-primary" id="submit-individual">ยืนยันและส่งผล</button></div>` : `<div class="notice">ผลถูกส่งแล้วและล็อกการแก้ไข หากต้องแก้ระบบจะส่งกลับทั้งชุดผ่านขั้นผู้ทบทวนหรือผู้จัดการคุณภาพ</div>`}` : `<div class="notice">หน้านี้ใช้สำหรับผู้ปฏิบัติจริงที่ได้รับมอบหมายเท่านั้น</div>`}
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
    return [
      `ABO: ${x.abo || '-'}`, `Rh: ${x.rh || '-'}`, `คัดกรอง: ${x.screen || '-'}`,
      `แอนติบอดี: ${x.antibody || '-'}`, `ความเข้ากันได้: ${x.crossmatch || '-'}`, `ความแรง: ${x.strength || '-'}`
    ].join('<br>');
  }

  function resultComparison(rows, consensus) {
    if (!rows || rows.length < 2) return '';
    const [first, second] = rows;
    return `<div class="table-wrap"><table style="min-width:850px"><thead><tr><th>ตัวอย่าง</th><th>${esc(first.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 1')}</th><th>${esc(second.ec_profiles?.full_name || 'ผู้ปฏิบัติคนที่ 2')}</th><th>ผลกลางที่บันทึกไว้</th></tr></thead><tbody>
      ${RESULT_SPECIMENS.map((specimen) => `<tr><td><strong>${esc(specimen)}</strong></td><td>${resultSummary(first.result_payload, specimen)}</td><td>${resultSummary(second.result_payload, specimen)}</td><td>${resultSummary(consensus?.result_payload, specimen)}</td></tr>`).join('')}
    </tbody></table></div>`;
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
        return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(label)}</strong><br>${found.length ? found.map((item) => `${esc(name(item.approver_id))} — ${esc(labelFrom(DECISION_LABELS, item.decision))} (${fmtDate(item.signed_at, true)})${item.note ? `<br><span class="small muted">${esc(item.note)}</span>` : ''}`).join('<br>') : '<span class="muted">ยังไม่มีการรับรอง</span>'}</div></div>`;
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
    const [{ data: consensus }, { data: approvals }, { data: individualRows }, { data: assignmentRows }] = await Promise.all([
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_approvals').select('*').eq('round_id', round.id).eq('stage', 'practitioner_confirm'),
      state.supabase.from('ec_individual_results').select('*, ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('round_id', round.id).order('submitted_at'),
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('assignment_role', 'practitioner').eq('active', true)
    ]);
    const practitioner = await isPractitioner(round.id);
    const submittedIds = new Set((individualRows || []).filter((row) => ['submitted','resubmitted','locked'].includes(row.status)).map((row) => row.user_id));
    const pairComplete = (assignmentRows || []).length === 2 && (assignmentRows || []).every((row) => submittedIds.has(row.user_id));
    const currentVersionApprovals = (approvals || []).filter((a) => !consensus || a.result_version === consensus.version);
    const editable = practitioner && pairComplete && (!consensus || ['draft','returned','awaiting_practitioner_confirmations'].includes(consensus.status));
    const canSeeComparison = pairComplete && (practitioner || canReview() || hasRole('physician','viewer'));
    return `<div class="card"><div class="card-header"><div><h2>เปรียบเทียบและจัดทำผลกลางของห้องปฏิบัติการ</h2><div class="small muted">เปิดเมื่อผู้ปฏิบัติทั้งสองคนส่งผลแล้ว จากนั้นทั้งสองคนร่วมกันเลือกผลกลางและยืนยันคนละหนึ่งครั้ง</div></div>${consensus ? `<span class="badge">${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status))} · ฉบับที่ ${consensus.version}</span>` : ''}</div>
      ${!pairComplete ? `<div class="notice warning">ยังจัดทำผลกลางไม่ได้ ต้องรอผู้ปฏิบัติจริงทั้ง 2 คนกด “ยืนยันและส่งผล” ให้ครบก่อน</div>` : ''}
      ${canSeeComparison ? `<h3>เปรียบเทียบผลของผู้ปฏิบัติ</h3>${resultComparison((individualRows || []).filter((row) => submittedIds.has(row.user_id)), consensus)}<div style="height:18px"></div>` : ''}
      ${pairComplete && (practitioner || canReview() || hasRole('physician','viewer')) ? `<h3>ผลกลางของห้อง</h3><form id="consensus-form">${resultForm(consensus?.result_payload, 'consensus', !editable)}</form>
      <div class="modal-footer">
        ${editable ? `<button class="btn btn-secondary" id="save-consensus">บันทึกผลกลาง</button><button class="btn btn-primary" id="confirm-consensus">ยืนยันผลกลางของฉัน</button>` : ''}
        ${canReview() && consensus ? `<button class="btn btn-outline" id="print-consensus">พิมพ์ผลกลาง</button>` : ''}
      </div>
      <div class="notice">ผู้ปฏิบัติยืนยันผลกลางฉบับปัจจุบันแล้ว ${currentVersionApprovals.length}/2 คน เมื่อครบระบบจะส่งต่อให้ผู้ทบทวนโดยอัตโนมัติ</div>` : `<div class="notice">หน้านี้ใช้สำหรับผู้ปฏิบัติจริงและผู้มีหน้าที่ตรวจรับรองเท่านั้น</div>`}
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
    const reviewerCanAct = consensus && hasRole('reviewer') && isAssignedReviewer && ['practitioners_confirmed'].includes(consensus.status);
    const qmCanAct = consensus && hasRole('qm') && ['awaiting_qm_review'].includes(consensus.status);
    const physicianCanAct = consensus && hasRole('physician') && ['qm_approved','awaiting_physician_approval'].includes(consensus.status);
    const stages = ['practitioner_confirm','reviewer_review','qm_review','physician_approval','closure_acknowledgement'];
    return `<div class="grid cols-2">
      <div class="card"><h2>ลำดับการตรวจและอนุมัติ</h2>
        <div class="timeline">${stages.map((stage) => {
          const found = (approvals || []).filter((a) => a.stage === stage);
          return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(labelFrom(APPROVAL_STAGE_LABELS, stage))}</strong><br>${found.length ? found.map((a) => `${esc(a.ec_profiles?.full_name || '')} — ${esc(labelFrom(DECISION_LABELS, a.decision))} (${fmtDate(a.signed_at,true)})${a.note ? `<br><span class="small muted">${esc(a.note)}</span>` : ''}`).join('<br>') : '<span class="muted">ยังไม่มีการรับรอง</span>'}</div></div>`;
        }).join('')}</div>
      </div>
      <div class="card"><h2>ดำเนินการตามลำดับ</h2>
        ${!consensus ? `<div class="notice warning">ยังไม่มีผลกลางของห้อง</div>` : ''}
        ${reviewerCanAct ? `<div class="form-grid"><div class="notice">ผู้ทบทวนตรวจได้ แต่แก้คำตอบเดิมของผู้ปฏิบัติไม่ได้ หากพบข้อผิดพลาดให้ส่งกลับทั้งชุดพร้อมเหตุผล</div><div class="field"><label>ข้อคิดเห็นของผู้ทบทวน</label><textarea class="textarea" id="reviewer-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="reviewer-approve">ผ่านการทบทวนและส่งให้ผู้จัดการคุณภาพ</button><button class="btn btn-warning" id="reviewer-return">ส่งกลับผู้ปฏิบัติแก้ไข</button></div></div>` : ''}
        ${qmCanAct ? `<div class="form-grid"><div class="notice">ผู้ทบทวนตรวจผ่านแล้ว ผู้จัดการคุณภาพจึงสามารถอนุมัติได้</div><div class="field"><label>หมายเหตุผู้จัดการคุณภาพ</label><textarea class="textarea" id="qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="qm-approve">ผู้จัดการคุณภาพอนุมัติ</button><button class="btn btn-warning" id="qm-return">ส่งกลับแก้ไข</button></div></div>` : ''}
        ${physicianCanAct ? `<div class="form-grid"><div class="notice">ผู้จัดการคุณภาพอนุมัติแล้ว แพทย์จึงสามารถรับรองขั้นสุดท้ายได้</div><div class="field"><label>หมายเหตุแพทย์</label><textarea class="textarea" id="physician-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="physician-approve">แพทย์อนุมัติขั้นสุดท้าย</button><button class="btn btn-warning" id="physician-return">ส่งกลับผู้จัดการคุณภาพ</button></div></div>` : ''}
        ${consensus && !reviewerCanAct && !qmCanAct && !physicianCanAct ? `<div class="notice">สถานะปัจจุบัน: ${esc(labelFrom(RESULT_STATUS_LABELS, consensus.status, consensus.status))}<br>ระบบจะเปิดปุ่มให้เฉพาะผู้มีหน้าที่ในลำดับปัจจุบันเท่านั้น</div>` : ''}
        ${hasRole('reviewer') && assignedReviewer && !isAssignedReviewer ? `<div class="notice warning">รอบนี้มอบหมายผู้ทบทวนคนอื่น คุณเปิดดูได้แต่ไม่สามารถกดผ่านหรือส่งกลับได้</div>` : ''}
      </div>
    </div>`;
  }

  async function roundSubmission(round) {
    const [{ data: rows, error }, directory] = await Promise.all([
      state.supabase.from('ec_submission_evidence').select('*, ec_round_documents(*)').eq('round_id', round.id).order('submitted_at', { ascending: false }),
      loadDirectory()
    ]);
    if (error) throw error;
    const name = (id) => directory.find((person) => person.id === id)?.full_name || '-';
    if (isHistoricalRound(round)) {
      return `<div class="card"><div class="card-header"><div><h2>หลักฐานการส่งผลย้อนหลัง</h2><div class="small muted">แสดงข้อมูลการส่งจริงในอดีต แยกจากผู้ที่นำข้อมูลเข้าระบบภายหลัง</div></div></div>
        <div class="grid cols-3">
          <div><strong>วันที่และเวลาที่ส่งจริง</strong><p>${fmtDate(round.actual_submitted_at, true)}</p></div>
          <div><strong>เจ้าหน้าที่ผู้ส่งผลจริง</strong><p>${esc(name(round.actual_submitted_by))}</p></div>
          <div><strong>เลขอ้างอิง</strong><p>${esc(round.actual_provider_reference || '-')}</p></div>
        </div>
        <div class="notice">ให้อัปโหลดภาพหน้าจอหรือ PDF หลักฐานการส่งในหัวข้อ 2 “เอกสาร/ภาพ” โดยเลือกประเภท “หลักฐานการส่งผล”</div>
        ${(rows || []).length ? `<div style="height:14px"></div><div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>เลขอ้างอิง</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${fmtDate(row.submitted_at, true)}</td><td>${esc(row.provider_reference || '-')}</td><td>${esc(row.note || '-')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
    }
    return `<div class="card"><div class="card-header"><div><h2>หลักฐานการส่งผล</h2><div class="small muted">บันทึกวันเวลา ผู้ส่ง เลขอ้างอิง และแนบหลักฐาน</div></div>${canManage() ? `<button class="btn btn-primary" id="add-submission">＋ บันทึกการส่ง</button>` : ''}</div>
      ${(rows || []).length ? `<div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>เลขอ้างอิง</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${fmtDate(row.submitted_at,true)}</td><td>${esc(row.provider_reference || '-')}</td><td>${esc(row.note || '-')}</td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่มีหลักฐานการส่งผล')}
    </div>`;
  }

  async function roundOfficial(round) {
    const { data: official } = await state.supabase.from('ec_official_results').select('*').eq('round_id', round.id).maybeSingle();
    return `<div class="card"><div class="card-header"><div><h2>ผลประเมินอย่างเป็นทางการ</h2><div class="small muted">กรอกหลังได้รับผลจาก CAP แล้วจึงเปิดเฉลยให้บุคลากร</div></div></div>
      ${canManage() ? `<form id="official-form" class="form-grid cols-2">
        <div class="field"><label>คะแนน</label><input class="input" type="number" step="0.01" name="score" value="${esc(official?.score ?? '')}"></div>
        <div class="field"><label>ผลสรุป</label><select class="select" name="outcome"><option value="pending">รอผล</option><option value="pass" ${official?.outcome==='pass'?'selected':''}>ผ่าน</option><option value="fail" ${official?.outcome==='fail'?'selected':''}>ไม่ผ่าน</option><option value="partial" ${official?.outcome==='partial'?'selected':''}>ผ่านบางส่วน</option></select></div>
        <div class="field" style="grid-column:1/-1"><label>สรุปผล / รายการที่ผิด</label><textarea class="textarea" name="summary">${esc(official?.summary || '')}</textarea></div>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="published" ${official?.published_to_staff?'checked':''}> เปิดผลและเฉลยให้บุคลากร</label>
      </form><div class="modal-footer"><button class="btn btn-primary" id="save-official">บันทึกผลประเมิน</button></div>` : official ? `<div class="grid cols-3"><div><strong>คะแนน</strong><div class="stat-value">${official.score ?? '-'}</div></div><div><strong>ผล</strong><p>${esc(labelFrom(OFFICIAL_OUTCOME_LABELS, official.outcome))}</p></div><div><strong>เปิดให้บุคลากร</strong><p>${official.published_to_staff ? 'เปิดแล้ว' : 'ยังไม่เปิด'}</p></div></div><p>${esc(official.summary || '')}</p>` : empty('ยังไม่ได้รับผลประเมินอย่างเป็นทางการ')}
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
    const [{ data: questions }, { data: assignments }, directory] = await Promise.all([
      state.supabase.from('ec_questions').select('*, ec_question_choices(*)').eq('round_id', round.id).order('question_order'),
      state.supabase.from('ec_competency_assignments').select('*').eq('round_id', round.id).order('created_at'),
      loadDirectory()
    ]);
    const name = (id) => directory.find((p) => p.id === id)?.full_name || id;
    const canCreateCompetency = canManage() && (!isHistoricalRound(round) || round.historical_review_status === 'qm_certified');
    const actionFor = (assignment) => {
      if (hasRole('reviewer')) {
        const canReviewQuiz = assignment.assignment_type === 'quiz' && assignment.status === 'submitted';
        const canReviewPractical = assignment.assignment_type === 'practical' && ['not_started','in_progress','submitted'].includes(assignment.status);
        if (canReviewQuiz || canReviewPractical) return `<button class="btn btn-primary btn-sm" data-review-competency="${assignment.id}" data-type="${assignment.assignment_type}">ตรวจประเมิน</button>`;
      }
      if (hasRole('qm') && assignment.status === 'under_review') {
        return `<button class="btn btn-success btn-sm" data-qm-approve-competency="${assignment.id}">รับรองผล</button><button class="btn btn-warning btn-sm" data-qm-return-competency="${assignment.id}">ส่งกลับผู้ทบทวน</button>`;
      }
      return '<span class="small muted">รอตามลำดับงาน</span>';
    };
    return `<div class="grid cols-2">
      <div class="card"><div class="card-header"><div><h2>ข้อสอบ</h2><div class="small muted">เผยแพร่คำถามหลังห้องส่งผลให้ผู้ให้บริการ และก่อนเปิดเฉลย</div></div>${canManage() ? `<button class="btn btn-primary" id="add-question">＋ เพิ่มคำถาม</button>` : ''}</div>
        ${(questions || []).length ? questions.map((q) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><span class="badge ${q.published?'success':'warning'}">${q.published?'เผยแพร่':'ฉบับร่าง'}</span> <strong>${q.question_order}. ${esc(q.prompt)}</strong><br><span class="small muted">${esc(labelFrom(QUESTION_TYPE_LABELS, q.question_type))} · ${q.points} คะแนน ${q.is_critical?'· ข้อสำคัญ':''}</span>${canManage()?`<div style="margin-top:7px"><button class="btn btn-outline btn-sm" data-edit-question="${q.id}">แก้ไข</button></div>`:''}</div>`).join('') : empty('ยังไม่มีคำถาม')}
      </div>
      <div class="card"><div class="card-header"><div><h2>การมอบหมายและตรวจประเมิน</h2><div class="small muted">ผู้ปฏิบัติจริงประเมินจากการทำงาน เจ้าหน้าที่คนอื่นทำแบบทดสอบ ผู้ทบทวนตรวจด่านแรก แล้วผู้จัดการคุณภาพรับรอง</div></div>${canCreateCompetency?`<button class="btn btn-primary" id="assign-all-competency">สร้างรายการประเมิน</button>`:''}</div>
        ${isHistoricalRound(round) && round.historical_review_status !== 'qm_certified' ? `<div class="notice warning">ต้องให้ผู้ปฏิบัติทั้งสองคนยืนยัน ผู้ทบทวนตรวจ และผู้จัดการคุณภาพรับรองข้อมูลย้อนหลังให้ครบก่อน จึงจะสร้างรายการประเมินได้</div><div style="height:12px"></div>` : ''}
        ${(assignments || []).length ? `<div class="table-wrap"><table style="min-width:760px"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${assignments.map((a)=>`<tr><td>${esc(name(a.user_id))}</td><td>${esc(labelFrom(COMPETENCY_TYPE_LABELS, a.assignment_type))}</td><td>${assignmentBadge(a.status)}</td><td>${a.score ?? '-'}</td><td><div class="table-actions">${actionFor(a)}</div></td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่ได้สร้างรายการประเมิน')}
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
    document.getElementById('upload-doc-btn')?.addEventListener('click', () => {
      showModal('อัปโหลดเอกสาร/ภาพ', `<form id="doc-form" class="form-grid">
        <div class="field"><label>ประเภท</label><select class="select" name="category">${Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}</select></div>
        <div class="field"><label>ชื่อเอกสาร</label><input class="input" name="title" required></div>
        <div class="field"><label>ผู้ที่เปิดดูได้</label><select class="select" name="visibility"><option value="restricted">เฉพาะผู้ทบทวน ผู้จัดการคุณภาพ และแพทย์</option><option value="assigned">ผู้ได้รับมอบหมาย</option><option value="staff">บุคลากรทุกคน</option></select></div>
        <div class="field"><label>ไฟล์ PDF/JPG/PNG/WebP ไม่เกิน 20 MB</label><input class="input" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="upload-doc-save">อัปโหลด</button>`);
      document.getElementById('upload-doc-save').addEventListener('click', async () => {
        const form = document.getElementById('doc-form'); if (!form.reportValidity()) return;
        const fd = new FormData(form); const file = fd.get('file');
        if (!(file instanceof File)) return;
        if (file.size > 20 * 1024 * 1024) return toast('ไฟล์เกิน 20 MB', 'danger');
        const category = String(fd.get('category')); const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g,'_');
        const path = `${round.id}/${category}/${crypto.randomUUID()}_${safeName}`;
        const upload = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
        if (upload.error) return toast(friendlyError(upload.error), 'danger');
        const ins = await state.supabase.from('ec_round_documents').insert({ round_id: round.id, category, title: String(fd.get('title')), file_name: file.name, storage_path: path, mime_type: file.type, file_size: file.size, visibility: String(fd.get('visibility')), uploaded_by: state.user.id });
        if (ins.error) return toast(friendlyError(ins.error), 'danger');
        closeModal(); toast('อัปโหลดเรียบร้อย', 'success'); route();
      });
    });
    document.querySelectorAll('[data-open-doc]').forEach((b) => b.addEventListener('click', async () => {
      const { data, error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(b.dataset.path, 300);
      if (error) return toast(friendlyError(error), 'danger');
      window.open(data.signedUrl, '_blank', 'noopener');
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
        <div class="notice" style="grid-column:1/-1">ลำดับการทำงาน: ผู้ปฏิบัติ 2 คน → ผู้ทบทวน → ผู้จัดการคุณภาพ → แพทย์</div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 1</label><select class="select" name="p1" required>${options(practitioners, find('practitioner',1))}</select></div>
        <div class="field"><label>ผู้ปฏิบัติจริง คนที่ 2</label><select class="select" name="p2" required>${options(practitioners, find('practitioner',2))}</select></div>
        <div class="field"><label>ผู้ทบทวนผล</label><select class="select" name="reviewer" required>${options(reviewers, find('reviewer'))}</select><div class="help">ต้องเป็นคนละคนกับผู้ปฏิบัติทั้งสองคน</div></div>
        <div class="field"><label>แพทย์ผู้อนุมัติที่คาดไว้</label><select class="select" name="physician">${options(physicians, find('physician'), 'ยังไม่ระบุ — แพทย์ผู้รับรองคนใดก็ได้สามารถอนุมัติ')}</select><div class="help">แพทย์ไม่ต้องมีบทบาทเจ้าหน้าที่และไม่ถูกมอบหมายแบบทดสอบ</div></div>
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
    document.getElementById('save-consensus')?.addEventListener('click',async()=>{
      const payload=collectResultPayload(document.getElementById('consensus-form'),'consensus');
      const {data:existing}=await state.supabase.from('ec_consensus_results').select('id').eq('round_id',round.id).maybeSingle();
      const row={round_id:round.id,result_payload:payload,status:'awaiting_practitioner_confirmations',prepared_by:state.user.id};
      const res=existing?await state.supabase.from('ec_consensus_results').update(row).eq('id',existing.id):await state.supabase.from('ec_consensus_results').insert(row);
      if(res.error)return toast(friendlyError(res.error), 'danger');
      toast('บันทึกผลกลางแล้ว กรุณาให้ผู้ปฏิบัติทั้งสองคนกดยืนยัน','success');route();
    });
    document.getElementById('confirm-consensus')?.addEventListener('click',async()=>{
      if(!confirm('ยืนยันผลกลางฉบับนี้หรือไม่ การยืนยันจะบันทึกชื่อและวันเวลา')) return;
      const note=prompt('หมายเหตุการยืนยัน (เว้นว่างได้)')||'';
      const {error}=await state.supabase.rpc('ec_confirm_consensus',{p_round_id:round.id,p_note:note});
      if(error)return toast(friendlyError(error), 'danger');
      toast('ยืนยันผลกลางแล้ว','success');route();
    });
    document.getElementById('print-consensus')?.addEventListener('click',()=>window.print());
  }

    function bindApproval(round) {
    const decide = async (rpcName, decision, note) => {
      const { error } = await state.supabase.rpc(rpcName, { p_round_id: round.id, p_decision: decision, p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      toast(decision === 'approved' ? 'บันทึกการอนุมัติแล้ว' : 'ส่งกลับแก้ไขแล้ว', 'success');
      route();
    };
    document.getElementById('reviewer-approve')?.addEventListener('click', () => decide('ec_reviewer_decide_consensus','approved',document.getElementById('reviewer-note').value));
    document.getElementById('reviewer-return')?.addEventListener('click', () => {
      const note=document.getElementById('reviewer-note').value.trim(); if(!note)return toast('กรุณาระบุเหตุผลที่ส่งกลับ','warning'); decide('ec_reviewer_decide_consensus','returned',note);
    });
    document.getElementById('qm-approve')?.addEventListener('click', () => decide('ec_qm_decide_consensus','approved',document.getElementById('qm-note').value));
    document.getElementById('qm-return')?.addEventListener('click', () => {
      const note=document.getElementById('qm-note').value.trim(); if(!note)return toast('กรุณาระบุเหตุผลที่ส่งกลับ','warning'); decide('ec_qm_decide_consensus','returned',note);
    });
    document.getElementById('physician-approve')?.addEventListener('click', () => decide('ec_physician_decide_consensus','approved',document.getElementById('physician-note').value));
    document.getElementById('physician-return')?.addEventListener('click', () => {
      const note=document.getElementById('physician-note').value.trim(); if(!note)return toast('กรุณาระบุเหตุผลที่ส่งกลับ','warning'); decide('ec_physician_decide_consensus','returned',note);
    });
  }

    function bindSubmission(round) {
    document.getElementById('add-submission')?.addEventListener('click',()=>{showModal('บันทึกหลักฐานการส่งผล',`<form id="submission-form" class="form-grid"><div class="field"><label>วันเวลา</label><input class="input" type="datetime-local" name="submitted_at" required value="${new Date().toISOString().slice(0,16)}"></div><div class="field"><label>เลขอ้างอิง</label><input class="input" name="reference"></div><div class="field"><label>หมายเหตุ</label><textarea class="textarea" name="note"></textarea></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-submission">บันทึก</button>`);document.getElementById('save-submission').addEventListener('click',async()=>{const f=document.getElementById('submission-form');if(!f.reportValidity())return;const fd=new FormData(f);const {error}=await state.supabase.from('ec_submission_evidence').insert({round_id:round.id,submitted_at:new Date(String(fd.get('submitted_at'))).toISOString(),submitted_by:state.user.id,provider_reference:String(fd.get('reference')||'')||null,note:String(fd.get('note')||'')||null});if(error)return toast(friendlyError(error), 'danger');await state.supabase.from('ec_eqa_rounds').update({status:'submitted_to_provider',updated_by:state.user.id,competency_open_at:new Date().toISOString()}).eq('id',round.id);closeModal();toast('บันทึกการส่งผลแล้ว','success');route();});});
  }

  function bindOfficial(round) {
    document.getElementById('save-official')?.addEventListener('click',async()=>{const fd=new FormData(document.getElementById('official-form'));const payload={round_id:round.id,score:fd.get('score')?Number(fd.get('score')):null,outcome:String(fd.get('outcome')),summary:String(fd.get('summary')||'')||null,published_to_staff:fd.get('published')==='on',recorded_by:state.user.id,received_at:new Date().toISOString()};const {error}=await state.supabase.from('ec_official_results').upsert(payload,{onConflict:'round_id'});if(error)return toast(friendlyError(error), 'danger');await state.supabase.from('ec_eqa_rounds').update({status:'official_result_received',answer_released_at:payload.published_to_staff?new Date().toISOString():null,updated_by:state.user.id}).eq('id',round.id);toast('บันทึกผลอย่างเป็นทางการแล้ว','success');route();});
  }

  function bindCapa(round) {
    const open=(row={})=>{showModal(row.id?'แก้ไขรายการแก้ไขและป้องกัน':'เปิดรายการแก้ไขและป้องกัน',`<form id="capa-form" class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>ปัญหาที่พบ</label><textarea class="textarea" name="issue" required>${esc(row.issue_description||'')}</textarea></div><div class="field"><label>สาเหตุ</label><textarea class="textarea" name="root">${esc(row.root_cause||'')}</textarea></div><div class="field"><label>ผลกระทบ</label><textarea class="textarea" name="impact">${esc(row.impact_assessment||'')}</textarea></div><div class="field"><label>การแก้ไขทันที</label><textarea class="textarea" name="correction">${esc(row.immediate_correction||'')}</textarea></div><div class="field"><label>การป้องกัน</label><textarea class="textarea" name="preventive">${esc(row.preventive_action||'')}</textarea></div><div class="field"><label>กำหนดเสร็จ</label><input class="input" type="date" name="due" value="${fmtDateInput(row.due_date)}"></div><div class="field"><label>สถานะ</label><select class="select" name="status">${Object.entries(CAPA_STATUS_LABELS).map(([value,label])=>`<option value="${value}" ${row.status===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div><input type="hidden" name="id" value="${esc(row.id||'')}"></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-capa">บันทึก</button>`,true);document.getElementById('save-capa').addEventListener('click',async()=>{const f=document.getElementById('capa-form');if(!f.reportValidity())return;const fd=new FormData(f);const id=String(fd.get('id')||'');const p={round_id:round.id,issue_description:String(fd.get('issue')),root_cause:String(fd.get('root')||'')||null,impact_assessment:String(fd.get('impact')||'')||null,immediate_correction:String(fd.get('correction')||'')||null,preventive_action:String(fd.get('preventive')||'')||null,due_date:fd.get('due')||null,status:String(fd.get('status')),updated_by:state.user.id};const res=id?await state.supabase.from('ec_corrective_actions').update(p).eq('id',id):await state.supabase.from('ec_corrective_actions').insert({...p,created_by:state.user.id});if(res.error)return toast(friendlyError(res.error), 'danger');closeModal();toast('บันทึกรายการแก้ไขและป้องกันแล้ว','success');route();});};
    document.getElementById('add-capa')?.addEventListener('click',()=>open());
    document.querySelectorAll('[data-edit-capa]').forEach(b=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_corrective_actions').select('*').eq('id',b.dataset.editCapa).single();if(error)return toast(friendlyError(error), 'danger');open(data);}));
  }

  function bindCompetencyAdmin(round) {
    const openQuestion=async(row=null)=>{let choices=[];let key=null;if(row?.id){const [{data:choiceData},{data:keyData}]=await Promise.all([state.supabase.from('ec_question_choices').select('*').eq('question_id',row.id).order('choice_order'),state.supabase.from('ec_question_answer_keys').select('*').eq('question_id',row.id).maybeSingle()]);choices=choiceData||[];key=keyData||null;}const correctIndex=choices.findIndex(c=>(key?.correct_choice_ids||[]).includes(c.id));showModal(row?'แก้ไขคำถาม':'เพิ่มคำถาม',`<form id="question-form" class="form-grid cols-2"><input type="hidden" name="id" value="${esc(row?.id||'')}"><div class="field"><label>ลำดับ</label><input class="input" type="number" name="order" required value="${esc(row?.question_order||1)}"></div><div class="field"><label>หัวข้อ</label><input class="input" name="section" value="${esc(row?.section||'')}"></div><div class="field"><label>ประเภท</label><select class="select" name="type">${Object.entries(QUESTION_TYPE_LABELS).map(([value,label])=>`<option value="${value}" ${row?.question_type===value?'selected':''}>${esc(label)}</option>`).join('')}</select></div><div class="field"><label>คะแนน</label><input class="input" type="number" step="0.1" name="points" value="${esc(row?.points||1)}"></div><div class="field" style="grid-column:1/-1"><label>คำถาม</label><textarea class="textarea" name="prompt" required>${esc(row?.prompt||'')}</textarea></div><div class="field" style="grid-column:1/-1"><label>ตัวเลือก (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</label><textarea class="textarea" name="choices">${esc(choices.map(c=>c.choice_text).join('\n'))}</textarea><div class="help">ใช้เมื่อเลือกประเภท “เลือกคำตอบเดียว”</div></div><div class="field"><label>ลำดับตัวเลือกที่ถูก</label><input class="input" type="number" name="correct" min="1" value="${correctIndex>=0?correctIndex+1:''}"></div><div class="field"><label>คำอธิบายเฉลย</label><input class="input" name="explanation" value="${esc(key?.explanation||'')}"></div><label><input type="checkbox" name="critical" ${row?.is_critical?'checked':''}> ข้อสำคัญ</label><label><input type="checkbox" name="published" ${row?.published?'checked':''}> เผยแพร่คำถาม</label></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-question">บันทึก</button>`,true);document.getElementById('save-question').addEventListener('click',async()=>{const f=document.getElementById('question-form');if(!f.reportValidity())return;const fd=new FormData(f);const id=String(fd.get('id')||'');const p={round_id:round.id,question_order:Number(fd.get('order')),section:String(fd.get('section')||'')||null,question_type:String(fd.get('type')),prompt:String(fd.get('prompt')),points:Number(fd.get('points')||1),is_critical:fd.get('critical')==='on',published:fd.get('published')==='on',updated_by:state.user.id};let qres=id?await state.supabase.from('ec_questions').update(p).eq('id',id).select().single():await state.supabase.from('ec_questions').insert({...p,created_by:state.user.id}).select().single();if(qres.error)return toast(friendlyError(qres.error), 'danger');const qid=qres.data.id;await state.supabase.from('ec_question_choices').delete().eq('question_id',qid);const lines=String(fd.get('choices')||'').split('\n').map(x=>x.trim()).filter(Boolean);const correct=Number(fd.get('correct')||0);let correctIds=[];if(lines.length){const {data:inserted,error}=await state.supabase.from('ec_question_choices').insert(lines.map((text,i)=>({question_id:qid,choice_order:i+1,choice_text:text}))).select();if(error)return toast(friendlyError(error), 'danger');if(correct>0&&inserted?.[correct-1])correctIds=[inserted[correct-1].id];}const keyRes=await state.supabase.from('ec_question_answer_keys').upsert({question_id:qid,correct_choice_ids:correctIds,answer_key_json:null,explanation:String(fd.get('explanation')||'')||null,updated_by:state.user.id},{onConflict:'question_id'});if(keyRes.error)return toast(friendlyError(keyRes.error), 'danger');closeModal();toast('บันทึกคำถามแล้ว','success');route();});};
    document.getElementById('add-question')?.addEventListener('click',()=>openQuestion());
    document.querySelectorAll('[data-edit-question]').forEach(b=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_questions').select('*').eq('id',b.dataset.editQuestion).single();if(error)return toast(friendlyError(error), 'danger');openQuestion(data);}));
    document.getElementById('assign-all-competency')?.addEventListener('click',async()=>{if(isHistoricalRound(round)&&round.historical_review_status!=='qm_certified')return toast('ต้องให้ผู้จัดการคุณภาพรับรองข้อมูลย้อนหลังให้ครบก่อน','warning');if(!confirm('สร้างรายการประเมินให้เจ้าหน้าที่ห้องปฏิบัติการทั้งหมดหรือไม่ แพทย์จะไม่ถูกนำมาสร้างแบบทดสอบ'))return;let directory;try{directory=await loadDirectory();}catch(error){return toast(friendlyError(error), 'danger');}const {data:practitioners,error:practitionerError}=await state.supabase.from('ec_round_assignments').select('user_id').eq('round_id',round.id).eq('assignment_role','practitioner').eq('active',true);if(practitionerError)return toast(friendlyError(practitionerError), 'danger');const practitionerIds=new Set((practitioners||[]).map(x=>x.user_id));const eligible=directory.filter(p=>personHasRole(p,'staff')&&!personHasRole(p,'physician'));const rows=eligible.map(p=>({round_id:round.id,user_id:p.id,assignment_type:practitionerIds.has(p.id)?'practical':'quiz',assigned_by:state.user.id}));if(!rows.length)return toast('ไม่พบเจ้าหน้าที่ที่ต้องรับการประเมิน','warning');const {error}=await state.supabase.from('ec_competency_assignments').upsert(rows,{onConflict:'round_id,user_id',ignoreDuplicates:true});if(error)return toast(friendlyError(error), 'danger');toast('สร้างรายการประเมิน แล้ว','success');route();});
  }

  async function openQuizReview(assignmentId) {
    const [{ data: assignment, error: assignmentError }, { data: answers, error: answersError }, { data: questions }, { data: choices }, { data: keys }] = await Promise.all([
      state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name)').eq('id', assignmentId).single(),
      state.supabase.from('ec_competency_answers').select('*').eq('assignment_id', assignmentId),
      state.supabase.from('ec_questions').select('*').order('question_order'),
      state.supabase.from('ec_question_choices').select('*').order('choice_order'),
      state.supabase.from('ec_question_answer_keys').select('*')
    ]);
    if (assignmentError || answersError) return toast(friendlyError(assignmentError || answersError), 'danger');
    const roundQuestions = (questions || []).filter((q) => q.round_id === assignment.round_id);
    const answerMap = new Map((answers || []).map((a) => [a.question_id, a]));
    const keyMap = new Map((keys || []).map((k) => [k.question_id, k]));
    const choiceName = (id) => (choices || []).find((c) => c.id === id)?.choice_text || id || '-';
    const rows = roundQuestions.map((q) => {
      const answer = answerMap.get(q.id);
      const payload = answer?.answer_payload || {};
      const userAnswer = payload.choice_id ? choiceName(payload.choice_id) : (payload.text || '-');
      const key = keyMap.get(q.id);
      const correctText = (key?.correct_choice_ids || []).map(choiceName).join(', ') || key?.answer_key_json?.text || key?.explanation || 'ให้ผู้ทบทวนพิจารณา';
      return `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
        <h3>${q.question_order}. ${esc(q.prompt)}</h3>
        <div class="grid cols-2"><div><strong>คำตอบของผู้ทำ</strong><p>${esc(userAnswer)}</p></div><div><strong>แนวคำตอบ/เฉลย</strong><p>${esc(correctText)}</p></div></div>
        <div class="form-grid cols-2">
          <div class="field"><label>ผลการตรวจ</label><select class="select" data-answer-result="${answer?.id || ''}" required><option value="">เลือกผล</option><option value="true" ${answer?.is_correct===true?'selected':''}>ถูก</option><option value="false" ${answer?.is_correct===false?'selected':''}>ไม่ถูก</option></select></div>
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
      if (reviewRows.some((r) => !r.answer_id || r.is_correct === null)) return toast('กรุณาตรวจทุกข้อให้ครบ', 'warning');
      const { error } = await state.supabase.rpc('ec_reviewer_review_quiz', { p_assignment_id: assignmentId, p_reviews: reviewRows, p_note: document.getElementById('quiz-review-note').value || null });
      if (error) return toast(friendlyError(error), 'danger');
      closeModal(); toast('ตรวจทานแล้ว ส่งให้ผู้จัดการคุณภาพเรียบร้อย', 'success'); route();
    });
  }

  async function openPracticalReview(assignmentId) {
    const { data: assignment, error } = await state.supabase.from('ec_competency_assignments').select('*, ec_profiles!ec_competency_assignments_user_id_fkey(full_name)').eq('id', assignmentId).single();
    if (error) return toast(friendlyError(error), 'danger');
    const { data: existing } = await state.supabase.from('ec_practical_assessments').select('*').eq('assignment_id', assignmentId).maybeSingle();
    const criteria = [
      ['result_accuracy','ความถูกต้องของผล'], ['procedure_compliance','ปฏิบัติตามขั้นตอน'], ['method_selection','เลือกวิธีตรวจเหมาะสม'],
      ['interpretation','แปลผลถูกต้อง'], ['documentation','บันทึกข้อมูลครบถ้วน'], ['problem_solving','แก้ปัญหาได้เหมาะสม']
    ];
    showModal(`ประเมินการปฏิบัติจริง — ${assignment.ec_profiles?.full_name || ''}`, `<form id="practical-review-form" class="form-grid"><div class="notice">ผู้ทบทวนประเมินจากการปฏิบัติจริงก่อน แล้วส่งให้ผู้จัดการคุณภาพรับรอง</div>${criteria.map(([key,label])=>`<div class="field"><label>${label}</label><select class="select" name="${key}" required><option value="">เลือกผล</option><option value="true" ${existing?.[key]===true?'selected':''}>ผ่าน</option><option value="false" ${existing?.[key]===false?'selected':''}>ต้องทบทวน</option></select></div>`).join('')}<div class="field"><label>หมายเหตุของผู้ทบทวน</label><textarea class="textarea" name="note">${esc(existing?.reviewer_note || '')}</textarea></div></form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-practical-review">ผ่านการทบทวนและส่งให้ผู้จัดการคุณภาพ</button>`, true);
    document.getElementById('save-practical-review').addEventListener('click', async () => {
      const form = document.getElementById('practical-review-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const assessment = Object.fromEntries(criteria.map(([key]) => [key, String(fd.get(key)) === 'true']));
      const { error: saveError } = await state.supabase.rpc('ec_reviewer_review_practical', { p_assignment_id: assignmentId, p_assessment: assessment, p_note: String(fd.get('note') || '') || null });
      if (saveError) return toast(friendlyError(saveError), 'danger');
      closeModal(); toast('ตรวจทานแล้ว ส่งให้ผู้จัดการคุณภาพเรียบร้อย', 'success'); route();
    });
  }

  function bindCompetencyReview(round) {
    document.querySelectorAll('[data-review-competency]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.type === 'practical') openPracticalReview(button.dataset.reviewCompetency);
      else openQuizReview(button.dataset.reviewCompetency);
    }));
    document.querySelectorAll('[data-qm-approve-competency]').forEach((button) => button.addEventListener('click', async () => {
      const note = prompt('หมายเหตุผู้จัดการคุณภาพ (เว้นว่างได้)') || '';
      const { error } = await state.supabase.rpc('ec_qm_decide_competency', { p_assignment_id: button.dataset.qmApproveCompetency, p_decision: 'approved', p_note: note || null });
      if (error) return toast(friendlyError(error), 'danger');
      toast('ผู้จัดการคุณภาพรับรองผลแล้ว', 'success'); route();
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
    const { data: assignments, error } = await state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(*)').eq('user_id', state.user.id).order('created_at', { ascending: false });
    if (error) return renderError(error);
    const content=`<section class="page"><div class="page-header"><div><h1>การประเมินของฉัน</h1><p>คำตอบของคุณถูกเก็บแยกและส่งแล้วจะล็อก</p></div></div><div class="card">${(assignments||[]).length?`<div class="table-wrap"><table><thead><tr><th>รอบ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${assignments.map(a=>`<tr><td><strong>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</strong></td><td>${esc(labelFrom(COMPETENCY_TYPE_LABELS, a.assignment_type))}</td><td>${assignmentBadge(a.status)}</td><td>${a.score??'-'}</td><td><button class="btn btn-primary btn-sm" data-open-assignment="${a.id}">เปิด</button></td></tr>`).join('')}</tbody></table></div>`:empty('ยังไม่มีรายการประเมิน')}</div></section>`;
    appEl.innerHTML=shell(content,'การประเมินของฉัน');bindShell();document.querySelectorAll('[data-open-assignment]').forEach(b=>b.addEventListener('click',()=>navigate(`assignment/${b.dataset.openAssignment}`)));
  }

  async function renderAssignment(id) {
    if (!isCompetencyParticipant()) return navigate('dashboard');
    const {data:a,error}=await state.supabase.from('ec_competency_assignments').select('*,ec_eqa_rounds(*)').eq('id',id).single();if(error)return renderError(error);
    if(a.assignment_type==='practical'){
      const content=`<section class="page"><div class="page-header"><div><h1>การประเมินจากการปฏิบัติจริง</h1><p>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</p></div><button class="btn btn-outline" id="back-my">กลับ</button></div><div class="card"><h2>การประเมินผู้ปฏิบัติจริง</h2><p>ผลการประเมินเชื่อมจากผล EQA รายบุคคล วิธีตรวจ การแปลผล การบันทึก และการแก้ปัญหา</p>${assignmentBadge(a.status)}<div style="height:12px"></div><button class="btn btn-primary" id="open-round-practical">เปิดรอบ EQA</button></div></section>`;appEl.innerHTML=shell(content,'การประเมินจากการปฏิบัติจริง');bindShell();document.getElementById('back-my').onclick=()=>navigate('my-competency');document.getElementById('open-round-practical').onclick=()=>navigate(`round/${a.round_id}/individual`);return;
    }
    const [{data:questions},{data:choices},{data:answers}]=await Promise.all([state.supabase.from('ec_questions_public').select('*').eq('round_id',a.round_id).order('question_order'),state.supabase.from('ec_question_choices_public').select('*'),state.supabase.from('ec_competency_answers').select('*').eq('assignment_id',id)]);
    const ansMap=new Map((answers||[]).map(x=>[x.question_id,x]));const editable=['not_started','in_progress'].includes(a.status);
    const qHtml=(questions||[]).map(q=>{const ans=ansMap.get(q.id)?.answer_payload||{};const cs=(choices||[]).filter(c=>c.question_id===q.id);let input='';if(q.question_type==='single_choice')input=cs.map(c=>`<label style="display:flex;gap:9px;align-items:flex-start;padding:8px 0"><input type="radio" name="q_${q.id}" value="${c.id}" ${ans.choice_id===c.id?'checked':''} ${editable?'':'disabled'}>${esc(c.choice_text)}</label>`).join('');else input=`<textarea class="textarea" name="q_${q.id}" ${editable?'':'disabled'}>${esc(ans.text||'')}</textarea>`;return `<div class="card"><span class="badge">${esc(q.section||'')}</span>${q.is_critical?'<span class="badge danger">ข้อสำคัญ</span>':''}<h3>${q.question_order}. ${esc(q.prompt)}</h3>${input}</div>`;}).join('');
    const content=`<section class="page"><div class="page-header"><div><h1>แบบทดสอบ</h1><p>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${assignmentBadge(a.status)}<button class="btn btn-outline" id="back-my">กลับ</button></div></div><form id="quiz-form" class="grid">${qHtml||empty('ผู้จัดการคุณภาพยังไม่ได้เผยแพร่คำถาม')}</form>${editable&&questions?.length?`<div class="modal-footer"><button class="btn btn-secondary" id="save-quiz">บันทึกร่าง</button><button class="btn btn-primary" id="submit-quiz">ยืนยันและส่งคำตอบ</button></div>`:''}</section>`;
    appEl.innerHTML=shell(content,'แบบทดสอบ');bindShell();document.getElementById('back-my').onclick=()=>navigate('my-competency');if(editable){await state.supabase.rpc('ec_start_competency',{p_assignment_id:id});const save=async()=>{const rows=[];(questions||[]).forEach(q=>{let payload={};if(q.question_type==='single_choice'){const x=document.querySelector(`input[name="q_${q.id}"]:checked`);payload=x?{choice_id:x.value}:{};}else payload={text:String(document.querySelector(`[name="q_${q.id}"]`)?.value||'').trim()};rows.push({assignment_id:id,question_id:q.id,answer_payload:payload});});const {error}=await state.supabase.from('ec_competency_answers').upsert(rows,{onConflict:'assignment_id,question_id'});if(error)throw error;};document.getElementById('save-quiz').onclick=async()=>{try{await save();toast('บันทึกร่างแล้ว','success');}catch(e){toast(friendlyError(e), 'danger');}};document.getElementById('submit-quiz').onclick=async()=>{if(!confirm('ยืนยันส่งคำตอบหรือไม่ หลังส่งจะแก้ไขไม่ได้'))return;try{await save();const {error}=await state.supabase.rpc('ec_submit_competency',{p_assignment_id:id});if(error)throw error;toast('ส่งคำตอบแล้ว','success');navigate('my-competency');}catch(e){toast(friendlyError(e), 'danger');}};}
  }

  async function renderReports() {
    const {data:rounds,error}=await state.supabase.from('ec_eqa_rounds').select('*').order('survey_year',{ascending:false});if(error)return renderError(error);
    const content=`<section class="page"><div class="page-header"><div><h1>รายงาน / ทะเบียน EQA</h1><p>กดปุ่มพิมพ์ แล้วเลือกบันทึกเป็นไฟล์ PDF</p></div><button class="btn btn-primary no-print" id="print-report">พิมพ์ / บันทึกเป็น PDF</button></div><div class="print-only"><h1>ทะเบียน EQA ประจำปี</h1><p>${esc(cfg.ORGANIZATION_NAME)}</p></div><div class="card"><div class="table-wrap"><table><thead><tr><th>ปี</th><th>ผู้ให้บริการ / รอบ</th><th>ประเภทข้อมูล</th><th>โปรแกรม</th><th>วันครบกำหนด</th><th>สถานะ</th><th>เลขเอกสาร</th></tr></thead><tbody>${(rounds||[]).map(r=>`<tr><td>${r.survey_year}</td><td>${esc(r.provider)} ${esc(r.round_code)}</td><td>${isHistoricalRound(r)?'ข้อมูลย้อนหลัง':'รอบใหม่'}</td><td>${esc(r.program_name)}</td><td>${fmtDate(r.due_date)}</td><td>${STATUS_LABELS[r.status]||'ไม่ทราบสถานะ'}${isHistoricalRound(r)?`<br><span class="small muted">${esc(labelFrom(HISTORICAL_REVIEW_LABELS,r.historical_review_status))}</span>`:''}</td><td>${esc(r.document_number||'-')} ฉบับแก้ไขที่ ${esc(r.document_revision||'1')}</td></tr>`).join('')}</tbody></table></div><div class="small muted" style="margin-top:12px">พิมพ์จากระบบวันที่ ${fmtDate(new Date(),true)}</div></div></section>`;appEl.innerHTML=shell(content,'รายงาน');bindShell();document.getElementById('print-report').onclick=()=>window.print();
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

  async function renderSettings(){const {data:factors}=await state.supabase.auth.mfa.listFactors();const totp=factors?.totp||[];const content=`<section class="page"><div class="page-header"><div><h1>ตั้งค่าของฉัน</h1><p>เปลี่ยนรหัสผ่านและส่งคำขอเปลี่ยนชื่อ/อีเมล</p></div></div><div class="grid cols-2"><div class="card"><h2>เปลี่ยนรหัสผ่าน</h2><form id="password-form" class="form-grid"><div class="field"><label>รหัสผ่านใหม่</label><input class="input" type="password" name="password" minlength="8" required></div><div class="field"><label>ยืนยัน</label><input class="input" type="password" name="confirm" minlength="8" required></div><button class="btn btn-primary">บันทึกรหัสผ่าน</button></form></div><div class="card"><h2>ข้อมูลส่วนตัว</h2><p><strong>${esc(state.profile.full_name)}</strong><br>${esc(state.profile.email)}<br>ชื่อผู้ใช้: ${esc(state.profile.username)}</p><button class="btn btn-outline" id="request-profile-change">ส่งคำขอเปลี่ยนชื่อ/อีเมล</button></div><div class="card"><h2>การยืนยันตัวตนสองขั้นตอน สำหรับผู้ดูแลระบบ ผู้จัดการคุณภาพ และแพทย์</h2><p class="muted">รหัสยืนยันจากแอปช่วยเพิ่มความปลอดภัยในการอนุมัติ</p>${totp.length?`<div class="notice success">ตั้งค่ารหัสยืนยันไว้แล้ว ${totp.length} รายการ</div>`:`<button class="btn btn-primary" id="enroll-mfa">ตั้งค่ารหัสยืนยันสองขั้นตอน</button>`}</div></div></section>`;appEl.innerHTML=shell(content,'ตั้งค่า');bindShell();document.getElementById('password-form').onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.currentTarget);const p=String(fd.get('password'));if(p!==String(fd.get('confirm')))return toast('รหัสผ่านไม่ตรงกัน','danger');const {error}=await state.supabase.auth.updateUser({password:p});if(error)return toast(friendlyError(error), 'danger');toast('เปลี่ยนรหัสผ่านแล้ว','success');e.currentTarget.reset();};document.getElementById('request-profile-change').onclick=()=>{showModal('ขอเปลี่ยนข้อมูลส่วนตัว',`<form id="profile-change-form" class="form-grid"><div class="field"><label>ชื่อ-สกุลใหม่</label><input class="input" name="full_name" value="${esc(state.profile.full_name)}"></div><div class="field"><label>อีเมลใหม่</label><input class="input" type="email" name="email" value="${esc(state.profile.email)}"></div><div class="field"><label>ชื่อผู้ใช้ใหม่</label><input class="input" name="username" value="${esc(state.profile.username)}"></div><div class="field"><label>เหตุผล</label><textarea class="textarea" name="reason" required></textarea></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-profile-request">ส่งคำขอ</button>`);document.getElementById('save-profile-request').onclick=async()=>{const f=document.getElementById('profile-change-form');if(!f.reportValidity())return;const fd=new FormData(f);const {error}=await state.supabase.rpc('ec_request_profile_change',{p_full_name:String(fd.get('full_name')),p_email:String(fd.get('email')),p_username:String(fd.get('username')),p_reason:String(fd.get('reason'))});if(error)return toast(friendlyError(error), 'danger');closeModal();toast('ส่งคำขอให้ผู้ดูแลระบบแล้ว','success');};};document.getElementById('enroll-mfa')?.addEventListener('click',async()=>{const {data,error}=await state.supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'CNMI EQA'});if(error)return toast(friendlyError(error), 'danger');showModal('ตั้งค่ารหัสยืนยันสองขั้นตอน',`<div style="text-align:center">${data.totp.qr_code}<p>รหัสตั้งค่า: <code>${esc(data.totp.secret)}</code></p></div><form id="mfa-verify-form" class="form-grid"><div class="field"><label>รหัส 6 หลักจากแอปสร้างรหัสยืนยัน</label><input class="input" name="code" inputmode="numeric" required></div></form>`,`<button class="btn btn-primary" id="verify-mfa">ยืนยัน</button>`);document.getElementById('verify-mfa').onclick=async()=>{const code=new FormData(document.getElementById('mfa-verify-form')).get('code');const ch=await state.supabase.auth.mfa.challenge({factorId:data.id});if(ch.error)return toast(friendlyError(ch.error), 'danger');const vr=await state.supabase.auth.mfa.verify({factorId:data.id,challengeId:ch.data.id,code:String(code)});if(vr.error)return toast(friendlyError(vr.error), 'danger');closeModal();toast('เปิดการยืนยันตัวตนสองขั้นตอนแล้ว','success');route();};});}

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
      else if(parts[0]==='settings')await renderSettings();
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
