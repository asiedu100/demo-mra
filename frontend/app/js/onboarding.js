/* ============================================================
   MRA SYSTEMS — ADMIN BUSINESS ONBOARDING
   Uses MRA database tables and secure RPCs.
   ============================================================ */

(function () {
  'use strict';

  const API = () => window.MRAApi || window.LumodaSupabase;
  const DB = () => API().getClient();

  const state = {
    step: 1,
    profile: null,
    branches: [],
    categories: [],
    products: [],
    inventory: [],
    busy: false
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

  function notify(message, type = 'success') {
    if (typeof showToast === 'function') {
      showToast(message, type);
    } else {
      alert(message);
    }
  }

  function createWizard() {
    if (document.getElementById('mra-onboarding-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'mra-onboarding-modal';
    modal.className = 'modal-overlay';

    modal.style.cssText = `
      display:none;
      position:fixed;
      inset:0;
      z-index:99999;
      background:rgba(0,0,0,.65);
      align-items:center;
      justify-content:center;
      padding:16px;
      overflow-y:auto;
    `;

    modal.innerHTML = `
      <div style="
        background:var(--surface,#fff);
        color:var(--text,#222);
        width:100%;
        max-width:760px;
        max-height:94vh;
        overflow-y:auto;
        border-radius:14px;
        box-shadow:0 20px 70px rgba(0,0,0,.25);
      ">
        <div style="padding:22px 24px 16px;border-bottom:1px solid var(--border,#eee)">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--primary,#2563eb)">
            MRA SYSTEMS
          </div>
          <h2 style="margin:8px 0 5px;font-size:21px">Set up your business</h2>
          <div id="mra-onboarding-subtitle" style="font-size:13px;color:var(--gray-500,#777)">
            Let's get your business ready.
          </div>
          <div id="mra-onboarding-progress" style="
            display:flex;gap:5px;margin-top:18px
          "></div>
        </div>

        <div id="mra-onboarding-content" style="padding:24px"></div>

        <div style="
          padding:16px 24px;
          border-top:1px solid var(--border,#eee);
          display:flex;
          justify-content:space-between;
          gap:12px;
          align-items:center;
        ">
          <button class="btn btn-secondary" id="mra-onboarding-back"
            onclick="MRAOnboarding.back()">Back</button>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary" id="mra-onboarding-skip"
              onclick="MRAOnboarding.skip()">Skip</button>
            <button class="btn btn-primary" id="mra-onboarding-next"
              onclick="MRAOnboarding.next()">Continue</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function setBusy(value) {
    state.busy = value;

    ['mra-onboarding-back', 'mra-onboarding-skip', 'mra-onboarding-next']
      .forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = value;
      });

    const next = document.getElementById('mra-onboarding-next');
    if (next) next.textContent = value ? 'Please wait…' : (
      state.step === 7 ? 'Finish setup' : 'Continue'
    );
  }

  async function loadData() {
    const [businessResult, branches, categories, products] = await Promise.all([
      DB().from('business_profile').select('*').limit(1).maybeSingle(),
      API().loadBranches(),
      API().loadCategories(),
      API().loadProducts()
    ]);

    if (businessResult.error) throw businessResult.error;

    state.profile = businessResult.data || {};
    state.branches = branches || [];
    state.categories = categories || [];
    state.products = products || [];

    const { data, error } = await DB()
      .from('branch_inventory')
      .select('branch_id,product_id,quantity');

    if (error) throw error;

    state.inventory = data || [];
  }

  async function saveProgress(step) {
    const { error } = await DB().rpc('mra_save_onboarding_progress', {
      p_step: step
    });

    if (error) throw error;
  }

  function progressBar() {
    const container = document.getElementById('mra-onboarding-progress');

    container.innerHTML = Array.from({ length: 7 }, (_, index) => `
      <div style="
        flex:1;height:5px;border-radius:5px;
        background:${index + 1 <= state.step
          ? 'var(--primary,#2563eb)'
          : 'var(--border,#ddd)'};
      "></div>
    `).join('');
  }

  function field(label, id, value = '', type = 'text', placeholder = '') {
    return `
      <div class="form-group">
        <label class="form-label" for="${id}">${label}</label>
        <input class="form-input" id="${id}" type="${type}"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}">
      </div>
    `;
  }

  function selectField(label, id, options, selected = '') {
    return `
      <div class="form-group">
        <label class="form-label" for="${id}">${label}</label>
        <select class="form-input" id="${id}">
          ${options.map(option => `
            <option value="${escapeHtml(option.value)}"
              ${option.value === selected ? 'selected' : ''}>
              ${escapeHtml(option.label)}
            </option>
          `).join('')}
        </select>
      </div>
    `;
  }

  function render() {
    createWizard();

    const content = document.getElementById('mra-onboarding-content');
    const subtitle = document.getElementById('mra-onboarding-subtitle');
    const back = document.getElementById('mra-onboarding-back');
    const skip = document.getElementById('mra-onboarding-skip');
    const next = document.getElementById('mra-onboarding-next');

    progressBar();

    back.style.display = state.step === 1 ? 'none' : '';
    skip.style.display = [3, 4, 5, 6].includes(state.step) ? '' : 'none';
    next.textContent = state.step === 7 ? 'Finish setup' : 'Continue';

    const titles = {
      1: 'Business details',
      2: 'Branches',
      3: 'Product categories',
      4: 'Products',
      5: 'Opening stock',
      6: 'Staff accounts',
      7: 'You are almost ready'
    };

    subtitle.textContent = `Step ${state.step} of 7 — ${titles[state.step]}`;

    if (state.step === 1) renderBusiness(content);
    if (state.step === 2) renderBranches(content);
    if (state.step === 3) renderCategories(content);
    if (state.step === 4) renderProducts(content);
    if (state.step === 5) renderOpeningStock(content);
    if (state.step === 6) renderStaff(content);
    if (state.step === 7) renderFinish(content);
  }

  function renderBusiness(content) {
    const p = state.profile || {};

    content.innerHTML = `
      <h3>Tell us about your business</h3>
      <p style="color:var(--gray-500,#777);font-size:13px">
        These details will be used across your invoices and business records.
      </p>

      ${field('Business name *', 'mra-business-name', p.business_name || '')}

      ${selectField('Business type', 'mra-business-type', [
        { value: 'retail', label: 'Retail' },
        { value: 'wholesale', label: 'Wholesale' },
        { value: 'retail_wholesale', label: 'Retail and wholesale' },
        { value: 'distribution', label: 'Distribution' },
        { value: 'other', label: 'Other' }
      ], p.business_type || 'retail')}

      <div class="form-grid">
        ${field('Phone number', 'mra-business-phone', p.phone || '', 'tel')}
        ${field('Business email', 'mra-business-email', p.email || '', 'email')}
      </div>

      ${field('Business address', 'mra-business-address', p.address || '')}

      ${selectField('Currency', 'mra-business-currency', [
        { value: 'GHS', label: 'GHS — Ghana Cedi' },
        { value: 'NGN', label: 'NGN — Nigerian Naira' },
        { value: 'USD', label: 'USD — US Dollar' },
        { value: 'GBP', label: 'GBP — British Pound' },
        { value: 'EUR', label: 'EUR — Euro' }
      ], p.currency_code || 'GHS')}
    `;
  }

  function renderBranches(content) {
    content.innerHTML = `
      <h3>Set up your branches</h3>
      <p style="font-size:13px;color:var(--gray-500,#777)">
        A branch represents a business location or warehouse.
        Your existing branches are listed below.
      </p>

      <div style="margin:16px 0">
        ${state.branches.length ? state.branches.map(branch => `
          <div style="padding:12px;border:1px solid var(--border,#ddd);border-radius:8px;margin-bottom:8px">
            <strong>${escapeHtml(branch.branch_name)}</strong>
            <div style="font-size:12px;color:var(--gray-500,#777)">
              ${escapeHtml(branch.branch_code || 'No branch code')}
              · ${branch.is_active ? 'Active' : 'Inactive'}
            </div>
          </div>
        `).join('') : '<p>No branches have been created yet.</p>'}
      </div>

      <h4 style="margin-top:22px">Add another branch</h4>
      ${field('Branch name *', 'mra-branch-name', '', 'text', 'e.g. Kumasi Central')}
      <div class="form-grid">
        ${field('Branch code', 'mra-branch-code')}
        ${field('Phone number', 'mra-branch-phone', '', 'tel')}
      </div>
      ${field('Address', 'mra-branch-address')}
      <button class="btn btn-secondary" onclick="MRAOnboarding.addBranch()">
        + Add branch
      </button>
    `;
  }

  function renderCategories(content) {
    content.innerHTML = `
      <h3>Product categories</h3>
      <p style="font-size:13px;color:var(--gray-500,#777)">
        Categories help organise your products. You can add more later.
      </p>

      <div style="margin:16px 0">
        ${state.categories.length ? state.categories.map(category => `
          <span style="
            display:inline-block;padding:7px 11px;margin:4px;
            border:1px solid var(--border,#ddd);border-radius:20px;font-size:13px
          ">${escapeHtml(category.category_name)}</span>
        `).join('') : '<p>No categories created yet.</p>'}
      </div>

      ${field('New category name', 'mra-category-name', '', 'text', 'e.g. Electronics')}
      <button class="btn btn-secondary" onclick="MRAOnboarding.addCategory()">
        + Add category
      </button>
    `;
  }

  function renderProducts(content) {
    content.innerHTML = `
      <h3>Add your products</h3>
      <p style="font-size:13px;color:var(--gray-500,#777)">
        Your existing products are preserved. Add products here or skip and add them later.
      </p>

      <div style="margin:14px 0;padding:12px;background:var(--bg,#f5f5f5);border-radius:8px">
        <strong>${state.products.length}</strong> product(s) currently in your database.
      </div>

      <div style="max-height:180px;overflow:auto;margin-bottom:20px">
        ${state.products.slice(0, 30).map(product => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border,#eee);font-size:13px">
            ${escapeHtml(product.name)}
            <span style="color:var(--gray-500,#777)">
              · ${escapeHtml(product.sku || 'No SKU')}
            </span>
          </div>
        `).join('')}
      </div>

      <h4>Add a product</h4>
      ${field('Product name *', 'mra-product-name')}
      <div class="form-grid">
        ${field('SKU', 'mra-product-sku')}
        ${field('Barcode', 'mra-product-barcode')}
      </div>

      <div class="form-grid">
        ${field('Cost price', 'mra-product-cost', '0', 'number')}
        ${field('Selling price', 'mra-product-selling', '0', 'number')}
      </div>

      <div class="form-grid">
        ${selectField('Category', 'mra-product-category', [
          { value: '', label: 'Uncategorised' },
          ...state.categories.map(category => ({
            value: category.id,
            label: category.category_name
          }))
        ])}
        ${field('Unit', 'mra-product-unit', 'piece')}
      </div>

      ${field('Reorder level', 'mra-product-reorder', '0', 'number')}

      <button class="btn btn-secondary" onclick="MRAOnboarding.addProduct()">
        + Save product
      </button>
    `;
  }

  function renderOpeningStock(content) {
    const activeBranches = state.branches.filter(branch => branch.is_active);

    const rows = [];

    activeBranches.forEach(branch => {
      state.products.forEach(product => {
        const inventory = state.inventory.find(item =>
          item.branch_id === branch.id && item.product_id === product.id
        );

        const quantity = Number(inventory?.quantity || 0);

        if (quantity === 0) {
          rows.push({ branch, product });
        }
      });
    });

    content.innerHTML = `
      <h3>Record opening stock</h3>
      <p style="font-size:13px;color:var(--gray-500,#777)">
        Enter the quantities currently available at each branch.
        Leave quantities at zero if you do not want to record them now.
      </p>

      ${rows.length ? `
        <div style="max-height:430px;overflow:auto">
          ${rows.map(item => `
            <div style="
              display:grid;grid-template-columns:1fr 1fr 110px;
              gap:10px;align-items:center;padding:10px 0;
              border-bottom:1px solid var(--border,#eee)
            ">
              <div style="font-size:13px">
                <strong>${escapeHtml(item.product.name)}</strong>
                <div style="color:var(--gray-500,#777);font-size:11px">
                  ${escapeHtml(item.branch.branch_name)}
                </div>
              </div>
              <div style="font-size:12px;color:var(--gray-500,#777)">
                ${escapeHtml(item.product.sku || '')}
              </div>
              <input class="form-input mra-opening-quantity"
                type="number" min="0" step="any" value="0"
                data-branch="${item.branch.id}"
                data-product="${item.product.id}"
                aria-label="Opening quantity">
            </div>
          `).join('')}
        </div>
      ` : `
        <div style="padding:18px;background:var(--bg,#f5f5f5);border-radius:8px">
          There are no zero-stock product records to initialise.
          You can manage stock from the dashboard later.
        </div>
      `}
    `;
  }

  function renderStaff(content) {
    const branches = state.branches.filter(branch => branch.is_active);

    content.innerHTML = `
      <h3>Add staff accounts</h3>
      <p style="font-size:13px;color:var(--gray-500,#777)">
        This step is optional. Staff can be added later from the administration area.
      </p>

      ${field('Staff full name', 'mra-staff-name')}
      ${field('Staff email', 'mra-staff-email', '', 'email')}

      <div class="form-group">
        <label class="form-label">Assign branch access *</label>
        ${branches.map(branch => `
          <label style="display:block;margin:9px 0;font-size:13px">
            <input type="checkbox" class="mra-staff-branch"
              value="${branch.id}">
            ${escapeHtml(branch.branch_name)}
          </label>
        `).join('')}
      </div>

      <button class="btn btn-secondary" onclick="MRAOnboarding.addStaff()">
        + Create staff account
      </button>
    `;
  }

  function renderFinish(content) {
    content.innerHTML = `
      <div style="text-align:center;padding:18px 0">
        <div style="font-size:42px;margin-bottom:12px">✓</div>
        <h2>Business setup is ready</h2>
        <p style="color:var(--gray-500,#777);font-size:14px;max-width:450px;margin:12px auto">
          Review your setup, then finish to open your MRA Systems dashboard.
          You can continue managing products, branches, stock and staff afterwards.
        </p>

        <div style="
          margin:22px auto;max-width:400px;text-align:left;
          border:1px solid var(--border,#ddd);border-radius:10px;padding:16px
        ">
          <div style="padding:7px 0">Business: <strong>${escapeHtml(state.profile.business_name || 'Not set')}</strong></div>
          <div style="padding:7px 0">Active branches: <strong>${state.branches.filter(b => b.is_active).length}</strong></div>
          <div style="padding:7px 0">Categories: <strong>${state.categories.length}</strong></div>
          <div style="padding:7px 0">Products: <strong>${state.products.length}</strong></div>
        </div>
      </div>
    `;
  }

  async function addBranch() {
    if (state.busy) return;

    const name = document.getElementById('mra-branch-name').value.trim();

    if (!name) {
      notify('Enter a branch name.', 'error');
      return;
    }

    setBusy(true);

    try {
      const { error } = await DB().rpc('mra_create_branch', {
        p_branch_name: name,
        p_branch_code: document.getElementById('mra-branch-code').value.trim() || null,
        p_address: document.getElementById('mra-branch-address').value.trim() || null,
        p_phone: document.getElementById('mra-branch-phone').value.trim() || null
      });

      if (error) throw error;

      await loadData();
      render();
      notify('Branch created successfully.');
    } catch (error) {
      console.error('MRA branch creation failed:', error);
      notify(error.message || 'Could not create branch.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    if (state.busy) return;

    const name = document.getElementById('mra-category-name').value.trim();

    if (!name) {
      notify('Enter a category name.', 'error');
      return;
    }

    setBusy(true);

    try {
      const existing = state.categories.find(category =>
        category.category_name.toLowerCase() === name.toLowerCase()
      );

      if (existing) {
        notify('That category already exists.', 'error');
        return;
      }

      const { error } = await DB()
        .from('product_categories')
        .insert({ category_name: name })
        .select()
        .single();

      if (error) throw error;

      await loadData();
      render();
      notify('Category added.');
    } catch (error) {
      console.error('MRA category creation failed:', error);
      notify(error.message || 'Could not add category.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addProduct() {
    if (state.busy) return;

    const name = document.getElementById('mra-product-name').value.trim();

    if (!name) {
      notify('Enter a product name.', 'error');
      return;
    }

    const cost = Number(document.getElementById('mra-product-cost').value || 0);
    const selling = Number(document.getElementById('mra-product-selling').value || 0);
    const reorder = Number(document.getElementById('mra-product-reorder').value || 0);

    if ([cost, selling, reorder].some(value => !Number.isFinite(value) || value < 0)) {
      notify('Prices and reorder level must be valid non-negative numbers.', 'error');
      return;
    }

    setBusy(true);

    try {
      await API().saveProduct({
        productName: name,
        sku: document.getElementById('mra-product-sku').value.trim(),
        barcode: document.getElementById('mra-product-barcode').value.trim(),
        categoryId: document.getElementById('mra-product-category').value || null,
        costPrice: cost,
        sellingPrice: selling,
        reorderLevel: reorder,
        unitName: document.getElementById('mra-product-unit').value.trim() || 'piece'
      });

      await loadData();
      render();
      notify('Product saved successfully.');
    } catch (error) {
      console.error('MRA product creation failed:', error);
      notify(error.message || 'Could not save product.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveOpeningStock() {
    const inputs = document.querySelectorAll('.mra-opening-quantity');

    for (const input of inputs) {
      const quantity = Number(input.value || 0);

      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error('Opening stock quantities must be valid non-negative numbers.');
      }

      if (quantity === 0) continue;

      const { error } = await DB().rpc('mra_record_opening_stock', {
        p_branch_id: input.dataset.branch,
        p_product_id: input.dataset.product,
        p_quantity: quantity,
        p_reason: 'Initial opening stock'
      });

      if (error) throw error;
    }

    await loadData();
  }

  async function addStaff() {
    if (state.busy) return;

    const fullName = document.getElementById('mra-staff-name').value.trim();
    const email = document.getElementById('mra-staff-email').value.trim();

    const branchIds = Array.from(
      document.querySelectorAll('.mra-staff-branch:checked')
    ).map(input => String(input.value || '').trim()).filter(Boolean);

    if (!fullName || !email) {
      notify('Enter the staff member’s name and email.', 'error');
      return;
    }

    if (!branchIds.length) {
      notify('Assign the staff member to at least one branch.', 'error');
      return;
    }

    setBusy(true);

    try {
      await API().createStaffAccount({
        fullName,
        email,
        branchIds,
        branch_ids: branchIds
      });
      document.getElementById('mra-staff-name').value = '';
      document.getElementById('mra-staff-email').value = '';
      document.querySelectorAll('.mra-staff-branch:checked')
        .forEach(input => input.checked = false);

      notify('Staff account created.');
    } catch (error) {
      console.error('MRA staff creation failed:', error);
      notify(error.message || 'Could not create staff account.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function validateCurrentStep() {
    if (state.step === 1) {
      const businessName = document.getElementById('mra-business-name').value.trim();

      if (!businessName) throw new Error('Business name is required.');

      await API().saveBusinessSettings({
        businessName,
        businessType: document.getElementById('mra-business-type').value,
        phone: document.getElementById('mra-business-phone').value.trim(),
        email: document.getElementById('mra-business-email').value.trim(),
        address: document.getElementById('mra-business-address').value.trim(),
        currencyCode: document.getElementById('mra-business-currency').value
      });

      await loadData();
    }

    if (state.step === 2) {
      await loadData();

      if (!state.branches.some(branch => branch.is_active)) {
        throw new Error('Create at least one active branch before continuing.');
      }
    }

    if (state.step === 5) {
      await saveOpeningStock();
    }
  }

  async function next() {
    if (state.busy) return;

    setBusy(true);

    try {
      if (state.step === 7) {
        const { error } = await DB().rpc('mra_complete_onboarding');

        if (error) throw error;

        document.getElementById('mra-onboarding-modal').style.display = 'none';
        notify('Your MRA Systems business setup is complete.');
        return;
      }

      await validateCurrentStep();

      const nextStep = Math.min(7, state.step + 1);

      await saveProgress(nextStep);

      state.step = nextStep;
      await loadData();
      render();
    } catch (error) {
      console.error('MRA onboarding error:', error);
      notify(error.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (state.busy) return;

    if (![3, 4, 5, 6].includes(state.step)) return;

    setBusy(true);

    try {
      const nextStep = Math.min(7, state.step + 1);
      await saveProgress(nextStep);
      state.step = nextStep;
      await loadData();
      render();
    } catch (error) {
      console.error('MRA onboarding skip failed:', error);
      notify(error.message || 'Could not continue.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    if (state.busy || state.step <= 1) return;

    setBusy(true);

    try {
      state.step -= 1;
      await saveProgress(state.step);
      await loadData();
      render();
    } catch (error) {
      notify(error.message || 'Could not go back.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function maybeShowOnboarding() {
    try {
      // Reuse the authenticated profile already loaded by auth.js.
      // Avoid another auth.getUser() request during onboarding.
      const session = window.getCurrentSession();
      const user = session?.user;

      if (!user || user.role !== 'admin' || user.active === false) {
        return;
      }

      const { data, error } = await DB().rpc('mra_get_onboarding_state');

      if (error) throw error;

      if (data?.is_complete) return;

      state.step = Math.min(7, Math.max(1, Number(data?.current_step || 1)));

      await loadData();
      createWizard();
      render();

      document.getElementById('mra-onboarding-modal').style.display = 'flex';
    } catch (error) {
      console.error('Could not initialise MRA onboarding:', error);
    }
  }

  window.MRAOnboarding = {
    maybeShowOnboarding,
    addBranch,
    addCategory,
    addProduct,
    addStaff,
    next,
    skip,
    back
  };
})();
