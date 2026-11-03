// ============================================================
// MRA SYSTEMS — PRODUCTS
// Dynamic branches, single selling price, database-backed data
// ============================================================

let adjustingProductId = null;
let csvRows = [];

// ============================================================
// HELPERS
// ============================================================

function productValue(product, ...keys) {
  for (const key of keys) {
    if (product?.[key] !== undefined && product[key] !== null) {
      return product[key];
    }
  }
  return '';
}

function productName(product) {
  return String(productValue(product, 'name', 'product_name') || '');
}

function productSku(product) {
  return String(productValue(product, 'sku') || '');
}

function productCategory(product) {
  return String(
    productValue(product, 'category', 'category_name') || 'General'
  );
}

function productPrice(product) {
  return Number(
    productValue(product, 'price', 'selling_price') || 0
  );
}

function productCost(product) {
  return Number(
    productValue(product, 'costPrice', 'cost_price') || 0
  );
}

function productReorder(product) {
  return Number(
    productValue(product, 'reorder', 'reorder_level') || 0
  );
}

function productIsActive(product) {
  return productValue(product, 'isActive', 'is_active') !== false;
}

function getProductBranchStock(product, branchId) {
  const stockSources = [
    product?.branchStock,
    product?.branch_stock,
    product?.branchInventory,
    product?.branch_inventory
  ];

  for (const source of stockSources) {
    if (!source) continue;

    if (Array.isArray(source)) {
      const match = source.find(item =>
        String(item.branch_id || item.branchId) === String(branchId)
      );

      if (match) {
        return Number(match.quantity || 0);
      }
    }

    if (typeof source === 'object') {
      const value = source[branchId];

      if (value !== undefined) {
        return Number(
          typeof value === 'object' ? value.quantity || 0 : value
        );
      }
    }
  }

  return 0;
}

function getProductStockSummary(product) {
  const branches = getBranches();

  return branches.map(branch => ({
    branch,
    quantity: getProductBranchStock(product, branch.id)
  }));
}

function getMraProductAPI() {
  return window.MRAApi || window.MRASupabase || window.LumodaSupabase || null;
}

function isMraDatabaseReady() {
  const api = getMraProductAPI();

  return Boolean(
    api &&
    typeof api.isConfigured === 'function' &&
    api.isConfigured()
  );
}


// ============================================================
// PRODUCT LIST
// ============================================================

