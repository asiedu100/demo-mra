// ============================================================
// MRA SYSTEMS - CORE.JS
// Adapted from Lumoda Enterprise
// ============================================================

// ---- CONSTANTS ----
const INACTIVITY_MS = 5 * 60 * 1000;
const WARNING_MS = 60 * 1000;

// Offline invoice creation is intentionally not enabled.
// Invoices must be created through the secure Supabase RPC.
const OFFLINE_INVOICES_ENABLED = false;

// ---- LOCAL STORAGE ----
// All physical keys are isolated under mra_.
// The lumoda_ compatibility mapping allows older modules to
// continue using their existing logical key names temporarily.
function mraStorageKey(key) {
  const cleanKey = String(key || '');
  if (cleanKey.startsWith('mra_')) return cleanKey;
  if (cleanKey.startsWith('lumoda_')) {
    return 'mra_' + cleanKey.substring('lumoda_'.length);
  }
  return 'mra_' + cleanKey;
}

const LS = {
  get(key) {
    try {
      const value = localStorage.getItem(mraStorageKey(key));
      return value === null ? null : JSON.parse(value);
    } catch (error) {
      console.warn('Local storage read failed:', key, error);
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(mraStorageKey(key), JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Local storage write failed:', key, error);
      return false;
    }
  },

  del(key) {
    try {
      localStorage.removeItem(mraStorageKey(key));
    } catch (error) {
      console.warn('Local storage removal failed:', key, error);
    }
  }
};

const SS = {
  get(key) {
    try {
      const value = sessionStorage.getItem(mraStorageKey(key));
      return value === null ? null : JSON.parse(value);
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      sessionStorage.setItem(mraStorageKey(key), JSON.stringify(value));
    } catch (error) {
      console.warn('Session storage write failed:', error);
    }
  },

  del(key) {
    try {
      sessionStorage.removeItem(mraStorageKey(key));
    } catch {}
  }
};

// ---- APPLICATION STATE ----
let currentUser = null;

// currentLocation now represents a branch ID, not a branch name.
// "All" is available to administrators when viewing consolidated data.
let currentLocation = 'All';

let editingProductId = null;
let viewingInvoiceId = null;
let editingInvoiceId = null;
let lineItemCount = 0;
let invoiceSaving = false;
let invoiceLastSubmissionSignature = null;
let invoiceClientRef = null;
let editInvoiceSaving = false;
let isOfflineSession = false;
let authGeneration = 0;

let inactivityTimer = null;
let warningTimer = null;
let countdownInterval = null;

let onlineSinceMark = navigator.onLine ? Date.now() : null;

let branches = [];
let LOCATIONS = [];

// Other modules use these shared variables.
// They are retained temporarily for compatibility.
let productSearch = '';
let customerSearchFilter = '';
let cashSalesFilter = '';
let invoiceFilter = { text: '', status: '' };
let balanceSearch = '';
let warehouseMovementFilter = {
  search: '',
  type: 'all',
  status: 'all'
};
let editingWarehouseId = null;
let editingSupplierId = null;
let warehouseTransferItems = [];
let topCustomersSortMode = 'spend';
let reportsInvoicesCache = [];
let reportsSalesCache = [];
let catalogLinkCandidates = [];
let catalogLinkRemainingCount = 0;

// ============================================================
// SUPABASE CLIENT ACCESS
// ============================================================

// supabase-client.js currently retains LumodaSupabase as a
// compatibility name. Prefer MRASupabase when available.
function getSupabaseAPI() {
  return window.MRAApi || window.MRASupabase || window.LumodaSupabase || null;
}

function isSupabaseConfigured() {
  const api = getSupabaseAPI();

  try {
    return !!(
      api &&
      typeof api.isConfigured === 'function' &&
      api.isConfigured()
    );
  } catch {
    return false;
  }
}

// ============================================================
// ONLINE TIME
// ============================================================

function getCumulativeOnlineMs() {
  const base = Number(LS.get('cumulative_online_ms')) || 0;

  return (
    navigator.onLine && onlineSinceMark
      ? base + (Date.now() - onlineSinceMark)
      : base
  );
}

function markOnlineTransition(isOnline) {
  if (isOnline) {
    if (!onlineSinceMark) onlineSinceMark = Date.now();
    return;
  }

  if (onlineSinceMark) {
    const total =
      (Number(LS.get('cumulative_online_ms')) || 0) +
      (Date.now() - onlineSinceMark);

    LS.set('cumulative_online_ms', total);
    onlineSinceMark = null;
  }
}

// ============================================================
// USER / ROLE HELPERS
// ============================================================

// MRA authentication is managed by Supabase Auth.
// This function only normalizes profile data returned by the server.
function normalizeUser(user) {
  if (!user) return null;

  return {
    id: user.id || null,
    fullName:
      user.fullName ||
      user.full_name ||
      user.email ||
      'User',
    email: user.email || '',
    role: user.role === 'admin' ? 'admin' : 'staff',
    active:
      user.active !== undefined
        ? user.active !== false
        : user.is_active !== false,
    branchIds: Array.isArray(user.branchIds)
      ? user.branchIds
      : Array.isArray(user.branch_ids)
        ? user.branch_ids
        : []
  };
}

function isAdmin() {
  return !!currentUser && currentUser.role === 'admin';
}

function isStaff() {
  return !!currentUser && currentUser.role === 'staff';
}

// No local user creation or local password authentication.
function ensureUsers() {
  const users = LS.get('users');
  if (!Array.isArray(users)) LS.set('users', []);
}

function getUsers() {
  return LS.get('users') || [];
}

function getSessions() {
  // Supabase manages authentication sessions.
  return [];
}

// ============================================================
// DATA INITIALIZATION
// ============================================================

// Deliberately does not seed sample products, customers, invoices,
// branches or users. MRA data must come from its own database.
function initData() {
  const defaults = {
    products: [],
    invoices: [],
    customers: [],
    stockhistory: [],
    audit: [],
    users: []
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!Array.isArray(LS.get(key))) {
      LS.set(key, value);
    }
  });
}

