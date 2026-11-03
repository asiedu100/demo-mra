// ============================================================
// MRA SYSTEMS — DASHBOARD
// ============================================================

// ============================================================
// HELPERS
// ============================================================

function dashboardValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dashboardInvoiceTotal(invoice) {
  return dashboardValue(
    invoice.total ??
    invoice.total_amount ??
    invoice.totalAmount
  );
}

function dashboardBalanceDue(invoice) {
  return dashboardValue(
    invoice.balanceDue ??
    invoice.balance_due ??
    invoice.balance
  );
}

function dashboardAmountPaid(invoice) {
  return dashboardValue(
    invoice.amountPaid ??
    invoice.amount_paid
  );
}

function dashboardCreatedAt(invoice) {
  return asTimestamp(
    invoice.createdAt ??
    invoice.created_at ??
    invoice.invoiceDate ??
    invoice.invoice_date
  );
}

function dashboardCreatedBy(invoice) {
  return invoice.createdBy ??
    invoice.created_by ??
    null;
}

function dashboardBranchId(invoice) {
  return invoice.branchId ??
    invoice.branch_id ??
    null;
}

function dashboardBranchName(branchId) {
  if (typeof getBranchName === 'function') {
    return getBranchName(branchId);
  }

  const branch = getBranches().find(
    item => item.id === branchId
  );

  return branch?.branch_name || 'Unknown Branch';
}

function dashboardProductName(product) {
  return product.name ||
    product.product_name ||
    'Unnamed Product';
}

function dashboardProductReorder(product) {
  return dashboardValue(
    product.reorder ??
    product.reorderLevel ??
    product.reorder_level
  );
}


// ============================================================
// BRANCH STOCK
// Supports normalized branchStock data and branch inventory rows.
// ============================================================

function getDashboardProductBranchStock(product, branchId) {
  const stockData = product.branchStock;

  if (Array.isArray(stockData)) {
    const row = stockData.find(
      item =>
        (item.branchId || item.branch_id) === branchId
    );

    return dashboardValue(
      row?.quantity ?? row?.stock ?? 0
    );
  }

  if (stockData && typeof stockData === 'object') {
    const row = stockData[branchId];

    if (typeof row === 'object' && row !== null) {
      return dashboardValue(
        row.quantity ?? row.stock ?? 0
      );
    }

    return dashboardValue(row);
  }

  // Fallback if the product normalizer exposes inventory separately.
  const inventory = product.branch_inventory ||
    product.branchInventory;

  if (Array.isArray(inventory)) {
    const row = inventory.find(
      item =>
        (item.branchId || item.branch_id) === branchId
    );

    return dashboardValue(row?.quantity);
  }

  return 0;
}


// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {
  if (!currentUser) return;

  updateUserUI();

  const admin = isAdmin();

  // Include both named-customer invoices and walk-in cash sales.
  const invoices = filterByLoc(
    (typeof getAllInvoices === 'function' ? getAllInvoices() : getInvoices())
      .filter(invoice => !invoice.deleted)
  );

  // Admin sees branch-wide figures.
  // Staff sees only invoices they personally created.
  const ownInvoices = admin
    ? invoices
    : invoices.filter(
        invoice => dashboardCreatedBy(invoice) === currentUser.id
      );

  const now = new Date();

  const today = startOfLocalDay(now);

  const weekStart = startOfWeek(now);

  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const previousWeek = new Date(weekStart);
  previousWeek.setDate(previousWeek.getDate() - 7);

  // ----------------------------------------------------------
  // SALES PERIODS
  // ----------------------------------------------------------

  const todayInvoices = ownInvoices.filter(invoice =>
    dashboardCreatedAt(invoice) >= today
  );

  const weekInvoices = ownInvoices.filter(invoice => {
    const createdAt = dashboardCreatedAt(invoice);

    return createdAt >= weekStart &&
      createdAt < nextWeek;
  });

  const lastWeekInvoices = ownInvoices.filter(invoice => {
    const createdAt = dashboardCreatedAt(invoice);

    return createdAt >= previousWeek &&
      createdAt < weekStart;
  });

  const outstandingInvoices = ownInvoices.filter(invoice =>
    !dashboardIsWalkIn(invoice) &&
    ['pending', 'partial'].includes(String(invoice.status || '').toLowerCase())
  );

  const weekTotal = weekInvoices.reduce(
    (sum, invoice) => sum + dashboardInvoiceTotal(invoice),
    0
  );

  const lastWeekTotal = lastWeekInvoices.reduce(
    (sum, invoice) => sum + dashboardInvoiceTotal(invoice),
    0
  );

  const todayTotal = todayInvoices.reduce(
    (sum, invoice) => sum + dashboardInvoiceTotal(invoice),
    0
  );

  const outstandingTotal = outstandingInvoices.reduce(
    (sum, invoice) => sum + dashboardBalanceDue(invoice),
    0
  );

  // ----------------------------------------------------------
  // SUMMARY LABELS
  // ----------------------------------------------------------

  const todayLabel = document.getElementById('stat-today-label');
  const weekLabel = document.getElementById('stat-week-label');
  const pendingLabel = document.getElementById('stat-pending-label');

  if (todayLabel) {
    todayLabel.textContent = admin
      ? "Today's Sales"
      : 'Your Sales Today';
  }

  if (weekLabel) {
    weekLabel.textContent = admin
      ? 'This Week'
      : 'Your Sales This Week';
  }

  if (pendingLabel) {
    pendingLabel.textContent = admin
      ? 'Outstanding'
      : 'Your Outstanding';
  }

  // ----------------------------------------------------------
  // SUMMARY CARDS
  // ----------------------------------------------------------

  const todayElement = document.getElementById('stat-today');
  const todayDescription = document.getElementById('stat-today-d');

  const weekElement = document.getElementById('stat-week');
  const weekDescription = document.getElementById('stat-week-d');

  const pendingElement = document.getElementById('stat-pending');
  const pendingDescription = document.getElementById('stat-pending-d');

  const customerElement = document.getElementById('stat-customers');

  if (todayElement) {
    todayElement.textContent = fmtGHS(todayTotal);
  }

  if (todayDescription) {
    todayDescription.textContent =
      todayInvoices.length +
      ' invoice' +
      (todayInvoices.length !== 1 ? 's' : '');
  }

  if (weekElement) {
    weekElement.textContent = fmtGHS(weekTotal);
  }

  if (weekDescription) {
    weekDescription.innerHTML =
      weekInvoices.length +
      ' invoices ' +
      weekComparisonLabel(weekTotal, lastWeekTotal);
  }

  if (pendingElement) {
    pendingElement.textContent = fmtGHS(outstandingTotal);
  }

  if (pendingDescription) {
    pendingDescription.textContent =
      outstandingInvoices.length +
      ' outstanding invoice' +
      (outstandingInvoices.length !== 1 ? 's' : '');
  }

  if (customerElement) {
    customerElement.textContent =
      filterByLoc(getCustomers()).length;
  }

  // ----------------------------------------------------------
  // RECENT INVOICES
  // ----------------------------------------------------------

  const recent = [...ownInvoices]
    .sort(
      (a, b) =>
        dashboardCreatedAt(b) - dashboardCreatedAt(a)
    )
    .slice(0, 6);

  const recentBody = document.getElementById('dash-recent-body');

  if (recentBody) {
    recentBody.innerHTML = recent.length === 0
      ? `
        <tr>
          <td colspan="4"
              style="text-align:center;color:var(--gray-400);padding:32px">
            No invoices yet
          </td>
        </tr>
      `
      : recent.map(invoice => {
          const invoiceNumber =
            invoice.number ||
            invoice.invoiceNumber ||
            invoice.invoice_number ||
            '—';

          const customerName =
            invoice.customerName ||
            invoice.customer_name ||
            'Walk-in Customer';

          return `
            <tr
              style="cursor:pointer"
              onclick="viewInvoice('${escapeHtml(invoice.id)}')"
            >
              <td class="mono">
                ${escapeHtml(invoiceNumber)}
              </td>

              <td>
                ${escapeHtml(customerName)}
              </td>

              <td class="mono">
                ${fmtGHS(dashboardInvoiceTotal(invoice))}
              </td>

              <td>
                ${statusBadge(invoice.status)}
              </td>
            </tr>
          `;
        }).join('');
  }

  // ----------------------------------------------------------
  // LOW STOCK
  // ----------------------------------------------------------

  renderDashboardLowStock();

  // ----------------------------------------------------------
  // PAYMENT BREAKDOWN
  // ----------------------------------------------------------

  renderDashboardPaymentBreakdown(ownInvoices, today, new Date(today).setDate(today.getDate() + 1));

  // ----------------------------------------------------------
  // WEEKLY CHART
  // ----------------------------------------------------------

  renderWeeklyChart(ownInvoices);
}


