// ============================================================
// MRA SYSTEMS — INVOICES
// Uses the MRA Supabase database as the source of truth.
// Financial transactions must go through secure database RPCs.
// ============================================================


window._invoiceMode = 'invoice';
window._selectedPayMethod = '';
window._invoicePriceType = 'standard';

// ------------------------------------------------------------
// SHARED HELPERS
// ------------------------------------------------------------

function invoiceAPI() {
  return window.MRAApi || window.MRASupabase || window.LumodaSupabase || null;
}

function invoiceEscape(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function invoiceMoney(value) {
  const amount = Number(value || 0);
  return typeof fmtGHS === 'function'
    ? fmtGHS(amount)
    : 'GH₵ ' + amount.toFixed(2);
}

function invoiceValue(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return null;
}

function invoiceId(inv) {
  return invoiceValue(inv, 'id');
}

function invoiceNumber(inv) {
  return invoiceValue(inv, 'number', 'invoice_number') || '—';
}

function invoiceCustomerName(inv) {
  return invoiceValue(inv, 'customerName', 'customer_name') || 'Walk-in Customer';
}

function invoiceBranchId(inv) {
  return invoiceValue(inv, 'branch_id', 'branchId');
}

function invoiceBranchName(inv) {
  const branchId = invoiceBranchId(inv);
  const branch = typeof getBranchById === 'function'
    ? getBranchById(branchId)
    : null;

  return branch
    ? branch.branch_name || branch.branchName || branch.name
    : invoiceValue(inv, 'branch_name', 'branchName', 'location') || 'Unknown branch';
}

function invoiceTotal(inv) {
  return Number(invoiceValue(inv, 'total', 'total_amount') || 0);
}

function invoiceSubtotal(inv) {
  return Number(invoiceValue(inv, 'subtotal') ?? invoiceTotal(inv));
}

function invoiceDiscount(inv) {
  return Number(invoiceValue(inv, 'discount', 'discount_amount') || 0);
}

function invoicePaid(inv) {
  return Number(invoiceValue(inv, 'amountPaid', 'amount_paid') || 0);
}

function invoiceBalance(inv) {
  const supplied = invoiceValue(inv, 'balanceDue', 'balance_due');
  return supplied !== null
    ? Number(supplied)
    : Math.max(0, invoiceTotal(inv) - invoicePaid(inv));
}

function invoiceStatus(inv) {
  return String(invoiceValue(inv, 'status') || 'pending').toLowerCase();
}

function invoiceDate(inv) {
  return invoiceValue(inv, 'createdAt', 'created_at', 'invoice_date', 'invoiceDate');
}

function invoiceItems(inv) {
  const items = invoiceValue(inv, 'items', 'invoice_items');
  if (!Array.isArray(items)) return [];

  return items.map(item => {
    const quantity = Number(invoiceValue(item, 'qty', 'quantity') || 0);
    const price = Number(invoiceValue(item, 'price', 'unit_price') || 0);

    return {
      id: item.id,
      productId: invoiceValue(item, 'product_id', 'productId'),
      name: invoiceValue(item, 'name', 'product_name', 'productName') || 'Product',
      sku: item.sku || '',
      qty: quantity,
      price,
      total: Number(invoiceValue(item, 'total', 'line_total') ?? quantity * price)
    };
  });
}

function invoicePayments(inv) {
  const payments = invoiceValue(inv, 'payments', 'invoice_payments');
  return Array.isArray(payments) ? payments : [];
}

function getInvoiceById(id) {
  const invoices = typeof getAllInvoices === 'function'
    ? uniqueInvoices(getAllInvoices())
    : getInvoices();

  return invoices.find(inv => String(invoiceId(inv)) === String(id));
}

function uniqueInvoices(invoices) {
  const seen = new Set();

  return (invoices || []).filter(invoice => {
    const id = invoiceId(invoice);
    if (!id) return true;

    const key = String(id);
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function invoiceCanBeViewed(inv) {
  if (!inv) return false;
  if (typeof canEditInvoice === 'function') return canEditInvoice(inv);

  if (typeof isAdmin === 'function' && isAdmin()) return true;

  const branchIds = currentUser?.branchIds || [];
  return branchIds.includes(invoiceBranchId(inv));
}

function invoiceToast(message, type) {
  if (typeof toast === 'function') toast(message, type);
  else alert(message);
}

function invoiceRefresh() {
  if (typeof syncSupabaseCache === 'function') {
    return syncSupabaseCache();
  }
  return Promise.resolve();
}

// ------------------------------------------------------------
// PRODUCT DATALISTS
// ------------------------------------------------------------

function refreshAllLineItemDataLists() {
  const products = typeof getProducts === 'function' ? getProducts() : [];

  const opts = products
    .filter(p => p.is_active !== false && p.isActive !== false)
    .map(p => {
      const name = p.product_name || p.name || '';
      return '<option value="' + invoiceEscape(name) + '">';
    })
    .join('');

  document.querySelectorAll(
    '#line-items-body .line-item-row datalist, #edit-items-container .line-item-row datalist'
  ).forEach(list => {
    list.innerHTML = opts;
  });

  const globalList = document.getElementById('product-list');
  if (globalList) globalList.innerHTML = opts;
}

// ------------------------------------------------------------
// INVOICE LIST
// ------------------------------------------------------------

function renderInvoices() {
  let invoices = typeof getInvoices === 'function'
    ? uniqueInvoices(getInvoices()).slice()
    : [];

  if (typeof filterByLoc === 'function') {
    invoices = filterByLoc(invoices);
  }

  if (!isAdmin()) {
    invoices = invoices.filter(inv =>
      invoiceValue(inv, 'createdBy', 'created_by') === currentUser?.id
    );
  }

  if (invoiceFilter.text) {
    const query = invoiceFilter.text.toLowerCase();

    invoices = invoices.filter(inv =>
      invoiceCustomerName(inv).toLowerCase().includes(query) ||
      String(invoiceNumber(inv)).toLowerCase().includes(query)
    );
  }

  if (invoiceFilter.status) {
    invoices = invoices.filter(inv => invoiceStatus(inv) === invoiceFilter.status);
  }

  invoices.sort((a, b) =>
    new Date(invoiceDate(b) || 0) - new Date(invoiceDate(a) || 0)
  );

  const tbody = document.getElementById('invoices-body');
  if (!tbody) return;

  tbody.innerHTML = invoices.length
    ? invoices.map(inv => {
        const id = invoiceId(inv);
        const items = invoiceItems(inv);

        return `
          <tr>
            <td class="mono" style="cursor:pointer" onclick="viewInvoice('${invoiceEscape(id)}')">
              ${invoiceEscape(invoiceNumber(inv))}
            </td>
            <td class="mono">${typeof fmtDate === 'function' ? fmtDate(invoiceDate(inv)) : ''}</td>
            <td>${invoiceEscape(invoiceCustomerName(inv))}</td>
            <td><span class="badge badge-neutral">${invoiceEscape(invoiceBranchName(inv))}</span></td>
            <td>${items.length} item${items.length === 1 ? '' : 's'}</td>
            <td class="mono">${invoiceMoney(invoiceTotal(inv))}</td>
            <td>${typeof statusBadge === 'function' ? statusBadge(invoiceStatus(inv)) : invoiceEscape(invoiceStatus(inv))}</td>
            <td>${invoiceEscape(invoicePayments(inv)[0]?.method || invoicePayments(inv)[0]?.payment_method || '—')}</td>
            <td>${invoiceEscape(invoiceValue(inv, 'createdByName', 'created_by_name') || '—')}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="viewInvoice('${invoiceEscape(id)}')">View</button></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--gray-400)">No invoices found</td></tr>';
}

function filterInvoices(value) {
  invoiceFilter.text = value || '';
  renderInvoices();
}

function filterInvoiceStatus(value) {
  invoiceFilter.status = value || '';
  renderInvoices();
}

// ------------------------------------------------------------
// CASH SALES
// Walk-in sales are invoices with no customer_id.
// ------------------------------------------------------------

function getMraCashSales() {
  const invoices = typeof getCashSales === 'function'
    ? uniqueInvoices(getCashSales())
    : [];

  return invoices.filter(inv =>
    !invoiceValue(inv, 'customer_id', 'customerId')
  );
}

function filterCashSales(value) {
  cashSalesFilter = value || '';
  renderCashSales();
}

function renderCashSales() {
  let sales = getMraCashSales();

  if (typeof filterByLoc === 'function') {
    sales = filterByLoc(sales);
  }

  if (!isAdmin()) {
    sales = sales.filter(inv =>
      invoiceValue(inv, 'createdBy', 'created_by') === currentUser?.id
    );
  }

  if (cashSalesFilter) {
    const query = cashSalesFilter.toLowerCase();

    sales = sales.filter(inv =>
      invoiceCustomerName(inv).toLowerCase().includes(query) ||
      String(invoiceNumber(inv)).toLowerCase().includes(query)
    );
  }

  sales.sort((a, b) =>
    new Date(invoiceDate(b) || 0) - new Date(invoiceDate(a) || 0)
  );

  const tbody = document.getElementById('cashsales-body');
  if (!tbody) return;

  tbody.innerHTML = sales.length
    ? sales.map(inv => `
        <tr>
          <td class="mono" style="cursor:pointer" onclick="viewInvoice('${invoiceEscape(invoiceId(inv))}')">
            ${invoiceEscape(invoiceNumber(inv))}
          </td>
          <td class="mono">${typeof fmtDate === 'function' ? fmtDate(invoiceDate(inv)) : ''}</td>
          <td><span class="badge badge-neutral">${invoiceEscape(invoiceBranchName(inv))}</span></td>
          <td>${invoiceItems(inv).length} items</td>
          <td class="mono">${invoiceMoney(invoiceTotal(inv))}</td>
          <td>${invoiceEscape(invoiceValue(inv, 'createdByName', 'created_by_name') || '—')}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="viewInvoice('${invoiceEscape(invoiceId(inv))}')">View</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--gray-400)">No cash sales found</td></tr>';
}

// ------------------------------------------------------------
// NEW INVOICE / CASH SALE MODAL
// ------------------------------------------------------------

function openInvoiceModal(mode) {
  mode = mode === 'cash' ? 'cash' : 'invoice';
  window._invoiceMode = mode;
  invoiceLastSubmissionSignature = null;
  invoiceClientRef = null;

  lineItemCount = 0;

  const body = document.getElementById('line-items-body');
  if (body) body.innerHTML = '';

  [
    'inv-cust-name',
    'inv-cust-phone',
    'inv-cust-addr',
    'inv-notes',
    'inv-momo-number',
    'inv-cash-tendered'
  ].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });

  const discount = document.getElementById('inv-discount');
  if (discount) discount.value = '0';

  const status = document.getElementById('inv-status');
  if (status) status.value = mode === 'cash' ? 'paid' : 'pending';

  const branchSelect = document.getElementById('inv-location');

  if (branchSelect) {
    const branches = typeof getBranches === 'function' ? getBranches() : [];

    branchSelect.innerHTML = branches.map(branch => {
      const id = branch.id;
      const name = branch.branch_name || branch.branchName || branch.name;
      return `<option value="${invoiceEscape(id)}">${invoiceEscape(name)}</option>`;
    }).join('');

    const availableIds = currentUser?.branchIds || [];
    const firstAllowed = branches.find(branch =>
      isAdmin() || availableIds.includes(branch.id)
    );

    if (firstAllowed) branchSelect.value = firstAllowed.id;

    branchSelect.disabled = !isAdmin();
  }

  const title = document.getElementById('invoice-modal-title');
  const submit = document.getElementById('invoice-submit-btn');

  const namePhone = document.getElementById('inv-fg-name-phone');
  const address = document.getElementById('inv-fg-address');
  const statusField = document.getElementById('inv-fg-status');
  const tenderedField = document.getElementById('inv-fg-tendered');

  if (mode === 'cash') {
    if (namePhone) namePhone.style.display = 'none';
    if (address) address.style.display = 'none';
    if (statusField) statusField.style.display = 'none';
    if (tenderedField) tenderedField.style.display = 'block';

    if (title) title.textContent = 'Cash Sale';
    if (submit) submit.textContent = 'Complete Sale';
  } else {
    if (namePhone) namePhone.style.display = '';
    if (address) address.style.display = '';
    if (statusField) statusField.style.display = '';
    if (tenderedField) tenderedField.style.display = 'none';

    if (title) title.textContent = 'New Invoice';
    if (submit) submit.textContent = 'Create Invoice';
  }

  window._selectedPayMethod = mode === 'cash' ? 'cash' : '';

  const paymentRow = document.getElementById('payment-method-row');
  const momoRow = document.getElementById('momo-number-row');

  if (paymentRow) paymentRow.style.display = mode === 'cash' ? 'block' : 'none';
  if (momoRow) momoRow.style.display = 'none';

  const cashButton = document.getElementById('pm-cash');
  const momoButton = document.getElementById('pm-momo');

  if (cashButton) cashButton.style.cssText = '';
  if (momoButton) momoButton.style.cssText = '';

  const totalDisplay = document.getElementById('invoice-total-display');
  if (totalDisplay) totalDisplay.textContent = 'Total: GH₵ 0.00';

  const changeDisplay = document.getElementById('inv-change-display');
  if (changeDisplay) changeDisplay.textContent = '';

  addLineItem();

  if (typeof openModal === 'function') openModal('invoice-modal');
}

function onStatusChange() {
  const status = document.getElementById('inv-status')?.value;
  const paymentRow = document.getElementById('payment-method-row');
  const momoRow = document.getElementById('momo-number-row');

  const showPayment = status === 'paid' || status === 'partial';

  if (paymentRow) paymentRow.style.display = showPayment ? 'block' : 'none';
  if (!showPayment) {
    window._selectedPayMethod = '';
    if (momoRow) momoRow.style.display = 'none';
  }
}

function selectPayMethod(method) {
  const allowed = ['cash', 'momo', 'bank_transfer', 'card', 'other'];

  if (!allowed.includes(method)) {
    invoiceToast('Invalid payment method.', 'error');
    return;
  }

  window._selectedPayMethod = method;

  const buttons = {
    cash: document.getElementById('pm-cash'),
    momo: document.getElementById('pm-momo')
  };

  Object.entries(buttons).forEach(([key, button]) => {
    if (!button) return;

    button.style.border = key === method
      ? '2px solid var(--accent)'
      : '1px solid var(--gray-200)';
  });

  const momoRow = document.getElementById('momo-number-row');
  if (momoRow) momoRow.style.display = method === 'momo' ? 'block' : 'none';
}

function toggleMomoSameAsMe(checkbox) {
  const input = document.getElementById('inv-momo-number');
  if (!input) return;

  if (checkbox.checked) {
    const phone = document.getElementById('inv-cust-phone')?.value?.trim() || '';

    if (!phone) {
      alert('Enter the customer phone number first.');
      checkbox.checked = false;
      return;
    }

    input.value = phone;
    input.disabled = true;
  } else {
    input.value = '';
    input.disabled = false;
  }
}

// ------------------------------------------------------------
// LINE ITEMS
// MRA uses one selling_price per product.
// The database calculates the authoritative price during creation.
// ------------------------------------------------------------

function getProductName(product) {
  return product.product_name || product.name || '';
}

function getProductSellingPrice(product) {
  return Number(product.selling_price ?? product.sellingPrice ?? 0);
}

function addLineItem() {
  const id = lineItemCount++;
  const products = typeof getProducts === 'function' ? getProducts() : [];

  const options = products
    .filter(product => product.is_active !== false && product.isActive !== false)
    .map(product =>
      `<option value="${invoiceEscape(getProductName(product))}">`
    ).join('');

  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = 'li-' + id;

  row.innerHTML = `
    <input type="text"
      list="pl-${id}"
      placeholder="Product name"
      oninput="onLineItemInput(${id})"
      onchange="onLineItemInput(${id})"
      style="padding:5px 7px;width:100%">
    <datalist id="pl-${id}">${options}</datalist>

    <input type="number"
      placeholder="Qty"
      min="1"
      step="1"
      oninput="calcTotal()"
      style="padding:5px 7px;width:100%">

    <input type="number"
      placeholder="Unit price"
      min="0"
      step="0.01"
      readonly
      style="padding:5px 7px;width:100%;background:var(--gray-50)">

    <button type="button" class="remove-item" onclick="removeLineItem(${id})">×</button>
  `;

  document.getElementById('line-items-body')?.appendChild(row);
}

function onLineItemInput(id) {
  const row = document.getElementById('li-' + id);
  if (!row) return;

  const inputs = row.querySelectorAll('input');
  const name = inputs[0]?.value?.trim() || '';

  const product = (typeof getProducts === 'function' ? getProducts() : [])
    .find(item =>
      getProductName(item).toLowerCase() === name.toLowerCase()
    );

  if (product && inputs[2]) {
    inputs[2].value = getProductSellingPrice(product).toFixed(2);
  } else if (inputs[2]) {
    inputs[2].value = '';
  }

  calcTotal();
}

function removeLineItem(id) {
  document.getElementById('li-' + id)?.remove();
  calcTotal();
}

function calculateInvoiceFormTotals() {
  let subtotal = 0;

  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const quantity = Number(inputs[1]?.value || 0);
    const price = Number(inputs[2]?.value || 0);

    subtotal += quantity * price;
  });

  const discount = Math.max(
    0,
    Number(document.getElementById('inv-discount')?.value || 0)
  );

  return {
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount)
  };
}