// ============================================================
// USER-SCOPED CACHE RESET
// ============================================================

function clearUserScopedState() {
  [
    'invoices',
    'products',
    'customers',
    'stockhistory',
    'audit',
    'users'
  ].forEach(key => LS.del(key));

  currentLocation = 'All';

  editingProductId = null;
  viewingInvoiceId = null;
  editingInvoiceId = null;

  productSearch = '';
  customerSearchFilter = '';
  cashSalesFilter = '';
  invoiceFilter = { text: '', status: '' };
  balanceSearch = '';

  warehouseMovementFilter = {
    search: '',
    type: 'all',
    status: 'all'
  };

  editingWarehouseId = null;
  editingSupplierId = null;
  warehouseTransferItems = [];

  topCustomersSortMode = 'spend';
  reportsInvoicesCache = [];
  reportsSalesCache = [];
  catalogLinkCandidates = [];
  catalogLinkRemainingCount = 0;

  branches = [];
  LOCATIONS = [];
}

// ============================================================
// CACHED DATA ACCESS
// ============================================================

function getInvoices() {
  return (LS.get('invoices') || []).filter(invoice =>
    !invoice.deleted && !invoice.isCashSale
  );
}

function getAllInvoices() {
  return LS.get('invoices') || [];
}

function getCashSales() {
  return (LS.get('invoices') || []).filter(invoice =>
    !invoice.deleted && (
      invoice.isCashSale ||
      !invoice.customer_id
    )
  );
}

function getCustomers() {
  return LS.get('customers') || [];
}

function getProducts() {
  return normalizeProducts(LS.get('products') || []);
}

function getStockHistory() {
  return LS.get('stockhistory') || [];
}

// ============================================================
// BRANCHES
// ============================================================

// Branches are dynamic database records.
// A branch represents a business location/warehouse.
function normalizeBranch(branch) {
  return {
    id: branch.id,
    branchName: branch.branch_name || branch.branchName || '',
    branchCode: branch.branch_code || branch.branchCode || '',
    address: branch.address || '',
    phone: branch.phone || '',
    isActive:
      branch.is_active !== undefined
        ? branch.is_active
        : branch.isActive !== false
  };
}

