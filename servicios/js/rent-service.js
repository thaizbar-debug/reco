/**
 * Reco Servicios — Rent Payment Service Layer
 * PaymentProvider abstraction, lease management, payment processing.
 *
 * SECURITY:
 * - NO card numbers, CVV, or sensitive payment data stored in frontend.
 * - PaymentProvider.createCheckout returns a hosted URL/token — the PSP
 *   handles card entry in its own iframe/redirect.
 * - Payment confirmation MUST be validated server-side via webhook.
 * - Frontend status is optimistic; real status comes from PSP webhook.
 * - Idempotency keys prevent duplicate charges.
 *
 * ⚠️ MOCK: Uses MockPaymentProvider for development.
 * Real implementation: swap via PaymentProviderRegistry.setProvider(realAdapter).
 */

const RENT_PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
});

const RENT_PAYMENT_STATUS_LABELS = Object.freeze({
  [RENT_PAYMENT_STATUS.PENDING]: 'Pendiente',
  [RENT_PAYMENT_STATUS.PROCESSING]: 'Procesando',
  [RENT_PAYMENT_STATUS.SUCCESS]: 'Pagado',
  [RENT_PAYMENT_STATUS.FAILED]: 'Rechazado',
  [RENT_PAYMENT_STATUS.REFUNDED]: 'Reembolsado',
  [RENT_PAYMENT_STATUS.CANCELLED]: 'Cancelado',
});

const RENT_PAYMENT_STATUS_COLORS = Object.freeze({
  [RENT_PAYMENT_STATUS.PENDING]: { color: 'var(--amber)', bg: 'var(--amber-bg)' },
  [RENT_PAYMENT_STATUS.PROCESSING]: { color: 'var(--accent)', bg: 'var(--accent-light)' },
  [RENT_PAYMENT_STATUS.SUCCESS]: { color: 'var(--green)', bg: 'var(--green-bg)' },
  [RENT_PAYMENT_STATUS.FAILED]: { color: 'var(--red)', bg: 'var(--red-bg)' },
  [RENT_PAYMENT_STATUS.REFUNDED]: { color: 'var(--ink-3)', bg: 'var(--paper-2)' },
  [RENT_PAYMENT_STATUS.CANCELLED]: { color: 'var(--ink-3)', bg: 'var(--paper-2)' },
});

const RENT_LEASE_STATUS = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  TERMINATED: 'terminated',
});

const RENT_EVENTS = Object.freeze({
  RENT_DUE_SOON: 'rent_due_soon',
  RENT_PAYMENT_SUCCESS: 'rent_payment_success',
  RENT_PAYMENT_FAILED: 'rent_payment_failed',
});

// --- Payment Fee Configuration ---
// NOT hardcoded — editable per deployment.

