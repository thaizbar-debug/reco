/**
 * Reco Servicios — Finance UI
 * Renders: marketplace, mortgage simulator, insurance products, lead flows.
 * Uses FinanceService + MortgageSimulator + provider registries for data.
 *
 * @requires RentService (rent-service.js) — PAYMENT_FEE_CONFIG
 * @requires ValuationService (valuation-service.js) — getAvailableDistricts()
 *
 * IMPORTANT: Reco NO ES una entidad financiera.
 * Simulaciones son REFERENCIALES. No se inventan tasas ni convenios.
 *
 * ⚠️ MOCK: All financial products use simulated data.
 */

const FinanceUI = (() => {
  let _view = 'marketplace';

  // Mortgage state
  let _mortgageStep = 0;
  let _mortgageData = {
    propertyPrice: '',
    downPayment: '',
    termYears: 20,
    referentialRate: 8,
    propertyType: '',
    isFirstHome: true,
    district: '',
  };
  let _simulation = null;
  let _mortgageLead = null;
  let _mortgageContactData = {};

  // Insurance state
  let _selectedInsuranceId = null;
  let _insuranceLead = null;
  let _insuranceContactData = {};

  function reset() {
    _view = 'marketplace';
    _mortgageStep = 0;
    _mortgageData = { propertyPrice: '', downPayment: '', termYears: 20, referentialRate: 8, propertyType: '', isFirstHome: true, district: '' };
    _simulation = null;
    _mortgageLead = null;
    _mortgageContactData = {};
    _selectedInsuranceId = null;
    _insuranceLead = null;
    _insuranceContactData = {};
  }

  function render() {
    if (_view === 'mortgage') return _renderMortgageWizard();
    if (_view === 'mortgage_result') return _renderMortgageResult();
    if (_view === 'mortgage_lead') return _renderMortgageLead();
    if (_view === 'insurance_detail') return _renderInsuranceDetail();
    if (_view === 'insurance_lead') return _renderInsuranceLeadConfirmation();
    return _renderMarketplace();
  }

  // === MARKETPLACE VIEW ===
  function _renderMarketplace() {
    const insuranceProducts = FinanceService.getInsuranceProducts();
    const p2 = FinanceService.P2_PRODUCTS;

    return `
      ${SectionHeader('Finanzas', 'Financia y protege tu operación inmobiliaria', 'Reco conecta con entidades financieras y aseguradoras para que encuentres las mejores opciones. Sin costo, sin compromiso.')}

      <div class="leg-mock-tag" style="margin-bottom:24px">⚠️ MOCK — Datos simulados. No existen convenios reales implementados. Las simulaciones son referenciales.</div>

      <div class="fin-product-card fin-product-featured" onclick="FinanceUI.startMortgage()">
        <div class="fin-product-header">
          <div class="fin-product-icon">🏦</div>
          <div>
            <h3 class="font-serif" style="font-size:20px;margin:0 0 4px">Crédito hipotecario</h3>
            <p style="color:var(--ink-3);margin:0;font-size:13px;line-height:1.5">
              Simula tu crédito y recibe cotizaciones de entidades financieras.
              Compara opciones sin compromiso.
            </p>
          </div>
        </div>
        <ul class="fin-feature-list">
          <li>✓ Simulador referencial instantáneo</li>
          <li>✓ Cotización de entidades financieras partners</li>
          <li>✓ Sin costo para el usuario</li>
          <li>✓ Acompañamiento en el proceso</li>
        </ul>
        <button class="plan-cta" style="margin-top:14px" onclick="event.stopPropagation();FinanceUI.startMortgage()">
          Simular crédito →
        </button>
      </div>

      ${CategoryDivider('🛡️', 'Reco Insurance', insuranceProducts.length)}
      <div class="fin-insurance-grid">
        ${insuranceProducts.map(p => _insuranceCard(p)).join('')}
      </div>

      ${CategoryDivider('🚀', 'Próximamente', Object.keys(p2).length)}
      <div class="fin-p2-grid">
        ${Object.values(p2).map(p => `
          <div class="fin-p2-card">
            <div class="fin-p2-icon">${escapeHTML(p.icon)}</div>
            <div>
              <strong>${escapeHTML(p.name)}</strong>
              <span>${escapeHTML(p.description)}</span>
            </div>
            <div class="fin-p2-badge">P2</div>
          </div>
        `).join('')}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="FinanceUI.crossSell('estimate')">
          <div class="val-cross-icon">📐</div>
          <div>
            <strong>¿Cuánto vale tu propiedad?</strong>
            <span>Reco Estimate — Estimación gratuita e instantánea</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="FinanceUI.crossSell('rent')">
          <div class="val-cross-icon">💳</div>
          <div>
            <strong>¿Necesitas pagar tu alquiler?</strong>
            <span>Reco Rent — Paga con tarjeta de crédito</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('⚠️ Información referencial', 'Las simulaciones y datos presentados son referenciales. Reco no es una entidad financiera. Los productos financieros son ofrecidos por partners regulados. Consulta condiciones reales directamente con cada entidad.')}`;
  }

  function _insuranceCard(product) {
    return `
      <div class="fin-insurance-card" onclick="FinanceUI.showInsurance('${escapeAttr(product.id)}')">
        <div class="fin-product-icon">${escapeHTML(product.icon)}</div>
        <h4 style="font-size:16px;margin:8px 0 4px">${escapeHTML(product.name)}</h4>
        <p style="font-size:13px;color:var(--ink-3);line-height:1.5;margin:0 0 12px">${escapeHTML(product.description)}</p>
        <div class="fin-coverage-preview">
          ${product.coverages.slice(0, 3).map(c => '<span>✓ ' + escapeHTML(c) + '</span>').join('')}
          ${product.coverages.length > 3 ? '<span style="color:var(--accent)">+' + (product.coverages.length - 3) + ' más</span>' : ''}
        </div>
        <button class="svc-fin-cta" style="margin-top:auto" onclick="event.stopPropagation();FinanceUI.showInsurance('${escapeAttr(product.id)}')">Ver cobertura →</button>
      </div>`;
  }

  // === MORTGAGE WIZARD ===
  function startMortgage() {
    _mortgageStep = 0;
    _simulation = null;
    _mortgageLead = null;
    _mortgageContactData = {};
    _view = 'mortgage';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MORTGAGE_STARTED, {});
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderMortgageWizard() {
    const steps = [
      { name: 'Propiedad', render: () => _mortStep1() },
      { name: 'Financiamiento', render: () => _mortStep2() },
    ];

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="FinanceUI.backToMarketplace()">← Volver a finanzas</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#DBEAFE;color:#1E40AF">🏦 Crédito Hipotecario</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Simulador referencial</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 8px">Calcula una estimación de tu cuota mensual.</p>
          <div class="fin-disclaimer-inline">⚠️ Simulación referencial — No es una oferta bancaria ni compromiso de crédito.</div>
        </div>

        <div class="val-progress">
          ${steps.map((s, i) => `
            <div class="val-progress-step ${i < _mortgageStep ? 'done' : i === _mortgageStep ? 'active' : ''}">
              <div class="val-progress-dot">${i < _mortgageStep ? '✓' : i + 1}</div>
              <div class="val-progress-label">${s.name}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_mortgageStep].render()}

        <div class="val-nav-buttons">
          ${_mortgageStep > 0 ? '<button class="plan-cta outline" onclick="FinanceUI.mortgagePrev()">← Anterior</button>' : '<div></div>'}
          <button class="plan-cta" onclick="FinanceUI.mortgageNext()">${_mortgageStep === 1 ? '📊 Simular cuota' : 'Siguiente →'}</button>
        </div>
      </div>`;
  }

  function _mortStep1() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de la propiedad</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Precio de la propiedad (${PAYMENT_FEE_CONFIG.get().currencySymbol}) *</label>
            <input type="number" min="50000" step="1000" placeholder="Ej: 350000" value="${_mortgageData.propertyPrice || ''}" oninput="FinanceUI.updateMortgage('propertyPrice',+this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Distrito</label>
            <select onchange="FinanceUI.updateMortgage('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => '<option value="' + escapeAttr(d) + '"' + (_mortgageData.district === d ? ' selected' : '') + '>' + escapeHTML(d) + '</option>').join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Tipo de propiedad</label>
            <select onchange="FinanceUI.updateMortgage('propertyType',this.value)">
              <option value="">Selecciona tipo</option>
              ${types.map(t => '<option value="' + escapeAttr(t.value) + '"' + (_mortgageData.propertyType === t.value ? ' selected' : '') + '>' + escapeHTML(t.label) + '</option>').join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>¿Es tu primera vivienda?</label>
            <div style="display:flex;gap:12px;margin-top:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
                <input type="radio" name="firstHome" value="true" ${_mortgageData.isFirstHome ? 'checked' : ''} onchange="FinanceUI.updateMortgage('isFirstHome',true)"/> Sí
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
                <input type="radio" name="firstHome" value="false" ${!_mortgageData.isFirstHome ? 'checked' : ''} onchange="FinanceUI.updateMortgage('isFirstHome',false)"/> No (inversión)
              </label>
            </div>
          </div>
        </div>
      </div>`;
  }

  function _mortStep2() {
    const price = _mortgageData.propertyPrice || 0;
    const dp = _mortgageData.downPayment || 0;
    const dpPercent = price > 0 ? Math.round((dp / price) * 100) : 0;

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de financiamiento</h3>
        <div class="val-row">
          <div class="val-field">
            <label>Cuota inicial (${PAYMENT_FEE_CONFIG.get().currencySymbol}) *</label>
            <input type="number" min="0" step="1000" placeholder="Ej: 70000" value="${_mortgageData.downPayment || ''}" oninput="FinanceUI.updateMortgage('downPayment',+this.value)"/>
            ${price > 0 ? '<div style="font-size:11px;color:var(--ink-4);margin-top:4px">' + dpPercent + '% del precio</div>' : ''}
          </div>
          <div class="val-field">
            <label>Plazo (años) *</label>
            <select onchange="FinanceUI.updateMortgage('termYears',+this.value)">
              ${MortgageSimulator.TERM_OPTIONS.map(t => '<option value="' + escapeAttr(t) + '"' + (_mortgageData.termYears === t ? ' selected' : '') + '>' + escapeHTML(t) + ' años</option>').join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Tasa referencial anual (%)</label>
            <div style="display:flex;align-items:center;gap:12px">
              <input type="range" min="5" max="15" step="0.5" value="${_mortgageData.referentialRate}" oninput="FinanceUI.updateMortgage('referentialRate',+this.value);this.nextElementSibling.textContent=this.value+'%'" style="flex:1"/>
              <span style="font-size:16px;font-weight:700;color:var(--accent);min-width:50px;text-align:right">${_mortgageData.referentialRate}%</span>
            </div>
            <div style="font-size:11px;color:var(--amber);margin-top:4px">⚠️ Tasa referencial para simulación. No es la tasa real de ninguna entidad financiera.</div>
          </div>
        </div>
        ${price > 0 && dp > 0 ? `
          <div style="background:var(--paper-2);border-radius:10px;padding:12px 16px;margin-top:8px;font-size:13px;color:var(--ink-2)">
            Monto a financiar: <strong>${PAYMENT_FEE_CONFIG.formatAmount(price - dp)}</strong>
          </div>
        ` : ''}
      </div>`;
  }

  function updateMortgage(field, value) {
    _mortgageData[field] = value;
    if (field === 'referentialRate') return;
    _rerender();
  }

  function mortgageNext() {
    if (_mortgageStep < 1) {
      _mortgageStep++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    _runSimulation();
  }

  function mortgagePrev() {
    if (_mortgageStep > 0) {
      _mortgageStep--;
      _rerender();
    }
  }

  function _runSimulation() {
    const price = _mortgageData.propertyPrice;
    const dp = _mortgageData.downPayment;
    if (!price || price <= 0 || !dp || dp <= 0 || dp >= price) return;

    _simulation = MortgageSimulator.simulate({
      propertyPrice: price,
      downPayment: dp,
      termYears: _mortgageData.termYears,
      referentialRate: _mortgageData.referentialRate,
      isFirstHome: _mortgageData.isFirstHome,
    });

    _view = 'mortgage_result';

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MORTGAGE_APPLICATION_STARTED, {
      propertyPrice: price,
      downPayment: dp,
      termYears: _mortgageData.termYears,
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === MORTGAGE RESULT ===
  function _renderMortgageResult() {
    if (!_simulation) return ErrorState('Error en la simulación');

    const s = _simulation;

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="FinanceUI.startMortgage()">← Modificar simulación</button>

        <div class="fin-disclaimer-box">
          <strong>⚠️ Simulación referencial</strong>
          <p>Esta simulación utiliza una tasa referencial de ${s.referentialRate}% anual. No es una oferta bancaria ni un compromiso de crédito. Las tasas, condiciones y requisitos reales varían según cada entidad financiera.</p>
        </div>

        <div class="fin-sim-highlight">
          <div class="fin-sim-highlight-label">Cuota mensual estimada</div>
          <div class="fin-sim-highlight-value">${PAYMENT_FEE_CONFIG.formatAmount(s.monthlyPayment)}</div>
          <div class="fin-sim-highlight-note">Tasa referencial: ${s.referentialRate}% anual · ${s.termYears} años</div>
        </div>

        <div class="rent-checkout-card">
          <h4>📊 Resumen de simulación</h4>
          <div class="rent-detail-row"><span>Precio de propiedad</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(s.propertyPrice)}</strong></div>
          <div class="rent-detail-row"><span>Cuota inicial (${s.downPaymentPercent}%)</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(s.downPayment)}</strong></div>
          <div class="rent-detail-row"><span>Monto a financiar</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(s.financedAmount)}</strong></div>
          <div class="rent-detail-row"><span>Plazo</span><strong>${s.termYears} años (${s.totalMonths} cuotas)</strong></div>
          <div class="rent-detail-row"><span>Tasa referencial</span><strong>${s.referentialRate}% anual</strong></div>
          <div class="rent-detail-row"><span>Total intereses (estimado)</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(s.totalInterest)}</strong></div>
          <div class="rent-detail-row rent-total"><span>Total a pagar (estimado)</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(s.totalPayment)}</strong></div>
        </div>

        <div class="rent-checkout-card">
          <h4>🏦 ¿Quieres recibir cotizaciones reales?</h4>
          <p style="font-size:13px;color:var(--ink-3);margin:0 0 14px;line-height:1.5">
            Reco puede enviar tu solicitud a entidades financieras partners para que recibas cotizaciones personalizadas con tasas y condiciones reales. Sin costo ni compromiso.
          </p>
          <button class="plan-cta" onclick="FinanceUI.startMortgageLead()">Solicitar cotizaciones reales →</button>
        </div>

        <div class="val-crosssell" style="margin-top:24px">
          <div class="val-cross-card" onclick="FinanceUI.crossSell('estimate')">
            <div class="val-cross-icon">📐</div>
            <div>
              <strong>¿Cuánto vale la propiedad?</strong>
              <span>Reco Estimate — Estimación gratuita</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="FinanceUI.crossSell('agent')">
            <div class="val-cross-icon">🏠</div>
            <div>
              <strong>¿Necesitas un agente inmobiliario?</strong>
              <span>Reco Agent — Te conectamos con el agente ideal</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
        </div>

        <div style="text-align:center;margin-top:16px">
          <button class="plan-cta outline" style="width:auto;padding:10px 24px" onclick="FinanceUI.backToMarketplace()">Volver a Finanzas</button>
        </div>
      </div>`;
  }

  // === MORTGAGE LEAD ===
  function startMortgageLead() {
    _mortgageLead = null;
    _mortgageContactData = {};
    _view = 'mortgage_lead';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderMortgageLead() {
    if (_mortgageLead) return _renderMortgageLeadConfirmation();

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="FinanceUI._backToResult()">← Volver a simulación</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#DBEAFE;color:#1E40AF">🏦 Solicitar cotización</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Datos de contacto</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Completa tus datos para recibir cotizaciones de entidades financieras.</p>
        </div>

        <div class="val-step">
          <div class="val-row">
            <div class="val-field">
              <label>Nombre completo *</label>
              <input type="text" placeholder="Tu nombre" value="${escapeAttr(_mortgageContactData.name || '')}" oninput="FinanceUI.updateMortgageContact('name',this.value)"/>
            </div>
            <div class="val-field">
              <label>Teléfono *</label>
              <input type="tel" placeholder="987 654 321" value="${escapeAttr(_mortgageContactData.phone || '')}" oninput="FinanceUI.updateMortgageContact('phone',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Email *</label>
              <input type="email" placeholder="tu@email.com" value="${escapeAttr(_mortgageContactData.email || '')}" oninput="FinanceUI.updateMortgageContact('email',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Ingresos mensuales netos (aproximado)</label>
              <input type="number" min="0" step="500" placeholder="Ej: 8000" value="${escapeAttr(_mortgageContactData.income || '')}" oninput="FinanceUI.updateMortgageContact('income',+this.value)"/>
              <div style="font-size:11px;color:var(--ink-4);margin-top:4px">Opcional — ayuda a las entidades a evaluar tu solicitud más rápido.</div>
            </div>
          </div>
        </div>

        <button class="plan-cta" onclick="FinanceUI.submitMortgageLead()">Enviar solicitud →</button>
      </div>`;
  }

  function _renderMortgageLeadConfirmation() {
    return `
      <div class="val-form-wrap" style="text-align:center;padding:32px 24px">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto">
          Tu solicitud de cotización hipotecaria ha sido registrada. Las entidades financieras partners te contactarán con ofertas personalizadas.
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Solicitud</span><strong>${escapeHTML(_mortgageLead.id)}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${escapeHTML(FIN_MORTGAGE_STATUS_LABELS[_mortgageLead.status])}</strong></div>
          <div class="val-order-row"><span>Monto solicitado</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(_mortgageLead.requestedAmount)}</strong></div>
          <div class="val-order-row"><span>Plazo</span><strong>${escapeHTML(String(_mortgageLead.term))} años</strong></div>
          <div class="val-order-row"><span>Cuota inicial</span><strong>${PAYMENT_FEE_CONFIG.formatAmount(_mortgageLead.downPayment)}</strong></div>
        </div>

        <div class="leg-mock-tag" style="margin-top:16px">⚠️ MOCK — No se enviaron solicitudes reales a entidades financieras.</div>

        <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="FinanceUI.backToMarketplace()">Volver a Finanzas</button>
      </div>`;
  }

  function updateMortgageContact(field, value) {
    _mortgageContactData[field] = value;
  }

  function submitMortgageLead() {
    const container = document.querySelector('.val-form-wrap');
    if (container) RecoValidation.clearAllErrors(container);

    const nameRes = RecoValidation.validateName(_mortgageContactData.name);
    const emailRes = RecoValidation.validateEmail(_mortgageContactData.email);
    const phoneRes = RecoValidation.validatePhone(_mortgageContactData.phone);
    const incomeRes = _mortgageContactData.income != null && _mortgageContactData.income !== ''
      ? RecoValidation.validateNumber(_mortgageContactData.income, { min: 0 })
      : { valid: true };

    let hasError = false;
    if (container) {
      const inputs = container.querySelectorAll('input');
      for (const inp of inputs) {
        const oi = inp.getAttribute('oninput') || '';
        if (oi.includes("'name'") && !nameRes.valid) { RecoValidation.showFieldError(inp, nameRes.error); hasError = true; }
        if (oi.includes("'email'") && !emailRes.valid) { RecoValidation.showFieldError(inp, emailRes.error); hasError = true; }
        if (oi.includes("'phone'") && !phoneRes.valid) { RecoValidation.showFieldError(inp, phoneRes.error); hasError = true; }
        if (oi.includes("'income'") && !incomeRes.valid) { RecoValidation.showFieldError(inp, incomeRes.error); hasError = true; }
      }
    }
    if (hasError) return;

    _mortgageLead = FinanceService.createMortgageLead(
      {
        name: _mortgageContactData.name,
        phone: _mortgageContactData.phone,
        email: _mortgageContactData.email,
        income: _mortgageContactData.income,
      },
      {
        district: _mortgageData.district,
        propertyType: _mortgageData.propertyType,
        isFirstHome: _mortgageData.isFirstHome,
      },
      _simulation
    );

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MORTGAGE_LEAD_CREATED, {
      lead_id: _mortgageLead.id,
      requestedAmount: _mortgageLead.requestedAmount,
      term: _mortgageLead.term,
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _backToResult() {
    _view = 'mortgage_result';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === INSURANCE DETAIL ===
  function showInsurance(productId) {
    _selectedInsuranceId = productId;
    _insuranceLead = null;
    _insuranceContactData = {};
    _view = 'insurance_detail';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.INSURANCE_VIEWED, { product_id: productId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderInsuranceDetail() {
    const product = FinanceService.getInsuranceProduct(_selectedInsuranceId);
    if (!product) return ErrorState('Producto no encontrado');

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="FinanceUI.backToMarketplace()">← Volver a finanzas</button>

        <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — Producto de seguro simulado. No representa una póliza real.</div>

        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:8px">${escapeHTML(product.icon)}</div>
          <h2 class="font-serif" style="font-size:22px;margin:0 0 4px">${escapeHTML(product.name)}</h2>
          <p style="color:var(--ink-3);font-size:14px;margin:0;max-width:480px;margin:0 auto">${escapeHTML(product.description)}</p>
        </div>

        <div class="leg-detail-section">
          <h4>🛡️ Coberturas incluidas</h4>
          <ul class="fin-coverage-list">
            ${product.coverages.map(c => '<li><span class="fin-cov-check">✓</span> ' + escapeHTML(c) + '</li>').join('')}
          </ul>
        </div>

        <div class="leg-detail-section">
          <h4>💰 Precio</h4>
          <p style="font-size:13px;color:var(--ink-2);line-height:1.5;margin:0">${escapeHTML(product.priceNote)}</p>
        </div>

        <div class="leg-detail-section">
          <h4>🏢 Partners</h4>
          <p style="font-size:13px;color:var(--ink-3);line-height:1.5;margin:0">
            En producción, se mostrarán las aseguradoras partners disponibles con sus ofertas y precios reales.
          </p>
        </div>

        <button class="plan-cta" style="margin-top:16px" onclick="FinanceUI.startInsuranceLead('${escapeAttr(product.id)}')">
          Solicitar cotización →
        </button>

        <div class="val-crosssell" style="margin-top:24px">
          ${product.type === INSURANCE_TYPES.RENT ? `
            <div class="val-cross-card" onclick="FinanceUI.crossSell('rent')">
              <div class="val-cross-icon">💳</div>
              <div><strong>¿Pagas alquiler?</strong><span>Reco Rent — Paga con tarjeta de crédito</span></div>
              <span class="val-cross-arrow">→</span>
            </div>
          ` : `
            <div class="val-cross-card" onclick="FinanceUI.crossSell('estimate')">
              <div class="val-cross-icon">📐</div>
              <div><strong>¿Cuánto vale tu propiedad?</strong><span>Reco Estimate — Estimación gratuita</span></div>
              <span class="val-cross-arrow">→</span>
            </div>
          `}
          <div class="val-cross-card" onclick="FinanceUI.crossSell('legal')">
            <div class="val-cross-icon">⚖️</div>
            <div><strong>¿Necesitas asesoría legal?</strong><span>Reco Legal — Abogados especializados</span></div>
            <span class="val-cross-arrow">→</span>
          </div>
        </div>
      </div>`;
  }

  // === INSURANCE LEAD ===
  function startInsuranceLead(productId) {
    _selectedInsuranceId = productId;
    _insuranceLead = null;
    _insuranceContactData = {};
    _view = 'insurance_lead';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderInsuranceLeadConfirmation() {
    const product = FinanceService.getInsuranceProduct(_selectedInsuranceId);
    if (!product) return ErrorState('Producto no encontrado');

    if (_insuranceLead) {
      return `
        <div class="val-form-wrap" style="text-align:center;padding:32px 24px">
          <div style="font-size:48px;margin-bottom:12px">✅</div>
          <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
          <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto">
            Tu solicitud de cotización de ${escapeHTML(product.name.toLowerCase())} ha sido registrada.
            Una aseguradora partner te contactará con opciones personalizadas.
          </p>

          <div class="val-order-card">
            <div class="val-order-row"><span>Solicitud</span><strong>${escapeHTML(_insuranceLead.id)}</strong></div>
            <div class="val-order-row"><span>Producto</span><strong>${escapeHTML(product.name)}</strong></div>
            <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">Enviado</strong></div>
          </div>

          <div class="leg-mock-tag" style="margin-top:16px">⚠️ MOCK — No se enviaron solicitudes reales a aseguradoras.</div>

          <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="FinanceUI.backToMarketplace()">Volver a Finanzas</button>
        </div>`;
    }

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="FinanceUI.showInsurance('${escapeAttr(_selectedInsuranceId)}')">← Volver a ${escapeHTML(product.name)}</button>

        <div class="val-form-header">
          <div class="val-form-badge">${escapeHTML(product.icon)} ${escapeHTML(product.name)}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar cotización</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Completa tus datos para recibir una cotización personalizada.</p>
        </div>

        <div class="val-step">
          <div class="val-row">
            <div class="val-field">
              <label>Nombre completo *</label>
              <input type="text" placeholder="Tu nombre" value="${escapeAttr(_insuranceContactData.name || '')}" oninput="FinanceUI.updateInsuranceContact('name',this.value)"/>
            </div>
            <div class="val-field">
              <label>Teléfono *</label>
              <input type="tel" placeholder="987 654 321" value="${escapeAttr(_insuranceContactData.phone || '')}" oninput="FinanceUI.updateInsuranceContact('phone',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Email *</label>
              <input type="email" placeholder="tu@email.com" value="${escapeAttr(_insuranceContactData.email || '')}" oninput="FinanceUI.updateInsuranceContact('email',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Distrito de la propiedad</label>
              <select onchange="FinanceUI.updateInsuranceContact('district',this.value)">
                <option value="">Selecciona</option>
                ${ValuationService.getAvailableDistricts().map(d => '<option value="' + escapeAttr(d) + '"' + (_insuranceContactData.district === d ? ' selected' : '') + '>' + escapeHTML(d) + '</option>').join('')}
              </select>
            </div>
            <div class="val-field">
              <label>Tipo de propiedad</label>
              <select onchange="FinanceUI.updateInsuranceContact('propertyType',this.value)">
                <option value="">Selecciona</option>
                ${ValuationService.getPropertyTypes().map(t => '<option value="' + escapeAttr(t.value) + '"' + (_insuranceContactData.propertyType === t.value ? ' selected' : '') + '>' + escapeHTML(t.label) + '</option>').join('')}
              </select>
            </div>
          </div>
        </div>

        <button class="plan-cta" onclick="FinanceUI.submitInsuranceLead()">Enviar solicitud →</button>
      </div>`;
  }

  function updateInsuranceContact(field, value) {
    _insuranceContactData[field] = value;
  }

  function submitInsuranceLead() {
    const container = document.querySelector('.val-form-wrap');
    if (container) RecoValidation.clearAllErrors(container);

    const nameRes = RecoValidation.validateName(_insuranceContactData.name);
    const emailRes = RecoValidation.validateEmail(_insuranceContactData.email);
    const phoneRes = RecoValidation.validatePhone(_insuranceContactData.phone);

    let hasError = false;
    if (container) {
      const inputs = container.querySelectorAll('input');
      for (const inp of inputs) {
        const oi = inp.getAttribute('oninput') || '';
        if (oi.includes("'name'") && !nameRes.valid) { RecoValidation.showFieldError(inp, nameRes.error); hasError = true; }
        if (oi.includes("'email'") && !emailRes.valid) { RecoValidation.showFieldError(inp, emailRes.error); hasError = true; }
        if (oi.includes("'phone'") && !phoneRes.valid) { RecoValidation.showFieldError(inp, phoneRes.error); hasError = true; }
      }
    }
    if (hasError) return;

    _insuranceLead = FinanceService.createInsuranceLead(
      {
        name: _insuranceContactData.name,
        phone: _insuranceContactData.phone,
        email: _insuranceContactData.email,
      },
      _selectedInsuranceId,
      {
        district: _insuranceContactData.district,
        propertyType: _insuranceContactData.propertyType,
      }
    );

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.INSURANCE_LEAD_CREATED, {
      lead_id: _insuranceLead.id,
      product_id: _selectedInsuranceId,
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === CROSS-SELL ENTRY POINTS ===
  function prepareFromEstimate(propertyData) {
    _mortgageData.propertyPrice = propertyData.estimatedPrice || '';
    _mortgageData.district = propertyData.district || '';
    _mortgageData.propertyType = propertyData.propertyType || '';
    _mortgageStep = 0;
    _simulation = null;
    _view = 'mortgage';
  }

  function prepareFromRent() {
    _selectedInsuranceId = 'ins-alquiler';
    _insuranceLead = null;
    _insuranceContactData = {};
    _view = 'insurance_detail';
  }

  // === NAVIGATION ===
  function backToMarketplace() {
    _view = 'marketplace';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function crossSell(type) {
    if (type === 'estimate') RecoApp.setTab(CATEGORIES.TASACIONES);
    else if (type === 'agent') RecoApp.setTab(CATEGORIES.RECO_AGENT);
    else if (type === 'legal') RecoApp.setTab(CATEGORIES.LEGAL);
    else if (type === 'rent') RecoApp.setTab(CATEGORIES.PAGOS);
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    startMortgage,
    updateMortgage,
    mortgageNext,
    mortgagePrev,
    startMortgageLead,
    updateMortgageContact,
    submitMortgageLead,
    _backToResult,
    showInsurance,
    startInsuranceLead,
    updateInsuranceContact,
    submitInsuranceLead,
    prepareFromEstimate,
    prepareFromRent,
    backToMarketplace,
    crossSell,
  };
})();