function setBranches(data) {
  branches = (Array.isArray(data) ? data : [])
    .map(normalizeBranch)
    .filter(branch => branch.id && branch.isActive);

  LOCATIONS = branches.map(branch => branch.branchName);

  renderLocationSelects();
  return branches;
}

function getBranches() {
  return branches;
}

function getBranchById(branchId) {
  return branches.find(branch => branch.id === branchId) || null;
}

function getBranchName(branchId) {
  if (branchId === 'All') return 'All Branches';

  return getBranchById(branchId)?.branchName || 'Unknown Branch';
}

// Fetch branches through the existing Supabase wrapper.
// The wrapper's branch-reading method will be standardized when
// we adapt supabase-client.js and the other modules.
async function loadBranches() {
  const api = getSupabaseAPI();

  if (!api || !isSupabaseConfigured()) {
    console.warn('MRA Supabase is not configured.');
    setBranches([]);
    return [];
  }

  const loader =
    api.getBranches ||
    api.fetchBranches ||
    api.listBranches;

  if (typeof loader !== 'function') {
    console.warn(
      'Branch loading is not available in the current Supabase client. ' +
      'We will add the read method when adapting supabase-client.js.'
    );
    setBranches([]);
    return [];
  }

  try {
    const result = await loader.call(api);

    if (result?.error) throw result.error;

    const rows = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : [];

    return setBranches(rows);
  } catch (error) {
    console.error('Could not load MRA branches:', error);
    toast('Could not load branches.', 'error');
    return [];
  }
}

// ============================================================
// TOAST
// ============================================================

let toastTimer;

function toast(message, type = '') {
  const element = document.getElementById('toast');
  if (!element) return;

  element.textContent = message;
  element.className = 'toast show' + (type ? ' ' + type : '');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.className = 'toast';
  }, 3200);
}

// ============================================================
// AUDIT
// ============================================================

function addAudit(action, detail, options = {}) {
  const log = LS.get('audit') || [];

  log.unshift({
    id: 'audit_' + Date.now(),
    action,
    detail,
    by: currentUser?.id || 'system',
    byName: currentUser?.fullName || 'system',
    createdAt: Date.now(),
    localOnly: options.localOnly === true
  });

  if (log.length > 1000) log.length = 1000;

  LS.set('audit', log);

  const api = getSupabaseAPI();

  if (
    options.sync !== false &&
    isSupabaseConfigured() &&
    currentUser &&
    typeof api.logAudit === 'function'
  ) {
    void api.logAudit(action, detail).catch(error => {
      console.warn('MRA audit write failed:', error);
    });
  }
}

// ============================================================
// NAVIGATION
// ============================================================

const MRA_PAGES = {
  dashboard: 'Dashboard',
  cashsales: 'Cash Sales',
  invoices: 'Invoices',
  customers: 'Customers',
  products: 'Products',
  stockhistory: 'Stock History',
  reports: 'Reports',
  audit: 'Audit Log',
  users: 'User Management',
  settings: 'Settings'
};

function navigate(page, element) {
  if (!MRA_PAGES[page]) {
    toast('This page is not available in MRA Systems.', 'error');
    return;
  }

  const adminOnlyPages = [
    'reports',
    'audit',
    'users'
  ];

  if (adminOnlyPages.includes(page) && !isAdmin()) {
    toast('Access denied.', 'error');
    return;
  }

  document.querySelectorAll('.page').forEach(pageElement => {
    pageElement.classList.remove('active');
  });

  document.querySelectorAll('.nav-item').forEach(navElement => {
    navElement.classList.remove('active');
  });

  const pageElement = document.getElementById('page-' + page);

  if (!pageElement) {
    console.warn('Page element not found:', page);
    return;
  }

  pageElement.classList.add('active');

  if (element) {
    element.classList.add('active');
  } else {
    document
      .querySelector('.nav-item[data-page="' + page + '"]')
      ?.classList.add('active');
  }

  const title = document.getElementById('page-title');

  if (title) title.textContent = MRA_PAGES[page];

  renderPage(page);
  closeSidebar();
}

