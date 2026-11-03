// ============================================================
// MRA SYSTEMS — APPLICATION BOOTSTRAP
// ============================================================

// ============================================================
// OFFLINE STATUS
// ============================================================

function updateOfflineBadge() {
  const el = document.getElementById('offline-badge');

  if (el) {
    el.style.display = navigator.onLine ? 'none' : 'block';
  }
}

window.addEventListener('online', updateOfflineBadge);
window.addEventListener('offline', updateOfflineBadge);

window.addEventListener('online', () => {
  if (typeof currentUser !== 'undefined' && currentUser &&
      typeof syncSupabaseCache === 'function') {
    syncSupabaseCache()
      .then(() => {
      const activePage = document.querySelector('.page.active');
      if (activePage && typeof renderPage === 'function') {
        renderPage(activePage.id.replace('page-', ''));
      }
        if (typeof toast === 'function') toast('Connection restored. Data refreshed.', 'success');
      })
      .catch(error => console.warn('Online data refresh failed:', error));
  }
});

updateOfflineBadge();


// ============================================================
// GLOBAL SEARCH
// ============================================================

function globalSearch(value) {
  if (value && /^\d{4,}$/.test(value)) {
    navigate('invoices', null);
    filterInvoices(value);
  }
}

document.getElementById('global-search')?.addEventListener(
  'input',
  event => globalSearch(event.target.value.trim())
);


// ============================================================
// INITIALIZE APPLICATION DATA
// ============================================================

if (typeof initData === 'function') {
  initData();
}


// ============================================================
// RESTORE AUTHENTICATED SESSION
// auth.js owns restoreSession().
// ============================================================

async function startMRAApplication() {
  try {
    if (typeof window.restoreSession !== 'function') {
      throw new Error(
        'MRA authentication module was not loaded correctly.'
      );
    }

    await window.restoreSession();

  } catch (error) {
    console.error('MRA startup error:', error);

    if (typeof showAuthScreen === 'function') {
      showAuthScreen();
    }
  }
}

// Wait until the page is ready before restoring the session.
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    startMRAApplication,
    { once: true }
  );
} else {
  startMRAApplication();
}


// ============================================================
// SERVICE WORKER — PWA
// ============================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log(
          'MRA Systems: Service Worker registered',
          registration.scope
        );
      })
      .catch(error => {
        console.error(
          'MRA Service Worker registration failed:',
          error
        );
      });
  });
}


// ============================================================
// GLOBAL EXPORTS
// For HTML onclick attributes.
// ============================================================

const mraGlobalFunctions = [
  'openEditInvoiceModal',
  'saveEditedInvoice',
  'updateInvoice',
  'addItem',
  'shareInvoice',
  '_copyAndCloseShare',
  '_sendViaSMS',
  '_selectMpdMethod',
  '_confirmMarkPaid',
  '_shareViaWhatsAppOrCopy'
];

mraGlobalFunctions.forEach(name => {
  if (typeof window[name] === 'function') {
    window[name] = window[name];
  }
});