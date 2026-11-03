// ============================================================
// MRA SYSTEMS — SUPABASE CLIENT
// Database integration for MRA Systems
// ============================================================

(function () {
  const cfg = window.MRA_SUPABASE || {};
  let client = null;

  const AUTH_STORAGE_KEY = 'mra-auth-token';
  const USER_CACHE_KEY = 'mra-session-user';

  // ----------------------------------------------------------
  // INITIALIZATION
  // ----------------------------------------------------------

  function isConfigured() {
    return Boolean(
      cfg.url &&
      cfg.anonKey &&
      !cfg.url.includes('YOUR_PROJECT_REF')
    );
  }

  function getCachedSessionUser() {
    try {
      const raw = localStorage.getItem(USER_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function cacheSessionUser(user) {
    try {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } catch (error) {
      console.warn('Could not cache MRA session user:', error);
    }
  }

  function clearCachedSessionUser() {
    try {
      localStorage.removeItem(USER_CACHE_KEY);
    } catch (error) {}
  }

  function init() {
    if (!isConfigured()) return null;

    if (!window.supabase || !window.supabase.createClient) {
      console.warn('Supabase SDK was not loaded.');
      return null;
    }

    if (!client) {
      client = window.supabase.createClient(
        cfg.url,
        cfg.anonKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage,
            storageKey: AUTH_STORAGE_KEY
          }
        }
      );
    }

    return client;
  }

  function getClient() {
    return client || init();
  }

  function requireClient() {
    const sb = getClient();

    if (!sb) {
      throw new Error('MRA Supabase is not configured.');
    }

    return sb;
  }

  function unsupported(operation) {
    throw new Error(
      `${operation} is not yet available in MRA Systems. ` +
      'It requires a dedicated secure database operation.'
    );
  }

  // ----------------------------------------------------------
  // AUTHENTICATION
  // ----------------------------------------------------------

  async function signIn(email, password) {
    const sb = requireClient();

    return sb.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password
    });
  }

  async function sendPasswordResetEmail(email, redirectTo = window.location.href) {
    const address = String(email || '').trim().toLowerCase();
    if (!address) throw new Error('Enter your account email first.');

    const { error } = await requireClient().auth.resetPasswordForEmail(
      address,
      { redirectTo }
    );

    if (error) throw error;
    return true;
  }

  async function signOut() {
    const sb = getClient();

    if (!sb) return;

    try {
      await sb.auth.signOut();
    } finally {
      clearRawStoredSession();
      clearCachedSessionUser();
    }
  }

  async function getSession() {
    const sb = getClient();

    if (!sb) {
      return {
        data: { session: null },
        error: null
      };
    }

    return sb.auth.getSession();
  }

  async function getCurrentUser() {
    const sb = getClient();

    if (!sb) return null;

    const { data, error } = await sb.auth.getUser();

    if (error) throw error;

    return data?.user || null;
  }

  function getRawStoredSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function clearRawStoredSession() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (error) {}
  }

  async function getProfile(userId) {
    const sb = requireClient();

    return sb
      .from('profiles')
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        created_at,
        updated_at
      `)
      .eq('id', userId)
      .single();
  }

  async function getMyProfile() {
    const user = await getCurrentUser();

    if (!user) return null;

    const { data, error } = await getProfile(user.id);

    if (error) throw error;

    return data;
  }

  async function updateMyProfile(payload = {}) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error('You must be signed in to update your profile.');

    const fullName = String(
      payload.fullName ?? payload.full_name ?? ''
    ).trim();

    if (fullName.length < 2) {
      throw new Error('Your name must contain at least 2 characters.');
    }

    const { data, error } = await requireClient()
      .from('profiles')
      .update({
        full_name: fullName,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        created_at,
        updated_at
      `)
      .single();

    if (error) throw error;
    return data;
  }

  // MRA uses email authentication, not username authentication.
  async function getProfileByUsername() {
    throw new Error(
      'Username login is not supported. Please sign in using your email.'
    );
  }

  async function loadProfiles() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('profiles')
      .select(`
        id,
        email,
        full_name,
        role,
        is_active,
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  }

  async function recordLogin() {
    // The MRA schema does not currently have a record_login RPC.
    return null;
  }

  // ----------------------------------------------------------
  // BUSINESS PROFILE
  // ----------------------------------------------------------

  async function loadBusinessSettings() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('business_profile')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data ? {
      ...data,
      currency_code: data.currency_code || (
        data.currency_symbol === 'GH₵' ? 'GHS' : data.currency_symbol
      )
    } : data;
  }

  async function saveBusinessSettings(payload = {}) {
    const sb = requireClient();

    const updates = {
      business_name: payload.businessName ?? payload.business_name,
      business_type: payload.businessType ?? payload.business_type,
      currency_code:
        payload.currencyCode ??
        payload.currency_code ??
        'GHS',
      currency_symbol:
        payload.currencySymbol ??
        payload.currency_symbol ??
        'GH₵',
      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.address || null,
      default_reorder_level: Number(
        payload.defaultReorderLevel ??
        payload.default_reorder_level ??
        10
      ),
      brand_color: payload.brandColor ?? payload.brand_color ?? '#5C2D0A',
      updated_at: new Date().toISOString()
    };

    if (!updates.business_name) {
      throw new Error('Business name is required.');
    }

    // Find the existing business profile first.
    const { data: existing, error: findError } = await sb
      .from('business_profile')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    let result;

    if (existing?.id) {
      result = await sb
        .from('business_profile')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await sb
        .from('business_profile')
        .insert(updates)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    return result.data;
  }

  async function markOnboardingSeen() {
    return true;
  }

  async function completeStaffTour() {
    return true;
  }

  async function saveMyDefaultLandingPage() {
    unsupported('Saving a custom landing page');
  }

  async function uploadLogo() {
    unsupported('Logo uploads');
  }

  async function saveLogoUrl() {
    unsupported('Saving a business logo');
  }

  // ----------------------------------------------------------
  // BRANCHES
  // ----------------------------------------------------------

  async function loadBranches() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('branches')
      .select(`
        id,
        branch_name,
        branch_code,
        address,
        phone,
        is_active,
        created_at,
        updated_at
      `)
      .order('branch_name', { ascending: true });

    if (error) throw error;

    return data || [];
  }

  async function loadUserBranches(userId) {
    const sb = requireClient();

    const { data, error } = await sb
      .from('user_branch_access')
      .select(`
        id,
        user_id,
        branch_id,
        branches (
          id,
          branch_name,
          branch_code,
          is_active
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    return data || [];
  }

  // Branch management requires secure admin-only database functions.
  async function saveBranch() {
    unsupported('Creating or editing branches');
  }

  async function deleteBranch() {
    unsupported('Deleting branches');
  }

  async function deactivateBranch() {
    unsupported('Deactivating branches');
  }

  async function reactivateBranch() {
    unsupported('Reactivating branches');
  }

  // ----------------------------------------------------------
  // PRODUCT CATEGORIES
  // ----------------------------------------------------------

  async function loadCategories() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('product_categories')
      .select('*')
      .order('category_name', { ascending: true });

    if (error) throw error;

    return data || [];
  }

  // ----------------------------------------------------------
  // PRODUCTS AND BRANCH INVENTORY
  // ----------------------------------------------------------

  function toLocalProduct(row, inventoryRows = [], categories = []) {
    if (!row) return null;

    const category = categories.find(
      c => c.id === row.category_id
    );

    const branchStock = {};

    inventoryRows
      .filter(stock => stock.product_id === row.id)
      .forEach(stock => {
        branchStock[stock.branch_id] = Number(
          stock.quantity || 0
        );
      });

    return {
      id: row.id,

      name: row.product_name,
      productName: row.product_name,

      sku: row.sku || '',
      barcode: row.barcode || '',

      categoryId: row.category_id || null,

      category: category
        ? category.category_name
        : 'Uncategorised',

      description: row.description || '',

      costPrice: Number(row.cost_price || 0),
      sellingPrice: Number(row.selling_price || 0),

      // Temporary compatibility fields for older UI components.
      price: Number(row.selling_price || 0),
      retailPrice: Number(row.selling_price || 0),

      reorder: Number(row.reorder_level || 0),
      unitName: row.unit_name || 'piece',

      branchStock,

      isActive: !!row.is_active,

      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function loadProducts() {
    const sb = requireClient();

    const [
      productsResult,
      inventoryResult,
      categoriesResult
    ] = await Promise.all([
      sb.from('products')
        .select('*')
        .order('product_name', { ascending: true }),

      sb.from('branch_inventory')
        .select('id, branch_id, product_id, quantity'),

      sb.from('product_categories')
        .select('id, category_name')
    ]);

    if (productsResult.error) throw productsResult.error;
    if (inventoryResult.error) throw inventoryResult.error;
    if (categoriesResult.error) throw categoriesResult.error;

    const inventoryRows = inventoryResult.data || [];
    const categories = categoriesResult.data || [];

    return (productsResult.data || []).map(row =>
      toLocalProduct(row, inventoryRows, categories)
    );
  }

  // Product records and stock quantities are separate in MRA.
  // This method only saves product information.
  async function saveProduct(payload = {}) {
    const sb = requireClient();

    const row = {
      product_name: String(
        payload.productName ??
        payload.product_name ??
        payload.name ??
        ''
      ).trim(),

      sku: payload.sku || null,
      barcode: payload.barcode || null,

      category_id:
        payload.categoryId ??
        payload.category_id ??
        null,

      description: payload.description || null,

      cost_price: Number(
        payload.costPrice ??
        payload.cost_price ??
        0
      ),

      selling_price: Number(
        payload.sellingPrice ??
        payload.selling_price ??
        payload.price ??
        0
      ),

      reorder_level: Number(
        payload.reorder ??
        payload.reorderLevel ??
        payload.reorder_level ??
        0
      ),

      unit_name:
        payload.unitName ??
        payload.unit_name ??
        'piece',

      is_active:
        payload.isActive ??
        payload.is_active ??
        true,

      updated_at: new Date().toISOString()
    };

    if (!row.product_name) {
      throw new Error('Product name is required.');
    }

    let result;

    if (payload.id) {
      result = await sb
        .from('products')
        .update(row)
        .eq('id', payload.id)
        .select()
        .single();
    } else {
      result = await sb
        .from('products')
        .insert(row)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    return {
      data: toLocalProduct(result.data),
      error: null
    };
  }

  // Stock operations must use secure database functions.
  async function adjustProductStock() {
    unsupported('Stock adjustments');
  }

  async function logStockHistory() {
    unsupported('Direct stock-history insertion');
  }

  async function importProducts(rows = []) {
    const sb = requireClient();
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('At least one product is required.');
    }

    const { data: categories, error: categoryError } = await sb
      .from('product_categories')
      .select('id, category_name');
    if (categoryError) throw categoryError;

    const categoryIds = new Map(
      (categories || []).map(category => [
        String(category.category_name).trim().toLowerCase(),
        category.id
      ])
    );

    const imported = [];
    for (const product of rows) {
      const categoryName = String(product.category || '').trim().toLowerCase();
      const categoryId = categoryName ? categoryIds.get(categoryName) : null;
      if (categoryName && !categoryId) {
        throw new Error(`Category "${product.category}" is not available.`);
      }

      const result = await saveProduct({
        productName: product.name,
        sku: product.sku || null,
        categoryId,
        costPrice: product.costPrice || 0,
        sellingPrice: product.sellingPrice,
        reorderLevel: product.reorder || 0,
        unitName: product.unitName || 'piece'
      });
      imported.push(result.data);
    }
    return imported;
  }

  // ----------------------------------------------------------
  // CUSTOMERS
  // ----------------------------------------------------------

  function toLocalCustomer(row) {
    if (!row) return null;

    return {
      id: row.id,

      name: row.customer_name,
      customerName: row.customer_name,

      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      notes: row.notes || '',

      isActive: !!row.is_active,

      createdAt: row.created_at
        ? new Date(row.created_at).getTime()
        : Date.now()
    };
  }

  async function loadCustomers() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(toLocalCustomer);
  }

  async function saveCustomer(payload = {}) {
    const sb = requireClient();

    const row = {
      customer_name: String(
        payload.customerName ??
        payload.customer_name ??
        payload.name ??
        ''
      ).trim(),

      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.address || null,
      notes: payload.notes || null,

      is_active:
        payload.isActive ??
        payload.is_active ??
        true,

      updated_at: new Date().toISOString()
    };

    if (!row.customer_name) {
      throw new Error('Customer name is required.');
    }

    let result;

    if (payload.id) {
      result = await sb
        .from('customers')
        .update(row)
        .eq('id', payload.id)
        .select()
        .single();
    } else {
      result = await sb
        .from('customers')
        .insert(row)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    return {
      data: toLocalCustomer(result.data),
      error: null
    };
  }

  // ----------------------------------------------------------
  // INVOICES
  // ----------------------------------------------------------

  const INVOICE_SELECT = `
    *,
    customers (
      id,
      customer_name,
      phone,
      email
    ),
    invoice_items (*),
    invoice_payments (*)
  `;

  function toLocalInvoice(row, profileNames = {}) {
    const items = (row.invoice_items || []).map(item => ({
      id: item.id,

      productId: item.product_id,

      name: item.product_name,
      sku: item.sku || '',

      qty: Number(item.quantity || 0),

      price: Number(item.unit_price || 0),

      cost: Number(item.unit_cost || 0),

      discount: Number(item.discount_amount || 0),

      total: Number(item.line_total || 0)
    }));

    const payments = (row.invoice_payments || []).map(payment => ({
      id: payment.id,

      amount: Number(payment.amount || 0),

      method: payment.payment_method ||
        payment.paymentMethod ||
        payment.method ||
        '',

      reference: payment.payment_reference ||
        payment.paymentReference ||
        payment.reference ||
        '',

      note: payment.payment_note ||
        payment.paymentNote ||
        payment.note ||
        '',

      by: payment.received_by || null,

      at: (payment.payment_date || payment.created_at)
        ? new Date(payment.payment_date || payment.created_at).getTime()
        : Date.now()
    }));

    const customer = row.customers || null;

    return {
      id: row.id,

      number: row.invoice_number,

      branchId: row.branch_id,

      customerId: row.customer_id || row.customerId || null,
      customer_id: row.customer_id || row.customerId || null,

      customerName: customer?.customer_name ||
        row.customer_name ||
        'Walk-in Customer',

      customerPhone: customer?.phone || row.customer_phone || '',
      customerEmail: customer?.email || '',

      location: row.branch_id,

      items,

      subtotal: Number(row.subtotal ?? row.subtotal_amount ?? 0),

      discount: Number(row.discount_amount ?? row.discount ?? 0),

      tax: Number(row.tax_amount ?? row.tax ?? 0),

      total: Number(row.total_amount ?? row.total ?? 0),

      amountPaid: Number(row.amount_paid ?? row.amountPaid ?? 0),

      balance: Number(row.balance_due ?? row.balance ?? 0),

      status: row.status,
      payMethod: row.payment_method ||
        row.pay_method ||
        row.partial_method ||
        null,
      isCashSale: Boolean(
        row.is_cash_sale ||
        row.isCashSale ||
        !(row.customer_id || row.customerId)
      ),

      notes: row.notes || '',

      createdBy: row.created_by,
      createdByName: profileNames[row.created_by] ||
        row.created_by_name ||
        row.createdByName ||
        '',

      createdAt: (row.invoice_date || row.created_at)
        ? new Date(row.invoice_date || row.created_at).getTime()
        : Date.now(),

      payments
    };
  }

  async function loadInvoices() {
    const sb = requireClient();

    const [{ data, error }, { data: profiles }] = await Promise.all([
      sb
        .from('invoices')
        .select(INVOICE_SELECT)
        .order('created_at', { ascending: false }),
      sb
        .from('profiles')
        .select('id, full_name')
    ]);

    if (error) throw error;

    const profileNames = Object.fromEntries(
      (profiles || []).map(profile => [profile.id, profile.full_name])
    );

    return (data || []).map(row => toLocalInvoice(row, profileNames));
  }

  async function loadInvoiceById(id) {
    const sb = requireClient();

    const [{ data, error }, { data: profiles }] = await Promise.all([
      sb
        .from('invoices')
        .select(INVOICE_SELECT)
        .eq('id', id)
        .maybeSingle(),
      sb
        .from('profiles')
        .select('id, full_name')
    ]);

    if (error) throw error;

    const profileNames = Object.fromEntries(
      (profiles || []).map(profile => [profile.id, profile.full_name])
    );

    return data ? toLocalInvoice(data, profileNames) : null;
  }

  // ----------------------------------------------------------
  // CREATE INVOICE
  // ----------------------------------------------------------

  async function createInvoice(payload = {}) {
    const sb = requireClient();
    const items = (payload.items || []).map(item => ({
      product_id:
        item.product_id ||
        item.productId,

      quantity: Number(
        item.quantity ??
        item.qty ??
        0
      )
    }));

    const branchId =
      payload.branchId ||
      payload.branch_id;

    if (!branchId) {
      throw new Error('A branch must be selected.');
    }

    if (!items.length) {
      throw new Error('Add at least one product.');
    }

    for (const item of items) {
      if (!item.product_id) {
        throw new Error('Every invoice item must have a product.');
      }

      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error('Product quantities must be greater than zero.');
      }
    }

    const { data, error } = await sb.rpc('create_invoice', {
      p_branch_id: branchId,

      p_customer_id:
        payload.customerId ||
        payload.customer_id ||
        null,

      p_items: items,

      p_discount_amount: Number(
        payload.discountAmount ??
        payload.discount ??
        payload.p_discount ??
        0
      ),

      p_tax_amount: Number(
        payload.taxAmount ??
        payload.tax ??
        0
      ),

      p_initial_payment: Number(
        payload.initialPayment ??
        payload.amountPaid ??
        payload.p_amount_paid ??
        0
      ),

      p_payment_method:
        payload.paymentMethod ||
        payload.p_payment_method ||
        null,

      p_payment_reference:
        payload.paymentReference ||
        payload.p_payment_reference ||
        null,

      p_notes:
        payload.notes ||
        payload.p_notes ||
        null
    });

    if (error) throw error;

    return data;
  }

  // Compatibility wrapper for the older Lumoda invoice UI.
  async function createInvoiceNoStock(payload = {}) {
    const data = await createInvoice({
      branchId:
        payload.branchId ||
        payload.branch_id,

      customerId:
        payload.customerId ||
        payload.customer_id,

      items:
        payload.items ||
        payload.p_items ||
        [],

      discountAmount:
        payload.discountAmount ??
        payload.discount ??
        payload.p_discount ??
        0,

      taxAmount:
        payload.taxAmount ??
        payload.tax ??
        0,

      initialPayment:
        payload.initialPayment ??
        payload.amountPaid ??
        payload.p_amount_paid ??
        0,

      clientRef:
        payload.clientRef ||
        payload.client_ref ||
        null,

      paymentMethod:
        payload.paymentMethod ||
        payload.p_payment_method ||
        null,

      paymentReference:
        payload.paymentReference ||
        payload.p_payment_reference ||
        null,

      notes:
        payload.notes ||
        payload.p_notes ||
        null
    });

    return {
      data,
      error: null
    };
  }

  // ----------------------------------------------------------
  // PAYMENTS
  // ----------------------------------------------------------

  async function recordPayment(
    invoiceId,
    amount,
    method,
    reference,
    note
  ) {
    const sb = requireClient();

    const payload = invoiceId && typeof invoiceId === 'object'
      ? invoiceId
      : {
          invoiceId,
          amount,
          paymentMethod: method,
          paymentReference: reference,
          paymentNote: note
        };

    const { data, error } = await sb.rpc('record_payment', {
      p_invoice_id: payload.invoiceId || payload.invoice_id,

      p_amount: Number(payload.amount),

      p_payment_method: payload.paymentMethod || payload.method || null,

      p_payment_reference:
        payload.paymentReference ||
        payload.momoNumber ||
        null,

      p_payment_note: payload.paymentNote || payload.note || null
    });

    if (error) throw error;

    return data;
  }

  // Compatibility wrapper for older invoice UI.
  async function recordPartialPayment(
    invoiceId,
    amount,
    method,
    reference,
    note
  ) {
    const data = await recordPayment(
      invoiceId,
      amount,
      method,
      reference,
      note
    );

    return {
      data,
      error: null
    };
  }

  async function updateInvoiceNoStock() {
    unsupported('Editing existing invoices');
  }

  async function softDeleteInvoiceNoStock() {
    unsupported('Cancelling invoices');
  }

  // ----------------------------------------------------------
  // REPORTS
  // ----------------------------------------------------------

  async function loadOutstandingBalances() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('invoices')
      .select(`
        id,
        invoice_number,
        branch_id,
        customer_id,
        total_amount,
        amount_paid,
        balance_due,
        invoice_date
      `)
      .gt('balance_due', 0)
      .neq('status', 'cancelled')
      .order('invoice_date', { ascending: true });

    if (error) throw error;

    return data || [];
  }

  async function loadSalesBreakdown() {
    unsupported('Product sales breakdown reports');
  }

  // ----------------------------------------------------------
  // STOCK HISTORY
  // ----------------------------------------------------------

  async function loadStockHistory() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('stock_history')
      .select(`
        id,
        branch_id,
        product_id,
        movement_type,
        quantity_change,
        quantity_before,
        quantity_after,
        related_invoice_id,
        reason,
        created_by,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw error;

    return data || [];
  }

  // ----------------------------------------------------------
  // AUDIT LOGS
  // ----------------------------------------------------------

    // ----------------------------------------------------------
  // AUDIT LOGS
  // ----------------------------------------------------------

  async function logAudit(action, details = {}) {
    const sb = requireClient();

    const payload = details && typeof details === 'object'
      ? details
      : { description: String(details || '') };

    const { data, error } = await sb.rpc('mra_log_audit', {
      p_action: String(action || ''),
      p_details: payload,
      p_table_name: payload.table_name || null,
      p_record_id: payload.record_id || null
    });

    if (error) throw error;

    return data;
  }

  async function loadAuditLogs() {
    const sb = requireClient();

    const [{ data, error }, { data: profiles }] = await Promise.all([
      sb
        .from('audit_logs')
        .select('id, user_id, action, table_name, record_id, details, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      sb
        .from('profiles')
        .select('id, full_name')
    ]);

    if (error) throw error;

    const profileNames = Object.fromEntries(
      (profiles || []).map(profile => [profile.id, profile.full_name])
    );

    return (data || []).map(row => ({
      ...row,
      created_by_name: profileNames[row.user_id] || 'system'
    }));
  }

  // ----------------------------------------------------------
  // STAFF ACCOUNTS
  // ----------------------------------------------------------

  async function createStaffAccount(payload = {}) {
    const sb = requireClient();

    const body = {
      email: String(payload.email || '')
        .trim()
        .toLowerCase(),

      fullName: String(
        payload.fullName ||
        payload.full_name ||
        ''
      ).trim(),

      role: payload.role === 'admin' || payload.role === 'warehouse_manager'
        ? payload.role
        : 'staff',
      location: String(payload.location || '').trim(),

      branchIds: Array.from(new Set(
        (payload.branchIds || payload.branch_ids || [])
          .map(value => String(value || '').trim())
          .filter(Boolean)
      ))
    };
    body.branch_ids = body.branchIds;
    body.username = String(
      payload.username ||
      body.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase()
    ).slice(0, 20);

    if (!body.email || !body.fullName) {
      throw new Error('Staff name and email are required.');
    }

    if (!Array.isArray(body.branchIds) || !body.branchIds.length) {
      throw new Error(
        'Assign the staff member to at least one branch.'
      );
    }

    const { data, error } = await sb.functions.invoke(
      'create-staff-account',
      { body }
    );

    if (error) {
      let reason = error.message;

      try {
        const response = await error.context?.json();

        if (response?.error) {
          reason = response.error;
        }
      } catch (_) {}

      throw new Error(reason);
    }

    return data;
  }

  // ----------------------------------------------------------
  // LEGACY FEATURES NOT IMPLEMENTED IN MRA
  // ----------------------------------------------------------

  async function anyAdminExists() {
    // MRA admin account has already been created.
    return true;
  }

  async function createBootstrapAdmin() {
    unsupported('Bootstrap administrator creation');
  }

  async function completePasswordChange() {
    // Ordinary Supabase Auth password changes are handled separately.
    return true;
  }

  async function loadInvoiceEditRequests() {
    const sb = requireClient();

    const { data, error } = await sb
      .from('invoice_edit_requests')
      .select(`
        *,
        profiles:requested_by (full_name, location),
        invoices:invoice_id (number, customer_name)
      `)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function approveInvoiceRequest(id) {
    const { data, error } = await requireClient().rpc(
      'approve_invoice_request',
      { p_request_id: id }
    );
    if (error) throw error;
    return data;
  }

  async function rejectInvoiceRequest(id, reason = null) {
    const { data, error } = await requireClient().rpc(
      'reject_invoice_request',
      { p_request_id: id, p_reason: reason }
    );
    if (error) throw error;
    return data;
  }

  async function linkCatalogItem() {
    unsupported('Warehouse catalog linking');
  }

  async function backfillWarehouseCatalog() {
    unsupported('Warehouse catalog migration');
  }

  async function resolveWarehouseProduct(item = {}) {
    const sb = requireClient();
    const sku = String(item.itemCode || item.sku || '').trim();
    const name = String(item.description || item.itemName || item.name || '').trim();
    let query = sb.from('products').select(
      'id, product_name, sku, selling_price, reorder_level, unit_name'
    ).eq('is_active', true);

    if (sku) query = query.eq('sku', sku);
    else if (name) query = query.ilike('product_name', name);
    else throw new Error('A product SKU or name is required.');

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        `Product not found: ${sku || name}. Add it in Products before recording stock.`
      );
    }
    return data;
  }

  async function postWarehouseMovementDirect(payload = {}) {
    const sb = requireClient();
    const branchId = String(payload.warehouse_id || payload.warehouseId || '').trim();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!branchId) throw new Error('Choose a branch before recording stock.');
    if (!items.length) throw new Error('At least one product is required.');

    const type = String(payload.type || '').trim().toLowerCase();
    const movementType = type === 'opening_balance' ? 'opening_stock' : type;
    if (!['opening_stock', 'stock_in', 'stock_out', 'adjustment', 'transfer'].includes(movementType)) {
      throw new Error('Unsupported warehouse movement type.');
    }

    const destinationId = String(
      payload.to_warehouse_id || payload.toWarehouseId || ''
    ).trim();
    const processed = [];

    for (const item of items) {
      const quantity = Number(item.cartons || item.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Stock quantities must be greater than zero.');
      }

      const product = await resolveWarehouseProduct(item);
      const { data: current, error: currentError } = await sb
        .from('branch_inventory')
        .select('id, quantity')
        .eq('branch_id', branchId)
        .eq('product_id', product.id)
        .maybeSingle();
      if (currentError) throw currentError;

      const before = Number(current?.quantity || 0);
      const delta = movementType === 'stock_out' || movementType === 'transfer'
        ? -quantity
        : quantity;
      const after = before + delta;
      if (after < 0) {
        throw new Error(
          `${product.product_name} has only ${before} available in this branch.`
        );
      }

      const inventoryResult = current
        ? await sb.from('branch_inventory')
          .update({ quantity: after, updated_at: new Date().toISOString() })
          .eq('id', current.id)
          .select('id, quantity')
          .single()
        : await sb.from('branch_inventory')
          .insert({ branch_id: branchId, product_id: product.id, quantity: after })
          .select('id, quantity')
          .single();
      if (inventoryResult.error) throw inventoryResult.error;

      const historyResult = await sb.from('stock_history').insert({
        branch_id: branchId,
        product_id: product.id,
        movement_type: movementType,
        quantity_change: delta,
        quantity_before: before,
        quantity_after: after,
        reason: String(payload.notes || payload.description || 'Warehouse movement').trim() || null
      }).select('id, created_at').single();
      if (historyResult.error) throw historyResult.error;

      if (movementType === 'transfer') {
        if (!destinationId || destinationId === branchId) {
          throw new Error('Choose a different destination branch for a transfer.');
        }
        const { data: destination, error: destinationError } = await sb
          .from('branch_inventory')
          .select('id, quantity')
          .eq('branch_id', destinationId)
          .eq('product_id', product.id)
          .maybeSingle();
        if (destinationError) throw destinationError;
        const destinationBefore = Number(destination?.quantity || 0);
        const destinationAfter = destinationBefore + quantity;
        const destinationResult = destination
          ? await sb.from('branch_inventory')
            .update({ quantity: destinationAfter, updated_at: new Date().toISOString() })
            .eq('id', destination.id)
          : await sb.from('branch_inventory')
            .insert({ branch_id: destinationId, product_id: product.id, quantity: destinationAfter });
        if (destinationResult.error) throw destinationResult.error;
        const destinationHistory = await sb.from('stock_history').insert({
          branch_id: destinationId,
          product_id: product.id,
          movement_type: 'transfer',
          quantity_change: quantity,
          quantity_before: destinationBefore,
          quantity_after: destinationAfter,
          reason: String(payload.notes || 'Warehouse transfer').trim() || null
        });
        if (destinationHistory.error) throw destinationHistory.error;
      }

      processed.push({
        itemCode: product.sku || '',
        description: product.product_name,
        cartons: quantity
      });
    }

    return { success: true, type: movementType, items: processed };
  }

  async function loadWarehouseStockBalance() {
    const sb = requireClient();
    const { data, error } = await sb
      .from('branch_inventory')
      .select(`
        id,
        branch_id,
        product_id,
        quantity,
        updated_at,
        products (
          product_name,
          sku,
          selling_price,
          reorder_level
        )
      `)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      warehouse_id: row.branch_id,
      item_code: row.products?.sku || '',
      item_name: row.products?.product_name || '',
      total_cartons: Number(row.quantity || 0),
      reserved_cartons: 0,
      available_cartons: Number(row.quantity || 0),
      reorder_level: Number(row.products?.reorder_level || 0),
      unit_price: Number(row.products?.selling_price || 0),
      updated_at: row.updated_at
    }));
  }

  async function saveWarehouseStockOut(payload = {}) {
    return postWarehouseMovementDirect({ ...payload, type: 'stock_out' });
  }

  async function saveWarehouseMovement(payload = {}) {
    return postWarehouseMovementDirect(payload);
  }

  async function saveWarehouseProduct(payload = {}) {
    return saveProduct(payload);
  }

  async function deleteWarehouseProduct() {
    unsupported('Separate warehouse products');
  }

  async function saveWarehouseSupplier() {
    unsupported('Warehouse suppliers');
  }

  async function deleteWarehouseSupplier() {
    unsupported('Warehouse suppliers');
  }

  async function loadWarehouseMovements() {
    const sb = requireClient();
    const { data, error } = await sb
      .from('stock_history')
      .select(`
        id, branch_id, product_id, movement_type, quantity_change,
        quantity_before, quantity_after, reason, created_at,
        products (product_name, sku)
      `)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      warehouse_id: row.branch_id,
      type: row.movement_type,
      description: row.products?.product_name || row.products?.sku || 'Product movement',
      cartons: Math.abs(Number(row.quantity_change || 0)),
      notes: row.reason || '',
      items: [{
        itemCode: row.products?.sku || '',
        description: row.products?.product_name || '',
        cartons: Math.abs(Number(row.quantity_change || 0))
      }],
      created_at: row.created_at,
      status: 'executed'
    }));
  }

  async function loadWarehouseProducts() {
    const products = await loadProducts();
    return products.map(product => ({
      id: product.id,
      sku: product.sku || '',
      name: product.product_name || product.name || '',
      reorder_level: Number(product.reorder || product.reorder_level || 0)
    }));
  }

  async function loadWarehouseSuppliers() {
    return [];
  }

  // MRA branches replace the old warehouse concept.
  async function loadWarehouses() {
    const branches = await loadBranches();
    return branches.map(branch => ({
      id: branch.id,
      code: branch.branch_code || '',
      name: branch.branch_name,
      address: branch.address || '',
      active: branch.is_active !== false
    }));
  }

  async function saveWarehouse(payload = {}) {
    const sb = requireClient();
    const code = String(payload.code || '').trim();
    const name = String(payload.name || '').trim();
    if (!code || !name) throw new Error('Warehouse code and name are required.');

    const values = {
      branch_code: code,
      branch_name: name,
      address: String(payload.address || '').trim() || null,
      is_active: payload.active !== false
    };

    const query = payload.id
      ? sb.from('branches').update(values).eq('id', payload.id)
      : sb.from('branches').insert(values);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return {
      id: data.id,
      code: data.branch_code,
      name: data.branch_name,
      address: data.address || '',
      active: data.is_active !== false
    };
  }

  async function deleteWarehouse(id) {
    if (!id) throw new Error('Warehouse ID is required.');
    const { data, error } = await requireClient()
      .from('branches')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function loadWarehouseStaffAssignments(warehouseId = null) {
    let query = requireClient()
      .from('user_branch_access')
      .select('id, user_id, branch_id, profiles:user_id (full_name, email)');
    if (warehouseId) query = query.eq('branch_id', warehouseId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function assignStaffToWarehouse(payload = {}) {
    const userId = payload.userId || payload.user_id;
    const branchId = payload.warehouseId || payload.branch_id;
    if (!userId || !branchId) throw new Error('Staff and warehouse are required.');
    const { data, error } = await requireClient()
      .from('user_branch_access')
      .upsert({ user_id: userId, branch_id: branchId }, {
        onConflict: 'user_id,branch_id',
        ignoreDuplicates: true
      })
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function removeStaffFromWarehouse(payload = {}) {
    const userId = payload.userId || payload.user_id;
    const branchId = payload.warehouseId || payload.branch_id;
    if (!userId || !branchId) throw new Error('Staff and warehouse are required.');
    const { error } = await requireClient()
      .from('user_branch_access')
      .delete()
      .eq('user_id', userId)
      .eq('branch_id', branchId);
    if (error) throw error;
  }

  // ----------------------------------------------------------
  // EXPORT
  // ----------------------------------------------------------

  const api = {
    init,
    getClient,
    isConfigured,

    // Authentication
    getSession,
    getCurrentUser,
    getRawStoredSession,
    clearRawStoredSession,
    getCachedSessionUser,
    cacheSessionUser,
    clearCachedSessionUser,
    getProfile,
    getMyProfile,
    updateMyProfile,
    getProfileByUsername,
    signIn,
    sendPasswordResetEmail,
    signOut,
    recordLogin,

    // Business
    loadBusinessSettings,
    saveBusinessSettings,
    markOnboardingSeen,
    completeStaffTour,
    saveMyDefaultLandingPage,
    uploadLogo,
    saveLogoUrl,

    // Branches
    loadBranches,
    loadUserBranches,
    saveBranch,
    deleteBranch,
    deactivateBranch,
    reactivateBranch,

    // Categories and products
    loadCategories,
    loadProducts,
    saveProduct,
    adjustProductStock,
    importProducts,

    // Customers
    loadCustomers,
    saveCustomer,

    // Invoices and payments
    loadInvoices,
    loadInvoiceById,
    createInvoice,
    createInvoiceNoStock,
    updateInvoiceNoStock,
    softDeleteInvoiceNoStock,
    recordPayment,
    recordPartialPayment,

    // Reports
    loadSalesBreakdown,
    loadOutstandingBalances,

    // Stock history
    loadStockHistory,
    logStockHistory,

    // Audit
    logAudit,
    loadAuditLogs,

    // Staff
    loadProfiles,
    createStaffAccount,
    anyAdminExists,
    createBootstrapAdmin,
    completePasswordChange,

    // Legacy methods retained temporarily
    loadInvoiceEditRequests,
    approveInvoiceRequest,
    rejectInvoiceRequest,
    linkCatalogItem,
    backfillWarehouseCatalog,

    postWarehouseMovementDirect,
    loadWarehouseStockBalance,
    saveWarehouseStockOut,
    saveWarehouseMovement,
    saveWarehouseProduct,
    deleteWarehouseProduct,
    saveWarehouseSupplier,
    deleteWarehouseSupplier,
    loadWarehouseMovements,
    loadWarehouseProducts,
    loadWarehouseSuppliers,
    loadWarehouses,
    saveWarehouse,
    deleteWarehouse,
    loadWarehouseStaffAssignments,
    assignStaffToWarehouse,
    removeStaffFromWarehouse
  };

  window.MRAApi = api;
  window.LumodaSupabase = api;

})();