const PAYMENT_FEE_CONFIG = (() => {
  let _config = {
    transactionFeePercent: 2.9,
    transactionFeeFixed: 0,
    currency: 'PEN',
    currencySymbol: 'S/',
    revenueSharePercent: 0,
    minAmount: 100,
    maxAmount: 50000,
  };

  return {
    get() { return { ..._config }; },
    set(overrides) { _config = { ..._config, ...overrides }; },
    calculateFee(amount) {
      return Math.round((amount * _config.transactionFeePercent / 100 + _config.transactionFeeFixed) * 100) / 100;
    },
    formatAmount(amount) {
      return `${_config.currencySymbol} ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    formatPEN(amount) {
      return 'S/ ' + (amount || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },
    formatUSD(amount) {
      return 'US$ ' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },
    formatDate(dateStr) {
      if (!dateStr) return '—';
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
  };
})();

// --- Payment Provider Abstraction ---

const PaymentProviderRegistry = (() => {
  let _active = null;

  const MockPaymentProvider = {
    name: 'MockPSP',
    _isMock: true,

    createCheckout(paymentData) {
      const idempotencyKey = paymentData.idempotencyKey || ('idk-' + Date.now().toString(36));
      return {
        checkoutId: 'chk-' + Date.now().toString(36).toUpperCase(),
        idempotencyKey,
        status: 'created',
        hostedUrl: null,
        _isMock: true,
        _note: 'En producción, este objeto contiene la URL del checkout hosted del PSP. El usuario es redirigido allí para ingresar datos de tarjeta de forma segura.',
      };
    },

    getPaymentStatus(checkoutId) {
      return {
        checkoutId,
        status: RENT_PAYMENT_STATUS.SUCCESS,
        _isMock: true,
        _note: 'En producción, el status real viene del webhook del PSP, no del frontend.',
      };
    },

    refundPayment(paymentId) {
      return {
        refundId: 'ref-' + Date.now().toString(36).toUpperCase(),
        paymentId,
        status: 'refunded',
        _isMock: true,
      };
    },

    handleWebhook(payload) {
      return { processed: true, _isMock: true };
    },

    getSupportedMethods() {
      return [
        { id: 'mock_hosted', label: 'Pagar con tarjeta (mock)', icon: '💳', description: 'Checkout hosted simulado' },
      ];
    },
  };

  return {
    setProvider(provider) { _active = provider; },
    getProvider() { return _active || MockPaymentProvider; },
    MockPaymentProvider,
  };
})();

// --- Lease & Rent Management ---

const RentService = (() => {
  const _mockLeases = [
    {
      id: 'lease-mock-1',
      status: RENT_LEASE_STATUS.ACTIVE,
      role: 'tenant',
      property: {
        address: 'Av. Pardo 456, Dpto 1201',
        district: 'Miraflores',
        propertyType: 'departamento',
        area: 85,
      },
      landlord: { name: 'María García López', phone: '999111222', email: 'maria@example.com' },
      tenant: { name: 'Carlos Sánchez', phone: '987654321', email: 'carlos@example.com' },
      monthlyRent: 3200,
      currency: 'PEN',
      dueDay: 5,
      startDate: '2025-06-01',
      endDate: '2026-05-31',
      _isMock: true,
    },
    {
      id: 'lease-mock-2',
      status: RENT_LEASE_STATUS.ACTIVE,
      role: 'tenant',
      property: {
        address: 'Jr. Los Cedros 789',
        district: 'San Isidro',
        propertyType: 'departamento',
        area: 120,
      },
      landlord: { name: 'José Rodríguez Pérez', phone: '999333444', email: 'jose@example.com' },
      tenant: { name: 'Carlos Sánchez', phone: '987654321', email: 'carlos@example.com' },
      monthlyRent: 5400,
      currency: 'PEN',
      dueDay: 1,
      startDate: '2025-01-15',
      endDate: '2026-01-14',
      _isMock: true,
    },
  ];

  let _payments = [
    {
      id: 'PAY-MOCK-001',
      leaseId: 'lease-mock-1',
      amount: 3200,
      fee: PAYMENT_FEE_CONFIG.calculateFee(3200),
      total: 3200 + PAYMENT_FEE_CONFIG.calculateFee(3200),
      status: RENT_PAYMENT_STATUS.SUCCESS,
      period: '2026-07',
      periodLabel: 'Julio 2026',
      method: 'Tarjeta ****4532',
      paidAt: '2026-07-04T14:30:00Z',
      createdAt: '2026-07-04T14:28:00Z',
      checkoutId: 'chk-MOCK001',
      idempotencyKey: 'idk-mock-001',
      receiptId: 'REC-MOCK-001',
      _isMock: true,
    },
    {
      id: 'PAY-MOCK-002',
      leaseId: 'lease-mock-1',
      amount: 3200,
      fee: PAYMENT_FEE_CONFIG.calculateFee(3200),
      total: 3200 + PAYMENT_FEE_CONFIG.calculateFee(3200),
      status: RENT_PAYMENT_STATUS.SUCCESS,
      period: '2026-06',
      periodLabel: 'Junio 2026',
      method: 'Tarjeta ****4532',
      paidAt: '2026-06-03T10:15:00Z',
      createdAt: '2026-06-03T10:12:00Z',
      checkoutId: 'chk-MOCK002',
      idempotencyKey: 'idk-mock-002',
      receiptId: 'REC-MOCK-002',
      _isMock: true,
    },
    {
      id: 'PAY-MOCK-003',
      leaseId: 'lease-mock-1',
      amount: 3200,
      fee: PAYMENT_FEE_CONFIG.calculateFee(3200),
      total: 3200 + PAYMENT_FEE_CONFIG.calculateFee(3200),
      status: RENT_PAYMENT_STATUS.FAILED,
      period: '2026-05',
      periodLabel: 'Mayo 2026',
      method: 'Tarjeta ****7891',
      paidAt: null,
      createdAt: '2026-05-05T09:00:00Z',
      checkoutId: 'chk-MOCK003',
      idempotencyKey: 'idk-mock-003',
      receiptId: null,
      _isMock: true,
    },
  ];

  function getLeases(role) {
    if (role) return _mockLeases.filter(l => l.role === role);
    return [..._mockLeases];
  }

  function getLeaseById(id) {
    return _mockLeases.find(l => l.id === id) || null;
  }

  function getNextDueDate(lease) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let due = new Date(year, month, lease.dueDay);
    if (due <= now) due = new Date(year, month + 1, lease.dueDay);
    return due;
  }

  function getDueStatus(lease) {
    const due = getNextDueDate(lease);
    const now = new Date();
    const daysUntil = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return { label: 'Vencido', color: 'var(--red)', bg: 'var(--red-bg)', daysUntil };
    if (daysUntil <= 3) return { label: 'Vence pronto', color: 'var(--amber)', bg: 'var(--amber-bg)', daysUntil };
    return { label: 'Al día', color: 'var(--green)', bg: 'var(--green-bg)', daysUntil };
  }

  function isCurrentPeriodPaid(leaseId) {
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return _payments.some(p => p.leaseId === leaseId && p.period === currentPeriod && p.status === RENT_PAYMENT_STATUS.SUCCESS);
  }

  function getPaymentsByLease(leaseId) {
    return _payments.filter(p => p.leaseId === leaseId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function getAllPayments() {
    return [..._payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function createPayment(leaseId, period, periodLabel) {
    const lease = getLeaseById(leaseId);
    if (!lease) return { error: 'Contrato no encontrado' };

    const fee = PAYMENT_FEE_CONFIG.calculateFee(lease.monthlyRent);
    const total = lease.monthlyRent + fee;
    const idempotencyKey = `rent-${leaseId}-${period}-${Date.now().toString(36)}`;

    const checkout = PaymentProviderRegistry.getProvider().createCheckout({
      amount: total,
      currency: lease.currency,
      description: `Alquiler ${periodLabel} — ${lease.property.address}`,
      idempotencyKey,
      metadata: { leaseId, period },
    });

    const payment = {
      id: 'PAY-' + Date.now().toString(36).toUpperCase(),
      leaseId,
      amount: lease.monthlyRent,
      fee,
      total,
      status: RENT_PAYMENT_STATUS.PENDING,
      period,
      periodLabel,
      method: null,
      paidAt: null,
      createdAt: new Date().toISOString(),
      checkoutId: checkout.checkoutId,
      idempotencyKey,
      receiptId: null,
      _isMock: checkout._isMock || false,
    };

    _payments.unshift(payment);
    return { payment, checkout };
  }

  function simulatePaymentResult(paymentId, success) {
    const payment = _payments.find(p => p.id === paymentId);
    if (!payment) return { error: 'Pago no encontrado' };

    if (success) {
      payment.status = RENT_PAYMENT_STATUS.SUCCESS;
      payment.paidAt = new Date().toISOString();
      payment.method = 'Tarjeta (mock checkout)';
      payment.receiptId = 'REC-' + Date.now().toString(36).toUpperCase();
    } else {
      payment.status = RENT_PAYMENT_STATUS.FAILED;
    }
    return payment;
  }

  function getPayment(paymentId) {
    return _payments.find(p => p.id === paymentId) || null;
  }

  // Landlord view helpers
  function getLandlordPayments(landlordName) {
    const landlordLeases = _mockLeases.filter(l => l.landlord.name === landlordName);
    const leaseIds = landlordLeases.map(l => l.id);
    return _payments.filter(p => leaseIds.includes(p.leaseId));
  }

  return {
    getLeases, getLeaseById,
    getNextDueDate, getDueStatus, isCurrentPeriodPaid,
    getPaymentsByLease, getAllPayments, getPayment,
    createPayment, simulatePaymentResult,
    getLandlordPayments,
  };
})();