// ============================================================
// LOW STOCK
// ============================================================

function renderDashboardLowStock() {
  const container = document.getElementById('low-stock-list');

  if (!container || !currentUser) return;

  const products = getProducts().filter(
    product => product.is_active !== false &&
      product.isActive !== false
  );

  const branches = getBranches();

  const assignedIds = currentUser.role === 'admin'
    ? branches.map(branch => branch.id)
    : (currentUser.branchIds || []);

  let lowStockItems = [];

  products.forEach(product => {
    const reorderLevel = dashboardProductReorder(product);

    const relevantBranches = branches.filter(
      branch => assignedIds.includes(branch.id)
    );

    relevantBranches.forEach(branch => {
      // Admin's selected branch takes priority.
      if (
        isAdmin() &&
        currentLocation &&
        currentLocation !== 'All' &&
        currentLocation !== branch.id
      ) {
        return;
      }

      const stock = getDashboardProductBranchStock(
        product,
        branch.id
      );

      if (stock <= reorderLevel) {
        lowStockItems.push({
          product,
          branch,
          stock,
          reorderLevel
        });
      }
    });
  });

  lowStockItems.sort((a, b) => a.stock - b.stock);

  lowStockItems = lowStockItems.slice(0, 6);

  if (lowStockItems.length === 0) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:var(--gray-400);font-size:13px">
        All products well-stocked ✓
      </div>
    `;

    return;
  }

  container.innerHTML = lowStockItems.map(item => {
    const { product, branch, stock, reorderLevel } = item;

    const percentage = Math.min(
      100,
      Math.round(
        stock / Math.max(reorderLevel * 2, 1) * 100
      )
    );

    const cssClass = stock <= 0 ? 'critical' : 'low';

    // Stock adjustment is not available until the secure
    // MRA stock-adjustment RPC is implemented.
    const productName = dashboardProductName(product);

    return `
      <div class="low-stock-item">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">
            ${escapeHtml(productName)}
          </div>

          <div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">
            ${escapeHtml(branch.branch_name)}
            · Stock: ${stock}
            · Reorder: ${reorderLevel}
          </div>

          <div class="stock-bar-wrap" style="margin-top:6px">
            <div
              class="stock-bar ${cssClass}"
              style="width:${percentage}%"
            ></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}


// ============================================================
// PAYMENT BREAKDOWN
// Uses actual payment records, not invoice totals.
//
// The invoice payment records must be loaded by the API and
// attached to each invoice as `payments` or `invoice_payments`.
// If they are unavailable, the panel stays hidden rather than
// presenting misleading payment totals.
// ============================================================