function renderProducts() {
  const csvBtn = document.getElementById('btn-import-csv');
  const addBtn = document.getElementById('btn-add-product');
  const orderBtn = document.getElementById('btn-order-stock');
  const linkBtn = document.getElementById('btn-link-warehouse');

  if (csvBtn) csvBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
  if (linkBtn) linkBtn.style.display = 'none';

  if (addBtn) {
    addBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
  }

  if (orderBtn) {
    orderBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
  }

  const body = document.getElementById('products-body');
  if (!body) return;

  let products = getProducts();
  const totalCount = products.length;

  if (productSearch) {
    const q = productSearch.toLowerCase();

    products = products.filter(product => {
      return [
        productName(product),
        productSku(product),
        productCategory(product)
      ].some(value => String(value).toLowerCase().includes(q));
    });
  }

  const countEl = document.getElementById('products-count');

  if (countEl) {
    countEl.textContent = productSearch
      ? `${products.length} of ${totalCount} products`
      : `${totalCount} product${totalCount !== 1 ? 's' : ''}`;
  }

  const branches = getBranches();

  // Build dynamic branch columns.
  const table = body.closest('table');

  if (table) {
    const header = table.querySelector('thead tr');

    if (header) {
      header.innerHTML = `
        <th>Product</th>
        <th>SKU</th>
        <th>Category</th>
        <th>Selling Price</th>
        ${branches.map(branch =>
          `<th style="text-align:center">${escapeHtml(branch.branch_name || branch.name)}</th>`
        ).join('')}
        <th>Stock Status</th>
        <th>Reorder Level</th>
        <th>Actions</th>
      `;
    }
  }

  if (!products.length) {
    body.innerHTML = `
      <tr>
        <td colspan="${7 + branches.length}"
            style="text-align:center;color:var(--gray-400);padding:40px">
          ${productSearch ? 'No matching products found.' : 'No products have been added yet.'}
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = products.map(product => {
    const name = productName(product);
    const sku = productSku(product);
    const category = productCategory(product);
    const price = productPrice(product);
    const reorder = productReorder(product);
    const active = productIsActive(product);

    const branchStocks = getProductStockSummary(product);
    const totalStock = branchStocks.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    const isOut = totalStock <= 0;
    const isLow = !isOut && totalStock <= reorder;

    const rowStyle = isOut
      ? 'background:#fef2f2'
      : isLow
        ? 'background:#fefce8'
        : '';

    const stripe = isOut
      ? '#dc2626'
      : isLow
        ? '#f59e0b'
        : 'transparent';

    const branchCells = branchStocks.map(item => {
      const low = item.quantity <= reorder;

      return `
        <td class="mono"
            style="text-align:center;color:${low ? '#dc2626' : 'inherit'}">
          ${item.quantity}
        </td>
      `;
    }).join('');

    const status = !active
      ? '<span class="badge badge-neutral">Inactive</span>'
      : isOut
        ? '<span class="badge badge-danger">Out of stock</span>'
        : isLow
          ? '<span class="badge badge-warning">Low stock</span>'
          : '<span class="badge badge-success">In stock</span>';

    const editButton = isAdmin()
      ? `<button class="btn btn-secondary btn-sm"
                 onclick="editProduct('${escapeHtml(product.id)}')">Edit</button>`
      : '';

    return `
      <tr style="${rowStyle}">
        <td style="font-weight:500;box-shadow:inset 3px 0 0 ${stripe}">
          ${escapeHtml(name)}
          ${!active ? '<br><small style="color:var(--gray-400)">Inactive product</small>' : ''}
        </td>

        <td class="mono">${escapeHtml(sku)}</td>

        <td style="color:var(--gray-400)">
          ${escapeHtml(category)}
        </td>

        <td style="font-weight:600">
          ${fmtGHS(price)}
        </td>

        ${branchCells}

        <td>${status}</td>

        <td class="mono" style="color:var(--gray-400)">
          ${reorder}
        </td>

        <td>
          <div style="display:flex;gap:6px">
            ${editButton}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterProducts(value) {
  productSearch = value || '';
  renderProducts();
}


// ============================================================
// ADD PRODUCT
// ============================================================

function openProductModal() {
  if (!requireAdmin('add products')) return;

  if (!isMraDatabaseReady()) {
    toast('Database connection is not available.', 'error');
    return;
  }

  editingProductId = null;

  const title = document.getElementById('prod-modal-title');
  if (title) title.textContent = 'New Product';

  [
    'prod-name',
    'prod-sku',
    'prod-category',
    'prod-price',
    'prod-cost-price',
    'prod-reorder'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const reorder = document.getElementById('prod-reorder');

  if (reorder) {
    reorder.value = getDefaultReorderLevel();
  }

  openModal('product-modal');
}


// ============================================================
// EDIT PRODUCT
// ============================================================

function editProduct(id) {
  if (!requireAdmin('edit products')) return;

  const product = getProducts().find(
    item => String(item.id) === String(id)
  );

  if (!product) {
    toast('Product not found.', 'error');
    return;
  }

  editingProductId = id;

  const title = document.getElementById('prod-modal-title');
  if (title) title.textContent = 'Edit Product';

  const fields = {
    'prod-name': productName(product),
    'prod-sku': productSku(product),
    'prod-category': productCategory(product),
    'prod-price': productPrice(product),
    'prod-cost-price': productCost(product),
    'prod-reorder': productReorder(product)
  };

  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });

  openModal('product-modal');
}


// ============================================================
// SAVE PRODUCT
// ============================================================

async function saveProduct() {
  if (!requireAdmin('save products')) return;

  if (!isMraDatabaseReady()) {
    toast('Database connection is not available.', 'error');
    return;
  }

  const name = document.getElementById('prod-name')?.value.trim();
  const skuInput = document.getElementById('prod-sku')?.value.trim();
  const category =
    document.getElementById('prod-category')?.value.trim() || 'General';

  const price = Number(
    document.getElementById('prod-price')?.value
  );

  const costInput = document.getElementById('prod-cost-price')?.value;
  const costPrice = costInput === '' || costInput === undefined
    ? 0
    : Number(costInput);

  const reorderInput = document.getElementById('prod-reorder')?.value;
  const reorder = reorderInput === ''
    ? getDefaultReorderLevel()
    : Number(reorderInput);

  if (!name) {
    toast('Product name is required.', 'error');
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    toast('Enter a valid selling price.', 'error');
    return;
  }

  if (!Number.isFinite(costPrice) || costPrice < 0) {
    toast('Enter a valid cost price.', 'error');
    return;
  }

  if (!Number.isInteger(reorder) || reorder < 0) {
    toast('Reorder level must be a non-negative whole number.', 'error');
    return;
  }

  const sku = skuInput || `SKU-${Date.now()}`;

  const existing = editingProductId
    ? getProducts().find(p => String(p.id) === String(editingProductId))
    : null;

  // Keep the existing product's active state when editing.
  const payload = {
    id: editingProductId || undefined,

    // The compatibility API accepts these names and maps them
    // to the MRA products table.
    name,
    product_name: name,

    sku,

    category,
    category_name: category,

    price,
    selling_price: price,

    costPrice,
    cost_price: costPrice,

    reorder,
    reorder_level: reorder,

    is_active: existing
      ? productIsActive(existing)
      : true
  };

  const saveButton = document.querySelector(
    '#product-modal button[onclick="saveProduct()"]'
  );

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
  }

  try {
    const api = getMraProductAPI();

    const result = await api.saveProduct(payload);

    if (result?.error) {
      throw result.error;
    }

    if (result?.success === false) {
      throw new Error(result.error || 'Could not save product.');
    }

    // Refresh server-backed product and inventory data.
    await syncSupabaseCache();

    if (typeof loadProductSuggestions === 'function') {
      loadProductSuggestions(getProducts());
    }

    if (typeof addAudit === 'function') {
      addAudit(
        editingProductId ? 'Product Updated' : 'Product Added',
        `${currentUser.fullName} saved "${name}"`
      );
    }

    closeModal('product-modal');

    toast(
      editingProductId
        ? 'Product updated successfully.'
        : 'Product created successfully.'
    );

    renderProducts();

  } catch (error) {
    console.error('Save product failed:', error);
    toast(error.message || 'Could not save product.', 'error');

  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = 'Save Product';
    }
  }
}


