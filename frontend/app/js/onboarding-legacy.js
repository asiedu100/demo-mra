// ============================================================
// ONBOARDING — business setup wizard (admins) + feature tour (staff)
// ============================================================

// Called once from showApp() on every session start. Admin and staff
// wizards are mutually exclusive by role, so no collision handling needed.
function maybeShowOnboarding() {
  if (!currentUser) return;
  if (isAdmin() && !isOnboardingComplete()) { openBusinessSetupWizard(); return; }
  if (currentUser.role === 'staff' && !currentUser.hasSeenTour) { openStaffTourModal(); return; }
}

// ------------------------------------------------------------
// BUSINESS SETUP WIZARD
// ------------------------------------------------------------
const WIZ_TOTAL_STEPS = 5;
let bizWizardStep = 1;

function openBusinessSetupWizard() {
  if (!isAdmin()) return;
  bizWizardStep = 1;
  const settings = getBusinessSettings() || {};
  document.getElementById('wiz-business-name').value = settings.business_name || '';
  document.getElementById('wiz-phone').value = settings.phone || '';
  document.getElementById('wiz-address').value = settings.address || '';
  document.getElementById('wiz-currency').value = settings.currency_symbol || 'GH₵';
  document.getElementById('wiz-reorder').value = settings.default_reorder_level ?? 10;
  document.getElementById('wiz-brand-color').value = settings.brand_color || '#5C2D0A';
  document.getElementById('wiz-brand-color-hex').textContent = settings.brand_color || '#5C2D0A';
  updateWizLogoPreview(settings.logo_url);
  document.getElementById('wiz-step2-error').style.display = 'none';
  openModal('business-setup-wizard-modal');
  renderWizardStep();
}

function updateWizLogoPreview(url) {
  const img = document.getElementById('wiz-logo-preview');
  const empty = document.getElementById('wiz-logo-preview-empty');
  if (url) { img.src = url; img.style.display = ''; empty.style.display = 'none'; }
  else { img.style.display = 'none'; empty.style.display = ''; }
}

function renderWizardStep() {
  document.querySelectorAll('#business-setup-wizard-modal .wiz-step').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === bizWizardStep);
  });
  const dots = document.getElementById('wiz-dots');
  dots.innerHTML = '';
  for (let i = 1; i <= WIZ_TOTAL_STEPS; i++) {
    const dot = document.createElement('span');
    dot.className = 'wiz-dot' + (i === bizWizardStep ? ' active' : '');
    dots.appendChild(dot);
  }
  document.getElementById('wiz-back-btn').style.display = bizWizardStep === 1 ? 'none' : '';
  document.getElementById('wiz-next-btn').style.display = bizWizardStep === WIZ_TOTAL_STEPS ? 'none' : '';
  document.getElementById('wiz-finish-btn').style.display = bizWizardStep === WIZ_TOTAL_STEPS ? '' : 'none';
  if (bizWizardStep === WIZ_TOTAL_STEPS) renderWizardReview();
}

function renderWizardReview() {
  const name = document.getElementById('wiz-business-name').value.trim() || '(not set)';
  const phone = document.getElementById('wiz-phone').value.trim() || '(not set)';
  const address = document.getElementById('wiz-address').value.trim() || '(not set)';
  const currency = document.getElementById('wiz-currency').value.trim() || 'GH₵';
  const reorder = document.getElementById('wiz-reorder').value || '10';
  document.getElementById('wiz-review-summary').innerHTML =
    `<div><strong>${escapeHtml(name)}</strong></div>` +
    `<div>${escapeHtml(phone)}</div>` +
    `<div>${escapeHtml(address)}</div>` +
    `<div>Currency: ${escapeHtml(currency)} &nbsp;·&nbsp; Reorder at: ${escapeHtml(String(reorder))}</div>`;
}

function wizardNext() {
  const errEl = document.getElementById('wiz-step2-error');
  errEl.style.display = 'none';
  if (bizWizardStep === 2) {
    const name = document.getElementById('wiz-business-name').value.trim();
    if (!name) { errEl.textContent = 'Business name is required.'; errEl.style.display = 'block'; return; }
  }
  if (bizWizardStep < WIZ_TOTAL_STEPS) { bizWizardStep++; renderWizardStep(); }
}

function wizardBack() {
  if (bizWizardStep > 1) { bizWizardStep--; renderWizardStep(); }
}

// Retargets the existing applyBrandColor() (core.js) at the wizard's own
// colour field instead of the live Settings page's.
function previewBrandColorWizard() {
  const hex = document.getElementById('wiz-brand-color').value;
  document.getElementById('wiz-brand-color-hex').textContent = hex;
  applyBrandColor(hex);
}

