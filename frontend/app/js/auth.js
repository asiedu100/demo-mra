// ============================================================
// MRA SYSTEMS — AUTHENTICATION & SESSION MANAGEMENT
// Supabase Auth is the only source of authentication.
// Roles: admin, staff
// ============================================================

(function () {
  'use strict';

  const INACTIVITY_MS = 30 * 60 * 1000;
  const WARNING_MS = 5 * 60 * 1000;

  let inactivityTimer = null;
  let warningTimer = null;
  let countdownInterval = null;
  let activityTrackingStarted = false;

  // ----------------------------------------------------------
  // SUPABASE HELPERS
  // ----------------------------------------------------------

  function getAuthAPI() {
    return window.MRAApi || window.MRASupabase || window.LumodaSupabase || null;
  }

  function getSupabaseClient() {
    const api = getAuthAPI();

    if (!api || !api.isConfigured?.()) return null;

    return api.getClient?.() || null;
  }

  function isSupabaseReady() {
    return !!getSupabaseClient();
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function setDisplay(id, display) {
    const el = getElement(id);
    if (el) el.style.display = display;
  }

  function showError(id, message) {
    const el = getElement(id);
    if (!el) return;

    el.textContent = message;
    el.style.display = 'block';
  }

  function hideError(id) {
    setDisplay(id, 'none');
  }

  async function getProfile(userId) {
    const api = getAuthAPI();

    if (!api?.getProfile) {
      throw new Error('The Supabase profile function is unavailable.');
    }

    const result = await api.getProfile(userId);

    if (result?.error) throw result.error;

    return result?.data ?? result;
  }

  // ----------------------------------------------------------
  // USER PROFILE AND BRANCH ACCESS
  // ----------------------------------------------------------

  async function getUserBranchIds(userId, role) {
    const sb = getSupabaseClient();

    if (!sb) throw new Error('Supabase is not configured.');

    // Admins can access every active branch.
    if (role === 'admin') {
      const { data, error } = await sb
        .from('branches')
        .select('id')
        .eq('is_active', true);

      if (error) throw error;

      return (data || []).map(branch => branch.id);
    }

    // Staff can only access branches assigned to them.
    const { data, error } = await sb
      .from('user_branch_access')
      .select('branch_id')
      .eq('user_id', userId);

    if (error) throw error;

    return (data || []).map(item => item.branch_id);
  }

  async function loadMraBranches() {
    const sb = getSupabaseClient();

    if (!sb) throw new Error('Supabase is not configured.');

    const { data, error } = await sb
      .from('branches')
      .select('id, branch_name, branch_code, address, phone, is_active')
      .eq('is_active', true)
      .order('branch_name');

    if (error) throw error;

    const branches = data || [];

    // core.js provides setBranches().
    if (typeof setBranches === 'function') {
      setBranches(branches);
    }
    if (typeof LS !== 'undefined') {
      LS.set('branches', branches);
    }

    return branches;
  }

  async function buildCurrentUser(profile) {
    if (!profile) {
      throw new Error('Your user profile could not be found.');
    }

    if (profile.is_active === false) {
      throw new Error(
        'Your account has been deactivated. Contact your administrator.'
      );
    }

    if (!['admin', 'staff'].includes(profile.role)) {
      throw new Error('Your account has an unsupported role.');
    }

    const branchIds = await getUserBranchIds(
      profile.id,
      profile.role
    );

    if (profile.role === 'staff' && branchIds.length === 0) {
      throw new Error(
        'No branch has been assigned to your account. Contact your administrator.'
      );
    }

    const userData = {
      id: profile.id,
      email: profile.email || '',
      fullName: profile.full_name || 'MRA User',
      role: profile.role,
      active: profile.is_active !== false,
      branchIds
    };

    // core.js owns normalizeUser().
    if (typeof normalizeUser === 'function') {
      return normalizeUser(userData);
    }

    return userData;
  }

  // ----------------------------------------------------------
  // SESSION COMPATIBILITY
  // No locally generated authentication tokens.
  // ----------------------------------------------------------

  function getCurrentSession() {
    if (!currentUser) return null;

    return {
      user: currentUser,
      userId: currentUser.id,
      role: currentUser.role
    };
  }

  function registerSession(user) {
    // Supabase manages the actual authentication session.
    return user?.id || null;
  }

  function destroySession() {
    // No local authentication token to destroy.
  }

  function updateSessionActivity() {
    // Supabase manages session persistence.
  }

  // ----------------------------------------------------------
  // BRANCH INITIALIZATION
  // ----------------------------------------------------------

  async function initializeUserBranches() {
    const branches = await loadMraBranches();

    if (!currentUser) return branches;

    const assignedIds = currentUser.branchIds || [];

    if (currentUser.role === 'admin') {
      currentLocation = 'All';
    } else {
      const firstAssigned = branches.find(
        branch => assignedIds.includes(branch.id)
      );

      currentLocation = firstAssigned?.id || null;
    }

    if (typeof renderLocationSelects === 'function') {
      renderLocationSelects();
    }

    return branches;
  }

  // ----------------------------------------------------------
  // DATA SYNCHRONIZATION
  // ----------------------------------------------------------

  async function safeLoad(loader, fallback = []) {
    try {
      if (typeof loader !== 'function') return fallback;

      const result = await loader();

      if (result?.error) throw result.error;

      return result?.data ?? result ?? fallback;
    } catch (error) {
      console.warn('MRA data loading warning:', error);
      return fallback;
    }
  }

  async function syncSupabaseCache() {
    const api = getAuthAPI();

    if (!api?.isConfigured?.()) return;

    const myUserId = currentUser?.id;
    if (!myUserId) return;

    const myGeneration = authGeneration;

    const cached = {
      products: LS.get('lumoda_products') || [],
      customers: LS.get('lumoda_customers') || [],
      invoices: LS.get('lumoda_invoices') || [],
      stockHistory: LS.get('lumoda_stockhistory') || [],
      auditLogs: LS.get('lumoda_audit') || []
    };

    const [
      products,
      customers,
      invoices,
      stockHistory,
      auditLogs,
      businessSettings
    ] = await Promise.all([
      safeLoad(() => api.loadProducts(), cached.products),
      safeLoad(() => api.loadCustomers(), cached.customers),
      safeLoad(() => api.loadInvoices(), cached.invoices),
      safeLoad(() => api.loadStockHistory(), cached.stockHistory),
      safeLoad(() => api.loadAuditLogs(), cached.auditLogs),
      safeLoad(() => api.loadBusinessSettings(), null)
    ]);

    // Prevent data fetched for a previous user from overwriting
    // the current user's data.
    if (
      myGeneration !== authGeneration ||
      currentUser?.id !== myUserId
    ) {
      return;
    }

    LS.set('lumoda_products', normalizeProducts(products));
    LS.set('lumoda_customers', customers);
    LS.set('lumoda_invoices', invoices);

    if (Array.isArray(stockHistory)) {
      LS.set('lumoda_stockhistory', stockHistory);
    }

    if (Array.isArray(auditLogs)) {
      LS.set('lumoda_audit', auditLogs);
    }

    if (businessSettings) {
      const cachedBusinessSettings = cacheBusinessSettings(businessSettings);

      if (cachedBusinessSettings.brand_color && typeof applyBrandColor === 'function') {
        applyBrandColor(cachedBusinessSettings.brand_color);
      }

      if (typeof applyBusinessName === 'function') {
        applyBusinessName(
          cachedBusinessSettings.business_name || 'MRA SYSTEMS'
        );
      }
    }

    if (typeof refreshAllLineItemDataLists === 'function') {
      refreshAllLineItemDataLists();
    }
  }

  async function syncSingleInvoice(invoiceId) {
    const api = getAuthAPI();

    if (!api?.loadInvoiceById || !currentUser) return;

    const myGeneration = authGeneration;
    const myUserId = currentUser.id;

    const [invoice, customers] = await Promise.all([
      safeLoad(() => api.loadInvoiceById(invoiceId), null),
      safeLoad(() => api.loadCustomers())
    ]);

    if (
      myGeneration !== authGeneration ||
      currentUser?.id !== myUserId
    ) {
      return;
    }

    const invoices = LS.get('lumoda_invoices') || [];

    const index = invoices.findIndex(
      item => item.id === invoiceId
    );

    if (invoice) {
      if (index >= 0) {
        invoices[index] = invoice;
      } else {
        invoices.unshift(invoice);
      }
    } else if (index >= 0) {
      invoices.splice(index, 1);
    }

    LS.set('lumoda_invoices', invoices);
    LS.set('lumoda_customers', customers);

    if (typeof refreshAllLineItemDataLists === 'function') {
      refreshAllLineItemDataLists();
    }
  }

  // ----------------------------------------------------------
  // LOGIN
  // ----------------------------------------------------------

  async function doLogin() {
    const emailInput = getElement('auth-user');
    const passwordInput = getElement('auth-pass');
    const rememberInput = getElement('remember-login');

    const email = emailInput?.value.trim().toLowerCase() || '';
    const password = passwordInput?.value || '';

    hideError('auth-error');

    if (!email || !password) {
      showError(
        'auth-error',
        'Please enter your email address and password.'
      );
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      showError(
        'auth-error',
        'Please enter a valid email address.'
      );
      return;
    }

    const api = getAuthAPI();

    if (!api?.isConfigured?.()) {
      showError(
        'auth-error',
        'MRA Supabase is not configured. Check supabase-config.js.'
      );
      return;
    }

    const loginButton = document.querySelector(
      '#auth-screen button[type="submit"], #auth-screen .login-btn'
    );

    if (loginButton) loginButton.disabled = true;

    try {
      const { data, error } = await api.signIn(email, password);

      if (error) throw error;

      const userId = data?.user?.id;

      if (!userId) {
        throw new Error('Supabase did not return an authenticated user.');
      }

      const profile = await getProfile(userId);

      if (!profile) {
        throw new Error(
          'Your account profile could not be found. Contact your administrator.'
        );
      }

      if (profile.is_active === false) {
        throw new Error(
          'Your account is inactive. Tell your administrator to activate your account.'
        );
      }

      // Do not erase the current user's offline cache on a normal login.
      // Only clear it when a different cached account is signing in.
      const cachedSessionUser = api.getCachedSessionUser?.();
      if (cachedSessionUser?.id && cachedSessionUser.id !== userId) {
        clearUserScopedState();
      }
      currentUser = await buildCurrentUser(profile);
      api.cacheSessionUser?.(currentUser);

      currentLocation = currentUser.role === 'admin'
        ? 'All'
        : (currentUser.branchIds[0] || null);

      isOfflineSession = false;
      authGeneration++;

      await initializeUserBranches();

      // Optional login audit.
      try {
        if (typeof addAudit === 'function') {
          addAudit(
            'Login',
            `${currentUser.fullName} signed in to MRA Systems.`
          );
        }

        if (api.recordLogin) {
          await api.recordLogin();
        }
      } catch (auditError) {
        console.warn('Login audit warning:', auditError);
      }

      await syncSupabaseCache();

      if (typeof setAutoLoginAllowed === 'function') {
        setAutoLoginAllowed(!!rememberInput?.checked);
      }

      if (data.user?.user_metadata?.must_change_password === true) {
        showChangePwScreen();
      } else {
        showApp();
      }

    } catch (error) {
      console.error('MRA login error:', error);

      showError(
        'auth-error',
        error.message || 'Login failed. Please try again.'
      );

    } finally {
      if (loginButton) loginButton.disabled = false;
    }
  }

  async function sendForgotPassword() {
    const emailInput = getElement('auth-user');
    const email = String(emailInput?.value || '').trim();
    const errorElement = getElement('auth-error');

    if (!email || !email.includes('@')) {
      showError(
        'auth-error',
        'Enter your account email above, then select Forgot password.'
      );
      return;
    }

    try {
      const api = getAuthAPI();
      if (!api?.sendPasswordResetEmail) {
        throw new Error('Password recovery is not configured.');
      }

      await api.sendPasswordResetEmail(email);
      if (errorElement) {
        errorElement.textContent =
          'Password reset instructions were sent. Check your email.';
        errorElement.style.display = 'block';
        errorElement.style.color = 'var(--accent)';
      }
    } catch (error) {
      showError(
        'auth-error',
        error.message || 'Could not send password reset instructions.'
      );
    }
  }

  // ----------------------------------------------------------
  // SESSION RESTORE
  // Supabase restores its own persisted session.
  // We verify it against the server before showing the app.
  // ----------------------------------------------------------

  async function restoreSession() {
    const sb = getSupabaseClient();
    const api = getAuthAPI();

    if (!sb) {
      showAuthScreen();
      return;
    }

    try {
      const { data: sessionData, error: sessionError } =
        await sb.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData?.session;

      if (!session?.user?.id) {
        showAuthScreen();
        return;
      }

      const { data: userData, error: userError } =
        await sb.auth.getUser();

      if (userError) throw userError;

      const authUser = userData?.user;

      if (!authUser?.id) {
        await sb.auth.signOut();
        showAuthScreen();
        return;
      }

      const profile = await getProfile(authUser.id);

      if (!profile || profile.is_active === false) {
        await signOutDueToDeactivation();
        return;
      }

      currentUser = await buildCurrentUser(profile);
      api.cacheSessionUser?.(currentUser);

      currentLocation = currentUser.role === 'admin'
        ? 'All'
        : (currentUser.branchIds[0] || null);

      isOfflineSession = false;
      authGeneration++;

      await initializeUserBranches();
      await syncSupabaseCache();

      if (authUser.user_metadata?.must_change_password === true) {
        showChangePwScreen();
      } else {
        showApp();
      }
      if (isPasswordRecoveryRedirect()) {
        toast('Set a new password to finish account recovery.', 'info');
        setTimeout(() => {
          if (typeof navigate === 'function') navigate('settings');
          if (typeof openChangeMyPassword === 'function') {
            openChangeMyPassword();
          }
        }, 0);
      }

    } catch (error) {
      console.error('Session restoration failed:', error);

      // A refresh should not log the user out because a profile/data request
      // briefly failed. Supabase already restored the authenticated session;
      // use the last verified user only for this offline/degraded render.
      const cachedUser = api.getCachedSessionUser?.();
      if (cachedUser?.id && navigator.onLine === false) {
        currentUser = cachedUser;
        const cachedBranches = typeof LS !== 'undefined' ? LS.get('branches') : [];
        if (Array.isArray(cachedBranches) && typeof setBranches === 'function') {
          setBranches(cachedBranches);
        }
        currentLocation = currentUser.role === 'admin'
          ? 'All'
          : (currentUser.branchIds?.[0] || null);
        isOfflineSession = true;
        showApp();
        toast('Offline mode: reconnect to refresh business data.', 'info');
        return;
      }

      // Only clear authentication when Supabase confirms that the session is
      // invalid. Network and schema errors must remain visible, not become a
      // misleading logout.
      const authFailure = error?.status === 401 ||
        error?.code === 'PGRST301' ||
        /invalid.*token|jwt|not authenticated/i.test(error?.message || '');

      if (authFailure) {
        try {
          await sb.auth.signOut();
        } catch (signOutError) {
          console.warn('Could not clear invalid session:', signOutError);
        }
        api.clearCachedSessionUser?.();
        currentUser = null;
        clearUserScopedState();
        showAuthScreen();
      } else {
        const cachedUser = api.getCachedSessionUser?.();
        if (cachedUser?.id) {
          currentUser = cachedUser;
          const cachedBranches = typeof LS !== 'undefined' ? LS.get('branches') : [];
          if (Array.isArray(cachedBranches) && typeof setBranches === 'function') {
            setBranches(cachedBranches);
          }
          currentLocation = currentUser.role === 'admin'
            ? 'All'
            : (currentUser.branchIds?.[0] || null);
          isOfflineSession = true;
          showApp();
          toast('Session restored; some data could not be refreshed.', 'error');
        } else {
          showAuthScreen();
        }
      }

      if (!navigator.onLine) {
        toast(
          'Connect to the internet to verify your MRA account.',
          'error'
        );
      }
    }
  }

  // ----------------------------------------------------------
  // INACTIVITY AUTO-LOGOUT
  // ----------------------------------------------------------

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    clearInterval(countdownInterval);

    if (!currentUser) return;

    setDisplay('session-warning', 'none');

    updateSessionActivity();

    warningTimer = setTimeout(
      showSessionWarning,
      INACTIVITY_MS - WARNING_MS
    );

    inactivityTimer = setTimeout(
      () => forceLogout('inactivity'),
      INACTIVITY_MS
    );
  }

  function showSessionWarning() {
    let seconds = Math.floor(WARNING_MS / 1000);

    setDisplay('session-warning', 'flex');

    const countdown = getElement('session-countdown');

    if (countdown) {
      countdown.textContent = seconds;
    }

    clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
      seconds--;

      const el = getElement('session-countdown');

      if (el) el.textContent = seconds;

      if (seconds <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);
  }

  function stayLoggedIn() {
    resetInactivityTimer();
  }

  async function forceLogout(reason) {
    if (!currentUser) return;

    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    clearInterval(countdownInterval);

    try {
      if (typeof addAudit === 'function') {
        addAudit(
          'Auto Logout',
          `Session ended due to ${reason}.`
        );
      }
    } catch (error) {
      console.warn(error);
    }

    await signOutFromSupabase();

    currentUser = null;
    isOfflineSession = false;

    authGeneration++;

    clearUserScopedState();
    stopActivityTracking();
    showAuthScreen();

    toast(
      'You were logged out due to inactivity.',
      'error'
    );
  }

  function startActivityTracking() {
    if (activityTrackingStarted) return;

    const events = [
      'mousemove',
      'keydown',
      'click',
      'touchstart',
      'scroll'
    ];

    events.forEach(event => {
      document.addEventListener(
        event,
        resetInactivityTimer,
        { passive: true }
      );
    });

    activityTrackingStarted = true;

    resetInactivityTimer();
  }

  function stopActivityTracking() {
    const events = [
      'mousemove',
      'keydown',
      'click',
      'touchstart',
      'scroll'
    ];

    events.forEach(event => {
      document.removeEventListener(event, resetInactivityTimer);
    });

    activityTrackingStarted = false;

    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    clearInterval(countdownInterval);
  }

  // ----------------------------------------------------------
  // LOGOUT
  // ----------------------------------------------------------

  async function signOutFromSupabase() {
    const api = getAuthAPI();

    if (!api?.signOut) return;

    try {
      await api.signOut();
    } catch (error) {
      console.warn('Supabase sign-out warning:', error);
    }
  }

  async function doLogout() {
    if (!currentUser) return;

    if (!confirm('Sign out of MRA Systems?')) return;

    try {
      if (typeof addAudit === 'function') {
        addAudit(
          'Logout',
          `${currentUser.fullName} signed out.`
        );
      }
    } catch (error) {
      console.warn(error);
    }

    await signOutFromSupabase();

    currentUser = null;
    isOfflineSession = false;

    authGeneration++;

    stopActivityTracking();
    clearUserScopedState();

    showAuthScreen();
  }

  async function signOutDueToDeactivation() {
    await signOutFromSupabase();

    currentUser = null;
    isOfflineSession = false;

    authGeneration++;

    stopActivityTracking();
    clearUserScopedState();

    showAuthScreen();

    toast(
      'Your account is inactive. Tell your administrator to activate your account.',
      'error'
    );
  }

  // ----------------------------------------------------------
  // AUTH SCREEN
  // ----------------------------------------------------------

  function showAuthScreen(clear = true) {
    setDisplay('app', 'none');
    setDisplay('change-pw-screen', 'none');
    setDisplay('bootstrap-admin-screen', 'none');
    setDisplay('auth-screen', 'flex');
    setDisplay('session-warning', 'none');

    if (clear) {
      const email = getElement('auth-user');
      const password = getElement('auth-pass');

      if (email) email.value = '';
      if (password) password.value = '';

      hideError('auth-error');
    }
  }

  // MRA does not use first-admin bootstrap.
  async function checkNeedsBootstrap() {
    return false;
  }

  function showBootstrapScreen() {
    showAuthScreen();
  }

  async function doBootstrapAdmin() {
    toast(
      'Admin setup is already complete. Sign in with your MRA admin account.',
      'error'
    );
  }

  // MRA staff accounts are created through the admin interface
  // and the create-staff-account Edge Function.
  function showChangePwScreen() {
    setDisplay('auth-screen', 'none');
    setDisplay('app', 'none');
    setDisplay('bootstrap-admin-screen', 'none');
    setDisplay('change-pw-screen', 'flex');
    const nameElement = getElement('change-pw-name');
    if (nameElement) {
      nameElement.textContent =
        `Welcome ${currentUser?.fullName || 'to MRA Systems'}`;
    }
    getElement('new-pw')?.focus();
  }

  async function doChangePassword() {
    const newPassword = getElement('new-pw')?.value || '';
    const confirmPassword = getElement('confirm-pw')?.value || '';
    const errorElement = getElement('change-pw-error');

    if (errorElement) errorElement.style.display = 'none';

    if (newPassword.length < 8) {
      showError(
        'change-pw-error',
        'Password must be at least 8 characters.'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      showError(
        'change-pw-error',
        'Passwords do not match.'
      );
      return;
    }

    try {
      const sb = getSupabaseClient();

      const { error } = await sb.auth.updateUser({
        password: newPassword,
        data: {
          ...(currentUser?.user_metadata || {}),
          must_change_password: false
        }
      });

      if (error) throw error;

      setDisplay('change-pw-screen', 'none');

      if (window.history?.replaceState && isPasswordRecoveryRedirect()) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      toast('Password updated successfully.');

      showApp();

    } catch (error) {
      showError(
        'change-pw-error',
        error.message || 'Could not update your password.'
      );
    }

    function isPasswordRecoveryRedirect() {
      return /(?:^|[#&])type=recovery(?:&|$)/i.test(
        window.location.hash || ''
      );
    }
  }

  // ----------------------------------------------------------
  // SHOW APPLICATION
  // ----------------------------------------------------------

  function showApp() {
    if (!currentUser) {
      showAuthScreen();
      return;
    }

    setDisplay('auth-screen', 'none');
    setDisplay('change-pw-screen', 'none');
    setDisplay('bootstrap-admin-screen', 'none');

    setDisplay('app', 'flex');

    if (typeof updateUserUI === 'function') {
      updateUserUI();
    }

    if (typeof buildNavForRole === 'function') {
      buildNavForRole();
    }

    if (typeof renderLocationSelects === 'function') {
      renderLocationSelects();
    }

    // Start everyone on the dashboard.
    if (typeof navigate === 'function') {
      navigate('dashboard', null);
    }

    startActivityTracking();

    // Start MRA business onboarding after the authenticated app loads.
    if (window.MRAOnboarding?.maybeShowOnboarding) {
      setTimeout(() => {
        window.MRAOnboarding.maybeShowOnboarding();
      }, 300);
    }
  }

  // ----------------------------------------------------------
  // ROLE-BASED ACCESS
  // core.js owns isAdmin() and isStaff().
  // ----------------------------------------------------------

  function requireAdmin(action) {
    if (typeof isAdmin !== 'function' || !isAdmin()) {
      toast(
        'Only an administrator can ' + action + '.',
        'error'
      );

      return false;
    }

    return true;
  }

  function canEditInvoice(invoice) {
    if (!currentUser || !invoice || !invoice.id) {
      return false;
    }

    if (isAdmin()) return true;

    return (
      currentUser.role === 'staff' &&
      (currentUser.branchIds || []).includes(invoice.branch_id)
    );
  }

  function requireInvoiceEdit(invoice, action) {
    if (!canEditInvoice(invoice)) {
      toast(
        'You cannot ' + action + ' for this invoice.',
        'error'
      );

      return false;
    }

    return true;
  }

  // ----------------------------------------------------------
  // NAVIGATION
  // ----------------------------------------------------------

  function buildNavForRole() {
    if (!currentUser) return;

    const admin = currentUser.role === 'admin';

    const adminPages = [
      'reports',
      'audit',
      'users'
    ];

    const staffPages = [
      'dashboard',
      'cashsales',
      'invoices',
      'customers',
      'products',
      'warehouse',
      'stockhistory',
      'settings'
    ];

    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      const page = item.dataset.page;

      if (admin) {
        item.style.display = 'flex';
      } else {
        item.style.display = staffPages.includes(page)
          ? 'flex'
          : 'none';
      }

      if (!admin && adminPages.includes(page)) {
        item.style.display = 'none';
      }
    });

    // Hide only the unfinished dedicated warehouse-management page.
    [
      'nav-warehouses'
    ].forEach(id => {
      setDisplay(id, 'none');
    });

    const locationFilter = getElement('loc-filter');

    if (locationFilter) {
      locationFilter.style.display = admin ? 'flex' : 'none';
    }
  }

  // ----------------------------------------------------------
  // BRANCH FILTERING
  // ----------------------------------------------------------

  function filterByLoc(items) {
    if (!Array.isArray(items) || !currentUser) return [];

    // Admin can view all branches or select one branch.
    if (isAdmin()) {
      if (!currentLocation || currentLocation === 'All') {
        return items;
      }

      return items.filter(
        item => (item.branch_id || item.branchId) === currentLocation
      );
    }

    // Staff can only view their assigned branches.
    const assignedIds = currentUser.branchIds || [];

    return items.filter(
      item => assignedIds.includes(item.branch_id || item.branchId)
    );
  }

  // ----------------------------------------------------------
  // USER INTERFACE
  // ----------------------------------------------------------

  function updateUserUI() {
    if (!currentUser) return;

    const user = currentUser;

    const fullName = user.fullName || 'MRA User';

    const firstName = fullName.split(' ')[0];

    const initials = fullName
      .split(' ')
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    const usernameElement = getElement('topbar-username');
    const avatarElement = getElement('topbar-avatar');
    const sidebarElement = getElement('sidebar-user-info');
    const locationNameElement = getElement('loc-name');
    const roleElement = getElement('topbar-role');

    if (usernameElement) {
      usernameElement.textContent = fullName;
    }

    if (avatarElement) {
      avatarElement.textContent = initials;
    }

    if (sidebarElement) {
      sidebarElement.textContent = user.email || '';
    }

    const assignedBranches = getBranches()
      .filter(branch => (user.branchIds || []).includes(branch.id))
      .map(branch => branch.branch_name);

    const branchLabel = user.role === 'admin'
      ? 'All Branches'
      : (assignedBranches.join(', ') || 'No branch assigned');

    if (locationNameElement) {
      locationNameElement.textContent = branchLabel;
    }

    if (roleElement) {
      roleElement.textContent = user.role === 'admin'
        ? 'Admin'
        : 'Staff';

      roleElement.style.background = user.role === 'admin'
        ? 'var(--brand-red)'
        : 'var(--brand-brown)';
    }

    const hour = new Date().getHours();

    const greeting = hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : 'Good evening';

    const greetingElement = getElement('dash-greeting');

    if (greetingElement) {
      greetingElement.textContent =
        greeting + ', ' + firstName + ' 👋';
    }

    const dateElement = getElement('dash-date');

    if (dateElement) {
      const now = new Date();

      dateElement.textContent =
        now.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }) + ' · ' + branchLabel;
    }
  }

  // ----------------------------------------------------------
  // NO OFFLINE AUTHENTICATION
  // ----------------------------------------------------------

  async function revalidateSessionOnReconnect() {
    if (!currentUser) return;

    await restoreSession();
  }

  function isAuthNetworkFailure(error) {
    if (!navigator.onLine) return true;

    if (!error) return false;

    const message = String(error.message || '').toLowerCase();

    return (
      error.name === 'AuthRetryableFetchError' ||
      error.status === 0 ||
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('load failed')
    );
  }

  function isAuthTokenStaleError(error) {
    if (!error) return false;

    const message = String(error.message || '').toLowerCase();

    return (
      message.includes('not authenticated') ||
      message.includes('jwt expired') ||
      message.includes('invalid jwt')
    );
  }

  function tryEnterOfflineSession() {
    // Deliberately disabled.
    // Cached data must never be treated as proof of authentication.
    return false;
  }

  // ----------------------------------------------------------
  // PUBLIC FUNCTIONS
  // These remain globally accessible to HTML and other modules.
  // ----------------------------------------------------------

  window.doLogin = doLogin;
  window.restoreSession = restoreSession;
  window.sendForgotPassword = sendForgotPassword;

  window.doLogout = doLogout;
  window.forceLogout = forceLogout;
  window.stayLoggedIn = stayLoggedIn;

  window.startActivityTracking = startActivityTracking;
  window.stopActivityTracking = stopActivityTracking;
  window.resetInactivityTimer = resetInactivityTimer;

  window.showAuthScreen = showAuthScreen;
  window.showApp = showApp;

  window.getCurrentSession = getCurrentSession;
  window.registerSession = registerSession;
  window.destroySession = destroySession;
  window.updateSessionActivity = updateSessionActivity;

  window.syncSupabaseCache = syncSupabaseCache;
  window.syncSingleInvoice = syncSingleInvoice;

  window.loadMraBranches = loadMraBranches;
  window.initializeUserBranches = initializeUserBranches;

  window.buildCurrentUser = buildCurrentUser;
  window.getUserBranchIds = getUserBranchIds;

  window.requireAdmin = requireAdmin;
  window.canEditInvoice = canEditInvoice;
  window.requireInvoiceEdit = requireInvoiceEdit;

  window.buildNavForRole = buildNavForRole;
  window.filterByLoc = filterByLoc;
  window.updateUserUI = updateUserUI;

  window.signOutDueToDeactivation = signOutDueToDeactivation;
  window.revalidateSessionOnReconnect = revalidateSessionOnReconnect;

  window.isAuthNetworkFailure = isAuthNetworkFailure;
  window.isAuthTokenStaleError = isAuthTokenStaleError;
  window.tryEnterOfflineSession = tryEnterOfflineSession;

  window.checkNeedsBootstrap = checkNeedsBootstrap;
  window.showBootstrapScreen = showBootstrapScreen;
  window.doBootstrapAdmin = doBootstrapAdmin;

  window.showChangePwScreen = showChangePwScreen;
  window.doChangePassword = doChangePassword;

})();