// ============================================================
// RESTOCK SUMMARY
// ============================================================

function orderStock() {
  if (!requireAdmin('view restock list')) return;

  const branches = getBranches();
  const products = getProducts();

  const lowStock = [];

  products.forEach(product => {
    if (!productIsActive(product)) return;

    const reorder = productReorder(product);

    branches.forEach(branch => {
      const quantity = getProductBranchStock(product, branch.id);

      if (quantity <= reorder) {
        lowStock.push({
          product,
          branch,
          quantity,
          reorder
        });
      }
    });
  });

  if (!lowStock.length) {
    toast('No restocking needed.');
    return;
  }

  const lines = lowStock.map(item =>
    `• ${productName(item.product)} (${productSku(item.product)})\n` +
    `  ${item.branch.branch_name || item.branch.name}: ${item.quantity} ` +
    `(Reorder level: ${item.reorder})`
  );

  const text = `${getBusinessName()} — Restock List\n\n${lines.join('\n\n')}`;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Restock list copied.'))
      .catch(() => window.prompt('Copy restock list:', text));
  } else {
    window.prompt('Copy restock list:', text);
  }
}


// ============================================================
// STOCK ADJUSTMENT
// ============================================================

// MRA does not yet have a secure stock-adjustment RPC.
// Do not update branch_inventory directly from the frontend.

function openStockAdjust(productId) {
  if (!requireAdmin('adjust stock')) return;

  toast(
    'Stock adjustments are not enabled yet. A secure database function is required.',
    'error'
  );
}

async function applyStockAdjustment() {
  if (!requireAdmin('adjust stock')) return;

  toast(
    'Stock adjustments are not enabled yet.',
    'error'
  );
}


// ============================================================
// STOCK HISTORY
// ============================================================

