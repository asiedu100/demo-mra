import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function validEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server configuration is incomplete.' }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  // Fast-fail before touching the Admin API — avoids creating an orphaned
  // auth.users row in the normal, already-bootstrapped case. This is a
  // pure optimization, not the security boundary: bootstrap_first_admin()
  // re-checks atomically below regardless of what this returns.
  const { data: adminExists, error: adminCheckError } =
    await serviceClient.rpc('any_admin_exists');

  if (adminCheckError) {
    return json({
      error: adminCheckError.message || 'Could not check setup status.'
    }, 500);
  }

  if (adminExists) {
    return json({ error: 'Setup has already been completed.' }, 409);
  }

  const payload = await req.json().catch(() => ({}));

  const email = String(payload.email || '')
    .trim()
    .toLowerCase();

  const username = String(payload.username || '')
    .trim()
    .toLowerCase();

  const fullName = String(payload.fullName || '').trim();

  const password = String(payload.password || '');

  if (!validEmail(email)) {
    return json({
      error: 'A valid email is required.'
    }, 400);
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return json({
      error: 'A valid username is required.'
    }, 400);
  }

  if (!fullName) {
    return json({
      error: 'Full name is required.'
    }, 400);
  }

  if (password.length < 6) {
    return json({
      error: 'Password must be at least 6 characters.'
    }, 400);
  }

  try {
    const { data: createdUser, error: createUserError } =
      await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: fullName,
          role: 'admin',
          location: 'All',
          must_change_password: false
        }
      });

    if (createUserError || !createdUser?.user) {
      return json({
        error:
          createUserError?.message ||
          'Could not create auth user.'
      }, 400);
    }

    const { data: profileData, error: profileError } =
      await serviceClient.rpc('bootstrap_first_admin', {
        p_id: createdUser.user.id,
        p_email: email,
        p_username: username,
        p_full_name: fullName
      });

    if (profileError) {
      try {
        await serviceClient.auth.admin.deleteUser(
          createdUser.user.id
        );
      } catch (_) {}

      const alreadyExists = /already exists/i.test(profileError.message || '');

      return json({
        error:
          profileError.message ||
          'Could not create profile.'
      }, alreadyExists ? 409 : 400);
    }

    return json({
      userId: createdUser.user.id,
      profile: profileData
    });

  } catch (err) {
    return json({
      error:
        err?.message ||
        'Unexpected server error'
    }, 500);
  }
});
