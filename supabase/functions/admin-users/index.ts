// CNMI EQA & Competency - Admin user management Edge Function
// Deploy name: admin-users
// Required secrets are provided automatically by Supabase:
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cleanEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function isMahidolEmail(email: string) {
  return /^[^\s@]+@mahidol\.ac\.th$/i.test(email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Missing authentication token' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerData, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !callerData.user) return json({ error: 'Invalid session' }, 401);
    const callerId = callerData.user.id;

    const { data: adminRole, error: roleError } = await admin
      .from('ec_user_roles')
      .select('role')
      .eq('profile_id', callerId)
      .eq('role', 'admin')
      .maybeSingle();
    if (roleError || !adminRole) return json({ error: 'Admin permission required' }, 403);

    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'create_user') {
      const email = cleanEmail(body.email);
      const employeeId = String(body.employee_id ?? '').trim();
      const fullName = String(body.full_name ?? '').trim();
      const positionTitle = String(body.position_title ?? '').trim() || null;
      const username = String(body.username ?? email.split('@')[0]).trim().toLowerCase();
      const requestedRoles: string[] = Array.isArray(body.roles) ? body.roles : ['staff'];
      const allowedRoles = ['staff', 'reviewer', 'qm', 'physician', 'admin', 'viewer'];
      const roles = [...new Set(['staff', ...requestedRoles.filter((r) => allowedRoles.includes(r))])];

      if (!isMahidolEmail(email)) return json({ error: 'ต้องใช้อีเมล @mahidol.ac.th' }, 400);
      if (!employeeId || !fullName) return json({ error: 'กรุณากรอกรหัสพนักงานและชื่อ-สกุล' }, 400);
      const initialPassword = `CNMI@${employeeId}`;
      if (initialPassword.length < 8) return json({ error: 'รหัสพนักงานสั้นเกินไปสำหรับรหัสเริ่มต้น' }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: {
          username,
          employee_id: employeeId,
          full_name: fullName,
          session_version: 1,
        },
      });
      if (createError || !created.user) return json({ error: createError?.message ?? 'Create user failed' }, 400);

      const userId = created.user.id;
      const { error: profileError } = await admin.from('ec_profiles').upsert({
        id: userId,
        email,
        username,
        employee_id: employeeId,
        full_name: fullName,
        position_title: positionTitle,
        active: true,
        must_change_password: true,
        session_version: 1,
      });
      if (profileError) return json({ error: profileError.message }, 400);

      await admin.from('ec_user_roles').delete().eq('profile_id', userId);
      const { error: rolesError } = await admin.from('ec_user_roles').insert(
        roles.map((role) => ({ profile_id: userId, role, created_by: callerId })),
      );
      if (rolesError) return json({ error: rolesError.message }, 400);

      await admin.from('ec_audit_logs').insert({
        actor_user_id: callerId,
        action: 'admin_create_user',
        table_name: 'auth.users',
        record_id: userId,
        metadata: { email, employee_id: employeeId, roles },
      });

      return json({ ok: true, user_id: userId, initial_password_pattern: 'CNMI@รหัสพนักงาน' });
    }

    if (action === 'reset_password') {
      const userId = String(body.user_id ?? '');
      const reason = String(body.reason ?? '').trim();
      if (!userId || !reason) return json({ error: 'กรุณาระบุผู้ใช้และเหตุผล' }, 400);

      const { data: profile, error: profileError } = await admin
        .from('ec_profiles')
        .select('employee_id,session_version,active')
        .eq('id', userId)
        .single();
      if (profileError || !profile) return json({ error: 'User profile not found' }, 404);

      const nextVersion = Number(profile.session_version ?? 1) + 1;
      const { data: authUserData, error: getUserError } = await admin.auth.admin.getUserById(userId);
      if (getUserError || !authUserData.user) return json({ error: getUserError?.message ?? 'Auth user not found' }, 404);

      const currentMetadata = authUserData.user.user_metadata ?? {};
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(userId, {
        password: `CNMI@${profile.employee_id}`,
        user_metadata: { ...currentMetadata, session_version: nextVersion },
      });
      if (updateAuthError) return json({ error: updateAuthError.message }, 400);

      const { error: updateProfileError } = await admin
        .from('ec_profiles')
        .update({ must_change_password: true, session_version: nextVersion })
        .eq('id', userId);
      if (updateProfileError) return json({ error: updateProfileError.message }, 400);

      await admin.from('ec_audit_logs').insert({
        actor_user_id: callerId,
        action: 'admin_reset_password',
        table_name: 'ec_profiles',
        record_id: userId,
        reason,
        metadata: { session_version: nextVersion },
      });

      return json({ ok: true, message: 'รีเซ็ตรหัสผ่านเป็น CNMI@รหัสพนักงานแล้ว' });
    }

    if (action === 'set_active') {
      const userId = String(body.user_id ?? '');
      const active = Boolean(body.active);
      const reason = String(body.reason ?? '').trim();
      if (!userId || !reason) return json({ error: 'กรุณาระบุผู้ใช้และเหตุผล' }, 400);

      const { data: profile, error: profileError } = await admin
        .from('ec_profiles')
        .select('session_version')
        .eq('id', userId)
        .single();
      if (profileError || !profile) return json({ error: 'User profile not found' }, 404);

      const nextVersion = Number(profile.session_version ?? 1) + 1;
      const { data: authUserData } = await admin.auth.admin.getUserById(userId);
      const currentMetadata = authUserData.user?.user_metadata ?? {};
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { ...currentMetadata, session_version: nextVersion },
      });

      const { error } = await admin
        .from('ec_profiles')
        .update({ active, session_version: nextVersion, archived_at: active ? null : new Date().toISOString() })
        .eq('id', userId);
      if (error) return json({ error: error.message }, 400);

      await admin.from('ec_audit_logs').insert({
        actor_user_id: callerId,
        action: active ? 'admin_activate_user' : 'admin_deactivate_user',
        table_name: 'ec_profiles',
        record_id: userId,
        reason,
      });
      return json({ ok: true });
    }

    if (action === 'update_roles') {
      const userId = String(body.user_id ?? '');
      const requestedRoles: string[] = Array.isArray(body.roles) ? body.roles : [];
      const allowedRoles = ['staff', 'reviewer', 'qm', 'physician', 'admin', 'viewer'];
      const roles = [...new Set(['staff', ...requestedRoles.filter((r) => allowedRoles.includes(r))])];
      if (!userId) return json({ error: 'Missing user_id' }, 400);

      await admin.from('ec_user_roles').delete().eq('profile_id', userId);
      const { error } = await admin.from('ec_user_roles').insert(
        roles.map((role) => ({ profile_id: userId, role, created_by: callerId })),
      );
      if (error) return json({ error: error.message }, 400);

      await admin.from('ec_audit_logs').insert({
        actor_user_id: callerId,
        action: 'admin_update_roles',
        table_name: 'ec_user_roles',
        record_id: userId,
        metadata: { roles },
      });
      return json({ ok: true, roles });
    }

    if (action === 'approve_profile_change' || action === 'reject_profile_change') {
      const requestId = String(body.request_id ?? '');
      const note = String(body.note ?? '').trim();
      if (!requestId) return json({ error: 'Missing request_id' }, 400);

      const { data: change, error: changeError } = await admin
        .from('ec_profile_change_requests')
        .select('*')
        .eq('id', requestId)
        .eq('status', 'pending')
        .single();
      if (changeError || !change) return json({ error: 'Pending request not found' }, 404);

      if (action === 'reject_profile_change') {
        await admin.from('ec_profile_change_requests').update({
          status: 'rejected', reviewed_by: callerId, reviewed_at: new Date().toISOString(), review_note: note,
        }).eq('id', requestId);
        return json({ ok: true });
      }

      const updates: Record<string, unknown> = {};
      if (change.requested_full_name) updates.full_name = change.requested_full_name;
      if (change.requested_username) updates.username = String(change.requested_username).toLowerCase();
      if (change.requested_email) {
        const email = cleanEmail(change.requested_email);
        if (!isMahidolEmail(email)) return json({ error: 'ต้องใช้อีเมล @mahidol.ac.th' }, 400);
        updates.email = email;
        const { error: authEmailError } = await admin.auth.admin.updateUserById(change.profile_id, {
          email,
          email_confirm: true,
        });
        if (authEmailError) return json({ error: authEmailError.message }, 400);
      }

      const { error: updateError } = await admin.from('ec_profiles').update(updates).eq('id', change.profile_id);
      if (updateError) return json({ error: updateError.message }, 400);

      await admin.from('ec_profile_change_requests').update({
        status: 'approved', reviewed_by: callerId, reviewed_at: new Date().toISOString(), review_note: note,
      }).eq('id', requestId);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