function renderDashboardPaymentBreakdown(invoices, dayStart, dayEnd) {
  const panel = document.getElementById('dash-pm-panel');

  if (!panel) return;

  let cashTotal = 0;
  let momoTotal = 0;
  let hasPaymentRecords = false;

  invoices.forEach(invoice => {
    const createdAt = dashboardCreatedAt(invoice);

    if (dashboardIsWalkIn(invoice)) {
      if (createdAt >= dayStart && createdAt < dayEnd) {
        cashTotal += dashboardAmountPaid(invoice) || dashboardInvoiceTotal(invoice);
        hasPaymentRecords = true;
      }
      return;
    }

    const payments = invoice.payments ||
      invoice.invoice_payments ||
      [];

    if (Array.isArray(payments) && payments.length) {
      payments.forEach(payment => {
        const paymentAt = dashboardPaymentDate(payment) || createdAt;
        if (paymentAt < dayStart || paymentAt >= dayEnd) return;

        hasPaymentRecords = true;

        const amount = dashboardValue(payment.amount);

        const method = dashboardPaymentMethod(payment);

        if (method === 'cash') cashTotal += amount;
        if (method === 'momo') momoTotal += amount;
      });
      return;
    }

    // Older invoice responses may contain the aggregate payment but not the
    // nested payment row. Only use this fallback on the invoice's creation
    // day so a historical invoice is not counted again every morning.
    if (createdAt >= dayStart && createdAt < dayEnd) {
      const amount = dashboardAmountPaid(invoice);
      const method = String(
        invoice.payMethod ||
        invoice.pay_method ||
        invoice.payment_method ||
        ''
      ).toLowerCase();

      if (amount > 0 && method === 'cash') cashTotal += amount;
      if (amount > 0 && method === 'momo') momoTotal += amount;
      if (amount > 0) hasPaymentRecords = true;
    }
  });

  panel.style.display = 'grid';

  const cashElement = document.getElementById('stat-cash');
  const momoElement = document.getElementById('stat-momo');

  const cashLabel = document.getElementById('stat-cash-label');
  const momoLabel = document.getElementById('stat-momo-label');

  if (cashElement) {
    cashElement.textContent = fmtGHS(cashTotal);
  }

  if (momoElement) {
    momoElement.textContent = fmtGHS(momoTotal);
  }

  if (cashLabel) {
    cashLabel.textContent = isAdmin()
      ? '💵 Cash Today'
      : '💵 Your Cash Today';
  }

  if (momoLabel) {
    momoLabel.textContent = isAdmin()
      ? '📱 MoMo Today'
      : '📱 Your MoMo Today';
  }
}

function dashboardIsWalkIn(invoice) {
  return Boolean(
    invoice.isCashSale ||
    invoice.is_cash_sale ||
    !(invoice.customerId || invoice.customer_id)
  );
}

function dashboardPaymentDate(payment) {
  const value = payment.at ||
    payment.payment_date ||
    payment.paymentDate ||
    payment.created_at ||
    payment.createdAt;

  if (!value) return null;
  const timestamp = asTimestamp(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dashboardPaymentMethod(payment) {
  return String(
    payment.method ||
    payment.payment_method ||
    payment.paymentMethod ||
    ''
  ).toLowerCase();
}


// ============================================================
// WEEKLY SALES CHART
// ============================================================

function renderWeeklyChart(invoices) {
  const container = document.getElementById('weekly-chart');

  if (!container) return;

  const days = [];

  const { start } = weekRange();

  for (let i = 0; i < 7; i++) {
    const day = new Date(start);

    day.setDate(day.getDate() + i);

    const nextDay = new Date(day);

    nextDay.setDate(nextDay.getDate() + 1);

    const total = invoices
      .filter(invoice => {
        const createdAt = dashboardCreatedAt(invoice);

        return createdAt >= day && createdAt < nextDay;
      })
      .reduce(
        (sum, invoice) =>
          sum + dashboardInvoiceTotal(invoice),
        0
      );

    days.push({
      label: day.toLocaleDateString('en', {
        weekday: 'short'
      }),
      total
    });
  }

  const max = Math.max(
    ...days.map(day => day.total),
    1
  );

  container.innerHTML = days.map(day => {
    const height = Math.round(
      day.total / max * 100
    );

    return `
      <div class="chart-bar-wrap">
        <div style="font-size:9px;color:var(--gray-400);font-family:var(--font-mono)">
          ${day.total > 0 ? 'GH₵' + Math.round(day.total) : ''}
        </div>

        <div
          class="chart-bar"
          style="height:${height}px"
        ></div>

        <div class="chart-bar-label">
          ${day.label}
        </div>
      </div>
    `;
  }).join('');
}