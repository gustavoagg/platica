/* ═══════════════════════════════════════════════════════════
   PLATICA — App Logic
   Supabase client · Auth · CRUD · Balance calc · Rendering
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Config ─────────────────────────────────────────
// ⚠️ REPLACE THESE with your Supabase project credentials
const SUPABASE_URL = 'https://ytccoqferwryeyxgihvk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Jm7eC3HcmES9DDUhZVvWAg_hODUlaVH';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── App State ───────────────────────────────────────────────
const state = {
  user: null,        // { id, username, role, display_name }
  accounts: [],      // [{ id, name, initial_balance }]
  transactions: [],  // full list from DB
  filter: 'all',     // 'all' | 'zelle' | 'uruguay' | 'transfer'
  editing: null,      // transaction being edited, or null
  formType: 'zelle', // current form type selection
};

// ── Helpers ─────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function formatUSD(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatNumber(n, decimals = 2) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Ahora';
  if (mins < 60) return `hace ${mins}m`;
  if (hrs < 24) return `hace ${hrs}h`;
  if (days < 7) return `hace ${days}d`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Screen Navigation ───────────────────────────────────────
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Toast ───────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Loading ─────────────────────────────────────────────────
function showLoading(show = true) {
  $('loading-overlay').classList.toggle('active', show);
}

// ── Modal ───────────────────────────────────────────────────
function showModal(icon, title, message, confirmText, onConfirm) {
  $('modal-icon').textContent = icon;
  $('modal-title').textContent = title;
  $('modal-message').textContent = message;
  $('modal-confirm').textContent = confirmText;
  $('modal-overlay').classList.add('active');

  const handler = () => {
    $('modal-overlay').classList.remove('active');
    $('modal-confirm').removeEventListener('click', handler);
    onConfirm();
  };
  $('modal-confirm').addEventListener('click', handler);
}

$('modal-cancel').addEventListener('click', () => {
  $('modal-overlay').classList.remove('active');
});

$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) {
    $('modal-overlay').classList.remove('active');
  }
});

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════

async function login(username, password) {
  const { data, error } = await sb
    .from('users')
    .select('*')
    .eq('username', username.toLowerCase().trim())
    .eq('password', password)
    .single();

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
      throw new Error('Debes ejecutar el SQL setup-supabase.sql en Supabase primero');
    }
    throw new Error('Usuario o contraseña incorrectos');
  }

  if (!data) {
    throw new Error('Usuario o contraseña incorrectos');
  }

  state.user = data;
  sessionStorage.setItem('platica_user', JSON.stringify(data));
  return data;
}



function logout() {
  state.user = null;
  sessionStorage.removeItem('platica_user');
  showScreen('login-screen');
  $('login-username').value = '';
  $('login-password').value = '';
}

function restoreSession() {
  const stored = sessionStorage.getItem('platica_user');
  if (stored) {
    state.user = JSON.parse(stored);
    return true;
  }
  return false;
}

function isAdmin() {
  return state.user && state.user.role === 'admin';
}

// ═══════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════

async function loadAccounts() {
  const { data, error } = await sb
    .from('accounts')
    .select('*')
    .order('name');

  if (error) throw error;
  state.accounts = data;
  return data;
}

async function loadTransactions() {
  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .order('date', { ascending: false });

  if (error) throw error;
  state.transactions = data;
  return data;
}

async function loadData() {
  await Promise.all([loadAccounts(), loadTransactions()]);
}

// ═══════════════════════════════════════════════════════════
// BALANCE CALCULATIONS
// ═══════════════════════════════════════════════════════════

function getAccountId(name) {
  const acc = state.accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
  return acc ? acc.id : null;
}

function getAccountInitialBalance(name) {
  const acc = state.accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
  return acc ? parseFloat(acc.initial_balance) : 0;
}

function calculateBalance(accountName) {
  const accountId = getAccountId(accountName);
  let balance = getAccountInitialBalance(accountName);

  for (const tx of state.transactions) {
    if (tx.type === 'zelle' && tx.account_id === accountId) {
      const amount = parseFloat(tx.amount) || 0;
      const commission = parseFloat(tx.commission) || 0;
      if (tx.direction === 'income') {
        balance += amount - commission;
      } else {
        balance -= amount + commission;
      }
    }

    if (tx.type === 'uruguay' && tx.account_id === accountId) {
      const usdAmount = parseFloat(tx.usd_amount) || 0;
      const commissionUSD = parseFloat(tx.commission_usd) || 0;
      const totalDeducted = parseFloat(tx.total_uy_deducted) || (usdAmount + commissionUSD);
      balance -= totalDeducted;
    }

    if (tx.type === 'transfer') {
      if (tx.from_account_id === accountId) {
        balance -= parseFloat(tx.amount_deducted) || 0;
      }
      if (tx.to_account_id === accountId) {
        balance += parseFloat(tx.net_received) || 0;
      }
    }
  }

  return balance;
}

// ═══════════════════════════════════════════════════════════
// RENDERING — MAIN SCREEN
// ═══════════════════════════════════════════════════════════

function renderBalances() {
  const zelleBalance = calculateBalance('Zelle');
  const uruguayBalance = calculateBalance('Uruguay');
  const globalBalance = zelleBalance + uruguayBalance;

  $('global-balance').textContent = formatUSD(globalBalance);
  $('zelle-balance').textContent = formatUSD(zelleBalance);
  $('uruguay-balance').textContent = formatUSD(uruguayBalance);
}

function renderUserBadge() {
  const badge = $('user-badge');
  badge.textContent = state.user.display_name || state.user.username;
  badge.className = `user-badge ${state.user.role}`;
}

function getFilteredTransactions() {
  if (state.filter === 'all') return state.transactions;
  return state.transactions.filter(tx => tx.type === state.filter);
}

function renderTransactions() {
  const list = $('transactions-list');
  const filtered = getFilteredTransactions();

  $('tx-count').textContent = `${filtered.length} movimiento${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">No hay movimientos</div>
        <div class="empty-state-hint">${isAdmin() ? 'Toca + para agregar uno' : 'Los administradores pueden agregar transacciones'}</div>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(tx => renderTransactionItem(tx)).join('');
}

function renderTransactionItem(tx) {
  const typeConfig = {
    zelle: { icon: '⚡', label: 'Zelle' },
    uruguay: { icon: '🇺🇾', label: 'Uruguay' },
    transfer: { icon: '🔄', label: 'Transfer' },
  };

  const config = typeConfig[tx.type];
  let amountDisplay = '';
  let amountClass = '';
  let commissionText = '';

  if (tx.type === 'zelle') {
    const amount = parseFloat(tx.amount) || 0;
    const commission = parseFloat(tx.commission) || 0;
    if (tx.direction === 'income') {
      amountDisplay = `+${formatUSD(amount)}`;
      amountClass = 'income';
    } else {
      amountDisplay = `-${formatUSD(amount)}`;
      amountClass = 'expense';
    }
    if (commission > 0) {
      commissionText = `Comisión: ${formatUSD(commission)}`;
    }
  } else if (tx.type === 'uruguay') {
    const usd = parseFloat(tx.usd_amount) || 0;
    const comUSD = parseFloat(tx.commission_usd) || 0;
    const totalDeducted = parseFloat(tx.total_uy_deducted) || (usd + comUSD);
    amountDisplay = `-${formatUSD(totalDeducted)}`;
    amountClass = 'expense';
    const bs = parseFloat(tx.bs_amount) || 0;
    const usdt = parseFloat(tx.usdt_amount) || usd;
    if (tx.step2_completed || bs > 0) {
      commissionText = `→ ${formatNumber(bs)} Bs`;
    } else {
      commissionText = `→ ${formatNumber(usdt)} USDT (Paso 1)`;
    }
  } else if (tx.type === 'transfer') {
    const fromAcc = state.accounts.find(a => a.id === tx.from_account_id);
    const toAcc = state.accounts.find(a => a.id === tx.to_account_id);
    const amount = parseFloat(tx.transfer_amount) || 0;
    amountDisplay = formatUSD(amount);
    amountClass = 'transfer-out';
    commissionText = `${fromAcc?.name || '?'} → ${toAcc?.name || '?'}`;
  }

  const description = tx.description || (tx.type === 'transfer' ? 'Transferencia entre cuentas' : 'Sin descripción');

  return `
    <div class="transaction-item type-${tx.type}" data-id="${tx.id}" onclick="viewTransaction('${tx.id}')">
      <div class="tx-row">
        <div class="tx-icon">${config.icon}</div>
        <div class="tx-info">
          <div class="tx-description">${escapeHtml(description)}</div>
          <div class="tx-meta">
            <span class="tx-type-badge">${config.label}</span>
            <span class="tx-date">${formatDate(tx.step1_date || tx.date)}</span>
          </div>
        </div>
        <div class="tx-amount-col">
          <div class="tx-amount ${amountClass}">${amountDisplay}</div>
          ${commissionText ? `<div class="tx-commission">${commissionText}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMain() {
  renderBalances();
  renderUserBadge();
  renderTransactions();

  // Show/hide FAB based on role
  $('fab').style.display = isAdmin() ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════════
// RENDERING — DETAIL SCREEN
// ═══════════════════════════════════════════════════════════

function viewTransaction(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;

  $('detail-title').textContent = tx.type === 'zelle' ? 'Detalle Zelle' : tx.type === 'uruguay' ? 'Detalle Uruguay' : 'Detalle Transferencia';
  $('detail-edit-btn').style.display = isAdmin() ? '' : 'none';
  $('detail-edit-btn').onclick = () => openEditForm(tx);

  let html = '';

  if (tx.type === 'zelle') {
    const amount = parseFloat(tx.amount) || 0;
    const commission = parseFloat(tx.commission) || 0;
    html = `
      <div class="balance-global" style="background: linear-gradient(135deg, #6C2BD9, #5521B5); margin-bottom: 16px;">
        <div class="balance-label">${tx.direction === 'income' ? '📈 Ingreso' : '📉 Egreso'} Zelle</div>
        <div class="balance-amount">${tx.direction === 'income' ? '+' : '-'}${formatUSD(amount)}</div>
        ${commission > 0 ? `<div class="balance-currency">Comisión: ${formatUSD(commission)}</div>` : ''}
      </div>
      <div class="form-group">
        <div class="form-label">Descripción</div>
        <div style="font-size: 0.95rem; padding: 8px 0;">${escapeHtml(tx.description || 'Sin descripción')}</div>
      </div>
      <div class="form-group">
        <div class="form-label">Fecha</div>
        <div style="font-size: 0.95rem; padding: 8px 0;">${formatDateFull(tx.date)}</div>
      </div>
    `;
  } else if (tx.type === 'uruguay') {
    const usd = parseFloat(tx.usd_amount) || 0;
    const comUSD = parseFloat(tx.commission_usd) || 0;
    const totalDeducted = parseFloat(tx.total_uy_deducted) || (usd + comUSD);
    const bs = parseFloat(tx.bs_amount) || 0;
    const usdt = parseFloat(tx.usdt_amount) || usd;
    const isStep2Done = tx.step2_completed || bs > 0;

    html = `
      <div class="balance-global" style="background: linear-gradient(135deg, #059669, #047857); margin-bottom: 16px;">
        <div class="balance-label">📉 Egreso Uruguay</div>
        <div class="balance-amount">-${formatUSD(totalDeducted)}</div>
        <div class="balance-currency">${isStep2Done ? `→ ${formatNumber(bs)} Bs` : `→ ${formatNumber(usdt)} USDT (Paso 1)`}</div>
      </div>

      <div class="form-section-title">Paso 1: Pesos (ITAU) → USDT</div>
      <div class="tx-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
        <div class="tx-detail-item">
          <span class="tx-detail-label">Monto U$S</span>
          <span class="tx-detail-value">${formatUSD(usd)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Tasa U$S/UYU (ITAU)</span>
          <span class="tx-detail-value">${formatNumber(parseFloat(tx.itau_rate || tx.exchange_rate) || 0, 4)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Tasa USDT (Binance)</span>
          <span class="tx-detail-value">${formatNumber(parseFloat(tx.binance_usdt_rate) || 0, 4)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Comisión adicional U$S</span>
          <span class="tx-detail-value" style="color: var(--expense);">${formatUSD(comUSD)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Total descontado UY</span>
          <span class="tx-detail-value" style="font-weight: 700; color: var(--expense);">-${formatUSD(totalDeducted)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">USDT Resultante</span>
          <span class="tx-detail-value">${formatNumber(usdt)} USDT</span>
        </div>
        <div class="tx-detail-item" style="grid-column: 1 / -1;">
          <span class="tx-detail-label">Fecha Paso 1</span>
          <span class="tx-detail-value">${formatDateFull(tx.step1_date || tx.date)}</span>
        </div>
      </div>

      <div class="form-section-title" style="margin-top: 16px;">Paso 2: USDT → Bs</div>
      ${isStep2Done ? `
        <div class="tx-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
          <div class="tx-detail-item">
            <span class="tx-detail-label">Tasa P2P (Bs/USDT)</span>
            <span class="tx-detail-value">${formatNumber(parseFloat(tx.usdt_p2p_rate) || 0, 4)}</span>
          </div>
          <div class="tx-detail-item">
            <span class="tx-detail-label">Fecha Paso 2</span>
            <span class="tx-detail-value">${formatDateFull(tx.step2_date || tx.date)}</span>
          </div>
          <div class="tx-detail-item" style="grid-column: 1 / -1; background: var(--income-bg); padding: 12px; border-radius: 8px;">
            <span class="tx-detail-label" style="color: var(--income);">Monto Final en Bs</span>
            <span class="tx-detail-value" style="font-size: 1.2rem; color: var(--income);">${formatNumber(bs)} Bs</span>
          </div>
        </div>
      ` : `
        <div style="padding: 12px; background: var(--transfer-bg); border: 1px dashed var(--transfer); border-radius: 8px; margin-top: 8px; text-align: center;">
          <div style="font-weight: 600; color: var(--transfer); font-size: 0.9rem;">⏳ Paso 2 pendiente</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Toca "Editar" cuando se realice la conversión a Bolívares para ingresar la tasa P2P.</div>
        </div>
      `}

      <div class="form-group" style="margin-top: 16px;">
        <div class="form-label">Descripción</div>
        <div style="font-size: 0.95rem; padding: 8px 0;">${escapeHtml(tx.description || 'Sin descripción')}</div>
      </div>
    `;
  } else if (tx.type === 'transfer') {
    const fromAcc = state.accounts.find(a => a.id === tx.from_account_id);
    const toAcc = state.accounts.find(a => a.id === tx.to_account_id);
    const transferAmount = parseFloat(tx.transfer_amount) || 0;
    const comFrom = parseFloat(tx.commission_from_usd ?? tx.commission_from) || 0;
    const comTo = parseFloat(tx.commission_to_usd ?? tx.commission_to) || 0;
    const deducted = parseFloat(tx.amount_deducted) || (transferAmount + comFrom);
    const received = parseFloat(tx.net_received) || Math.max(0, transferAmount - comTo);

    html = `
      <div class="balance-global" style="background: linear-gradient(135deg, #F59E0B, #D97706); margin-bottom: 16px;">
        <div class="balance-label">🔄 Transferencia</div>
        <div class="balance-amount">${formatUSD(transferAmount)}</div>
        <div class="balance-currency">${fromAcc?.name || '?'} → ${toAcc?.name || '?'}</div>
      </div>
      <div class="tx-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="tx-detail-item">
          <span class="tx-detail-label">Monto a Transferir</span>
          <span class="tx-detail-value">${formatUSD(transferAmount)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Com. Origen (${fromAcc?.name || '?'})</span>
          <span class="tx-detail-value">${comFrom > 0 ? formatUSD(comFrom) : 'Sin comisión ($0)'}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Deducido de ${fromAcc?.name || '?'}</span>
          <span class="tx-detail-value" style="color: var(--expense); font-weight: 700;">-${formatUSD(deducted)}</span>
        </div>
        <div class="tx-detail-item">
          <span class="tx-detail-label">Com. Destino (${toAcc?.name || '?'})</span>
          <span class="tx-detail-value">${comTo > 0 ? formatUSD(comTo) : 'Sin comisión ($0)'}</span>
        </div>
        <div class="tx-detail-item" style="grid-column: 1 / -1; background: var(--income-bg); padding: 12px; border-radius: 8px;">
          <span class="tx-detail-label" style="color: var(--income);">Recibido en ${toAcc?.name || '?'}</span>
          <span class="tx-detail-value" style="font-size: 1.2rem; color: var(--income); font-weight: 700;">+${formatUSD(received)}</span>
        </div>
      </div>
      ${(comFrom === 0 && comTo === 0) ? `
        <div style="padding: 10px 12px; background: var(--primary-50); border: 1px dashed var(--primary); border-radius: 8px; margin-top: 12px; font-size: 0.82rem; color: var(--text-secondary); text-align: center;">
          💡 Puedes editar la transacción en cualquier momento para agregar las comisiones bancarias cuando se confirmen.
        </div>
      ` : ''}
      <div class="form-group" style="margin-top: 16px;">
        <div class="form-label">Descripción</div>
        <div style="font-size: 0.95rem; padding: 8px 0;">${escapeHtml(tx.description || 'Transferencia entre cuentas')}</div>
      </div>
      <div class="form-group">
        <div class="form-label">Fecha</div>
        <div style="font-size: 0.95rem; padding: 8px 0;">${formatDateFull(tx.date)}</div>
      </div>
    `;
  }

  // Audit trail
  html += `
    <div class="tx-audit" style="margin-top: 16px; padding: 12px; background: var(--primary-50); border-radius: 8px; flex-direction: column; align-items: flex-start; gap: 4px;">
      <div><span class="tx-audit-icon">✍️</span> Creado por <strong>${escapeHtml(tx.created_by)}</strong> · ${formatDateFull(tx.created_at)}</div>
      ${tx.modified_by ? `<div><span class="tx-audit-icon">📝</span> Modificado por <strong>${escapeHtml(tx.modified_by)}</strong> · ${formatDateFull(tx.updated_at)}</div>` : ''}
    </div>
  `;

  $('detail-content').innerHTML = html;
  showScreen('detail-screen');
}

// ═══════════════════════════════════════════════════════════
// FORM — CREATE / EDIT
// ═══════════════════════════════════════════════════════════

function openNewForm() {
  state.editing = null;
  state.formType = 'zelle';
  $('form-title').textContent = 'Nueva Transacción';
  $('form-delete-btn').style.display = 'none';

  // Enable type selector
  $$('#type-selector .type-option').forEach(btn => {
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
  });

  renderTypeSelector();
  renderFormFields();
  showScreen('form-screen');
}

function openEditForm(tx) {
  state.editing = tx;
  state.formType = tx.type;
  $('form-title').textContent = 'Editar Transacción';
  $('form-delete-btn').style.display = '';

  // Lock type selector when editing
  $$('#type-selector .type-option').forEach(btn => {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.5';
  });

  renderTypeSelector();
  renderFormFields();
  populateFormFields(tx);
  showScreen('form-screen');
}

function renderTypeSelector() {
  $$('#type-selector .type-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.type === state.formType);
  });
}

function renderFormFields() {
  const container = $('form-fields');
  const type = state.formType;

  if (type === 'zelle') {
    container.innerHTML = `
      <div class="form-group">
        <div class="form-label">Dirección</div>
        <div class="direction-toggle">
          <button type="button" class="direction-option selected expense" data-dir="expense" onclick="selectDirection('expense')">
            📉 Egreso
          </button>
          <button type="button" class="direction-option income" data-dir="income" onclick="selectDirection('income')">
            📈 Ingreso
          </button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-description">Descripción</label>
        <input id="f-description" class="form-input" placeholder="Ej: Pago de servicios" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-amount">Monto (USD)</label>
          <input id="f-amount" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-commission">Comisión (USD)</label>
          <input id="f-commission" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" value="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-date">Fecha</label>
        <input id="f-date" class="form-input" type="datetime-local" value="${getLocalDatetime()}">
      </div>
    `;
  } else if (type === 'uruguay') {
    container.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="f-description">Descripción</label>
        <input id="f-description" class="form-input" placeholder="Ej: Envío para gastos del mes">
      </div>

      <div class="form-section-title">Paso 1: Pesos UYU → USDT (Obligatorio)</div>

      <div class="form-group">
        <label class="form-label" for="f-step1-date">Fecha Paso 1</label>
        <input id="f-step1-date" class="form-input" type="datetime-local" value="${getLocalDatetime()}">
      </div>

      <div class="form-group">
        <label class="form-label" for="f-usd-amount">Monto en U$S a egresar</label>
        <input id="f-usd-amount" class="form-input" type="number" step="0.01" min="0" placeholder="100.00" oninput="calcUruguay()" required>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-itau-rate">Tasa U$S/UYU (ITAU)</label>
          <input id="f-itau-rate" class="form-input" type="number" step="0.0001" min="0" placeholder="42.50" oninput="calcUruguay()" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-binance-usdt-rate">Tasa USDT (Binance)</label>
          <input id="f-binance-usdt-rate" class="form-input" type="number" step="0.0001" min="0" placeholder="43.10" oninput="calcUruguay()" required>
        </div>
      </div>

      <div class="form-row" style="margin-top: 8px;">
        <div class="form-group">
          <div class="form-label">Diferencia de Tasa</div>
          <div class="form-calculated" id="f-rate-diff-display">0.0000 UYU</div>
        </div>
        <div class="form-group">
          <div class="form-label">Comisión adicional U$S</div>
          <div class="form-calculated" id="f-commission-usd-display" style="color: var(--expense); border-color: var(--expense);">$0.00</div>
        </div>
      </div>

      <div class="form-row" style="margin-top: 8px;">
        <div class="form-group">
          <div class="form-label">Total a descontar UY</div>
          <div class="form-calculated" id="f-total-deducted-display" style="font-weight: 700; color: var(--expense); border-color: var(--expense);">$0.00</div>
        </div>
        <div class="form-group">
          <div class="form-label">USDT Resultante</div>
          <div class="form-calculated" id="f-usdt-display" style="font-weight: 700; color: var(--primary-dark);">0.00 USDT</div>
        </div>
      </div>

      <div class="form-section-title" style="margin-top: 24px;">Paso 2: USDT → Bolívares (Opcional)</div>
      
      <div class="form-group">
        <label class="form-label" for="f-step2-date">Fecha Paso 2</label>
        <input id="f-step2-date" class="form-input" type="datetime-local" value="${getLocalDatetime()}">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-usdt-p2p-rate">Tasa P2P (Bs / USDT)</label>
          <input id="f-usdt-p2p-rate" class="form-input" type="number" step="0.01" min="0" placeholder="115.50" oninput="calcUruguay()">
          <div class="form-hint">Cargar para calcular saldo final en Bs</div>
        </div>
        <div class="form-group">
          <div class="form-label">Monto Final en Bs</div>
          <div class="form-calculated" id="f-bs-display" style="font-weight: 700; color: var(--income); border-color: var(--income);">Pendiente</div>
        </div>
      </div>
    `;
  } else if (type === 'transfer') {
    const zelleId = getAccountId('Zelle');
    const uruguayId = getAccountId('Uruguay');
    container.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="f-description">Descripción</label>
        <input id="f-description" class="form-input" placeholder="Ej: Transferencia para operar">
      </div>

      <div class="form-group">
        <div class="form-label">Dirección de la Transferencia</div>
        <div class="account-selector">
          <div class="account-pill selected" id="from-pill" data-account="${zelleId}">⚡ Zelle</div>
          <div class="account-arrow">→</div>
          <div class="account-pill" id="to-pill" data-account="${uruguayId}">🇺🇾 Uruguay</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-block" onclick="swapTransferAccounts()" style="margin-top: 4px;">🔄 Invertir dirección</button>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-transfer-amount">Monto a Transferir (U$S)</label>
        <input id="f-transfer-amount" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" oninput="calcTransfer()" required>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-commission-from-usd">Comisión Origen (U$S)</label>
          <input id="f-commission-from-usd" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" value="0" oninput="calcTransfer()">
          <div class="form-hint">Opcional (se puede editar luego)</div>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-commission-to-usd">Comisión Destino (U$S)</label>
          <input id="f-commission-to-usd" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" value="0" oninput="calcTransfer()">
          <div class="form-hint">Opcional (se puede editar luego)</div>
        </div>
      </div>

      <div class="form-row" style="margin-top: 8px;">
        <div class="form-group">
          <div class="form-label">Deducido de Origen</div>
          <div class="form-calculated" id="f-deducted-display" style="color: var(--expense); border-color: var(--expense);">-$0.00</div>
        </div>
        <div class="form-group">
          <div class="form-label">Recibido en Destino</div>
          <div class="form-calculated" id="f-received-display" style="color: var(--income); border-color: var(--income);">+$0.00</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-date">Fecha</label>
        <input id="f-date" class="form-input" type="datetime-local" value="${getLocalDatetime()}">
      </div>
    `;
  }
}

function getLocalDatetime() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function selectDirection(dir) {
  $$('.direction-option').forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.dir === dir) btn.classList.add('selected');
  });
}

function calcUruguay() {
  const usd = parseFloat($('f-usd-amount')?.value) || 0;
  const itauRate = parseFloat($('f-itau-rate')?.value) || 0;
  const binanceRate = parseFloat($('f-binance-usdt-rate')?.value) || 0;

  let rateDiff = 0;
  let commissionUSD = 0;
  let totalDeductedUSD = 0;
  let usdtAmount = 0;

  if (itauRate > 0 && binanceRate > 0) {
    rateDiff = binanceRate - itauRate;
    commissionUSD = (rateDiff / itauRate) * usd;
    totalDeductedUSD = usd + commissionUSD;
    usdtAmount = usd;
  }

  if ($('f-rate-diff-display')) $('f-rate-diff-display').textContent = `${formatNumber(rateDiff, 4)} UYU`;
  if ($('f-commission-usd-display')) $('f-commission-usd-display').textContent = formatUSD(commissionUSD);
  if ($('f-total-deducted-display')) $('f-total-deducted-display').textContent = formatUSD(totalDeductedUSD);
  if ($('f-usdt-display')) $('f-usdt-display').textContent = `${formatNumber(usdtAmount)} USDT`;

  const p2pRate = parseFloat($('f-usdt-p2p-rate')?.value) || 0;
  const bsAmount = usdtAmount * p2pRate;

  if ($('f-bs-display')) $('f-bs-display').textContent = p2pRate > 0 ? `${formatNumber(bsAmount)} Bs` : 'Pendiente';
}

function calcTransfer() {
  const amount = parseFloat($('f-transfer-amount')?.value) || 0;
  const comFromUSD = parseFloat($('f-commission-from-usd')?.value) || 0;
  const comToUSD = parseFloat($('f-commission-to-usd')?.value) || 0;

  const deducted = amount + comFromUSD;
  const received = Math.max(0, amount - comToUSD);

  if ($('f-deducted-display')) $('f-deducted-display').textContent = `-${formatUSD(deducted)}`;
  if ($('f-received-display')) $('f-received-display').textContent = `+${formatUSD(received)}`;
}

function swapTransferAccounts() {
  const fromPill = $('from-pill');
  const toPill = $('to-pill');

  const fromAccId = fromPill.dataset.account;
  const fromHtml = fromPill.innerHTML;
  const toAccId = toPill.dataset.account;
  const toHtml = toPill.innerHTML;

  fromPill.dataset.account = toAccId;
  fromPill.innerHTML = toHtml;
  toPill.dataset.account = fromAccId;
  toPill.innerHTML = fromHtml;

  calcTransfer();
}

function populateFormFields(tx) {
  if (tx.type === 'zelle') {
    selectDirection(tx.direction || 'expense');
    if ($('f-description')) $('f-description').value = tx.description || '';
    if ($('f-amount')) $('f-amount').value = tx.amount || '';
    if ($('f-commission')) $('f-commission').value = tx.commission || 0;
    if ($('f-date')) $('f-date').value = toLocalDatetime(tx.date);
  } else if (tx.type === 'uruguay') {
    if ($('f-description')) $('f-description').value = tx.description || '';
    if ($('f-usd-amount')) $('f-usd-amount').value = tx.usd_amount || '';
    if ($('f-itau-rate')) $('f-itau-rate').value = tx.itau_rate || tx.exchange_rate || '';
    if ($('f-binance-usdt-rate')) $('f-binance-usdt-rate').value = tx.binance_usdt_rate || '';
    if ($('f-step1-date')) $('f-step1-date').value = toLocalDatetime(tx.step1_date || tx.date);

    if ($('f-usdt-p2p-rate')) $('f-usdt-p2p-rate').value = tx.usdt_p2p_rate || '';
    if ($('f-step2-date')) $('f-step2-date').value = toLocalDatetime(tx.step2_date || tx.date);
    calcUruguay();
  } else if (tx.type === 'transfer') {
    if ($('f-description')) $('f-description').value = tx.description || '';
    if ($('f-transfer-amount')) $('f-transfer-amount').value = tx.transfer_amount || '';
    if ($('f-commission-from-usd')) $('f-commission-from-usd').value = tx.commission_from_usd ?? tx.commission_from ?? 0;
    if ($('f-commission-to-usd')) $('f-commission-to-usd').value = tx.commission_to_usd ?? tx.commission_to ?? 0;
    if ($('f-date')) $('f-date').value = toLocalDatetime(tx.date);

    const fromPill = $('from-pill');
    const toPill = $('to-pill');
    const zelleId = getAccountId('Zelle');
    const uruguayId = getAccountId('Uruguay');

    if (tx.from_account_id === uruguayId) {
      fromPill.dataset.account = uruguayId;
      fromPill.innerHTML = '🇺🇾 Uruguay';
      toPill.dataset.account = zelleId;
      toPill.innerHTML = '⚡ Zelle';
    } else {
      fromPill.dataset.account = zelleId;
      fromPill.innerHTML = '⚡ Zelle';
      toPill.dataset.account = uruguayId;
      toPill.innerHTML = '🇺🇾 Uruguay';
    }

    calcTransfer();
  }
}

function toLocalDatetime(dateStr) {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

// ═══════════════════════════════════════════════════════════
// SAVE / DELETE TRANSACTION
// ═══════════════════════════════════════════════════════════

async function saveTransaction() {
  const type = state.formType;
  const isEdit = !!state.editing;

  let data = {
    type,
    description: $('f-description')?.value?.trim() || null,
    date: new Date($('f-date')?.value || new Date()).toISOString(),
  };

  if (isEdit) {
    data.modified_by = state.user.username;
  } else {
    data.created_by = state.user.username;
  }

  if (type === 'zelle') {
    const direction = document.querySelector('.direction-option.selected')?.dataset.dir || 'expense';
    const amount = parseFloat($('f-amount')?.value);
    if (!amount || amount <= 0) {
      showToast('Ingresa un monto válido', 'error');
      return;
    }
    data.account_id = getAccountId('Zelle');
    data.direction = direction;
    data.amount = amount;
    data.commission = parseFloat($('f-commission')?.value) || 0;
  } else if (type === 'uruguay') {
    const usdAmount = parseFloat($('f-usd-amount')?.value);
    const itauRate = parseFloat($('f-itau-rate')?.value);
    const binanceRate = parseFloat($('f-binance-usdt-rate')?.value);

    if (!usdAmount || usdAmount <= 0 || !itauRate || itauRate <= 0 || !binanceRate || binanceRate <= 0) {
      showToast('Completa los datos del Paso 1 (Monto U$S, Tasa ITAU y Tasa Binance)', 'error');
      return;
    }

    const rateDiff = binanceRate - itauRate;
    const commissionUSD = (rateDiff / itauRate) * usdAmount;
    const totalDeducted = usdAmount + commissionUSD;
    const usdtAmount = usdAmount;

    const step1Date = new Date($('f-step1-date')?.value || new Date()).toISOString();

    const p2pRate = parseFloat($('f-usdt-p2p-rate')?.value) || null;
    const step2DateVal = $('f-step2-date')?.value;
    const step2Date = p2pRate && step2DateVal ? new Date(step2DateVal).toISOString() : null;
    const bsAmount = p2pRate ? usdtAmount * p2pRate : null;
    const step2Completed = !!p2pRate && p2pRate > 0;

    data.account_id = getAccountId('Uruguay');
    data.direction = 'expense';
    data.date = step1Date;
    data.step1_date = step1Date;
    data.usd_amount = usdAmount;
    data.itau_rate = itauRate;
    data.exchange_rate = itauRate;
    data.binance_usdt_rate = binanceRate;
    data.rate_diff = rateDiff;
    data.commission_usd = commissionUSD;
    data.total_uy_deducted = totalDeducted;
    data.usdt_amount = usdtAmount;

    data.usdt_p2p_rate = p2pRate;
    data.bs_amount = bsAmount;
    data.step2_date = step2Date;
    data.step2_completed = step2Completed;
    if (tx.from_account_id === uruguayId) {
      fromPill.dataset.account = uruguayId;
      fromPill.innerHTML = '🇺🇾 Uruguay';
      toPill.dataset.account = zelleId;
      toPill.innerHTML = '⚡ Zelle';
    }

    calcTransfer();
  }
}

function toLocalDatetime(dateStr) {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

// ═══════════════════════════════════════════════════════════
// SAVE / DELETE TRANSACTION
// ═══════════════════════════════════════════════════════════

async function saveTransaction() {
  const type = state.formType;
  const isEdit = !!state.editing;

  let data = {
    type,
    description: $('f-description')?.value?.trim() || null,
    date: new Date($('f-date')?.value || new Date()).toISOString(),
  };

  if (isEdit) {
    data.modified_by = state.user.username;
  } else {
    data.created_by = state.user.username;
  }

  if (type === 'zelle') {
    const direction = document.querySelector('.direction-option.selected')?.dataset.dir || 'expense';
    const amount = parseFloat($('f-amount')?.value);
    if (!amount || amount <= 0) {
      showToast('Ingresa un monto válido', 'error');
      return;
    }
    data.account_id = getAccountId('Zelle');
    data.direction = direction;
    data.amount = amount;
    data.commission = parseFloat($('f-commission')?.value) || 0;
  } else if (type === 'uruguay') {
    const usdAmount = parseFloat($('f-usd-amount')?.value);
    const exchangeRate = parseFloat($('f-exchange-rate')?.value);
    if (!usdAmount || usdAmount <= 0 || !exchangeRate || exchangeRate <= 0) {
      showToast('Ingresa monto USD y tasa de cambio', 'error');
      return;
    }
    const binanceCommission = parseFloat($('f-binance-commission')?.value) || 0;
    const p2pCommission = parseFloat($('f-p2p-commission')?.value) || 0;
    const uyuAmount = usdAmount * exchangeRate;
    const usdtAmount = usdAmount * (1 - binanceCommission / 100);
    const bsAmount = parseFloat($('f-bs-amount')?.value) || 0;

    data.account_id = getAccountId('Uruguay');
    data.direction = 'expense';
    data.usd_amount = usdAmount;
    data.exchange_rate = exchangeRate;
    data.uyu_amount = uyuAmount;
    data.binance_commission = binanceCommission;
    data.usdt_amount = usdtAmount;
    data.p2p_commission = p2pCommission;
    data.bs_amount = bsAmount;
  } else if (type === 'transfer') {
    const amount = parseFloat($('f-transfer-amount')?.value);
    if (!amount || amount <= 0) {
      showToast('Ingresa un monto válido', 'error');
      return;
    }
    const comFromUSD = parseFloat($('f-commission-from-usd')?.value) || 0;
    const comToUSD = parseFloat($('f-commission-to-usd')?.value) || 0;

    data.from_account_id = $('from-pill').dataset.account;
    data.to_account_id = $('to-pill').dataset.account;
    data.transfer_amount = amount;
    data.commission_from = comFromUSD;
    data.commission_to = comToUSD;
    data.amount_deducted = amount + comFromUSD;
    data.net_received = Math.max(0, amount - comToUSD);
  }

  showLoading(true);

  try {
    if (isEdit) {
      const { error } = await sb
        .from('transactions')
        .update(data)
        .eq('id', state.editing.id);
      if (error) throw error;
      showToast('Transacción actualizada');
    } else {
      const { error } = await sb
        .from('transactions')
        .insert(data);
      if (error) throw error;
      showToast('Transacción creada');
    }

    await loadTransactions();
    renderMain();
    showScreen('main-screen');
  } catch (err) {
    console.error('Save error:', err);
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function deleteTransaction(id) {
  showLoading(true);
  try {
    const { error } = await sb
      .from('transactions')
      .delete()
      .eq('id', id);
    if (error) throw error;

    await loadTransactions();
    renderMain();
    showScreen('main-screen');
    showToast('Transacción eliminada');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════

// Login
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('login-username').value;
  const password = $('login-password').value;
  const btn = $('login-btn');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Entrando...';
  $('login-error').classList.remove('visible');

  try {
    await login(username, password);
    await loadData();
    renderMain();
    showScreen('main-screen');
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Entrar';
  }
});

// Logout
$('logout-btn').addEventListener('click', logout);

// FAB
$('fab').addEventListener('click', openNewForm);

// Filter tabs
$('filter-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  $$('.filter-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  state.filter = tab.dataset.filter;
  renderTransactions();
});

// Type selector
$('type-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-option');
  if (!btn || state.editing) return;
  state.formType = btn.dataset.type;
  renderTypeSelector();
  renderFormFields();
});

// Form actions
$('form-save-btn').addEventListener('click', saveTransaction);
$('form-cancel-btn').addEventListener('click', () => showScreen('main-screen'));
$('form-back-btn').addEventListener('click', () => showScreen('main-screen'));

// Form delete
$('form-delete-btn').addEventListener('click', () => {
  if (!state.editing) return;
  showModal(
    '🗑️',
    '¿Eliminar transacción?',
    'Esta acción no se puede deshacer.',
    'Eliminar',
    () => deleteTransaction(state.editing.id)
  );
});

// Detail back
$('detail-back-btn').addEventListener('click', () => showScreen('main-screen'));

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

async function init() {
  // Check if Supabase is configured
  if (SUPABASE_URL.includes('YOUR_PROJECT')) {
    $('login-error').textContent = '⚠️ Configura SUPABASE_URL y SUPABASE_ANON_KEY en app.js';
    $('login-error').classList.add('visible');
    $('login-btn').disabled = true;
    return;
  }

  if (restoreSession()) {
    showLoading(true);
    try {
      await loadData();
      renderMain();
      showScreen('main-screen');
    } catch (err) {
      console.error('Init error:', err);
      logout();
    } finally {
      showLoading(false);
    }
  }
}

init();