function renderPage(page) {
  const renderers = {
    dashboard: renderDashboard,
    cashsales: renderCashSales,
    invoices: renderInvoices,
    customers: renderCustomers,
    products: renderProducts,
    stockhistory: renderStockHistory,
    reports: renderReports,
    audit: renderAuditLog,
    users: renderUsers,
    settings: renderSettings
  };

  if (typeof renderers[page] === 'function') {
    renderers[page]();
  }
}

// ============================================================
// BRANCH FILTER
// ============================================================

function switchLocFilter(branchId, element) {
  if (!isAdmin()) return;

  document.querySelectorAll('.loc-tab').forEach(tab => {
    tab.classList.remove('active');
  });

  if (element) element.classList.add('active');

  currentLocation = branchId;
  refreshAll();
}

function renderLocationSelects() {
  const selectIds = [
    'inv-location',
    'cust-location',
    'stock-location',
    'new-user-location'
  ];

  selectIds.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = branches.map(branch =>
      '<option value="' + escAttr(branch.id) + '">' +
        escapeHtml(branch.branchName) +
      '</option>'
    ).join('');

    if (branches.some(branch => branch.id === previousValue)) {
      select.value = previousValue;
    }
  });

  const filter = document.getElementById('loc-filter');
  if (!filter) return;

  const previousBranch = filter.querySelector('.loc-tab.active')
    ?.dataset.branchId || currentLocation;

  let html = '';

  if (isAdmin()) {
    html +=
      '<div class="loc-tab" data-branch-id="All" ' +
      'onclick="switchLocFilter(\'All\',this)">' +
      'All Branches</div>';
  }

  html += branches.map(branch =>
    '<div class="loc-tab" data-branch-id="' +
      escAttr(branch.id) +
      '" onclick="switchLocFilter(\'' +
      escAttr(branch.id) +
      '\',this)">' +
      escapeHtml(branch.branchName) +
    '</div>'
  ).join('');

  filter.innerHTML = html;

  const activeTab = Array.from(
    filter.querySelectorAll('.loc-tab')
  ).find(tab => tab.dataset.branchId === previousBranch);

  if (activeTab) {
    activeTab.classList.add('active');
  } else {
    const firstTab = filter.querySelector('.loc-tab');
    if (firstTab) firstTab.classList.add('active');
  }
}

function refreshAll() {
  const activePage = document.querySelector('.page.active');

  if (activePage) {
    renderPage(activePage.id.replace('page-', ''));
  }
}

// ============================================================
// LIGHT / DARK THEME
// ============================================================

function getThemePreference() {
  // Keep fresh browser origins visually consistent. Users can still choose
  // light or dark mode and that explicit preference is persisted per origin.
  return LS.get('theme') || 'light';
}