async function renderStockHistory() {
  const body = document.getElementById('stockhistory-body');
  if (!body) return;

  body.innerHTML = `
    <tr>
      <td colspan="7"
          style="text-align:center;color:var(--gray-400);padding:30px">
        Loading stock history...
      </td>
    </tr>
  `;

  try {
    const api = getMraProductAPI();

    if (!api?.loadStockHistory) {
      throw new Error('Stock history is not available.');
    }

    const history = await api.loadStockHistory();

    const records = Array.isArray(history) ? history : [];

    const filtered = filterByLoc(records);

    filtered.sort((a, b) => {
      const dateA = new Date(
        a.created_at || a.createdAt || 0
      ).getTime();

      const dateB = new Date(
        b.created_at || b.createdAt || 0
      ).getTime();

      return dateB - dateA;
    });

    if (!filtered.length) {
      body.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--gray-400);padding:40px">
            No stock history yet.
          </td>
        </tr>
      `;
      return;
    }

    body.innerHTML = filtered.map(record => {
      const date = record.created_at || record.createdAt;
      const type = record.movement_type || record.type || 'Movement';

      const branchName =
        record.branch_name ||
        getBranchName(record.branch_id) ||
        'Unknown branch';

      const change = Number(
        record.quantity_change ?? record.change ?? 0
      );

      const product = record.product_name ||
        record.productName ||
        'Product';

      const note = record.reason || record.note || '—';

      const user = record.created_by_name ||
        record.byName ||
        record.by ||
        '—';

      return `
        <tr>
          <td class="mono">${fmtDateTime(date)}</td>

          <td>
            <span class="badge badge-neutral">
              ${escapeHtml(type)}
            </span>
          </td>

          <td>${escapeHtml(product)}</td>

          <td>${escapeHtml(branchName)}</td>

          <td class="mono"
              style="color:${change > 0 ? '#16a34a' : change < 0 ? '#dc2626' : 'inherit'}">
            ${change > 0 ? '+' : ''}${change}
          </td>

          <td>${escapeHtml(note)}</td>

          <td>${escapeHtml(user)}</td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Load stock history failed:', error);

    body.innerHTML = `
      <tr>
        <td colspan="7"
            style="text-align:center;color:#dc2626;padding:30px">
          Could not load stock history.
        </td>
      </tr>
    `;
  }
}

function filterStockHistory(value) {
  const query = String(value || '').toLowerCase();

  document.querySelectorAll('#stockhistory-body tr').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(query)
      ? ''
      : 'none';
  });
}


// ============================================================
// CSV IMPORT
// ============================================================

function openCsvModal() {
  if (!requireAdmin('import products')) return;
  csvRows = [];
  showCsvError('');
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('csv-import-btn').style.display = 'none';
  const input = document.getElementById('csv-file-input');
  if (input) input.value = '';
  openModal('csv-modal');
}

function showCsvError(message) {
  const element = document.getElementById('csv-error');

  if (!element) return;

  element.textContent = message || '';
  element.style.display = message ? 'block' : 'none';
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());

  return result;
}

function parseCsvFile() {
  const input = document.getElementById('csv-file-input');
  const file = input?.files?.[0];
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    showCsvError('Please save the spreadsheet as CSV before importing.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = String(reader.result || '').split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) throw new Error('The file must contain a header row and at least one product.');
      const headers = parseCsvLine(lines.shift()).map(header =>
        header.toLowerCase().replace(/[\s_-]+/g, '')
      );
      const nameIndex = headers.findIndex(header =>
        ['name', 'productname', 'product'].includes(header)
      );
      const priceIndex = headers.findIndex(header =>
        ['price', 'sellingprice', 'selling'].includes(header)
      );
      if (nameIndex < 0 || priceIndex < 0) {
        throw new Error('Required columns are Product Name and Selling Price.');
      }
      csvRows = lines.map((line, index) => {
        const values = parseCsvLine(line);
        const value = (...names) => {
          const i = headers.findIndex(header => names.includes(header));
          return i >= 0 ? String(values[i] || '').trim() : '';
        };
        const row = {
          line: index + 2,
          name: String(values[nameIndex] || '').trim(),
          sku: value('sku', 'productcode', 'code'),
          category: value('category', 'categoryname'),
          costPrice: value('costprice', 'cost'),
          sellingPrice: String(values[priceIndex] || '').trim(),
          reorder: value('reorderlevel', 'reorder', 'reorderat'),
          unitName: value('unit', 'unitname') || 'piece'
        };
        row.error = !row.name
          ? 'Product name is required'
          : !Number.isFinite(Number(row.sellingPrice)) || Number(row.sellingPrice) < 0
            ? 'Selling price must be a non-negative number'
            : '';
        return row;
      });
      renderCsvPreview();
    } catch (error) {
      csvRows = [];
      showCsvError(error.message);
    }
  };
  reader.onerror = () => showCsvError('Could not read the selected file.');
  reader.readAsText(file);
}