function calcTotal() {
  const totals = calculateInvoiceFormTotals();

  const display = document.getElementById('invoice-total-display');
  if (display) {
    display.textContent =
      'Subtotal: ' + invoiceMoney(totals.subtotal) +
      ' | Discount: ' + invoiceMoney(totals.discount) +
      ' | Total: ' + invoiceMoney(totals.total);
  }

  updateChangeDisplay();
}

function updateChangeDisplay() {
  const display = document.getElementById('inv-change-display');
  if (!display) return;

  if (window._invoiceMode !== 'cash') {
    display.textContent = '';
    return;
  }

  const tendered = Number(document.getElementById('inv-cash-tendered')?.value || 0);
  const total = calculateInvoiceFormTotals().total;

  if (!tendered) {
    display.textContent = '';
    return;
  }

  const change = tendered - total;

  display.textContent = change >= 0
    ? 'Change due: ' + invoiceMoney(change)
    : 'Short by ' + invoiceMoney(Math.abs(change));
}

// ------------------------------------------------------------
// CUSTOMER RESOLUTION
// ------------------------------------------------------------

async function resolveInvoiceCustomer(name, phone, address) {
  if (!name) return null;

  const customers = typeof getCustomers === 'function' ? getCustomers() : [];

  const existing = customers.find(customer => {
    const customerName = customer.customer_name || customer.name || '';
    return customerName.trim().toLowerCase() === name.trim().toLowerCase();
  });

  if (existing) return existing.id;

  const api = invoiceAPI();

  if (!api || typeof api.saveCustomer !== 'function') {
    throw new Error('Customer service is unavailable.');
  }

  const result = await api.saveCustomer({
    customer_name: name,
    phone: phone || null,
    address: address || null,
    email: null,
    notes: null,
    is_active: true
  });

  if (result?.error) throw result.error;

  const customer = result?.data || result;
  return customer?.id || null;
}