// Mirrors uploadLogoFile() (settings.js) but targets the wizard's own field
// IDs — the underlying Supabase calls are identical.
async function uploadLogoFileWizard() {
  if (!requireAdmin('change the logo')) return;
  const input = document.getElementById('wiz-logo-file');
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > LOGO_MAX_BYTES) { toast('Logo must be under 2MB', 'error'); input.value = ''; return; }
  try {
    const url = await window.LumodaSupabase.uploadLogo(file);
    const saved = await window.LumodaSupabase.saveLogoUrl(url);
    if (saved) LS.set('lumoda_business_settings', saved);
    updateWizLogoPreview(url);
    applyLogo(url);
    toast('Logo updated');
  } catch (error) {
    console.error('Logo upload failed:', error);
    toast(error.message || 'Could not upload logo', 'error');
  } finally {
    input.value = '';
  }
}

async function finishBusinessSetupWizard() {
  if (!requireAdmin('complete business setup')) return;
  const businessName = document.getElementById('wiz-business-name').value.trim();
  if (!businessName) {
    bizWizardStep = 2;
    renderWizardStep();
    const errEl = document.getElementById('wiz-step2-error');
    errEl.textContent = 'Business name is required.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const saved = await window.LumodaSupabase.saveBusinessSettings({
      businessName,
      phone:                document.getElementById('wiz-phone').value.trim(),
      address:              document.getElementById('wiz-address').value.trim(),
      currencySymbol:       document.getElementById('wiz-currency').value.trim() || 'GH₵',
      defaultReorderLevel:  document.getElementById('wiz-reorder').value,
      brandColor:           document.getElementById('wiz-brand-color').value
    });
    if (saved) {
      LS.set('lumoda_business_settings', saved);
      applyBrandColor(saved.brand_color);
      applyBusinessName(saved.business_name);
    }
    addAudit('Business Setup Completed', `${currentUser.fullName} completed the business setup wizard`);
    closeModal('business-setup-wizard-modal');
    toast('Business set up! You can fine-tune this anytime in Settings.');
  } catch (error) {
    console.error('Could not finish business setup:', error);
    toast(error.message || 'Could not save business settings', 'error');
  }
}

// Used by "Skip for now" and the modal's × alike — any dismissal counts as
// "seen" so the wizard doesn't reappear on the next login.
async function skipBusinessSetupWizard() {
  if (!confirm('Skip business setup for now? You can run it again anytime from Settings.')) return;
  closeModal('business-setup-wizard-modal');
  try {
    const saved = await window.LumodaSupabase.markOnboardingSeen();
    if (saved) LS.set('lumoda_business_settings', saved);
  } catch (error) {
    console.error('Could not update onboarding status:', error);
  }
}

// ------------------------------------------------------------
// STAFF FEATURE TOUR
// ------------------------------------------------------------
const TOUR_TOTAL_STEPS = 6;
// Steps with a mapped page call the app's existing navigate() so the real
// page renders behind the dimmed modal for context, instead of building a
// tooltip/spotlight system this codebase has no infrastructure for.
const TOUR_STEP_PAGES = { 2: 'dashboard', 3: 'invoices', 4: 'customers', 5: 'products' };
let staffTourStep = 1;

function openStaffTourModal() {
  staffTourStep = 1;
  const firstName = (currentUser?.fullName || '').split(' ')[0] || 'there';
  const heading = document.getElementById('tour-welcome-heading');
  if (heading) heading.textContent = `Welcome, ${firstName}!`;
  openModal('staff-tour-modal');
  renderTourStep();
}

function renderTourStep() {
  document.querySelectorAll('#staff-tour-modal .tour-step').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === staffTourStep);
  });
  const dots = document.getElementById('tour-dots');
  dots.innerHTML = '';
  for (let i = 1; i <= TOUR_TOTAL_STEPS; i++) {
    const dot = document.createElement('span');
    dot.className = 'tour-dot' + (i === staffTourStep ? ' active' : '');
    dots.appendChild(dot);
  }
  document.getElementById('tour-back-btn').style.display = staffTourStep === 1 ? 'none' : '';
  document.getElementById('tour-next-btn').style.display = staffTourStep === TOUR_TOTAL_STEPS ? 'none' : '';
  document.getElementById('tour-done-btn').style.display = staffTourStep === TOUR_TOTAL_STEPS ? '' : 'none';
  const page = TOUR_STEP_PAGES[staffTourStep];
  if (page) navigate(page, null);
}

function tourNext() { if (staffTourStep < TOUR_TOTAL_STEPS) { staffTourStep++; renderTourStep(); } }
function tourBack() { if (staffTourStep > 1) { staffTourStep--; renderTourStep(); } }

// Single function for Done, Skip, and the modal's × alike.
async function closeStaffTour() {
  closeModal('staff-tour-modal');
  navigate('dashboard', null);
  const alreadySeen = !!currentUser?.hasSeenTour;
  if (currentUser) currentUser.hasSeenTour = true;
  if (!alreadySeen) {
    try {
      await window.LumodaSupabase.completeStaffTour();
      addAudit('Staff Tour Completed', `${currentUser?.fullName || 'A staff member'} completed the onboarding tour`);
    } catch (error) {
      console.error('Could not save tour completion:', error);
    }
  }
  toast('You can replay the tour anytime from Settings.');
}
