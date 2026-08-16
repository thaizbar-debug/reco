/**
 * Reco Servicios — Rent UI
 * Renders: tenant dashboard, checkout flow, payment history, landlord view.
 * Uses RentService + PaymentProviderRegistry + PAYMENT_FEE_CONFIG for data.
 *
 * ⚠️ MOCK: Leases, payments, and checkout use simulated data.
 * Real implementation: swap PaymentProviderRegistry.setProvider(realAdapter).
 */

const RentUI = (() => {
  let _view = 'dashboard';
  let _selectedLeaseId = null;
  let _selectedPeriod = null;
  let _currentPayment = null;
  let _currentCheckout = null;
  let _viewRole = 'tenant';

  function reset() {
    _view = 'dashboard';
    _selectedLeaseId = null;
    _selectedPeriod = null;
    _currentPayment = null;
    _currentCheckout = null;
    _viewRole = 'tenant';
  }

  function render() {
    if (_view === 'checkout') return _renderCheckout();
    if (_view === 'processing') return _renderProcessing();
    if (_view === 'result') return _renderResult();
    if (_view === 'history') return _renderHistory();
    return _renderDashboard();
  }

  // === DASHBOARD VIEW ===
  function _renderDashboard() {
    const leases = RentService.getLeases('tenant');
    const feeConfig = PAYMENT_FEE_CONFIG.get();

    return `
      ${SectionHeader('Pagos', 'Paga tu alquiler de forma segura', 'Reco Rent te permite pagar tu alquiler con tarjeta. Acumula puntos, millas y difiere en cuotas. Sin contratos ni costos ocultos.')}

      <div class="rent-hero">
        <div class="leg-mock-tag">⚠️ MOCK — Datos simulados. No se realizarán pagos reales.</div>
        <div class="rent-hero-content">
          <div class="rent-hero-icon">💳</div>
          <div>
            <h3 class="font-serif" style="font-size:24px;margin:0 0 6px">Reco Rent</h3>
            <p style="color:var(--ink-3);margin:0 0 14px;font-size:14px;line-height:1.5">
              Paga tu alquiler con tarjeta de crédito o débito. Acumula millas, puntos LATAM Pass o Bonus.
              Comisión desde ${feeConfig.transactionFeePercent}%.
            </p>
            <ul class="rent-hero-list">
              <li>✓ Comisión desde ${feeConfig.transactionFeePercent}% — la más baja del mercado</li>
              <li>✓ Transferencia inmediata al propietario</li>
              <li>✓ Comprobante electrónico automático</li>
              <li>✓ Recordatorios mensuales</li>
            </ul>
          </div>
        </div>
        <div class="rent-role-toggle">
          <button class="rent-role-btn${_viewRole === 'tenant' ? ' active' : ''}" onclick="RentUI.setRole('tenant')">🔑 Inquilino</button>
          <button class="rent-role-btn${_viewRole === 'landlord' ? ' active' : ''}" onclick="RentUI.setRole('landlord')">🏠 Propietario</button>
        </div>
      </div>

      ${_viewRole === 'landlord' ? _renderLandlordSection() : _renderTenantSection(leases)}

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="RentUI.crossSell('agent')">
          <div class="val-cross-icon">🏠</div>
          <div>
            <strong>¿Buscas un agente inmobiliario?</strong>
            <span>Reco Agent — Te conectamos con el agente ideal</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="RentUI.crossSell('legal')">
          <div class="val-cross-icon">⚖️</div>
          <div>
            <strong>¿Necesitas revisar tu contrato?</strong>
            <span>Reco Legal — Revisión de contrato de alquiler</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('🔒 Seguridad', 'Los pagos son procesados por el PSP certificado PCI-DSS. Reco nunca almacena datos de tarjeta. El resultado del pago es validado por webhook del servidor.')}`;
  }

  function _renderTenantSection(leases) {
    if (leases.length === 0) {
      return EmptyState('No tienes contratos de alquiler activos');
    }

    return `
      <div class="rent-lease-section">
        <h3 class="font-serif" style="font-size:18px;margin:0 0 16px">Mis contratos</h3>
        <div class="rent-lease-grid">
          ${leases.map(l => _leaseCard(l)).join('')}
        </div>
      </div>
      <div style="text-align:center;margin-top:16px">
        <button class="plan-cta outline" style="width:auto;padding:10px 24px" onclick="RentUI.showHistory()">📋 Ver historial de pagos</button>
      </div>`;
  }

  function _leaseCard(lease) {
    const due = RentService.getNextDueDate(lease);
    const dueStatus = RentService.getDueStatus(lease);
    const isPaid = RentService.isCurrentPeriodPaid(lease.id);
    const dueStr = due.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });

    return `
      <div class="rent-lease-card">
        <div class="rent-lease-header">
          <div class="rent-lease-address">
            <strong>${lease.property.address}</strong>
            <span>${lease.property.district} · ${lease.property.area}m²</span>
          </div>
          <div class="rent-due-badge" style="background:${isPaid ? 'var(--green-bg)' : dueStatus.bg};color:${isPaid ? 'var(--green)' : dueStatus.color}">
            ${isPaid ? '✓ Pagado' : dueStatus.label}
          </div>
        </div>
        <div class="rent-lease-details">
          <div class="rent-detail-row"><span>Propietario</span><strong>${lease.landlord.name}</strong></div>
          <div class="rent-detail-row"><span>Monto mensual</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(lease.monthlyRent)}</strong></div>
          <div class="rent-detail-row"><span>Próximo vencimiento</span><strong>${dueStr}</strong></div>
          <div class="rent-detail-row"><span>Contrato</span><strong>${lease.startDate} → ${lease.endDate}</strong></div>
        </div>
        ${!isPaid ? `
          <button class="plan-cta" style="margin-top:14px" onclick="RentUI.startCheckout('${lease.id}')">💳 Pagar alquiler</button>
        ` : `
          <div class="rent-paid-notice"><span>✅</span> Periodo actual pagado</div>
        `}
        ${lease._isMock ? '<div class="rent-mock-tag">Mock</div>' : ''}
      </div>`;
  }

  // === CHECKOUT VIEW ===
  function startCheckout(leaseId) {
    _selectedLeaseId = leaseId;
    const now = new Date();
    _selectedPeriod = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    _currentPayment = null;
    _currentCheckout = null;
    _view = 'checkout';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.RENT_PAYMENT_STARTED, { lease_id: leaseId, period: _selectedPeriod });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderCheckout() {
    const lease = RentService.getLeaseById(_selectedLeaseId);
    if (!lease) return ErrorState('Contrato no encontrado');

    const fee = PAYMENT_FEE_CONFIG.calculateFee(lease.monthlyRent);
    const total = lease.monthlyRent + fee;
    const feeConfig = PAYMENT_FEE_CONFIG.get();
    const provider = PaymentProviderRegistry.getProvider();
    const methods = provider.getSupportedMethods();
    const periodLabel = _getPeriodLabel(_selectedPeriod);

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="RentUI.backToDashboard()">← Volver a mis contratos</button>

        <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — No se realizará ningún cargo real. En producción, el checkout hosted del PSP maneja los datos de tarjeta de forma segura.</div>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#E0F2FE;color:#0369A1">💳 Reco Rent</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Pagar alquiler</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Revisa los datos y procede al pago seguro.</p>
        </div>

        <div class="rent-checkout-card">
          <h4>📍 Propiedad</h4>
          <div class="rent-detail-row"><span>Dirección</span><strong>${lease.property.address}</strong></div>
          <div class="rent-detail-row"><span>Distrito</span><strong>${lease.property.district}</strong></div>
          <div class="rent-detail-row"><span>Propietario</span><strong>${lease.landlord.name}</strong></div>
        </div>

        <div class="rent-checkout-card">
          <h4>💰 Detalle del pago</h4>
          <div class="rent-detail-row"><span>Periodo</span><strong>${periodLabel}</strong></div>
          <div class="rent-detail-row"><span>Alquiler</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(lease.monthlyRent)}</strong></div>
          <div class="rent-detail-row"><span>Comisión (${feeConfig.transactionFeePercent}%)</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(fee)}</strong></div>
          <div class="rent-detail-row rent-total"><span>Total a pagar</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(total)}</strong></div>
        </div>

        <div class="rent-checkout-card">
          <h4>💳 Método de pago</h4>
          <div class="rent-methods">
            ${methods.map(m => `
              <div class="rent-method-option">
                <span class="rent-method-icon">${m.icon}</span>
                <div>
                  <strong>${m.label}</strong>
                  <span>${m.description}</span>
                </div>
              </div>
            `).join('')}
          </div>
          ${provider._isMock ? `
            <div class="rent-mock-notice">
              En producción, se abrirá el checkout hosted del PSP (Niubiz, Mercado Pago, etc.) donde el usuario ingresa los datos de tarjeta de forma segura. Reco nunca ve ni almacena datos de tarjeta.
            </div>
          ` : ''}
        </div>

        <div class="rent-security-note">
          <span>🔒</span> Pago procesado por PSP certificado PCI-DSS. Datos de tarjeta encriptados end-to-end.
        </div>

        <button class="plan-cta" style="margin-top:16px" onclick="RentUI.processPayment()">
          Proceder al pago → ${PAYMENT_FEE_CONFIG.formatAmount(total)}
        </button>
      </div>`;
  }

  // === PROCESSING VIEW ===
  function processPayment() {
    const lease = RentService.getLeaseById(_selectedLeaseId);
    if (!lease) return;

    const periodLabel = _getPeriodLabel(_selectedPeriod);
    const result = RentService.createPayment(_selectedLeaseId, _selectedPeriod, periodLabel);
    if (result.error) return;

    _currentPayment = result.payment;
    _currentCheckout = result.checkout;
    _view = 'processing';

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.RENT_CHECKOUT_OPENED, {
      lease_id: _selectedLeaseId,
      payment_id: _currentPayment.id,
      checkout_id: _currentCheckout.checkoutId,
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setTimeout(() => {
      const success = Math.random() > 0.15;
      RentService.simulatePaymentResult(_currentPayment.id, success);
      _currentPayment = RentService.getPayment(_currentPayment.id);
      _view = 'result';
      _rerender();

      if (success) {
        RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.RENT_PAYMENT_SUCCESS, {
          payment_id: _currentPayment.id,
          amount: _currentPayment.total,
        });
      } else {
        RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.RENT_PAYMENT_FAILED, {
          payment_id: _currentPayment.id,
          amount: _currentPayment.total,
        });
      }
    }, 2000);
  }

  function _renderProcessing() {
    return `
      <div class="val-form-wrap" style="text-align:center;padding:48px 24px">
        <div class="rent-processing-spinner"></div>
        <h3 class="font-serif" style="font-size:22px;margin:20px 0 8px">Procesando pago…</h3>
        <p style="color:var(--ink-3);font-size:14px;max-width:400px;margin:0 auto">
          Conectando con el procesador de pagos. Por favor no cierres esta ventana.
        </p>
        <div class="leg-mock-tag" style="margin-top:20px">⚠️ MOCK — Simulando respuesta del PSP. En producción, el usuario es redirigido al checkout hosted.</div>
      </div>`;
  }

  // === RESULT VIEW ===
  function _renderResult() {
    if (!_currentPayment) return ErrorState('Pago no encontrado');

    const payment = _currentPayment;
    const isSuccess = payment.status === PAYMENT_STATUS.SUCCESS;
    const lease = RentService.getLeaseById(payment.leaseId);

    if (isSuccess) {
      return `
        <div class="val-form-wrap" style="text-align:center;padding:32px 24px">
          <div style="font-size:56px;margin-bottom:12px">✅</div>
          <h3 class="font-serif" style="font-size:24px;margin-bottom:8px">Pago exitoso</h3>
          <p style="color:var(--ink-3);font-size:14px;margin-bottom:24px;max-width:420px;margin-left:auto;margin-right:auto">
            Tu pago de alquiler ha sido procesado correctamente.
            El propietario recibirá la transferencia.
          </p>

          <div class="val-order-card">
            <div class="val-order-row"><span>Comprobante</span><strong>${payment.receiptId}</strong></div>
            <div class="val-order-row"><span>Pago</span><strong>${payment.id}</strong></div>
            <div class="val-order-row"><span>Periodo</span><strong>${payment.periodLabel}</strong></div>
            <div class="val-order-row"><span>Alquiler</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(payment.amount)}</strong></div>
            <div class="val-order-row"><span>Comisión</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(payment.fee)}</strong></div>
            <div class="val-order-row" style="border-top:2px solid var(--paper-3);padding-top:10px"><span>Total</span><strong style="color:var(--green);font-size:16px">${PAYMENT_FEE_CONFIG.formatAmount(payment.total)}</strong></div>
            <div class="val-order-row"><span>Método</span><strong>${payment.method || '—'}</strong></div>
            <div class="val-order-row"><span>Fecha</span><strong>${new Date(payment.paidAt).toLocaleString('es-PE')}</strong></div>
            ${lease ? '<div class="val-order-row"><span>Propiedad</span><strong>' + lease.property.address + '</strong></div>' : ''}
          </div>

          <div class="val-crosssell" style="margin-top:24px">
            <div class="val-cross-card" onclick="RentUI.crossSell('insurance')">
              <div class="val-cross-icon">🛡️</div>
              <div>
                <strong>Protege tu vivienda</strong>
                <span>Rent Protect — Seguro de contenido desde S/ 25/mes</span>
              </div>
              <span class="val-cross-arrow">→</span>
            </div>
            <div class="val-cross-card" onclick="RentUI.crossSell('finance')">
              <div class="val-cross-icon">🏦</div>
              <div>
                <strong>¿Pensando en comprar?</strong>
                <span>Simula tu crédito hipotecario en segundos</span>
              </div>
              <span class="val-cross-arrow">→</span>
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
            <button class="plan-cta" style="width:auto;padding:12px 28px" onclick="RentUI.backToDashboard()">Volver a Pagos</button>
            <button class="plan-cta outline" style="width:auto;padding:12px 28px" onclick="RentUI.showHistory()">Ver historial</button>
          </div>
        </div>`;
    }

    return `
      <div class="val-form-wrap" style="text-align:center;padding:32px 24px">
        <div style="font-size:56px;margin-bottom:12px">❌</div>
        <h3 class="font-serif" style="font-size:24px;margin-bottom:8px;color:var(--red)">Pago rechazado</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:24px;max-width:420px;margin-left:auto;margin-right:auto">
          El procesador de pagos no pudo completar la transacción. Por favor intenta con otro método de pago o contacta a tu banco.
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Pago</span><strong>${payment.id}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--red)">Rechazado</strong></div>
          <div class="val-order-row"><span>Periodo</span><strong>${payment.periodLabel}</strong></div>
          <div class="val-order-row"><span>Monto</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(payment.total)}</strong></div>
        </div>

        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
          <button class="plan-cta" style="width:auto;padding:12px 28px" onclick="RentUI.startCheckout('${payment.leaseId}')">Reintentar pago</button>
          <button class="plan-cta outline" style="width:auto;padding:12px 28px" onclick="RentUI.backToDashboard()">Volver</button>
        </div>
      </div>`;
  }

  // === PAYMENT HISTORY ===
  function showHistory() {
    _view = 'history';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderHistory() {
    const payments = RentService.getAllPayments();

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="RentUI.backToDashboard()">← Volver a mis contratos</button>

        <h2 class="section-title font-serif" style="text-align:center;margin:0 0 4px">Historial de pagos</h2>
        <p style="text-align:center;color:var(--ink-3);font-size:13px;margin-bottom:20px">Todos tus pagos de alquiler</p>

        ${payments.length > 0 ? `
          <div style="overflow-x:auto">
            <table class="val-hist-table">
              <thead>
                <tr><th>ID</th><th>Periodo</th><th>Monto</th><th>Comisión</th><th>Total</th><th>Estado</th><th>Fecha</th><th>Comprobante</th></tr>
              </thead>
              <tbody>
                ${payments.map(p => {
                  const sc = PAYMENT_STATUS_COLORS[p.status] || {};
                  return '<tr>' +
                    '<td><code style="font-size:11px">' + p.id + '</code></td>' +
                    '<td>' + p.periodLabel + '</td>' +
                    '<td>' + PAYMENT_FEE_CONFIG.formatAmount(p.amount) + '</td>' +
                    '<td>' + PAYMENT_FEE_CONFIG.formatAmount(p.fee) + '</td>' +
                    '<td><strong>' + PAYMENT_FEE_CONFIG.formatAmount(p.total) + '</strong></td>' +
                    '<td><span class="rent-status-badge" style="background:' + sc.bg + ';color:' + sc.color + '">' + PAYMENT_STATUS_LABELS[p.status] + '</span></td>' +
                    '<td>' + (p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-PE') : '—') + '</td>' +
                    '<td>' + (p.receiptId || '—') + '</td>' +
                    '</tr>';
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p style="text-align:center;color:var(--ink-3);padding:32px 0">No hay pagos registrados.</p>'}
      </div>`;
  }

  // === LANDLORD SECTION ===
  function _renderLandlordSection() {
    const landlordName = 'María García López';
    const payments = RentService.getLandlordPayments(landlordName);
    const received = payments.filter(p => p.status === PAYMENT_STATUS.SUCCESS);
    const pending = payments.filter(p => p.status === PAYMENT_STATUS.PENDING);
    const failed = payments.filter(p => p.status === PAYMENT_STATUS.FAILED);
    const totalReceived = received.reduce((sum, p) => sum + p.amount, 0);

    return `
      <div class="rent-landlord-section">
        <h3 class="font-serif" style="font-size:18px;margin:0 0 16px">Vista propietario</h3>

        <div class="agt-stats-grid" style="margin-bottom:20px">
          <div class="agt-stat-card">
            <div class="agt-stat-value">${received.length}</div>
            <div class="agt-stat-label">Pagos recibidos</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${pending.length}</div>
            <div class="agt-stat-label">Pendientes</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value" style="font-size:18px">${PAYMENT_FEE_CONFIG.formatAmount(totalReceived)}</div>
            <div class="agt-stat-label">Total recibido</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${failed.length}</div>
            <div class="agt-stat-label">Rechazados</div>
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>📋 Pagos recientes</h4>
          ${payments.length > 0 ? `
            <div style="overflow-x:auto">
              <table class="val-hist-table">
                <thead><tr><th>ID</th><th>Periodo</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead>
                <tbody>
                  ${payments.map(p => {
                    const sc = PAYMENT_STATUS_COLORS[p.status] || {};
                    return '<tr>' +
                      '<td><code style="font-size:11px">' + p.id + '</code></td>' +
                      '<td>' + p.periodLabel + '</td>' +
                      '<td>' + PAYMENT_FEE_CONFIG.formatAmount(p.amount) + '</td>' +
                      '<td><span class="rent-status-badge" style="background:' + sc.bg + ';color:' + sc.color + '">' + PAYMENT_STATUS_LABELS[p.status] + '</span></td>' +
                      '<td>' + (p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-PE') : '—') + '</td>' +
                      '</tr>';
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p style="color:var(--ink-3);font-size:13px;text-align:center;padding:20px 0">No hay pagos registrados.</p>'}
        </div>
      </div>`;
  }

  // === HELPERS ===
  function _getPeriodLabel(period) {
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const parts = period.split('-');
    return months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  }

  function setRole(role) {
    _viewRole = role;
    _rerender();
  }

  function backToDashboard() {
    _view = 'dashboard';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function crossSell(type) {
    if (type === 'agent') RecoApp.setTab(CATEGORIES.RECO_AGENT);
    else if (type === 'legal') RecoApp.setTab(CATEGORIES.LEGAL);
    else if (type === 'insurance' || type === 'finance') RecoApp.setTab(CATEGORIES.FINANZAS);
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    setRole,
    startCheckout,
    processPayment,
    showHistory,
    backToDashboard,
    crossSell,
  };
})();