// ------------------------------------------------------------
// CREATE INVOICE / CASH SALE
// ------------------------------------------------------------

async function createInvoice() {
  if (invoiceSaving) return;

  const button = document.getElementById('invoice-submit-btn');
  if (button) button.disabled = true;

  invoiceSaving = true;

  try {
    await createInvoiceSubmit();
  } finally {
    invoiceSaving = false;
    if (button) button.disabled = false;
  }
}

async function createInvoiceSubmit() {
  const api = invoiceAPI();

  if (!api || !api.isConfigured || !api.isConfigured()) {
    invoiceToast('MRA database is not configured. No invoice was saved.', 'error');
    return;
  }

  if (!navigator.onLine) {
    invoiceToast('You are offline. Reconnect before recording this transaction.', 'error');
    return;
  }

  const isCashSale = window._invoiceMode === 'cash';

  const customerName = document.getElementById('inv-cust-name')?.value?.trim() || '';
  const customerPhone = document.getElementById('inv-cust-phone')?.value?.trim() || '';
  const customerAddress = document.getElementById('inv-cust-addr')?.value?.trim() || '';
  const branchId = document.getElementById('inv-location')?.value || '';
  const notes = document.getElementById('inv-notes')?.value?.trim() || '';

  const totals = calculateInvoiceFormTotals();

  if (!branchId) {
    invoiceToast('Select a branch before creating the invoice.', 'error');
    return;
  }

  if (!isAdmin() && !(currentUser?.branchIds || []).includes(branchId)) {
    invoiceToast('You do not have access to this branch.', 'error');
    return;
  }

  if (!isCashSale && !customerName) {
    invoiceToast('Customer name is required.', 'error');
    return;
  }

  const rows = Array.from(
    document.querySelectorAll('#line-items-body .line-item-row')
  );

  if (!rows.length) {
    invoiceToast('Add at least one product.', 'error');
    return;
  }

  const items = [];
  let invalid = false;

  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');

    const productName = inputs[0]?.value?.trim() || '';
    const quantity = Number(inputs[1]?.value || 0);

    const product = (typeof getProducts === 'function' ? getProducts() : [])
      .find(item =>
        getProductName(item).toLowerCase() === productName.toLowerCase()
      );

    if (!product || !product.id || !Number.isInteger(quantity) || quantity < 1) {
      invalid = true;
      return;
    }

    items.push({
      product_id: product.id,
      quantity
    });
  });

  if (invalid || !items.length) {
    invoiceToast('Choose valid products and enter whole-number quantities.', 'error');
    return;
  }

  if (totals.total <= 0) {
    invoiceToast('The invoice total must be greater than zero.', 'error');
    return;
  }

  if (totals.discount > totals.subtotal) {
    invoiceToast('Discount cannot exceed the subtotal.', 'error');
    return;
  }

  let initialPayment = 0;
  let paymentMethod = null;

  if (isCashSale) {
    const tendered = Number(
      document.getElementById('inv-cash-tendered')?.value || 0
    );

    if (tendered < totals.total) {
      invoiceToast('Cash tendered is less than the total.', 'error');
      return;
    }

    initialPayment = totals.total;
    paymentMethod = 'cash';
  } else {
    const status = document.getElementById('inv-status')?.value || 'pending';

    if (status === 'paid') {
      initialPayment = totals.total;
    } else if (status === 'partial') {
      const amountText = prompt(
        'Enter the amount the customer is paying now (GH₵):'
      );

      if (amountText === null) return;

      initialPayment = Number(amountText);

      if (
        !Number.isFinite(initialPayment) ||
        initialPayment <= 0 ||
        initialPayment >= totals.total
      ) {
        invoiceToast('Enter a valid partial payment below the invoice total.', 'error');
        return;
      }
    }

    if (initialPayment > 0) {
      paymentMethod = window._selectedPayMethod || '';

      if (!paymentMethod) {
        invoiceToast('Select the payment method.', 'error');
        return;
      }
    }
  }

  const submissionSignature = JSON.stringify({
    mode: window._invoiceMode,
    branchId,
    customerName,
    customerPhone,
    customerAddress,
    items,
    discount: totals.discount,
    initialPayment,
    paymentMethod,
    notes
  });

  if (submissionSignature === invoiceLastSubmissionSignature) {
    invoiceToast('This transaction has already been submitted.', 'info');
    return;
  }

  if (!invoiceClientRef) {
    invoiceClientRef = window.MRAInvoiceDomain?.createClientRef?.() ||
      `mra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  let customerId = null;

  try {
    if (!isCashSale) {
      customerId = await resolveInvoiceCustomer(
        customerName,
        customerPhone,
        customerAddress
      );

      if (!customerId) {
        throw new Error('Could not create or find the customer record.');
      }
    }

    if (typeof api.createInvoice !== 'function') {
      throw new Error('The MRA invoice service is unavailable.');
    }

    const result = await api.createInvoice({
      branchId,
      customerId,
      items,
      discountAmount: totals.discount,
      taxAmount: 0,
      initialPayment,
      paymentMethod,
      paymentReference: null,
      notes,
      clientRef: invoiceClientRef
    });

    if (result?.error) throw result.error;

    const newInvoiceId = result?.data || result;
    invoiceLastSubmissionSignature = submissionSignature;

    try {
      await invoiceRefresh();
    } catch (refreshError) {
      console.warn('Invoice was created, but the cache refresh failed:', refreshError);
    }

    if (typeof addAudit === 'function') {
      addAudit(
        isCashSale ? 'Cash Sale Created' : 'Invoice Created',
        `${currentUser?.fullName || 'User'} recorded a transaction for ${invoiceMoney(totals.total)}`
      );
    }

    if (typeof closeModal === 'function') closeModal('invoice-modal');

    invoiceToast(
      isCashSale ? 'Cash sale recorded successfully.' : 'Invoice created successfully.'
    );

    if (typeof renderDashboard === 'function') renderDashboard();
    if (document.getElementById('page-invoices')?.classList.contains('active')) {
      renderInvoices();
    }
    if (document.getElementById('page-cashsales')?.classList.contains('active')) {
      renderCashSales();
    }

    // Open the saved invoice if the API returned its UUID.
    if (newInvoiceId && typeof newInvoiceId === 'string') {
      setTimeout(() => viewInvoice(newInvoiceId), 250);
    }

  } catch (error) {
    console.error('MRA invoice creation failed:', error);
    invoiceToast(error?.message || 'Could not create the invoice.', 'error');
  }
}

// ------------------------------------------------------------
// VIEW INVOICE
// ------------------------------------------------------------

function viewInvoice(id) {
  const inv = getInvoiceById(id);
  if (!inv) {
    invoiceToast('Invoice not found. Refresh the data and try again.', 'error');
    return;
  }

  viewingInvoiceId = id;

  const title = document.getElementById('view-inv-title');
  const body = document.getElementById('view-inv-body');

  if (title) title.textContent = 'Invoice: ' + invoiceNumber(inv);
  if (body) body.innerHTML = buildInvoiceHTML(inv);

  const deleteButton = document.getElementById('view-inv-delete');
  if (deleteButton) {
    // No secure invoice cancellation/deletion RPC has been implemented yet.
    deleteButton.style.display = 'none';
  }

  const editButton = document.getElementById('view-inv-edit');
  if (editButton) {
    // Invoice editing must wait for a secure database function.
    editButton.style.display = 'none';
  }

  const paidButton = document.getElementById('view-inv-mark-paid');

  if (paidButton) {
    const canReceivePayment =
      invoiceCanBeViewed(inv) &&
      invoiceBalance(inv) > 0 &&
      invoiceStatus(inv) !== 'cancelled';

    paidButton.style.display = canReceivePayment ? 'inline-flex' : 'none';
    paidButton.textContent = 'Record Payment';
    paidButton.onclick = () => markViewingInvoicePaid();
  }

  const shareButton = document.getElementById('view-inv-share');

  if (shareButton) {
    shareButton.style.display = 'inline-flex';
    shareButton.onclick = () => shareInvoice();
  }

  if (typeof openModal === 'function') openModal('view-invoice-modal');
}

// ------------------------------------------------------------
// INVOICE HTML
// ------------------------------------------------------------

function getInvoiceBusinessDetails() {
  const settings = typeof getBusinessSettings === 'function'
    ? getBusinessSettings()
    : {};

  return {
    name: settings?.business_name || 'MRA SYSTEMS',
    phone: settings?.phone || '',
    email: settings?.email || '',
    address: settings?.address || '',
    currency: settings?.currency_code || 'GHS'
  };
}

function buildInvoiceHTML(inv) {
  const business = getInvoiceBusinessDetails();
  const items = invoiceItems(inv);
  const branch = invoiceBranchName(inv);
  const payments = invoicePayments(inv);
  const paymentHistory = payments.length
    ? payments
    : invoicePaid(inv) > 0
      ? [{
          amount: invoicePaid(inv),
          method: invoiceValue(inv, 'payMethod', 'pay_method', 'payment_method') || 'Payment'
        }]
      : [];

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:9px 10px;text-align:center;width:10%;white-space:nowrap">${item.qty}</td>
      <td style="padding:9px 10px;width:50%;overflow-wrap:anywhere;word-break:break-word">${invoiceEscape(item.name)}</td>
      <td style="padding:9px 10px;text-align:right;width:20%;white-space:nowrap">${item.price.toFixed(2)}</td>
      <td style="padding:9px 10px;text-align:right;width:20%;font-weight:600;white-space:nowrap">${item.total.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <div style="border:1px solid var(--gray-200);border-radius:var(--radius);overflow:hidden;margin-bottom:14px;background:white">

      <div style="padding:18px 16px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-size:20px;font-weight:800">${invoiceEscape(business.name)}</div>
          ${business.address ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">${invoiceEscape(business.address)}</div>` : ''}
          ${business.phone ? `<div style="font-size:12px;color:var(--gray-500)">${invoiceEscape(business.phone)}</div>` : ''}
          ${business.email ? `<div style="font-size:12px;color:var(--gray-500)">${invoiceEscape(business.email)}</div>` : ''}
        </div>

        <div style="text-align:right">
          <div style="font-size:22px;font-weight:800;letter-spacing:1px">INVOICE</div>
          <div class="mono">${invoiceEscape(invoiceNumber(inv))}</div>
          <div style="font-size:12px;color:var(--gray-500)">
            ${typeof fmtDate === 'function' ? fmtDate(invoiceDate(inv)) : ''}
          </div>
        </div>
      </div>

      <div style="padding:12px 16px;background:var(--gray-50);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;color:var(--gray-400)">CUSTOMER</div>
          <strong>${invoiceEscape(invoiceCustomerName(inv))}</strong>
          ${invoiceValue(inv, 'customerPhone', 'customer_phone') ? `<div style="font-size:12px">${invoiceEscape(invoiceValue(inv, 'customerPhone', 'customer_phone'))}</div>` : ''}
        </div>
        <div>
          <div style="font-size:11px;color:var(--gray-400)">BRANCH</div>
          <strong>${invoiceEscape(branch)}</strong>
        </div>
      </div>

      <table style="margin:0;width:100%;table-layout:fixed;border-collapse:collapse">
        <thead>
          <tr style="background:var(--gray-100)">
            <th style="padding:9px 10px;text-align:center">QTY</th>
            <th style="padding:9px 10px;text-align:left">DESCRIPTION</th>
            <th style="padding:9px 10px;text-align:right">UNIT PRICE</th>
            <th style="padding:9px 10px;text-align:right">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="padding:14px 16px;border-top:1px solid var(--gray-200)">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span>Subtotal</span><span>${invoiceMoney(invoiceSubtotal(inv))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span>Discount</span><span>-${invoiceMoney(invoiceDiscount(inv))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;margin-top:10px">
          <span>Total</span><span>${invoiceMoney(invoiceTotal(inv))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px">
          <span>Amount paid</span><span>${invoiceMoney(invoicePaid(inv))}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700">
          <span>Balance due</span><span>${invoiceMoney(invoiceBalance(inv))}</span>
        </div>
      </div>

      ${paymentHistory.length ? `
        <div style="padding:12px 16px;border-top:1px solid var(--gray-100)">
          <strong style="display:block;margin-bottom:8px">Payment history</strong>
          ${paymentHistory.map(payment => `
            <div style="display:flex;justify-content:space-between;gap:12px">
              <span>${invoiceEscape(payment.method || payment.payment_method || 'Payment')}</span>
              <span>${invoiceMoney(payment.amount)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div style="padding:12px 16px;background:var(--gray-50);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--gray-500)">
          ${invoiceEscape(branch)} · Prepared by: ${invoiceEscape(invoiceValue(inv, 'createdByName', 'created_by_name') || 'MRA User')}
        </span>
        ${typeof statusBadge === 'function' ? statusBadge(invoiceStatus(inv)) : invoiceEscape(invoiceStatus(inv))}
      </div>

      ${invoiceValue(inv, 'notes') ? `
        <div style="padding:12px 16px;border-top:1px solid var(--gray-100)">
          <strong>Notes</strong>
          <div>${invoiceEscape(inv.notes)}</div>
        </div>
      ` : ''}

      <div style="padding:12px 16px;text-align:center;font-size:11px;color:var(--gray-400)">
        Powered by MRA Systems
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// RECORD PAYMENT
// Uses the secure record_payment RPC.
// ------------------------------------------------------------

async function markViewingInvoicePaid() {
  const inv = getInvoiceById(viewingInvoiceId);
  if (!inv) return;

  const balance = invoiceBalance(inv);

  if (balance <= 0) {
    invoiceToast('This invoice has no outstanding balance.');
    return;
  }

  if (!invoiceCanBeViewed(inv)) {
    invoiceToast('You do not have permission to record payment for this invoice.', 'error');
    return;
  }

  const amountText = prompt(
    `Outstanding balance: ${invoiceMoney(balance)}\n\nEnter the amount received:`
  );

  if (amountText === null) return;

  const amount = Number(amountText);

  if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
    invoiceToast('Enter a valid payment amount not exceeding the outstanding balance.', 'error');
    return;
  }

  const method = prompt(
    'Enter payment method:\n\ncash\nmomo\nbank_transfer\ncard\nother',
    'cash'
  );

  if (method === null) return;

  const normalizedMethod = method.trim().toLowerCase();
  const allowedMethods = ['cash', 'momo', 'bank_transfer', 'card', 'other'];

  if (!allowedMethods.includes(normalizedMethod)) {
    invoiceToast('Invalid payment method.', 'error');
    return;
  }

  const reference = normalizedMethod === 'momo'
    ? (prompt('Enter the MoMo transaction reference (optional):') || '').trim()
    : '';

  const api = invoiceAPI();

  if (!api || typeof api.recordPayment !== 'function') {
    invoiceToast('The MRA payment service is unavailable.', 'error');
    return;
  }

  try {
    const result = await api.recordPayment({
      invoiceId: invoiceId(inv),
      amount,
      paymentMethod: normalizedMethod,
      paymentReference: reference || null,
      paymentNote: null
    });

    if (result?.error) throw result.error;

    try {
      await invoiceRefresh();
    } catch (refreshError) {
      console.warn('Payment recorded, but cache refresh failed:', refreshError);
    }

    invoiceToast('Payment recorded successfully.');

    viewInvoice(invoiceId(inv));

    if (typeof renderDashboard === 'function') renderDashboard();
    if (document.getElementById('page-invoices')?.classList.contains('active')) {
      renderInvoices();
    }

  } catch (error) {
    console.error('Payment recording failed:', error);
    invoiceToast(error?.message || 'Could not record payment.', 'error');
  }
}

// Compatibility with any older HTML button/function names.
function _showMarkPaidDialog() {
  markViewingInvoicePaid();
}

function _confirmMarkPaid() {
  markViewingInvoicePaid();
}

function _selectMpdMethod(method) {
  window._selectedPayMethod = method;
}

// ------------------------------------------------------------
// INVOICE TEXT / SHARING
// ------------------------------------------------------------

function generateInvoiceText(inv) {
  const business = getInvoiceBusinessDetails();
  const lines = invoiceItems(inv).map(item =>
    `${item.qty} x ${item.name} @ ${invoiceMoney(item.price)} = ${invoiceMoney(item.total)}`
  );

  return [
    business.name,
    'INVOICE',
    `Invoice: ${invoiceNumber(inv)}`,
    `Date: ${typeof fmtDate === 'function' ? fmtDate(invoiceDate(inv)) : ''}`,
    `Branch: ${invoiceBranchName(inv)}`,
    `Customer: ${invoiceCustomerName(inv)}`,
    '',
    ...lines,
    '',
    `Subtotal: ${invoiceMoney(invoiceSubtotal(inv))}`,
    `Discount: ${invoiceMoney(invoiceDiscount(inv))}`,
    `Total: ${invoiceMoney(invoiceTotal(inv))}`,
    `Paid: ${invoiceMoney(invoicePaid(inv))}`,
    `Balance: ${invoiceMoney(invoiceBalance(inv))}`,
    `Status: ${invoiceStatus(inv).toUpperCase()}`,
    '',
    'Powered by MRA Systems'
  ].join('\n');
}

function copyInvoiceText() {
  const inv = getInvoiceById(viewingInvoiceId);
  if (!inv) return;

  const text = generateInvoiceText(inv);

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => invoiceToast('Invoice copied.'))
      .catch(() => invoiceToast('Could not copy invoice text.', 'error'));
  } else {
    invoiceToast('Clipboard is not available in this browser.', 'error');
  }
}

function shareInvoice() {
  const inv = getInvoiceById(viewingInvoiceId);
  if (!inv) return;

  const text = generateInvoiceText(inv);

  if (navigator.share) {
    navigator.share({
      title: `Invoice ${invoiceNumber(inv)} — ${invoiceCustomerName(inv)}`,
      text
    }).catch(error => {
      if (error?.name !== 'AbortError') {
        shareInvoiceFallback(text);
      }
    });
    return;
  }

  shareInvoiceFallback(text);
}

function shareInvoiceFallback(text) {
  const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
}

// ------------------------------------------------------------
// PRINT
// ------------------------------------------------------------

function printInvoice(inv) {
  const invoiceToPrint = inv || getInvoiceById(viewingInvoiceId);

  if (!invoiceToPrint) {
    invoiceToast('Select an invoice before printing.', 'error');
    return;
  }

  const business = getInvoiceBusinessDetails();
  const html = buildInvoiceHTML(invoiceToPrint);

  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    invoiceToast('Allow pop-ups to print this invoice.', 'error');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice ${invoiceEscape(invoiceNumber(invoiceToPrint))}</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #222;
          max-width: 800px;
          margin: 20px auto;
          padding: 15px;
        }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid #ddd; }
        @media print {
          body { margin: 0; padding: 0; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      ${html}
      <script>
        window.onload = function() {
          window.print();
        };
      <\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ------------------------------------------------------------
// UNSUPPORTED OPERATIONS — INTENTIONALLY DISABLED
// Do not perform financial writes through local storage.
// Add secure database RPCs before enabling these features.
// ------------------------------------------------------------

async function deleteInvoice() {
  invoiceToast(
    'Invoice deletion is not enabled yet. A secure MRA cancellation function is required.',
    'error'
  );
}

function openEditInvoiceModal() {
  invoiceToast(
    'Invoice editing is not enabled yet. A secure MRA invoice-edit function is required.',
    'info'
  );
}

async function saveEditedInvoice() {
  invoiceToast(
    'Invoice editing is not enabled yet. No changes were made.',
    'error'
  );
}

async function updateInvoice() {
  invoiceToast(
    'Invoice editing is not enabled yet. No changes were made.',
    'error'
  );
}

// Legacy edit helpers retained only to prevent errors if old HTML references them.
function calculateTotal() {
  calcTotal();
}

function renderEditItems() {}
function addItem() {}
function onEditItemInput() {}
function collectEditedItems() { return []; }
function calcEditTotal() {}
function loadProductSuggestions() {}

// Offline sales queue is not supported by the MRA transaction design yet.
function getOfflineQueue() { return []; }
function renderOfflineQueueBadge() {}
function renderOfflineQueueModal() {}
function openOfflineQueueModal() {
  invoiceToast('Offline cash-sale recording is not enabled. Reconnect before recording a sale.', 'info');
}
async function trySyncOfflineQueue() {}
async function retryOfflineQueueItem() {}
function discardOfflineQueueItem() {}
function makeClientRef() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : 'mra-' + Date.now();
}

// Keep older calls harmless while removing the old queue implementation.
window.addEventListener('online', () => {});