function isDarkActive() {
  const explicit = document.documentElement.getAttribute('data-theme');

  if (explicit) return explicit === 'dark';

  return !!(
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  updateThemeToggleIcons();
  applyBrandColor(getBrandColor());
}

function updateThemeToggleIcons() {
  const dark = isDarkActive();

  document.querySelectorAll('.theme-toggle-icon').forEach(element => {
    element.textContent = dark ? '☀️' : '🌙';
  });

  document.querySelectorAll('.theme-toggle-btn').forEach(element => {
    element.setAttribute(
      'aria-label',
      dark ? 'Switch to light mode' : 'Switch to dark mode'
    );
  });
}

function toggleTheme() {
  const next = isDarkActive() ? 'light' : 'dark';

  LS.set('theme', next);
  applyTheme(next);
}

// ============================================================
// BUSINESS SETTINGS
// ============================================================

function getBusinessSettings() {
  return LS.get('business_settings') || null;
}

function cacheBusinessSettings(settings) {
  const cached = getBusinessSettings() || {};
  const merged = { ...cached, ...(settings || {}) };

  if (!merged.brand_color && cached.brand_color) {
    merged.brand_color = cached.brand_color;
  }

  LS.set('business_settings', merged);
  return merged;
}

function getCurrencyCode() {
  return (
    getBusinessSettings()?.currency_code ||
    'GHS'
  );
}

function getCurrencySymbol() {
  const code = getCurrencyCode();

  const symbols = {
    GHS: 'GH₵',
    NGN: '₦',
    USD: '$',
    GBP: '£',
    EUR: '€'
  };

  return symbols[code] || code;
}

function getDefaultReorderLevel() {
  return 10;
}

function getBrandColor() {
  const savedColor = getBusinessSettings()?.brand_color;
  return /^#[0-9a-fA-F]{6}$/.test(savedColor || '')
    ? savedColor
    : '#5C2D0A';
}

function lightenHexForDark(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return '#93C5FD';

  const values = hex.slice(1).match(/.{2}/g)
    .map(value => parseInt(value, 16));

  const mix = value =>
    Math.round(value + (255 - value) * 0.55);

  return '#' + values
    .map(value => mix(value).toString(16).padStart(2, '0'))
    .join('');
}

function applyBrandColor(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;

  document.documentElement.style.setProperty('--brand-brown', hex);

  document.documentElement.style.setProperty(
    '--accent',
    isDarkActive() ? lightenHexForDark(hex) : hex
  );
}

function getLogoUrl() {
  return '../MRA.png?v=2';
}

function applyLogo(url) {
  const logoUrl = url || getLogoUrl();

  [
    ['auth-logo-svg', 'auth-logo-img'],
    ['sidebar-logo-svg', 'sidebar-logo-img']
  ].forEach(([svgId, imageId]) => {
    const svg = document.getElementById(svgId);
    const image = document.getElementById(imageId);

    if (!svg || !image) return;

    if (logoUrl) {
      image.src = logoUrl;
      image.style.width = imageId === 'auth-logo-img' ? '280px' : '112px';
      image.style.height = 'auto';
      image.style.maxWidth = '100%';
      image.style.display = '';
      svg.style.display = 'none';
    } else {
      image.removeAttribute('src');
      image.style.display = 'none';
      svg.style.display = '';
    }
  });
}

const DEFAULT_BUSINESS_NAME = 'MRA SYSTEMS';

function getBusinessName() {
  return (
    getBusinessSettings()?.business_name ||
    DEFAULT_BUSINESS_NAME
  );
}

function isOnboardingComplete() {
  // MRA admin profile and business profile are provisioned separately.
  return true;
}

function applyBusinessName(name) {
  const businessName = name || DEFAULT_BUSINESS_NAME;

  document.title = businessName;

  const authElement = document.getElementById('auth-business-name');
  if (authElement) authElement.textContent = businessName;

  const line1 = document.getElementById('sidebar-business-name-1');
  const line2 = document.getElementById('sidebar-business-name-2');

  if (line1 && line2) {
    line1.textContent = businessName;
    line2.textContent = '';
  }
}

function applyBusinessSettings() {
  const settings = getBusinessSettings();

  applyBusinessName(settings?.business_name);
  applyLogo(settings?.logo_url);
}

// Apply local preferences immediately.
applyTheme(getThemePreference());
applyLogo(getLogoUrl());
applyBusinessName(getBusinessName());

// ============================================================
// FORMAT HELPERS
// ============================================================

function fmtGHS(amount) {
  return (
    getCurrencySymbol() +
    ' ' +
    Number(amount || 0).toLocaleString('en-GH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function fmtDate(value) {
  const timestamp = asTimestamp(value);

  if (!timestamp) return '—';

  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function fmtDateTime(value) {
  const timestamp = asTimestamp(value);

  if (!timestamp) return '—';

  return new Date(timestamp).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function fmtAgo(value) {
  const timestamp = asTimestamp(value);
  if (!timestamp) return '—';

  const difference = Date.now() - timestamp;
  const minutes = Math.floor(difference / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return hours + 'h ago';

  return fmtDate(timestamp);
}

function asTimestamp(value) {
  if (value instanceof Date) return value.getTime();

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);

    if (value.trim() !== '' && Number.isFinite(numeric)) {
      return numeric;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function startOfLocalDay(value = new Date()) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function startOfWeek(value = new Date()) {
  const weekStart = startOfLocalDay(value);
  const mondayOffset = (weekStart.getDay() + 6) % 7;

  weekStart.setDate(weekStart.getDate() - mondayOffset);

  return weekStart;
}

function weekRange(value = new Date()) {
  const start = startOfWeek(value);
  const end = new Date(start);

  end.setDate(end.getDate() + 7);

  return { start, end };
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(value) {
  return escapeHtml(value);
}

// ============================================================
// PRODUCT NORMALIZATION
// ============================================================

// MRA uses one selling price, not retail/wholesale/carton tiers.
// Also maps database field names to the existing frontend names.
function normalizeProduct(product) {
  if (!product) return {};

  const sellingPrice = Number(
    product.selling_price ??
    product.sellingPrice ??
    product.price ??
    0
  );

  return {
    ...product,

    id: product.id,
    name: product.product_name || product.name || '',
    product_name: product.product_name || product.name || '',

    sku: product.sku || '',
    barcode: product.barcode || '',

    category:
      product.category?.category_name ||
      product.category_name ||
      product.category ||
      '',

    category_id: product.category_id || null,

    cost_price: Number(product.cost_price || 0),

    price: sellingPrice,
    selling_price: sellingPrice,
    sellingPrice,

    reorder: Number(
      product.reorder_level ??
      product.reorder ??
      0
    ),

    reorder_level: Number(
      product.reorder_level ??
      product.reorder ??
      0
    ),

    unit_name: product.unit_name || 'unit',

    is_active:
      product.is_active !== undefined
        ? product.is_active
        : true,

    // Branch inventory should be supplied by the data-loading layer.
    // Never invent branch quantities.
    branchStock: product.branchStock || product.branch_stock || {}
  };
}

function normalizeProducts(products) {
  return (products || []).map(normalizeProduct);
}

function productPriceForType(product) {
  return Number(normalizeProduct(product).selling_price || 0);
}

function priceTypeLabel() {
  return 'Selling Price';
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function autoLoginAllowed() {
  // Persistent local auto-login is not used.
  return false;
}

function setAutoLoginAllowed() {
  // Supabase manages session persistence.
}

function sumInvoiceTotal(invoices) {
  return (invoices || []).reduce((sum, invoice) => {
    return sum + Number(
      invoice.total_amount ??
      invoice.total ??
      0
    );
  }, 0);
}

function weekComparisonLabel(currentTotal, previousTotal) {
  const delta = Number(currentTotal || 0) - Number(previousTotal || 0);
  const direction = delta >= 0 ? 'up' : 'down';
  const sign = delta >= 0 ? '+' : '-';

  return (
    '<span class="stat-delta ' +
    direction +
    '">' +
    sign +
    fmtGHS(Math.abs(delta)) +
    ' vs last week</span>'
  );
}

function statusBadge(status) {
  const classes = {
    paid: 'badge-success',
    pending: 'badge-warning',
    partial: 'badge-info',
    cancelled: 'badge-danger'
  };

  const safeStatus = String(status || 'unknown');

  return (
    '<span class="badge ' +
    (classes[safeStatus] || 'badge-neutral') +
    '">' +
    escapeHtml(safeStatus) +
    '</span>'
  );
}

function stockBadge(stock, reorder) {
  const quantity = Number(stock || 0);
  const reorderLevel = Number(reorder || 0);

  if (quantity <= 0) {
    return '<span class="badge badge-danger">Out of Stock</span>';
  }

  if (quantity <= reorderLevel) {
    return '<span class="badge badge-warning">Low Stock</span>';
  }

  return '<span class="badge badge-success">In Stock</span>';
}

// ============================================================
// MODALS
// ============================================================

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// ============================================================
// PASSWORD VISIBILITY
// ============================================================

const EYE_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">' +
  '<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/>' +
  '<circle cx="8" cy="8" r="2"/>' +
  '</svg>';

const EYE_OFF_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">' +
  '<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/>' +
  '<circle cx="8" cy="8" r="2"/>' +
  '<line x1="1.5" y1="1.5" x2="14.5" y2="14.5"/>' +
  '</svg>';

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const showing = input.type === 'password';

  input.type = showing ? 'text' : 'password';

  if (button) {
    button.innerHTML = showing ? EYE_OFF_ICON : EYE_ICON;

    button.setAttribute(
      'aria-label',
      showing ? 'Hide password' : 'Show password'
    );
  }
}

// ============================================================
// MOBILE SIDEBAR
// ============================================================

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}