function renderCsvPreview() {
  const preview = document.getElementById('csv-preview');
  const body = document.getElementById('csv-preview-body');
  const title = document.getElementById('csv-preview-title');
  if (!preview || !body || !title) return;
  const invalid = csvRows.filter(row => row.error);
  title.textContent = `${csvRows.length} product${csvRows.length === 1 ? '' : 's'} ready to import${invalid.length ? ` · ${invalid.length} invalid` : ''}`;
  body.innerHTML = csvRows.map((row, index) => `
    <tr>
      <td>${escapeHtml(row.name || '—')}</td>
      <td>${escapeHtml(row.sku || '—')}</td>
      <td>${escapeHtml(row.category || 'General')}</td>
      <td>${escapeHtml(row.sellingPrice || '—')}</td>
      <td colspan="3">${row.error ? `<span style="color:#b91c1c">${escapeHtml(row.error)}</span>` : `${escapeHtml(row.unitName)} · reorder ${escapeHtml(row.reorder || '0')}`}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="removeCsvRow(${index})">Remove</button></td>
    </tr>
  `).join('');
  preview.style.display = '';
  document.getElementById('csv-import-btn').style.display =
    csvRows.length && !invalid.length ? '' : 'none';
}

function removeCsvRow(index) {
  csvRows.splice(index, 1);
  renderCsvPreview();
}

async function importCsvProducts() {
  if (!requireAdmin('import products')) return;
  if (!csvRows.length || csvRows.some(row => row.error)) return;
  const api = getMraProductAPI();
  if (!api?.saveProduct) {
    showCsvError('The product database is not available.');
    return;
  }
  const button = document.getElementById('csv-import-btn');
  button.disabled = true;
  try {
    const imported = await api.importProducts(csvRows);
    closeModal('csv-modal');
    toast(`${imported.length} product${imported.length === 1 ? '' : 's'} imported successfully`);
    if (typeof syncSupabaseCache === 'function') await syncSupabaseCache();
    renderProducts();
  } catch (error) {
    showCsvError(error.message || 'Could not import products.');
  } finally {
    button.disabled = false;
  }
}

function downloadCsvTemplate() {
  const csv = [
    'Product Name,SKU,Category,Cost Price,Selling Price,Reorder Level',
    'Example Product,EX-001,General,50,100,5'
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'mra-products-template.csv';
  link.click();

  URL.revokeObjectURL(url);
}


// ============================================================
// STOCK HISTORY EXPORT
// ============================================================

function exportCSV() {
  const rows = [];

  document.querySelectorAll('#stockhistory-body tr').forEach(row => {
    if (row.cells.length < 7) return;

    rows.push(
      Array.from(row.cells).map(cell => cell.textContent.trim())
    );
  });

  if (!rows.length) {
    toast('No stock history to export.');
    return;
  }

  const headers = [
    'Date',
    'Movement Type',
    'Product',
    'Branch',
    'Quantity Change',
    'Reason',
    'User'
  ];

  const csv = [headers, ...rows]
    .map(row =>
      row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(',')
    )
    .join('\n');

  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'mra-stock-history.csv';
  link.click();

  URL.revokeObjectURL(url);
}


// ============================================================
// LEGACY WAREHOUSE CATALOGUE FUNCTIONS
// ============================================================

// MRA uses branches as stock locations.
// There is no separate warehouse catalogue to reconcile.

async function openCatalogLinkModal() {
  toast('MRA does not use a separate warehouse catalogue.');
}

function buildCatalogLinkCandidates() {
  return [];
}

function renderCatalogLinkRows() {
  const body = document.getElementById('catalog-link-rows');

  if (body) {
    body.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center;padding:20px">
          MRA uses branches as stock locations.
        </td>
      </tr>
    `;
  }
}

function skipCatalogLink() {}

async function confirmCatalogLink() {
  toast('Warehouse catalogue linking is not used in MRA.');
}

async function backfillRemainingWarehouseEntries() {
  toast('Warehouse catalogue backfilling is not used in MRA.');
}