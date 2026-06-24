/* CNMI EQA & Competency Management System v2.0.2
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
    rounds: [],
    directory: [],
    currentRound: null,
    busy: false,
  };

  const ROLE_LABELS = {
    staff: 'Staff', reviewer: 'Reviewer', qm: 'QM', physician: 'Physician', admin: 'Admin', viewer: 'Viewer / Auditor'
  };
  const STATUS_LABELS = {
    preparing: 'เตรียมดำเนินการ',
    in_progress: 'กำลังดำเนินการ',
    awaiting_review: 'รอตรวจทาน',
    returned_for_revision: 'ส่งกลับแก้ไข',
    awaiting_qm_approval: 'รอ QM อนุมัติ',
    qm_approved: 'QM อนุมัติแล้ว',
    awaiting_physician_approval: 'รอแพทย์อนุมัติ',
    physician_approved: 'แพทย์อนุมัติแล้ว',
    submitted_to_provider: 'ส่งผลแล้ว',
    official_result_received: 'ได้รับผลประเมินแล้ว',
    closed: 'ปิดรอบ',
    cancelled: 'ยกเลิก'
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

  function hasRole(...roles) { return roles.some((r) => state.roles.includes(r)); }
  function canManage() { return hasRole('admin', 'qm'); }
  function canReview() { return hasRole('admin', 'qm', 'reviewer'); }
  function isPhysician() { return hasRole('physician', 'admin'); }

  function statusBadge(status) {
    const label = STATUS_LABELS[status] || status || '-';
    const cls = ['closed', 'physician_approved', 'official_result_received'].includes(status) ? 'success'
      : ['returned_for_revision', 'cancelled'].includes(status) ? 'danger'
      : ['awaiting_review', 'awaiting_qm_approval', 'awaiting_physician_approval'].includes(status) ? 'warning'
      : 'info';
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function assignmentBadge(status) {
    const map = {
      not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', submitted: 'ส่งแล้ว', under_review: 'รอตรวจ',
      passed: 'ผ่าน', needs_reflection: 'ต้องทบทวน', reflection_submitted: 'ส่ง Reflection แล้ว',
      passed_after_review: 'ผ่านหลังทบทวน', cancelled: 'ยกเลิก'
    };
    const cls = ['passed', 'passed_after_review'].includes(status) ? 'success'
      : ['needs_reflection'].includes(status) ? 'danger'
      : ['submitted', 'under_review', 'reflection_submitted'].includes(status) ? 'warning' : 'info';
    return `<span class="badge ${cls}">${esc(map[status] || status)}</span>`;
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
          <h1>EQA & Competency<br>Management System</h1>
          <p>ระบบบริหารผลทดสอบความชำนาญและการประเมินสมรรถนะบุคลากร</p>
        </section>
        <section class="login-card-wrap">
          <div class="login-card">
            <div class="brand-mark">SETUP</div>
            <h2>ยังไม่ได้เชื่อม Supabase</h2>
            <p class="muted">เปิดไฟล์ <strong>js/config.js</strong> แล้วใส่ Project URL และ Publishable key ตามคู่มือ</p>
            <div class="notice warning">ห้ามใส่ Secret key หรือ service_role key ใน GitHub</div>
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
          <h1>CNMI EQA &<br>Competency</h1>
          <p>ติดตาม EQA ตั้งแต่รับตัวอย่าง ผลรายบุคคล ผลกลาง การอนุมัติ ผลประเมิน CAP การแก้ไข และ Competency ในรอบเดียว</p>
        </section>
        <section class="login-card-wrap">
          <form class="login-card" id="login-form">
            <div class="brand-mark">CNMI</div>
            <h2>เข้าสู่ระบบ</h2>
            <p class="muted">ใช้ Username หรืออีเมล Mahidol</p>
            ${message ? `<div class="notice danger">${esc(message)}</div><div style="height:12px"></div>` : ''}
            <div class="form-grid">
              <div class="field">
                <label for="login-name">Username หรืออีเมล Mahidol</label>
                <input class="input" id="login-name" name="login" required autocomplete="username" placeholder="username หรือ name@mahidol.ac.th">
              </div>
              <div class="field">
                <label for="login-password">รหัสผ่าน</label>
                <input class="input" id="login-password" name="password" type="password" required autocomplete="current-password" placeholder="รหัสผ่านของคุณ">
              </div>
              <button class="btn btn-primary btn-block" data-busy-sensitive type="submit">เข้าสู่ระบบ</button>
              <div class="notice">
                <strong>การเข้าสู่ระบบครั้งแรก</strong><br>
                รหัสผ่านเริ่มต้นคือ <strong>CNMI@</strong> ตามด้วยรหัสพนักงาน<br>
                หากเปลี่ยนรหัสผ่านแล้วและจำไม่ได้ กรุณาติดต่อ Admin เพื่อรีเซ็ต
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
      if (error) return renderLogin('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจ Username/Email และรหัสผ่าน');
    });
  }

  async function loadIdentity() {
    const { data: { session } } = await state.supabase.auth.getSession();
    state.session = session;
    state.user = session?.user || null;
    if (!state.user) {
      state.profile = null; state.roles = [];
      return false;
    }

    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] = await Promise.all([
      state.supabase.from('ec_profiles').select('*').eq('id', state.user.id).single(),
      state.supabase.from('ec_user_roles').select('role').eq('profile_id', state.user.id)
    ]);
    if (profileError || rolesError || !profile || profile.active === false) {
      await state.supabase.auth.signOut();
      state.profile = null; state.roles = [];
      return false;
    }
    state.profile = profile;
    state.roles = (roles || []).map((r) => r.role);
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
    return `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="brand-mark">CNMI</div>
            <div><strong>EQA & Competency</strong><div class="small muted">v${esc(cfg.VERSION || '2.0.0')}</div></div>
          </div>
          <div class="nav-section">งานของฉัน</div>
          ${navItem('dashboard', '⌂', 'ภาพรวม', route)}
          ${navItem('my-competency', '✓', 'Competency ของฉัน', route)}
          <div class="nav-section">EQA</div>
          ${navItem('rounds', '▦', 'รอบ EQA', route)}
          ${navItem('reports', '▤', 'รายงาน / ทะเบียน', route)}
          <div class="nav-section">การจัดการ</div>
          ${navItem('users', '♙', 'ผู้ใช้งานและสิทธิ์', route)}
          ${navItem('audit', '◷', 'Audit Log', route)}
          ${navItem('settings', '⚙', 'ตั้งค่าของฉัน', route)}
          <div class="sidebar-footer">
            <div class="user-mini">
              <strong>${esc(state.profile?.full_name)}</strong>
              <span class="small">${state.roles.map((r) => ROLE_LABELS[r] || r).join(', ')}</span>
              <button class="btn btn-outline btn-sm" id="logout-btn" style="margin-top:8px">ออกจากระบบ</button>
            </div>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="btn btn-outline mobile-menu" id="mobile-menu">☰</button>
              <div><strong>${esc(title || cfg.APP_NAME)}</strong><div class="small muted">${esc(cfg.ORGANIZATION_NAME || '')}</div></div>
            </div>
            <div class="small muted">${esc(state.profile?.username || '')}</div>
          </header>
          ${content}
        </main>
      </div>`;
  }

  function bindShell() {
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await state.supabase.auth.signOut();
    });
    document.getElementById('mobile-menu')?.addEventListener('click', () => document.getElementById('sidebar')?.classList.toggle('open'));
  }

  function navigate(route) {
    location.hash = `#/${route}`;
    document.getElementById('sidebar')?.classList.remove('open');
  }

  async function renderForcePassword() {
    appEl.innerHTML = `
      <div class="login-page">
        <section class="login-visual">
          <div class="brand-mark">CNMI</div><h1>ตั้งรหัสผ่านใหม่</h1>
          <p>รหัสเริ่มต้นใช้ได้เฉพาะครั้งแรกหรือหลัง Admin รีเซ็ต</p>
        </section>
        <section class="login-card-wrap">
          <form class="login-card" id="force-password-form">
            <div class="brand-mark">KEY</div>
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
        if (rpcError) toast(rpcError.message, 'danger');
      }
      setBusy(false);
      if (error) return toast(error.message, 'danger');
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
    const { data, error } = await state.supabase.rpc('ec_get_staff_directory');
    if (error) throw error;
    state.directory = data || [];
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
          ${canManage() ? `<div class="header-actions"><button class="btn btn-primary" id="new-round-btn">＋ สร้างรอบ EQA</button></div>` : ''}
        </div>
        <div class="grid cols-4">
          <div class="card stat-card"><div><div class="stat-value">${rounds.length}</div><div class="stat-label">รอบล่าสุด</div></div><div class="stat-icon">▦</div></div>
          <div class="card stat-card"><div><div class="stat-value">${openRounds}</div><div class="stat-label">รอบที่ยังไม่ปิด</div></div><div class="stat-icon">◷</div></div>
          <div class="card stat-card"><div><div class="stat-value">${assignments.length}</div><div class="stat-label">Competency ของฉัน</div></div><div class="stat-icon">✓</div></div>
          <div class="card stat-card"><div><div class="stat-value">${pendingCompetency}</div><div class="stat-label">รายการที่ต้องดำเนินการ</div></div><div class="stat-icon">!</div></div>
        </div>
        <div style="height:18px"></div>
        <div class="grid cols-2">
          <div class="card">
            <div class="card-header"><h2>รอบ EQA ล่าสุด</h2><button class="btn btn-outline btn-sm" data-nav-inline="rounds">ดูทั้งหมด</button></div>
            ${rounds.length ? `<div class="timeline">${rounds.map((r) => `
              <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content">
                <button class="btn btn-outline btn-sm" style="float:right" data-open-round="${r.id}">เปิด</button>
                <strong>${esc(r.provider)} ${esc(r.round_code)}</strong><br>
                ${statusBadge(r.status)} <span class="small muted">ครบกำหนด ${fmtDate(r.due_date)}</span>
              </div></div>`).join('')}</div>` : empty('ยังไม่มีรอบ EQA')}
          </div>
          <div class="card">
            <div class="card-header"><h2>Competency ของฉัน</h2><button class="btn btn-outline btn-sm" data-nav-inline="my-competency">ดูทั้งหมด</button></div>
            ${assignments.length ? assignments.slice(0, 6).map((a) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
              <strong>${esc(a.ec_eqa_rounds?.provider || '')} ${esc(a.ec_eqa_rounds?.round_code || '')}</strong>
              <span style="float:right">${assignmentBadge(a.status)}</span>
            </div>`).join('') : empty('ยังไม่มี Competency ที่ได้รับมอบหมาย')}
          </div>
        </div>
      </section>`;
    appEl.innerHTML = shell(content, 'ภาพรวม');
    bindShell();
    document.querySelectorAll('[data-nav-inline]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.navInline)));
    document.querySelectorAll('[data-open-round]').forEach((b) => b.addEventListener('click', () => navigate(`round/${b.dataset.openRound}/overview`)));
    document.getElementById('new-round-btn')?.addEventListener('click', openRoundModal);
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
        <div class="field"><label>Program code</label><input class="input" name="program_code" value="${esc(round?.program_code || 'J')}"></div>
        <div class="field"><label>ชื่อรอบ</label><input class="input" name="round_code" required value="${esc(round?.round_code || 'J-B 2026')}"></div>
        <div class="field"><label>Kit number</label><input class="input" name="kit_number" value="${esc(round?.kit_number || '')}"></div>
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
      if (result.error) return toast(result.error.message, 'danger');
      closeModal(); toast('บันทึกรอบ EQA แล้ว', 'success');
      navigate(`round/${result.data.id}/overview`);
    });
  }

  async function renderRounds() {
    let rounds;
    try { rounds = await loadRounds(); } catch (e) { return renderError(e); }
    const content = `
      <section class="page">
        <div class="page-header"><div><h1>รอบ EQA</h1><p>เปิดรอบเดียวเพื่อดูหลักฐาน ผล การอนุมัติ CAPA และ Competency</p></div>
        ${canManage() ? `<div class="header-actions"><button class="btn btn-primary" id="new-round-btn">＋ สร้างรอบ EQA</button></div>` : ''}</div>
        <div class="card">
          ${rounds.length ? `<div class="table-wrap"><table><thead><tr><th>รอบ</th><th>โปรแกรม / Kit</th><th>ครบกำหนด</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
            ${rounds.map((r) => `<tr><td><strong>${esc(r.provider)} ${esc(r.round_code)}</strong><br><span class="small muted">ปี ${esc(r.survey_year)}</span></td>
            <td>${esc(r.program_name)}<br><span class="small muted">${esc(r.program_code || '-')} · Kit ${esc(r.kit_number || '-')}</span></td>
            <td>${fmtDate(r.due_date)}</td><td>${statusBadge(r.status)}</td><td class="table-actions"><button class="btn btn-primary btn-sm" data-open-round="${r.id}">เปิดรอบ</button>${canManage() ? `<button class="btn btn-outline btn-sm" data-edit-round="${r.id}">แก้ไข</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : empty('ยังไม่มีรอบ EQA')}
        </div>
      </section>`;
    appEl.innerHTML = shell(content, 'รอบ EQA'); bindShell();
    document.getElementById('new-round-btn')?.addEventListener('click', () => openRoundModal());
    document.querySelectorAll('[data-open-round]').forEach((b) => b.addEventListener('click', () => navigate(`round/${b.dataset.openRound}/overview`)));
    document.querySelectorAll('[data-edit-round]').forEach((b) => b.addEventListener('click', () => openRoundModal(rounds.find((r) => r.id === b.dataset.editRound))));
  }

  const ROUND_TABS = [
    ['overview', '1. ข้อมูลรอบ'], ['documents', '2. เอกสาร/ภาพ'], ['assignments', '3. ผู้รับผิดชอบ'],
    ['individual', '4. ผลรายบุคคล'], ['consensus', '5. ผลกลางของห้อง'], ['approval', '6. ตรวจ/อนุมัติ'],
    ['submission', '7. หลักฐานการส่ง'], ['official', '8. ผลประเมินกลับ'], ['capa', '9. CAPA'], ['competency', '10. Competency']
  ];

  function roundTabs(roundId, active) {
    return `<div class="tabs">${ROUND_TABS.map(([key, label]) => `<button class="tab-btn ${active === key ? 'active' : ''}" data-round-tab="${key}">${label}</button>`).join('')}</div>`;
  }

  function roundStepper(round) {
    const steps = [
      ['preparing','เตรียม'], ['in_progress','ดำเนินการ'], ['awaiting_review','ตรวจทาน'], ['awaiting_qm_approval','QM'],
      ['awaiting_physician_approval','แพทย์'], ['submitted_to_provider','ส่งผล'], ['official_result_received','ผลกลับ'], ['closed','ปิดรอบ']
    ];
    const currentIndex = Math.max(0, steps.findIndex(([s]) => s === round.status));
    return `<div class="stepper">${steps.map(([s,l],i) => `<div class="step ${i < currentIndex ? 'done' : i === currentIndex ? 'current' : ''}"><div class="step-number">${i+1}</div>${l}</div>`).join('')}</div>`;
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
    } catch (e) { tabContent = `<div class="notice danger">${esc(e.message || e)}</div>`; }

    const content = `<section class="page">
      <div class="page-header"><div><h1>${esc(round.provider)} ${esc(round.round_code)}</h1><p>${esc(round.program_name)} · Kit ${esc(round.kit_number || '-')}</p></div>
      <div class="header-actions">${statusBadge(round.status)}<button class="btn btn-outline" id="back-rounds">กลับ</button></div></div>
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
    const directory = round.receiver_id ? await loadDirectory() : [];
    const receiver = round.receiver_id ? directory.find((person) => person.id === round.receiver_id) || null : null;
    return `<div class="grid cols-2">
      <div class="card"><div class="card-header"><h2>ข้อมูลรอบ EQA</h2>${canManage() ? `<button class="btn btn-outline btn-sm" id="edit-current-round">แก้ไข</button>` : ''}</div>
        <div class="table-wrap"><table><tbody>
          <tr><th>ผู้ให้บริการ</th><td>${esc(round.provider)}</td></tr><tr><th>ชื่อโปรแกรม</th><td>${esc(round.program_name)}</td></tr>
          <tr><th>Program code</th><td>${esc(round.program_code || '-')}</td></tr><tr><th>รอบ</th><td>${esc(round.round_code)}</td></tr>
          <tr><th>Kit</th><td>${esc(round.kit_number || '-')}</td></tr><tr><th>วันครบกำหนด</th><td>${fmtDate(round.due_date)}</td></tr>
          <tr><th>วันรับ</th><td>${fmtDate(round.received_at, true)}</td></tr><tr><th>อุณหภูมิรับ</th><td>${round.received_temperature ?? '-'} °C</td></tr>
          <tr><th>เจ้าหน้าที่รับ</th><td>${esc(receiver?.full_name || '-')}</td></tr><tr><th>เลขเอกสาร</th><td>${esc(round.document_number || '-')} Rev.${esc(round.document_revision || '1')}</td></tr>
        </tbody></table></div>
      </div>
      <div class="card"><h2>หลักการของรอบนี้</h2>
        <div class="notice">ผู้ปฏิบัติจริง 2 คนบันทึกผลแยกกัน และยังไม่เห็นคำตอบกันจนกว่าทั้งคู่ส่ง</div>
        <div style="height:10px"></div><div class="notice">ผู้ปฏิบัติทั้งสองคนร่วมกันสร้างผลกลางของห้อง จากนั้น QM ตรวจ และแพทย์อนุมัติขั้นสุดท้าย</div>
        <div style="height:10px"></div><div class="notice">บุคลากรที่เหลือทำข้อสอบหลังห้องส่งผล CAP แต่ก่อนเปิดเฉลย</div>
        ${round.notes ? `<div style="height:14px"></div><h3>หมายเหตุ</h3><p>${esc(round.notes)}</p>` : ''}
      </div>
    </div>`;
  }

  async function roundDocuments(round) {
    const { data: docs, error } = await state.supabase.from('ec_round_documents').select('*').eq('round_id', round.id).order('created_at', { ascending: false });
    if (error) throw error;
    const uploadAllowed = canManage() || canReview() || await isAssigned(round.id);
    return `<div class="card">
      <div class="card-header"><div><h2>เอกสารและภาพ</h2><div class="small muted">ไฟล์อยู่ใน Supabase Private Storage ไม่อยู่ใน GitHub</div></div>
      ${uploadAllowed ? `<button class="btn btn-primary" id="upload-doc-btn">＋ อัปโหลดไฟล์</button>` : ''}</div>
      ${(docs || []).length ? `<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ชื่อ</th><th>การมองเห็น</th><th>ผู้อัปโหลด</th><th>จัดการ</th></tr></thead><tbody>
        ${(docs || []).map((d) => `<tr><td>${esc(d.category)}</td><td><strong>${esc(d.title)}</strong><br><span class="small muted">${esc(d.file_name)}</span></td><td>${esc(d.visibility)}</td><td>${fmtDate(d.created_at, true)}</td><td><button class="btn btn-outline btn-sm" data-open-doc="${d.id}" data-path="${esc(d.storage_path)}">เปิดไฟล์</button></td></tr>`).join('')}
      </tbody></table></div>` : empty('ยังไม่มีไฟล์ในรอบนี้')}
    </div>`;
  }

  async function isAssigned(roundId) {
    const { data } = await state.supabase.from('ec_round_assignments').select('id').eq('round_id', roundId).eq('user_id', state.user.id).eq('active', true).limit(1);
    return Boolean(data?.length);
  }

  async function roundAssignments(round) {
    const [{ data: assignments, error }, directory] = await Promise.all([
      state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true),
      loadDirectory()
    ]);
    if (error) throw error;
    const name = (id) => directory.find((p) => p.id === id)?.full_name || id;
    return `<div class="card">
      <div class="card-header"><div><h2>ผู้รับผิดชอบ</h2><div class="small muted">ผู้ปฏิบัติจริงกำหนดได้ 2 คน</div></div>${canManage() ? `<button class="btn btn-primary" id="manage-assignments">กำหนดผู้รับผิดชอบ</button>` : ''}</div>
      ${(assignments || []).length ? `<div class="table-wrap"><table><thead><tr><th>บทบาท</th><th>ชื่อ</th><th>Slot</th><th>วันที่มอบหมาย</th></tr></thead><tbody>
        ${(assignments || []).map((a) => `<tr><td>${esc(a.assignment_role)}</td><td>${esc(name(a.user_id))}</td><td>${a.practitioner_slot || '-'}</td><td>${fmtDate(a.assigned_at, true)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('ยังไม่ได้มอบหมายผู้ปฏิบัติ Reviewer หรือแพทย์')}
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
      <div class="result-row"><strong>ตัวอย่าง</strong><span>ABO</span><span>Rh</span><span>Antibody screen</span><span>Antibody ID</span><span>Crossmatch / Strength</span></div>
      ${RESULT_SPECIMENS.map((s) => { const x = p.specimens[s] || {}; return `<div class="result-row"><strong>${s}</strong>
        <input class="input" name="${prefix}_${s}_abo" value="${esc(x.abo)}" ${disabled?'disabled':''} placeholder="A/B/O/AB">
        <input class="input" name="${prefix}_${s}_rh" value="${esc(x.rh)}" ${disabled?'disabled':''} placeholder="Positive/Negative">
        <input class="input" name="${prefix}_${s}_screen" value="${esc(x.screen)}" ${disabled?'disabled':''} placeholder="Detected/Not detected">
        <input class="input" name="${prefix}_${s}_antibody" value="${esc(x.antibody)}" ${disabled?'disabled':''} placeholder="เช่น Anti-K">
        <div class="form-grid"><input class="input" name="${prefix}_${s}_crossmatch" value="${esc(x.crossmatch)}" ${disabled?'disabled':''} placeholder="Positive/Negative"><input class="input" name="${prefix}_${s}_strength" value="${esc(x.strength)}" ${disabled?'disabled':''} placeholder="0–4+"></div>
      </div>`; }).join('')}
      <div class="form-grid cols-3">
        ${['abo','rh','screen','antibody','crossmatch','antigen'].map((m) => `<div class="field"><label>วิธีตรวจ ${m}</label><input class="input" name="${prefix}_method_${m}" value="${esc(p.methods?.[m] || '')}" ${disabled?'disabled':''}></div>`).join('')}
      </div>
      <div class="form-grid cols-2"><div class="field"><label>น้ำยา / Lot</label><textarea class="textarea" name="${prefix}_reagents" ${disabled?'disabled':''}>${esc(p.reagents || '')}</textarea></div><div class="field"><label>เครื่องมือ</label><textarea class="textarea" name="${prefix}_instrument" ${disabled?'disabled':''}>${esc(p.instrument || '')}</textarea></div></div>
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

  async function roundIndividual(round) {
    const { data: rows, error } = await state.supabase.from('ec_individual_results').select('*, ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('round_id', round.id).order('updated_at');
    if (error) throw error;
    const own = (rows || []).find((r) => r.user_id === state.user.id);
    const practitioner = await isPractitioner(round.id);
    const canEditOwn = practitioner && (!own || ['draft','returned'].includes(own.status));
    return `<div class="grid ${canReview() ? 'cols-2' : ''}">
      <div class="card"><div class="card-header"><div><h2>ผลของฉัน</h2><div class="small muted">ระบบเก็บเวอร์ชันเดิมทุกครั้งที่แก้ไข</div></div>${own ? `<span class="badge">${esc(own.status)} · v${own.version}</span>` : ''}</div>
        ${practitioner ? `<form id="individual-result-form">${resultForm(own?.result_payload, 'individual', !canEditOwn)}</form>
          ${canEditOwn ? `<div class="modal-footer"><button class="btn btn-secondary" id="save-individual">บันทึกร่าง</button><button class="btn btn-primary" id="submit-individual">ยืนยันและส่งผล</button></div>` : `<div class="notice">ผลถูกส่งแล้วและล็อกการแก้ไข หากต้องแก้ต้องให้ QM ส่งกลับ</div>`}` : `<div class="notice">หน้านี้ใช้สำหรับผู้ปฏิบัติจริงที่ได้รับมอบหมายเท่านั้น</div>`}
      </div>
      ${canReview() ? `<div class="card"><h2>ผลรายบุคคลทั้งหมด</h2>${(rows || []).length ? (rows || []).map((r) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><strong>${esc(r.ec_profiles?.full_name || r.user_id)}</strong><span style="float:right" class="badge">${esc(r.status)} · v${r.version}</span><br><span class="small muted">ส่ง ${fmtDate(r.submitted_at, true)}</span><div style="margin-top:8px"><button class="btn btn-outline btn-sm" data-view-individual="${r.id}">ดูผล</button>${['submitted','resubmitted'].includes(r.status) ? `<button class="btn btn-warning btn-sm" data-return-individual="${r.id}">ส่งกลับแก้ไข</button>` : ''}</div></div>`).join('') : empty('ยังไม่มีผู้ปฏิบัติส่งผล')}</div>` : ''}
    </div>`;
  }

  async function isPractitioner(roundId) {
    const { data } = await state.supabase.from('ec_round_assignments').select('id').eq('round_id', roundId).eq('user_id', state.user.id).eq('assignment_role', 'practitioner').eq('active', true).limit(1);
    return Boolean(data?.length);
  }

  async function roundConsensus(round) {
    const [{ data: consensus }, { data: approvals }] = await Promise.all([
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle(),
      state.supabase.from('ec_approvals').select('*').eq('round_id', round.id).eq('stage', 'practitioner_confirm')
    ]);
    const practitioner = await isPractitioner(round.id);
    const editable = practitioner && (!consensus || ['draft','returned','awaiting_practitioner_confirmations'].includes(consensus.status));
    return `<div class="card"><div class="card-header"><div><h2>ผลกลางของห้องปฏิบัติการ</h2><div class="small muted">ผู้ปฏิบัติทั้งสองคนร่วมกันสรุปและต้องกดยืนยันคนละหนึ่งครั้ง</div></div>${consensus ? `<span class="badge">${esc(consensus.status)} · v${consensus.version}</span>` : ''}</div>
      ${practitioner || canReview() ? `<form id="consensus-form">${resultForm(consensus?.result_payload, 'consensus', !editable && !canReview())}</form>
      <div class="modal-footer">
        ${editable ? `<button class="btn btn-secondary" id="save-consensus">บันทึกผลกลาง</button><button class="btn btn-primary" id="confirm-consensus">ยืนยันผลกลางของฉัน</button>` : ''}
        ${canReview() && consensus ? `<button class="btn btn-outline" id="print-consensus">พิมพ์ผลกลาง</button>` : ''}
      </div>
      <div class="notice">ผู้ปฏิบัติยืนยันแล้ว ${(approvals || []).length}/2 คน</div>` : `<div class="notice">เฉพาะผู้ปฏิบัติจริง ผู้ตรวจ QM แพทย์ และ Viewer ที่ได้รับสิทธิ์</div>`}
    </div>`;
  }

  async function roundApproval(round) {
    const [{ data: approvals }, { data: consensus }] = await Promise.all([
      state.supabase.from('ec_approvals').select('*, ec_profiles!ec_approvals_approver_id_fkey(full_name)').eq('round_id', round.id).order('signed_at'),
      state.supabase.from('ec_consensus_results').select('*').eq('round_id', round.id).maybeSingle()
    ]);
    return `<div class="grid cols-2">
      <div class="card"><h2>ลำดับการรับรอง</h2>
        <div class="timeline">${['practitioner_confirm','qm_review','physician_approval','closure_acknowledgement'].map((stage) => {
          const found = (approvals || []).filter((a) => a.stage === stage);
          return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><strong>${esc(stage)}</strong><br>${found.length ? found.map((a) => `${esc(a.ec_profiles?.full_name || '')} — ${esc(a.decision)} (${fmtDate(a.signed_at,true)})`).join('<br>') : '<span class="muted">ยังไม่มีการรับรอง</span>'}</div></div>`;
        }).join('')}</div>
      </div>
      <div class="card"><h2>ดำเนินการ</h2>
        ${hasRole('qm','admin') && consensus ? `<div class="form-grid"><div class="field"><label>หมายเหตุ QM</label><textarea class="textarea" id="qm-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="qm-approve">QM อนุมัติ</button><button class="btn btn-warning" id="qm-return">ส่งกลับแก้ไข</button></div></div>` : ''}
        ${isPhysician() && consensus ? `<hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><div class="form-grid"><div class="field"><label>หมายเหตุแพทย์</label><textarea class="textarea" id="physician-note"></textarea></div><div class="table-actions"><button class="btn btn-success" id="physician-approve">แพทย์อนุมัติขั้นสุดท้าย</button><button class="btn btn-warning" id="physician-return">ส่งกลับ QM</button></div></div>` : ''}
        ${!hasRole('qm','admin','physician') ? `<div class="notice">หน้านี้แสดงสถานะการรับรอง ผู้มี Role ที่เกี่ยวข้องเท่านั้นที่กดอนุมัติได้</div>` : ''}
      </div>
    </div>`;
  }

  async function roundSubmission(round) {
    const { data: rows, error } = await state.supabase.from('ec_submission_evidence').select('*, ec_round_documents(*)').eq('round_id', round.id).order('submitted_at', { ascending: false });
    if (error) throw error;
    return `<div class="card"><div class="card-header"><div><h2>หลักฐานการส่งผล</h2><div class="small muted">บันทึกวันเวลา ผู้ส่ง เลขอ้างอิง และแนบหลักฐาน</div></div>${canManage() ? `<button class="btn btn-primary" id="add-submission">＋ บันทึกการส่ง</button>` : ''}</div>
      ${(rows || []).length ? `<div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>เลขอ้างอิง</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fmtDate(r.submitted_at,true)}</td><td>${esc(r.provider_reference || '-')}</td><td>${esc(r.note || '-')}</td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่มีหลักฐานการส่งผล')}
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
      </form><div class="modal-footer"><button class="btn btn-primary" id="save-official">บันทึกผลประเมิน</button></div>` : official ? `<div class="grid cols-3"><div><strong>คะแนน</strong><div class="stat-value">${official.score ?? '-'}</div></div><div><strong>ผล</strong><p>${esc(official.outcome || '-')}</p></div><div><strong>เปิดให้ Staff</strong><p>${official.published_to_staff ? 'เปิดแล้ว' : 'ยังไม่เปิด'}</p></div></div><p>${esc(official.summary || '')}</p>` : empty('ยังไม่ได้รับผลประเมินอย่างเป็นทางการ')}
    </div>`;
  }

  async function roundCapa(round) {
    const { data: rows, error } = await state.supabase.from('ec_corrective_actions').select('*, ec_profiles!ec_corrective_actions_responsible_user_id_fkey(full_name)').eq('round_id', round.id).order('created_at');
    if (error) throw error;
    return `<div class="card"><div class="card-header"><div><h2>Corrective Action / การทบทวน</h2><div class="small muted">วิเคราะห์สาเหตุ แก้ไข ป้องกัน และตรวจประสิทธิผล</div></div>${canReview() ? `<button class="btn btn-primary" id="add-capa">＋ เปิด CAPA</button>` : ''}</div>
      ${(rows || []).length ? `<div class="table-wrap"><table><thead><tr><th>ปัญหา</th><th>ผู้รับผิดชอบ</th><th>กำหนด</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.issue_description)}</strong><br><span class="small muted">${esc(r.root_cause || 'ยังไม่ระบุสาเหตุ')}</span></td><td>${esc(r.ec_profiles?.full_name || '-')}</td><td>${fmtDate(r.due_date)}</td><td><span class="badge">${esc(r.status)}</span></td><td><button class="btn btn-outline btn-sm" data-edit-capa="${r.id}">เปิด</button></td></tr>`).join('')}</tbody></table></div>` : empty('ไม่มี CAPA ในรอบนี้')}
    </div>`;
  }

  async function roundCompetency(round) {
    const [{ data: questions }, { data: assignments }, directory] = await Promise.all([
      state.supabase.from('ec_questions').select('*, ec_question_choices(*)').eq('round_id', round.id).order('question_order'),
      state.supabase.from('ec_competency_assignments').select('*').eq('round_id', round.id).order('created_at'),
      loadDirectory()
    ]);
    const name = (id) => directory.find((p) => p.id === id)?.full_name || id;
    return `<div class="grid cols-2">
      <div class="card"><div class="card-header"><div><h2>ข้อสอบ</h2><div class="small muted">เผยแพร่คำถามหลังห้องส่งผล CAP และก่อนเปิดเฉลย</div></div>${canManage() ? `<button class="btn btn-primary" id="add-question">＋ เพิ่มคำถาม</button>` : ''}</div>
        ${(questions || []).length ? questions.map((q) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><span class="badge ${q.published?'success':'warning'}">${q.published?'เผยแพร่':'ฉบับร่าง'}</span> <strong>${q.question_order}. ${esc(q.prompt)}</strong><br><span class="small muted">${esc(q.question_type)} · ${q.points} คะแนน ${q.is_critical?'· Critical':''}</span>${canManage()?`<div style="margin-top:7px"><button class="btn btn-outline btn-sm" data-edit-question="${q.id}">แก้ไข</button></div>`:''}</div>`).join('') : empty('ยังไม่มีคำถาม')}
      </div>
      <div class="card"><div class="card-header"><div><h2>การมอบหมาย</h2><div class="small muted">ผู้ปฏิบัติจริง = Practical คนอื่น = Quiz</div></div>${canManage()?`<button class="btn btn-primary" id="assign-all-competency">สร้าง Assignment</button>`:''}</div>
        ${(assignments || []).length ? `<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th></tr></thead><tbody>${assignments.map((a)=>`<tr><td>${esc(name(a.user_id))}</td><td>${esc(a.assignment_type)}</td><td>${assignmentBadge(a.status)}</td><td>${a.score ?? '-'}</td></tr>`).join('')}</tbody></table></div>` : empty('ยังไม่ได้สร้าง Assignment')}
      </div>
    </div>`;
  }

  function bindRoundTab(round, tab) {
    if (tab === 'overview') document.getElementById('edit-current-round')?.addEventListener('click', () => openRoundModal(round));
    if (tab === 'documents') bindDocuments(round);
    if (tab === 'assignments') bindAssignments(round);
    if (tab === 'individual') bindIndividual(round);
    if (tab === 'consensus') bindConsensus(round);
    if (tab === 'approval') bindApproval(round);
    if (tab === 'submission') bindSubmission(round);
    if (tab === 'official') bindOfficial(round);
    if (tab === 'capa') bindCapa(round);
    if (tab === 'competency') bindCompetencyAdmin(round);
  }

  function bindDocuments(round) {
    document.getElementById('upload-doc-btn')?.addEventListener('click', () => {
      showModal('อัปโหลดเอกสาร/ภาพ', `<form id="doc-form" class="form-grid">
        <div class="field"><label>ประเภท</label><select class="select" name="category">${['source_document','instruction','specimen_image','raw_result_image','submission_form','submission_evidence','official_result','corrective_action','closure_report','other'].map(x=>`<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label>ชื่อเอกสาร</label><input class="input" name="title" required></div>
        <div class="field"><label>การมองเห็น</label><select class="select" name="visibility"><option value="restricted">เฉพาะผู้ตรวจ/QM/แพทย์</option><option value="assigned">ผู้ได้รับมอบหมาย</option><option value="staff">บุคลากรทุกคน</option></select></div>
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
        if (upload.error) return toast(upload.error.message, 'danger');
        const ins = await state.supabase.from('ec_round_documents').insert({ round_id: round.id, category, title: String(fd.get('title')), file_name: file.name, storage_path: path, mime_type: file.type, file_size: file.size, visibility: String(fd.get('visibility')), uploaded_by: state.user.id });
        if (ins.error) return toast(ins.error.message, 'danger');
        closeModal(); toast('อัปโหลดเรียบร้อย', 'success'); route();
      });
    });
    document.querySelectorAll('[data-open-doc]').forEach((b) => b.addEventListener('click', async () => {
      const { data, error } = await state.supabase.storage.from(cfg.PRIVATE_BUCKET).createSignedUrl(b.dataset.path, 300);
      if (error) return toast(error.message, 'danger');
      window.open(data.signedUrl, '_blank', 'noopener');
    }));
  }

  function bindAssignments(round) {
    document.getElementById('manage-assignments')?.addEventListener('click', async () => {
      const [{ data: current }, directory] = await Promise.all([
        state.supabase.from('ec_round_assignments').select('*').eq('round_id', round.id).eq('active', true), loadDirectory()
      ]);
      const find = (role, slot) => current?.find((a) => a.assignment_role === role && (slot ? a.practitioner_slot === slot : true))?.user_id || '';
      const opts = (selected='') => `<option value="">-- เลือก --</option>${directory.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.full_name)}</option>`).join('')}`;
      showModal('กำหนดผู้รับผิดชอบ', `<form id="assignment-form" class="form-grid cols-2">
        <div class="field"><label>ผู้ปฏิบัติคนที่ 1</label><select class="select" name="p1">${opts(find('practitioner',1))}</select></div>
        <div class="field"><label>ผู้ปฏิบัติคนที่ 2</label><select class="select" name="p2">${opts(find('practitioner',2))}</select></div>
        <div class="field"><label>Reviewer</label><select class="select" name="reviewer">${opts(find('reviewer'))}</select></div>
        <div class="field"><label>แพทย์ผู้อนุมัติ</label><select class="select" name="physician">${opts(find('physician'))}</select></div>
      </form>`, `<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-assignments">บันทึก</button>`);
      document.getElementById('save-assignments').addEventListener('click', async () => {
        const fd = new FormData(document.getElementById('assignment-form'));
        const p1=String(fd.get('p1')||''), p2=String(fd.get('p2')||''), reviewer=String(fd.get('reviewer')||''), physician=String(fd.get('physician')||'');
        if (!p1 || !p2 || p1===p2) return toast('ต้องเลือกผู้ปฏิบัติ 2 คนและห้ามเป็นคนเดียวกัน', 'danger');
        await state.supabase.from('ec_round_assignments').update({active:false}).eq('round_id', round.id).eq('active', true);
        const rows=[{round_id:round.id,user_id:p1,assignment_role:'practitioner',practitioner_slot:1,assigned_by:state.user.id},{round_id:round.id,user_id:p2,assignment_role:'practitioner',practitioner_slot:2,assigned_by:state.user.id}];
        if(reviewer) rows.push({round_id:round.id,user_id:reviewer,assignment_role:'reviewer',practitioner_slot:null,assigned_by:state.user.id});
        if(physician) rows.push({round_id:round.id,user_id:physician,assignment_role:'physician',practitioner_slot:null,assigned_by:state.user.id});
        const {error}=await state.supabase.from('ec_round_assignments').insert(rows); if(error)return toast(error.message,'danger');
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
      if(res.error)return toast(res.error.message,'danger'); toast(submit?'ส่งผลแล้ว':'บันทึกร่างแล้ว','success'); route();
    };
    document.getElementById('save-individual')?.addEventListener('click',()=>save(false));
    document.getElementById('submit-individual')?.addEventListener('click',()=>{ if(confirm('ยืนยันส่งผลรายบุคคลหรือไม่ หลังส่งจะแก้ไขเองไม่ได้')) save(true); });
    document.querySelectorAll('[data-view-individual]').forEach((b)=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_individual_results').select('*,ec_profiles!ec_individual_results_user_id_fkey(full_name)').eq('id',b.dataset.viewIndividual).single();if(error)return toast(error.message,'danger');showModal(`ผลของ ${data.ec_profiles?.full_name||''}`,resultForm(data.result_payload,'view',true),'',true);}));
    document.querySelectorAll('[data-return-individual]').forEach((b)=>b.addEventListener('click',async()=>{const reason=prompt('เหตุผลที่ส่งกลับแก้ไข');if(!reason)return;const {error}=await state.supabase.from('ec_individual_results').update({status:'returned'}).eq('id',b.dataset.returnIndividual);if(error)return toast(error.message,'danger');toast('ส่งกลับแก้ไขแล้ว','success');route();}));
  }

  function bindConsensus(round) {
    document.getElementById('save-consensus')?.addEventListener('click',async()=>{const payload=collectResultPayload(document.getElementById('consensus-form'),'consensus');const {data:existing}=await state.supabase.from('ec_consensus_results').select('id').eq('round_id',round.id).maybeSingle();const row={round_id:round.id,result_payload:payload,status:'awaiting_practitioner_confirmations',prepared_by:state.user.id};const res=existing?await state.supabase.from('ec_consensus_results').update(row).eq('id',existing.id):await state.supabase.from('ec_consensus_results').insert(row);if(res.error)return toast(res.error.message,'danger');toast('บันทึกผลกลางแล้ว','success');route();});
    document.getElementById('confirm-consensus')?.addEventListener('click',async()=>{const note=prompt('หมายเหตุการยืนยัน (เว้นว่างได้)')||'';const {error}=await state.supabase.rpc('ec_confirm_consensus',{p_round_id:round.id,p_note:note});if(error)return toast(error.message,'danger');toast('ยืนยันผลกลางแล้ว','success');route();});
    document.getElementById('print-consensus')?.addEventListener('click',()=>window.print());
  }

  function bindApproval(round) {
    const upsertApproval=async(stage,decision,note)=>{const {data:consensus}=await state.supabase.from('ec_consensus_results').select('version').eq('round_id',round.id).single();const {error}=await state.supabase.from('ec_approvals').upsert({round_id:round.id,stage,approver_id:state.user.id,decision,note,result_version:consensus?.version},{onConflict:'round_id,stage,approver_id'});if(error)return toast(error.message,'danger');return true;};
    document.getElementById('qm-approve')?.addEventListener('click',async()=>{const note=document.getElementById('qm-note').value; if(await upsertApproval('qm_review','approved',note)){await state.supabase.from('ec_consensus_results').update({status:'qm_approved'}).eq('round_id',round.id);await state.supabase.from('ec_eqa_rounds').update({status:'awaiting_physician_approval',updated_by:state.user.id}).eq('id',round.id);toast('QM อนุมัติแล้ว','success');route();}});
    document.getElementById('qm-return')?.addEventListener('click',async()=>{const note=document.getElementById('qm-note').value;if(!note)return toast('กรุณาระบุเหตุผล','danger');if(await upsertApproval('qm_review','returned',note)){await state.supabase.from('ec_consensus_results').update({status:'returned'}).eq('round_id',round.id);await state.supabase.from('ec_eqa_rounds').update({status:'returned_for_revision',updated_by:state.user.id}).eq('id',round.id);route();}});
    document.getElementById('physician-approve')?.addEventListener('click',async()=>{const note=document.getElementById('physician-note').value;if(await upsertApproval('physician_approval','approved',note)){await state.supabase.from('ec_consensus_results').update({status:'physician_approved'}).eq('round_id',round.id);await state.supabase.from('ec_eqa_rounds').update({status:'physician_approved',updated_by:state.user.id}).eq('id',round.id);toast('แพทย์อนุมัติแล้ว','success');route();}});
    document.getElementById('physician-return')?.addEventListener('click',async()=>{const note=document.getElementById('physician-note').value;if(!note)return toast('กรุณาระบุเหตุผล','danger');if(await upsertApproval('physician_approval','returned',note)){await state.supabase.from('ec_eqa_rounds').update({status:'awaiting_qm_approval',updated_by:state.user.id}).eq('id',round.id);route();}});
  }

  function bindSubmission(round) {
    document.getElementById('add-submission')?.addEventListener('click',()=>{showModal('บันทึกหลักฐานการส่งผล',`<form id="submission-form" class="form-grid"><div class="field"><label>วันเวลา</label><input class="input" type="datetime-local" name="submitted_at" required value="${new Date().toISOString().slice(0,16)}"></div><div class="field"><label>เลขอ้างอิง</label><input class="input" name="reference"></div><div class="field"><label>หมายเหตุ</label><textarea class="textarea" name="note"></textarea></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-submission">บันทึก</button>`);document.getElementById('save-submission').addEventListener('click',async()=>{const f=document.getElementById('submission-form');if(!f.reportValidity())return;const fd=new FormData(f);const {error}=await state.supabase.from('ec_submission_evidence').insert({round_id:round.id,submitted_at:new Date(String(fd.get('submitted_at'))).toISOString(),submitted_by:state.user.id,provider_reference:String(fd.get('reference')||'')||null,note:String(fd.get('note')||'')||null});if(error)return toast(error.message,'danger');await state.supabase.from('ec_eqa_rounds').update({status:'submitted_to_provider',updated_by:state.user.id,competency_open_at:new Date().toISOString()}).eq('id',round.id);closeModal();toast('บันทึกการส่งผลแล้ว','success');route();});});
  }

  function bindOfficial(round) {
    document.getElementById('save-official')?.addEventListener('click',async()=>{const fd=new FormData(document.getElementById('official-form'));const payload={round_id:round.id,score:fd.get('score')?Number(fd.get('score')):null,outcome:String(fd.get('outcome')),summary:String(fd.get('summary')||'')||null,published_to_staff:fd.get('published')==='on',recorded_by:state.user.id,received_at:new Date().toISOString()};const {error}=await state.supabase.from('ec_official_results').upsert(payload,{onConflict:'round_id'});if(error)return toast(error.message,'danger');await state.supabase.from('ec_eqa_rounds').update({status:'official_result_received',answer_released_at:payload.published_to_staff?new Date().toISOString():null,updated_by:state.user.id}).eq('id',round.id);toast('บันทึกผลอย่างเป็นทางการแล้ว','success');route();});
  }

  function bindCapa(round) {
    const open=(row={})=>{showModal(row.id?'แก้ไข CAPA':'เปิด CAPA',`<form id="capa-form" class="form-grid cols-2"><div class="field" style="grid-column:1/-1"><label>ปัญหาที่พบ</label><textarea class="textarea" name="issue" required>${esc(row.issue_description||'')}</textarea></div><div class="field"><label>สาเหตุ</label><textarea class="textarea" name="root">${esc(row.root_cause||'')}</textarea></div><div class="field"><label>ผลกระทบ</label><textarea class="textarea" name="impact">${esc(row.impact_assessment||'')}</textarea></div><div class="field"><label>การแก้ไขทันที</label><textarea class="textarea" name="correction">${esc(row.immediate_correction||'')}</textarea></div><div class="field"><label>การป้องกัน</label><textarea class="textarea" name="preventive">${esc(row.preventive_action||'')}</textarea></div><div class="field"><label>กำหนดเสร็จ</label><input class="input" type="date" name="due" value="${fmtDateInput(row.due_date)}"></div><div class="field"><label>สถานะ</label><select class="select" name="status">${['open','in_progress','awaiting_effectiveness_review','effective','ineffective','closed','cancelled'].map(s=>`<option ${row.status===s?'selected':''}>${s}</option>`).join('')}</select></div><input type="hidden" name="id" value="${esc(row.id||'')}"></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-capa">บันทึก</button>`,true);document.getElementById('save-capa').addEventListener('click',async()=>{const f=document.getElementById('capa-form');if(!f.reportValidity())return;const fd=new FormData(f);const id=String(fd.get('id')||'');const p={round_id:round.id,issue_description:String(fd.get('issue')),root_cause:String(fd.get('root')||'')||null,impact_assessment:String(fd.get('impact')||'')||null,immediate_correction:String(fd.get('correction')||'')||null,preventive_action:String(fd.get('preventive')||'')||null,due_date:fd.get('due')||null,status:String(fd.get('status')),updated_by:state.user.id};const res=id?await state.supabase.from('ec_corrective_actions').update(p).eq('id',id):await state.supabase.from('ec_corrective_actions').insert({...p,created_by:state.user.id});if(res.error)return toast(res.error.message,'danger');closeModal();toast('บันทึก CAPA แล้ว','success');route();});};
    document.getElementById('add-capa')?.addEventListener('click',()=>open());
    document.querySelectorAll('[data-edit-capa]').forEach(b=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_corrective_actions').select('*').eq('id',b.dataset.editCapa).single();if(error)return toast(error.message,'danger');open(data);}));
  }

  function bindCompetencyAdmin(round) {
    const openQuestion=async(row=null)=>{let choices=[];let key=null;if(row?.id){const [{data:choiceData},{data:keyData}]=await Promise.all([state.supabase.from('ec_question_choices').select('*').eq('question_id',row.id).order('choice_order'),state.supabase.from('ec_question_answer_keys').select('*').eq('question_id',row.id).maybeSingle()]);choices=choiceData||[];key=keyData||null;}const correctIndex=choices.findIndex(c=>(key?.correct_choice_ids||[]).includes(c.id));showModal(row?'แก้ไขคำถาม':'เพิ่มคำถาม',`<form id="question-form" class="form-grid cols-2"><input type="hidden" name="id" value="${esc(row?.id||'')}"><div class="field"><label>ลำดับ</label><input class="input" type="number" name="order" required value="${esc(row?.question_order||1)}"></div><div class="field"><label>หัวข้อ</label><input class="input" name="section" value="${esc(row?.section||'')}"></div><div class="field"><label>ประเภท</label><select class="select" name="type">${['single_choice','multiple_choice','text','numeric','image_interpretation'].map(t=>`<option ${row?.question_type===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>คะแนน</label><input class="input" type="number" step="0.1" name="points" value="${esc(row?.points||1)}"></div><div class="field" style="grid-column:1/-1"><label>คำถาม</label><textarea class="textarea" name="prompt" required>${esc(row?.prompt||'')}</textarea></div><div class="field" style="grid-column:1/-1"><label>ตัวเลือก (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</label><textarea class="textarea" name="choices">${esc(choices.map(c=>c.choice_text).join('\n'))}</textarea><div class="help">ใช้สำหรับ single_choice</div></div><div class="field"><label>ลำดับตัวเลือกที่ถูก</label><input class="input" type="number" name="correct" min="1" value="${correctIndex>=0?correctIndex+1:''}"></div><div class="field"><label>คำอธิบายเฉลย</label><input class="input" name="explanation" value="${esc(key?.explanation||'')}"></div><label><input type="checkbox" name="critical" ${row?.is_critical?'checked':''}> Critical</label><label><input type="checkbox" name="published" ${row?.published?'checked':''}> เผยแพร่คำถาม</label></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-question">บันทึก</button>`,true);document.getElementById('save-question').addEventListener('click',async()=>{const f=document.getElementById('question-form');if(!f.reportValidity())return;const fd=new FormData(f);const id=String(fd.get('id')||'');const p={round_id:round.id,question_order:Number(fd.get('order')),section:String(fd.get('section')||'')||null,question_type:String(fd.get('type')),prompt:String(fd.get('prompt')),points:Number(fd.get('points')||1),is_critical:fd.get('critical')==='on',published:fd.get('published')==='on',updated_by:state.user.id};let qres=id?await state.supabase.from('ec_questions').update(p).eq('id',id).select().single():await state.supabase.from('ec_questions').insert({...p,created_by:state.user.id}).select().single();if(qres.error)return toast(qres.error.message,'danger');const qid=qres.data.id;await state.supabase.from('ec_question_choices').delete().eq('question_id',qid);const lines=String(fd.get('choices')||'').split('\n').map(x=>x.trim()).filter(Boolean);const correct=Number(fd.get('correct')||0);let correctIds=[];if(lines.length){const {data:inserted,error}=await state.supabase.from('ec_question_choices').insert(lines.map((text,i)=>({question_id:qid,choice_order:i+1,choice_text:text}))).select();if(error)return toast(error.message,'danger');if(correct>0&&inserted?.[correct-1])correctIds=[inserted[correct-1].id];}const keyRes=await state.supabase.from('ec_question_answer_keys').upsert({question_id:qid,correct_choice_ids:correctIds,answer_key_json:null,explanation:String(fd.get('explanation')||'')||null,updated_by:state.user.id},{onConflict:'question_id'});if(keyRes.error)return toast(keyRes.error.message,'danger');closeModal();toast('บันทึกคำถามแล้ว','success');route();});};
    document.getElementById('add-question')?.addEventListener('click',()=>openQuestion());
    document.querySelectorAll('[data-edit-question]').forEach(b=>b.addEventListener('click',async()=>{const {data,error}=await state.supabase.from('ec_questions').select('*').eq('id',b.dataset.editQuestion).single();if(error)return toast(error.message,'danger');openQuestion(data);}));
    document.getElementById('assign-all-competency')?.addEventListener('click',async()=>{if(!confirm('สร้าง Assignment ให้บุคลากรที่เปิดใช้งานทั้งหมดหรือไม่'))return;let directory;try{directory=await loadDirectory();}catch(error){return toast(error.message,'danger');}const {data:practitioners,error:practitionerError}=await state.supabase.from('ec_round_assignments').select('user_id').eq('round_id',round.id).eq('assignment_role','practitioner').eq('active',true);if(practitionerError)return toast(practitionerError.message,'danger');const practitionerIds=new Set((practitioners||[]).map(x=>x.user_id));const rows=directory.map(p=>({round_id:round.id,user_id:p.id,assignment_type:practitionerIds.has(p.id)?'practical':'quiz',assigned_by:state.user.id}));if(!rows.length)return toast('ไม่พบรายชื่อบุคลากรที่เปิดใช้งาน','warning');const {error}=await state.supabase.from('ec_competency_assignments').upsert(rows,{onConflict:'round_id,user_id',ignoreDuplicates:true});if(error)return toast(error.message,'danger');toast('สร้าง Assignment แล้ว','success');route();});
  }

  async function renderMyCompetency() {
    const { data: assignments, error } = await state.supabase.from('ec_competency_assignments').select('*, ec_eqa_rounds(*)').eq('user_id', state.user.id).order('created_at', { ascending: false });
    if (error) return renderError(error);
    const content=`<section class="page"><div class="page-header"><div><h1>Competency ของฉัน</h1><p>คำตอบของคุณถูกเก็บแยกและส่งแล้วจะล็อก</p></div></div><div class="card">${(assignments||[]).length?`<div class="table-wrap"><table><thead><tr><th>รอบ</th><th>ประเภท</th><th>สถานะ</th><th>คะแนน</th><th>ดำเนินการ</th></tr></thead><tbody>${assignments.map(a=>`<tr><td><strong>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</strong></td><td>${esc(a.assignment_type)}</td><td>${assignmentBadge(a.status)}</td><td>${a.score??'-'}</td><td><button class="btn btn-primary btn-sm" data-open-assignment="${a.id}">เปิด</button></td></tr>`).join('')}</tbody></table></div>`:empty('ยังไม่มี Competency')}</div></section>`;
    appEl.innerHTML=shell(content,'Competency ของฉัน');bindShell();document.querySelectorAll('[data-open-assignment]').forEach(b=>b.addEventListener('click',()=>navigate(`assignment/${b.dataset.openAssignment}`)));
  }

  async function renderAssignment(id) {
    const {data:a,error}=await state.supabase.from('ec_competency_assignments').select('*,ec_eqa_rounds(*)').eq('id',id).single();if(error)return renderError(error);
    if(a.assignment_type==='practical'){
      const content=`<section class="page"><div class="page-header"><div><h1>Practical Competency</h1><p>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</p></div><button class="btn btn-outline" id="back-my">กลับ</button></div><div class="card"><h2>การประเมินผู้ปฏิบัติจริง</h2><p>ผล Practical เชื่อมจากผล EQA รายบุคคล วิธีตรวจ การแปลผล การบันทึก และการแก้ปัญหา</p>${assignmentBadge(a.status)}<div style="height:12px"></div><button class="btn btn-primary" id="open-round-practical">เปิดรอบ EQA</button></div></section>`;appEl.innerHTML=shell(content,'Practical Competency');bindShell();document.getElementById('back-my').onclick=()=>navigate('my-competency');document.getElementById('open-round-practical').onclick=()=>navigate(`round/${a.round_id}/individual`);return;
    }
    const [{data:questions},{data:choices},{data:answers}]=await Promise.all([state.supabase.from('ec_questions_public').select('*').eq('round_id',a.round_id).order('question_order'),state.supabase.from('ec_question_choices_public').select('*'),state.supabase.from('ec_competency_answers').select('*').eq('assignment_id',id)]);
    const ansMap=new Map((answers||[]).map(x=>[x.question_id,x]));const editable=['not_started','in_progress'].includes(a.status);
    const qHtml=(questions||[]).map(q=>{const ans=ansMap.get(q.id)?.answer_payload||{};const cs=(choices||[]).filter(c=>c.question_id===q.id);let input='';if(q.question_type==='single_choice')input=cs.map(c=>`<label style="display:flex;gap:9px;align-items:flex-start;padding:8px 0"><input type="radio" name="q_${q.id}" value="${c.id}" ${ans.choice_id===c.id?'checked':''} ${editable?'':'disabled'}>${esc(c.choice_text)}</label>`).join('');else input=`<textarea class="textarea" name="q_${q.id}" ${editable?'':'disabled'}>${esc(ans.text||'')}</textarea>`;return `<div class="card"><span class="badge">${esc(q.section||'')}</span>${q.is_critical?'<span class="badge danger">Critical</span>':''}<h3>${q.question_order}. ${esc(q.prompt)}</h3>${input}</div>`;}).join('');
    const content=`<section class="page"><div class="page-header"><div><h1>แบบทดสอบ</h1><p>${esc(a.ec_eqa_rounds?.provider)} ${esc(a.ec_eqa_rounds?.round_code)}</p></div><div class="header-actions">${assignmentBadge(a.status)}<button class="btn btn-outline" id="back-my">กลับ</button></div></div><form id="quiz-form" class="grid">${qHtml||empty('QM ยังไม่ได้เผยแพร่คำถาม')}</form>${editable&&questions?.length?`<div class="modal-footer"><button class="btn btn-secondary" id="save-quiz">บันทึกร่าง</button><button class="btn btn-primary" id="submit-quiz">ยืนยันและส่งคำตอบ</button></div>`:''}</section>`;
    appEl.innerHTML=shell(content,'แบบทดสอบ');bindShell();document.getElementById('back-my').onclick=()=>navigate('my-competency');if(editable){await state.supabase.rpc('ec_start_competency',{p_assignment_id:id});const save=async()=>{const rows=[];(questions||[]).forEach(q=>{let payload={};if(q.question_type==='single_choice'){const x=document.querySelector(`input[name="q_${q.id}"]:checked`);payload=x?{choice_id:x.value}:{};}else payload={text:String(document.querySelector(`[name="q_${q.id}"]`)?.value||'').trim()};rows.push({assignment_id:id,question_id:q.id,answer_payload:payload});});const {error}=await state.supabase.from('ec_competency_answers').upsert(rows,{onConflict:'assignment_id,question_id'});if(error)throw error;};document.getElementById('save-quiz').onclick=async()=>{try{await save();toast('บันทึกร่างแล้ว','success');}catch(e){toast(e.message,'danger');}};document.getElementById('submit-quiz').onclick=async()=>{if(!confirm('ยืนยันส่งคำตอบหรือไม่ หลังส่งจะแก้ไขไม่ได้'))return;try{await save();const {error}=await state.supabase.rpc('ec_submit_competency',{p_assignment_id:id});if(error)throw error;toast('ส่งคำตอบแล้ว','success');navigate('my-competency');}catch(e){toast(e.message,'danger');}};}
  }

  async function renderReports() {
    const {data:rounds,error}=await state.supabase.from('ec_eqa_rounds').select('*').order('survey_year',{ascending:false});if(error)return renderError(error);
    const content=`<section class="page"><div class="page-header"><div><h1>รายงาน / ทะเบียน EQA</h1><p>ใช้ Browser Print แล้วเลือก Save as PDF</p></div><button class="btn btn-primary no-print" id="print-report">พิมพ์ / Save PDF</button></div><div class="print-only"><h1>ทะเบียน EQA ประจำปี</h1><p>${esc(cfg.ORGANIZATION_NAME)}</p></div><div class="card"><div class="table-wrap"><table><thead><tr><th>ปี</th><th>ผู้ให้บริการ / รอบ</th><th>โปรแกรม</th><th>วันครบกำหนด</th><th>สถานะ</th><th>เลขเอกสาร</th></tr></thead><tbody>${(rounds||[]).map(r=>`<tr><td>${r.survey_year}</td><td>${esc(r.provider)} ${esc(r.round_code)}</td><td>${esc(r.program_name)}</td><td>${fmtDate(r.due_date)}</td><td>${STATUS_LABELS[r.status]||r.status}</td><td>${esc(r.document_number||'-')} Rev.${esc(r.document_revision||'1')}</td></tr>`).join('')}</tbody></table></div><div class="small muted" style="margin-top:12px">พิมพ์จากระบบวันที่ ${fmtDate(new Date(),true)} · เวอร์ชันระบบ ${esc(cfg.VERSION)}</div></div></section>`;appEl.innerHTML=shell(content,'รายงาน');bindShell();document.getElementById('print-report').onclick=()=>window.print();
  }

  async function renderUsers() {
    if(!hasRole('admin')){const content=`<section class="page"><div class="page-header"><div><h1>ผู้ใช้งานและสิทธิ์</h1></div></div><div class="notice warning">เฉพาะ Admin เท่านั้นที่จัดการผู้ใช้ได้</div></section>`;appEl.innerHTML=shell(content,'ผู้ใช้งาน');bindShell();return;}
    const [{data:profiles,error},{data:roles},{data:requests}]=await Promise.all([state.supabase.from('ec_profiles').select('*').order('full_name'),state.supabase.from('ec_user_roles').select('*'),state.supabase.from('ec_profile_change_requests').select('*,ec_profiles!ec_profile_change_requests_profile_id_fkey(full_name)').eq('status','pending').order('created_at')]);if(error)return renderError(error);
    const roleMap=new Map();(roles||[]).forEach(r=>{if(!roleMap.has(r.profile_id))roleMap.set(r.profile_id,[]);roleMap.get(r.profile_id).push(r.role);});
    const content=`<section class="page"><div class="page-header"><div><h1>ผู้ใช้งานและสิทธิ์</h1><p>รหัสผ่านปัจจุบันไม่แสดงให้ Admin เห็น</p></div><button class="btn btn-primary" id="create-user">＋ สร้างผู้ใช้</button></div>${requests?.length?`<div class="card"><h2>คำขอเปลี่ยนข้อมูล (${requests.length})</h2>${requests.map(r=>`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><strong>${esc(r.ec_profiles?.full_name)}</strong> ขอเปลี่ยนเป็น ${esc(r.requested_full_name||'')} ${esc(r.requested_email||'')}<div class="table-actions" style="margin-top:7px"><button class="btn btn-success btn-sm" data-approve-request="${r.id}">อนุมัติ</button><button class="btn btn-danger btn-sm" data-reject-request="${r.id}">ไม่อนุมัติ</button></div></div>`).join('')}</div><div style="height:16px"></div>`:''}<div class="card"><div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>Username / Email</th><th>รหัสพนักงาน</th><th>Role</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${(profiles||[]).map(p=>`<tr><td><strong>${esc(p.full_name)}</strong><br><span class="small muted">${esc(p.position_title||'')}</span></td><td>${esc(p.username)}<br><span class="small muted">${esc(p.email)}</span></td><td>${esc(p.employee_id)}</td><td>${(roleMap.get(p.id)||[]).map(r=>`<span class="badge">${esc(r)}</span>`).join(' ')}</td><td>${p.active?'<span class="badge success">ใช้งาน</span>':'<span class="badge danger">ปิดใช้งาน</span>'}</td><td class="table-actions"><button class="btn btn-outline btn-sm" data-role-user="${p.id}">Role</button><button class="btn btn-warning btn-sm" data-reset-user="${p.id}">รีเซ็ตรหัสผ่าน</button><button class="btn ${p.active?'btn-danger':'btn-success'} btn-sm" data-toggle-user="${p.id}" data-active="${p.active}">${p.active?'ปิดใช้':'เปิดใช้'}</button></td></tr>`).join('')}</tbody></table></div></div></section>`;
    appEl.innerHTML=shell(content,'ผู้ใช้งาน');bindShell();
    document.getElementById('create-user').onclick=()=>openCreateUser();
    document.querySelectorAll('[data-reset-user]').forEach(b=>b.onclick=async()=>{const reason=prompt('เหตุผลที่รีเซ็ตรหัสผ่าน');if(!reason)return;const {error}=await state.supabase.functions.invoke('admin-users',{body:{action:'reset_password',user_id:b.dataset.resetUser,reason}});if(error)return toast(error.message,'danger');toast('รีเซ็ตเป็น CNMI@รหัสพนักงานแล้ว','success');});
    document.querySelectorAll('[data-toggle-user]').forEach(b=>b.onclick=async()=>{const active=b.dataset.active!=='true';const reason=prompt(`เหตุผลที่${active?'เปิด':'ปิด'}ใช้งานบัญชี`);if(!reason)return;const {error}=await state.supabase.functions.invoke('admin-users',{body:{action:'set_active',user_id:b.dataset.toggleUser,active,reason}});if(error)return toast(error.message,'danger');toast('อัปเดตสถานะแล้ว','success');route();});
    document.querySelectorAll('[data-role-user]').forEach(b=>b.onclick=()=>{const current=roleMap.get(b.dataset.roleUser)||[];showModal('จัดการ Role',`<form id="role-form" class="form-grid">${Object.entries(ROLE_LABELS).map(([r,l])=>`<label><input type="checkbox" name="roles" value="${r}" ${current.includes(r)?'checked':''} ${r==='staff'?'checked disabled':''}> ${esc(l)}</label>`).join('')}</form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-roles">บันทึก</button>`);document.getElementById('save-roles').onclick=async()=>{const roles=[...document.querySelectorAll('#role-form input[name="roles"]:checked')].map(x=>x.value);const {error}=await state.supabase.functions.invoke('admin-users',{body:{action:'update_roles',user_id:b.dataset.roleUser,roles}});if(error)return toast(error.message,'danger');closeModal();toast('บันทึก Role แล้ว','success');route();};});
    document.querySelectorAll('[data-approve-request]').forEach(b=>b.onclick=async()=>{const note=prompt('หมายเหตุการอนุมัติ')||'';const {error}=await state.supabase.functions.invoke('admin-users',{body:{action:'approve_profile_change',request_id:b.dataset.approveRequest,note}});if(error)return toast(error.message,'danger');toast('อนุมัติคำขอแล้ว','success');route();});
    document.querySelectorAll('[data-reject-request]').forEach(b=>b.onclick=async()=>{const note=prompt('เหตุผลที่ไม่อนุมัติ');if(!note)return;const {error}=await state.supabase.functions.invoke('admin-users',{body:{action:'reject_profile_change',request_id:b.dataset.rejectRequest,note}});if(error)return toast(error.message,'danger');route();});
  }

  function openCreateUser(){showModal('สร้างบัญชีผู้ใช้',`<form id="create-user-form" class="form-grid cols-2"><div class="field"><label>ชื่อ-สกุล</label><input class="input" name="full_name" required></div><div class="field"><label>รหัสพนักงาน</label><input class="input" name="employee_id" required></div><div class="field"><label>อีเมล Mahidol</label><input class="input" type="email" name="email" required placeholder="name@mahidol.ac.th"></div><div class="field"><label>Username</label><input class="input" name="username" placeholder="เว้นว่าง = ส่วนหน้าอีเมล"></div><div class="field"><label>ตำแหน่ง</label><input class="input" name="position_title"></div><div class="field"><label>Role เพิ่มเติม</label><div>${['reviewer','qm','physician','admin','viewer'].map(r=>`<label style="display:block"><input type="checkbox" name="roles" value="${r}"> ${ROLE_LABELS[r]}</label>`).join('')}</div></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="create-user-save">สร้างบัญชี</button>`);document.getElementById('create-user-save').onclick=async()=>{const f=document.getElementById('create-user-form');if(!f.reportValidity())return;const fd=new FormData(f);const roles=[...f.querySelectorAll('input[name="roles"]:checked')].map(x=>x.value);const {data,error}=await state.supabase.functions.invoke('admin-users',{body:{action:'create_user',full_name:String(fd.get('full_name')),employee_id:String(fd.get('employee_id')),email:String(fd.get('email')),username:String(fd.get('username')||''),position_title:String(fd.get('position_title')||''),roles}});if(error||data?.error)return toast(error?.message||data.error,'danger');closeModal();toast('สร้างบัญชีแล้ว รหัสเริ่มต้น CNMI@รหัสพนักงาน','success');route();};}

  async function renderAudit(){if(!hasRole('admin','qm','viewer')){const content=`<section class="page"><div class="notice warning">ไม่มีสิทธิ์ดู Audit Log</div></section>`;appEl.innerHTML=shell(content,'Audit Log');bindShell();return;}const {data,error}=await state.supabase.from('ec_audit_logs').select('*').order('occurred_at',{ascending:false}).limit(300);if(error)return renderError(error);const content=`<section class="page"><div class="page-header"><div><h1>Audit Log</h1><p>บันทึกผู้ดำเนินการ วันเวลา ค่าก่อนและหลัง</p></div></div><div class="card"><div class="table-wrap"><table><thead><tr><th>วันเวลา</th><th>Action</th><th>ตาราง</th><th>Record</th><th>เหตุผล</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${fmtDate(x.occurred_at,true)}</td><td>${esc(x.action)}</td><td>${esc(x.table_name||'-')}</td><td><code>${esc(x.record_id||'-')}</code></td><td>${esc(x.reason||'-')}</td></tr>`).join('')}</tbody></table></div></div></section>`;appEl.innerHTML=shell(content,'Audit Log');bindShell();}

  async function renderSettings(){const {data:factors}=await state.supabase.auth.mfa.listFactors();const totp=factors?.totp||[];const content=`<section class="page"><div class="page-header"><div><h1>ตั้งค่าของฉัน</h1><p>เปลี่ยนรหัสผ่านและส่งคำขอเปลี่ยนชื่อ/อีเมล</p></div></div><div class="grid cols-2"><div class="card"><h2>เปลี่ยนรหัสผ่าน</h2><form id="password-form" class="form-grid"><div class="field"><label>รหัสผ่านใหม่</label><input class="input" type="password" name="password" minlength="8" required></div><div class="field"><label>ยืนยัน</label><input class="input" type="password" name="confirm" minlength="8" required></div><button class="btn btn-primary">บันทึกรหัสผ่าน</button></form></div><div class="card"><h2>ข้อมูลส่วนตัว</h2><p><strong>${esc(state.profile.full_name)}</strong><br>${esc(state.profile.email)}<br>Username: ${esc(state.profile.username)}</p><button class="btn btn-outline" id="request-profile-change">ส่งคำขอเปลี่ยนชื่อ/อีเมล</button></div><div class="card"><h2>MFA สำหรับ Admin / QM / Physician</h2><p class="muted">TOTP ช่วยเพิ่มความปลอดภัยในการอนุมัติ</p>${totp.length?`<div class="notice success">มี TOTP Factor แล้ว ${totp.length} รายการ</div>`:`<button class="btn btn-primary" id="enroll-mfa">ตั้งค่า TOTP</button>`}</div></div></section>`;appEl.innerHTML=shell(content,'ตั้งค่า');bindShell();document.getElementById('password-form').onsubmit=async(e)=>{e.preventDefault();const fd=new FormData(e.currentTarget);const p=String(fd.get('password'));if(p!==String(fd.get('confirm')))return toast('รหัสผ่านไม่ตรงกัน','danger');const {error}=await state.supabase.auth.updateUser({password:p});if(error)return toast(error.message,'danger');toast('เปลี่ยนรหัสผ่านแล้ว','success');e.currentTarget.reset();};document.getElementById('request-profile-change').onclick=()=>{showModal('ขอเปลี่ยนข้อมูลส่วนตัว',`<form id="profile-change-form" class="form-grid"><div class="field"><label>ชื่อ-สกุลใหม่</label><input class="input" name="full_name" value="${esc(state.profile.full_name)}"></div><div class="field"><label>อีเมลใหม่</label><input class="input" type="email" name="email" value="${esc(state.profile.email)}"></div><div class="field"><label>Username ใหม่</label><input class="input" name="username" value="${esc(state.profile.username)}"></div><div class="field"><label>เหตุผล</label><textarea class="textarea" name="reason" required></textarea></div></form>`,`<button class="btn btn-outline" data-close-modal>ยกเลิก</button><button class="btn btn-primary" id="save-profile-request">ส่งคำขอ</button>`);document.getElementById('save-profile-request').onclick=async()=>{const f=document.getElementById('profile-change-form');if(!f.reportValidity())return;const fd=new FormData(f);const {error}=await state.supabase.rpc('ec_request_profile_change',{p_full_name:String(fd.get('full_name')),p_email:String(fd.get('email')),p_username:String(fd.get('username')),p_reason:String(fd.get('reason'))});if(error)return toast(error.message,'danger');closeModal();toast('ส่งคำขอให้ Admin แล้ว','success');};};document.getElementById('enroll-mfa')?.addEventListener('click',async()=>{const {data,error}=await state.supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'CNMI EQA'});if(error)return toast(error.message,'danger');showModal('ตั้งค่า TOTP',`<div style="text-align:center">${data.totp.qr_code}<p>Secret: <code>${esc(data.totp.secret)}</code></p></div><form id="mfa-verify-form" class="form-grid"><div class="field"><label>รหัส 6 หลักจากแอป Authenticator</label><input class="input" name="code" inputmode="numeric" required></div></form>`,`<button class="btn btn-primary" id="verify-mfa">ยืนยัน</button>`);document.getElementById('verify-mfa').onclick=async()=>{const code=new FormData(document.getElementById('mfa-verify-form')).get('code');const ch=await state.supabase.auth.mfa.challenge({factorId:data.id});if(ch.error)return toast(ch.error.message,'danger');const vr=await state.supabase.auth.mfa.verify({factorId:data.id,challengeId:ch.data.id,code:String(code)});if(vr.error)return toast(vr.error.message,'danger');closeModal();toast('เปิด MFA แล้ว','success');route();};});}

  function renderError(error){const content=`<section class="page"><div class="notice danger"><strong>เกิดข้อผิดพลาด</strong><br>${esc(error?.message||error)}</div></section>`;appEl.innerHTML=shell(content,'ข้อผิดพลาด');bindShell();}

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
    if(!window.supabase?.createClient){appEl.innerHTML='<div class="boot-screen"><div class="notice danger">โหลด Supabase library ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต</div></div>';return;}
    state.supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    await loadIdentity();
    state.supabase.auth.onAuthStateChange(async(event,session)=>{
      state.session=session;state.user=session?.user||null;
      if(event==='SIGNED_OUT'||!session){state.profile=null;state.roles=[];renderLogin();return;}
      await loadIdentity();await route();
    });
    window.addEventListener('hashchange',route);
    await route();
  }

  init();
})();
