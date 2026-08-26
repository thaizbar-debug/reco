/**
 * Reco Servicios — Valuation UI
 * Renders: Reco Estimate form, results, paid tasación request flows.
 * Uses ValuationService for logic, TASACIONES_SERVICES from data.js for pricing.
 *
 * @requires AgentUI (agent-ui.js) — prepareFromEstimate()
 * @requires FinanceUI (finance-ui.js) — prepareFromEstimate()
 */

const ValuationUI = (() => {
  let _view = 'tiers';
  let _formData = {};
  let _result = null;
  let _askingPrice = null;
  let _requestView = null;
  let _requestStep = 0;
  let _requestData = {};
  let _currentOrder = null;

  function reset() {
    _view = 'tiers';
    _formData = {};
    _result = null;
    _askingPrice = null;
    _requestView = null;
    _requestStep = 0;
    _requestData = {};
    _currentOrder = null;
  }

  function getView() { return _view; }

  // Registry-to-module service ID mapping for deep navigation
  const _REGISTRY_MAP = {
    'reco-estimate': 'tas-estimate',
    'tasacion-express': 'tas-express',
    'tasacion-virtual': 'tas-virtual',
    'tasacion-presencial': 'tas-presencial',
  };

  // --- Main renderer (replaces CategoryTasaciones when active) ---
  function render() {
    const pendingSvc = RecoApp.getPendingServiceId();
    if (pendingSvc) {
      const mapped = _REGISTRY_MAP[pendingSvc] || pendingSvc;
      if (mapped === 'tas-estimate') {
        showEstimateForm();
        return _renderEstimateForm();
      }
      const svc = getServiceById(mapped);
      if (svc) {
        showRequestFlow(mapped);
        return _renderRequestFlow();
      }
    }
    if (_view === 'estimate-form') return _renderEstimateForm();
    if (_view === 'estimate-result') return _renderEstimateResult();
    if (_view === 'request-flow') return _renderRequestFlow();
    if (_view === 'order-confirmation') return _renderOrderConfirmation();
    return _renderTiers();
  }

  // === TIERS VIEW (default) ===
  function _renderTiers() {
    const services = getServicesByCategory(CATEGORIES.TASACIONES);
    return `
      ${SectionHeader('Tasaciones', 'Elige la tasación que necesitas', 'Desde la estimación gratuita con datos de Vanet hasta la tasación presencial aceptada por bancos.')}
      <div class="svc-tas-grid">
        ${services.map(s => _tierCardWithAction(s)).join('')}
      </div>
      ${InfoBanner('¿Necesitas tasación para Mivivienda o Techo Propio?', 'Nuestros tasadores están autorizados por el Fondo Mivivienda y entregan el formato exigido por COFIDE.')}`;
  }

  function _tierCardWithAction(service) {
    const badge = service.tags[0] ? ServiceBadge(service.tags[0], service.featured ? 'accent' : service.price.value === 0 ? 'free' : 'accent') : '';
    const featuredClass = service.featured ? ' featured' : '';
    const checks = (service.highlights || []).map(h =>
      `<li>${h.startsWith('⚠') ? '' : '✓ '}${escapeHTML(h)}</li>`
    ).join('');
    const ctaStyle = service.cta?.style || 'outline';
    const cls = ctaStyle === 'outline' ? 'plan-cta outline' : 'plan-cta';

    let onclick;
    if (service.id === 'tas-estimate') {
      onclick = `ValuationUI.showEstimateForm()`;
    } else {
      onclick = `ValuationUI.requestLead('${escapeAttr(service.id)}')`;
    }

    return `
      <div class="svc-tas-card${featuredClass}">
        ${badge}
        <div class="svc-tas-icon">${escapeHTML(service.icon)}</div>
        <h3>${escapeHTML(service.name)}</h3>
        <div class="svc-tas-price">${escapeHTML(service.price.display)} ${service.price.suffix ? `<small>${escapeHTML(service.price.suffix)}</small>` : ''}</div>
        <ul class="svc-tas-checks">${checks}</ul>
        <button class="${cls}" onclick="${escapeAttr(onclick)}">${escapeHTML(service.cta?.label || 'Solicitar')}</button>
      </div>`;
  }

  // === ESTIMATE FORM ===
  function showEstimateForm() {
    _view = 'estimate-form';
    _result = null;
    RecoAnalytics.track('valuation_started', { type: 'estimate' });
    _rerender();
  }

  function _renderEstimateForm() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="ValuationUI.backToTiers()">← Volver a opciones</button>
        <div class="val-form-header">
          <div class="val-form-badge">Gratis · Instantáneo</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">¿Cuánto vale tu propiedad?</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Estimación basada en +40,000 tasaciones reales de Vanet y datos del mercado peruano.</p>
        </div>

        <div class="val-form">
          <div class="val-row">
            <div class="val-field val-full">
              <label>Distrito *</label>
              <select id="valDistrict" onchange="ValuationUI.updateField('district',this.value)">
                <option value="">Selecciona distrito</option>
                ${districts.map(d => `<option value="${escapeAttr(d)}"${_formData.district === d ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Tipo de propiedad *</label>
              <select id="valType" onchange="ValuationUI.updateField('propertyType',this.value)">
                <option value="">Selecciona tipo</option>
                ${types.map(t => `<option value="${escapeAttr(t.value)}"${_formData.propertyType === t.value ? ' selected' : ''}>${escapeHTML(t.label)}</option>`).join('')}
              </select>
            </div>
            <div class="val-field">
              <label>Área (m²) *</label>
              <input type="number" id="valArea" placeholder="Ej: 85" min="10" max="5000" value="${escapeAttr(_formData.area || '')}" oninput="ValuationUI.updateField('area',+this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Dormitorios</label>
              <div class="val-chips" id="valBeds">
                ${[1,2,3,4,'5+'].map(v => {
                  const val = v === '5+' ? 5 : v;
                  return `<button class="val-chip${_formData.bedrooms === val ? ' active' : ''}" onclick="ValuationUI.updateField('bedrooms',${val})">${v}</button>`;
                }).join('')}
              </div>
            </div>
            <div class="val-field">
              <label>Baños</label>
              <div class="val-chips">
                ${[1,2,3,'4+'].map(v => {
                  const val = v === '4+' ? 4 : v;
                  return `<button class="val-chip${_formData.bathrooms === val ? ' active' : ''}" onclick="ValuationUI.updateField('bathrooms',${val})">${v}</button>`;
                }).join('')}
              </div>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Antigüedad (años)</label>
              <input type="number" id="valAge" placeholder="Ej: 10" min="0" max="100" value="${escapeAttr(_formData.age || '')}" oninput="ValuationUI.updateField('age',+this.value)"/>
            </div>
            <div class="val-field" id="valFloorField" style="${_formData.propertyType === 'departamento' || !_formData.propertyType ? '' : 'display:none'}">
              <label>Piso</label>
              <input type="number" id="valFloor" placeholder="Ej: 5" min="1" max="50" value="${escapeAttr(_formData.floor || '')}" oninput="ValuationUI.updateField('floor',+this.value)"/>
            </div>
            <div class="val-field">
              <label>Estacionamientos</label>
              <div class="val-chips">
                ${[0,1,2,'3+'].map(v => {
                  const val = v === '3+' ? 3 : v;
                  return `<button class="val-chip${_formData.parking === val ? ' active' : ''}" onclick="ValuationUI.updateField('parking',${val})">${v}</button>`;
                }).join('')}
              </div>
            </div>
          </div>

          <button class="val-submit" id="valSubmitBtn" onclick="ValuationUI.runEstimate()" ${!_canEstimate() ? 'disabled' : ''}>
            📊 Estimar valor — Gratis
          </button>
        </div>

        <div class="val-disclaimer">
          ⚠️ La estimación es referencial y no constituye una tasación oficial, bancaria o legal.
        </div>
      </div>`;
  }

  function _canEstimate() {
    return _formData.district && _formData.propertyType && _formData.area >= 10;
  }

  function updateField(field, value) {
    _formData[field] = value;
    if (field === 'propertyType') {
      const floorField = document.getElementById('valFloorField');
      if (floorField) floorField.style.display = value === 'departamento' ? '' : 'none';
    }
    const btn = document.getElementById('valSubmitBtn');
    if (btn) btn.disabled = !_canEstimate();
  }

  function runEstimate() {
    if (!_canEstimate()) return;
    _result = ValuationService.estimate(_formData);
    if (_result.error) {
      RecoActions.handle('noop');
      return;
    }
    _view = 'estimate-result';
    RecoAnalytics.track('valuation_completed', {
      district: _formData.district,
      propertyType: _formData.propertyType,
      area: _formData.area,
      confidence: _result.confidence,
    });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === ESTIMATE RESULT ===
  function _renderEstimateResult() {
    const r = _result;
    const verdict = _askingPrice ? ValuationService.getVerdict(r.estimatedValue, _askingPrice) : null;
    const confColors = { high: 'var(--green)', medium: 'var(--amber)', low: 'var(--red)' };
    const confBg = { high: 'var(--green-bg)', medium: 'var(--amber-bg)', low: 'var(--red-bg)' };
    const confColor = confColors[r.confidence] || 'var(--ink-3)';
    const confBgColor = confBg[r.confidence] || 'var(--paper-2)';

    const verdictColors = {
      opportunity: { bg: '#E8F4EE', color: '#1A6B4A', icon: '🟢' },
      fair: { bg: '#EAF0FD', color: '#2563EB', icon: '🔵' },
      overpriced: { bg: '#FAEAEA', color: '#9B2020', icon: '🔴' },
    };

    const expressService = getServiceById('tas-express');
    const virtualService = getServiceById('tas-virtual');
    const presencialService = getServiceById('tas-presencial');

    RecoAnalytics.track('valuation_result_viewed', {
      district: r.district,
      estimatedValue: r.estimatedValue,
      confidence: r.confidence,
    });

    return `
      <div class="val-result-wrap">
        <button class="val-back" onclick="ValuationUI.showEstimateForm()">← Modificar datos</button>

        <div class="val-mock-badge">⚠️ ESTIMACIÓN REFERENCIAL — Motor de desarrollo (mock)</div>

        <div class="val-result-hero">
          <div class="val-result-tag">Reco Estimate</div>
          <div class="val-result-label">Valor estimado</div>
          <div class="val-result-value">S/ ${escapeHTML(_fmtNum(r.estimatedValue))}</div>
          <div class="val-result-range">
            <span>S/ ${escapeHTML(_fmtNum(r.minValue))}</span>
            <div class="val-range-bar">
              <div class="val-range-fill"></div>
              <div class="val-range-marker"></div>
            </div>
            <span>S/ ${escapeHTML(_fmtNum(r.maxValue))}</span>
          </div>
          <div class="val-result-m2">S/ ${escapeHTML(_fmtNum(r.pricePerM2))} /m² · US$ ${escapeHTML(_fmtNum(r.pricePerM2USD))} /m²</div>
        </div>

        <div class="val-metrics">
          <div class="val-metric">
            <div class="val-metric-label">Confianza</div>
            <div class="val-metric-value" style="background:${confBgColor};color:${confColor}">${escapeHTML(CONFIDENCE_LABELS[r.confidence])}</div>
          </div>
          <div class="val-metric">
            <div class="val-metric-label">Comparables</div>
            <div class="val-metric-value">${escapeHTML(String(r.comparablesCount))}</div>
          </div>
          <div class="val-metric">
            <div class="val-metric-label">Radio</div>
            <div class="val-metric-value">${escapeHTML(String(r.comparablesRadius))}m</div>
          </div>
          <div class="val-metric">
            <div class="val-metric-label">Yield estimado</div>
            <div class="val-metric-value">${escapeHTML(String(r.yieldEstimated))}%</div>
          </div>
          <div class="val-metric">
            <div class="val-metric-label">Score inversión</div>
            <div class="val-metric-value">${escapeHTML(String(r.investmentScore))}/10</div>
          </div>
        </div>

        <!-- Historial precio/m² zona -->
        ${_renderDistrictHistory(r)}

        <!-- Asking price comparison -->
        <div class="val-asking">
          <label>¿Tiene un precio de venta? Compara contra el mercado:</label>
          <div class="val-asking-row">
            <span>S/</span>
            <input type="number" placeholder="Precio publicado" value="${escapeAttr(_askingPrice || '')}" oninput="ValuationUI.setAskingPrice(+this.value)"/>
            <button class="val-asking-btn" onclick="ValuationUI.comparePrice()">Comparar</button>
          </div>
        </div>

        ${verdict ? `
        <div class="val-verdict" style="background:${verdictColors[verdict.type].bg};border-color:${verdictColors[verdict.type].color}">
          <span class="val-verdict-icon">${verdictColors[verdict.type].icon}</span>
          <div>
            <strong style="color:${verdictColors[verdict.type].color}">${escapeHTML(VERDICT_LABELS[verdict.type])}</strong>
            <span>${verdict.diff > 0 ? '+' : ''}${escapeHTML(String(verdict.diff))}% vs. estimación de mercado</span>
          </div>
        </div>` : ''}

        <!-- Upsell: paid tasaciones -->
        <div class="val-upsell">
          <h3 class="font-serif" style="text-align:center;margin-bottom:4px">¿Necesitas un informe más preciso?</h3>
          <p style="text-align:center;color:var(--ink-3);font-size:13px;margin-bottom:18px">Tasación con revisión profesional, válida para trámites bancarios.</p>
          <div class="val-upsell-grid">
            ${_upsellCard(expressService, 'valuation_express_clicked')}
            ${_upsellCard(virtualService, 'valuation_virtual_clicked')}
            ${_upsellCard(presencialService, 'valuation_presential_clicked')}
          </div>
        </div>

        <!-- Cross-sell -->
        <div class="val-crosssell">
          <div class="val-cross-card" onclick="ValuationUI.crossSell('agent')">
            <div class="val-cross-icon">🏠</div>
            <div>
              <strong>¿Quieres vender tu propiedad?</strong>
              <span>Reco Agent — Vende con un agente recomendado</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="ValuationUI.crossSell('check')">
            <div class="val-cross-icon">🔍</div>
            <div>
              <strong>¿Quieres verificar esta propiedad?</strong>
              <span>Property Check — Verificación legal</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="ValuationUI.crossSell('finance')">
            <div class="val-cross-icon">🏦</div>
            <div>
              <strong>¿Necesitas financiamiento?</strong>
              <span>Reco Finance — Simula tu crédito hipotecario</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
        </div>

        <div class="val-disclaimer">
          ⚠️ La estimación es referencial y no constituye una tasación oficial, bancaria o legal. Basada en datos de Vanet (+40,000 tasaciones) y condiciones de mercado a ${new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })}.
        </div>
      </div>`;
  }

  function _renderDistrictHistory(r) {
    const distData = ValuationService.DISTRICT_PRICES_USD_M2[r.district];
    if (!distData) return '';
    const hist = ValuationService.getDistrictHistory(r.district);
    let histRows = '';
    if (hist) {
      const years = Object.keys(hist).sort().slice(-5);
      histRows = years.map(y => {
        const d = hist[y];
        const changeClass = d.v > 0 ? 'val-hist-up' : d.v < 0 ? 'val-hist-down' : '';
        const changeSign = d.v > 0 ? '+' : '';
        return `<tr>
          <td>${escapeHTML(y)}</td>
          <td>US$ ${escapeHTML(_fmtNum(d.m))}</td>
          <td>${escapeHTML(String(d.n || '—'))}</td>
          <td class="val-hist-change ${changeClass}">${d.v !== undefined ? escapeHTML(changeSign + d.v + '%') : '—'}</td>
        </tr>`;
      }).join('');
    } else {
      histRows = `<tr><td colspan="4" style="text-align:center;color:var(--ink-4);padding:12px;font-size:12px">Historial completo disponible con tasación profesional</td></tr>`;
    }
    return `
      <div class="val-historial">
        <h4>Precio/m² en ${escapeHTML(r.district)}</h4>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">
          <div><span style="color:var(--ink-4)">Mediana:</span> <strong>US$ ${escapeHTML(_fmtNum(distData.median))}/m²</strong></div>
          <div><span style="color:var(--ink-4)">Rango:</span> <strong>US$ ${escapeHTML(_fmtNum(distData.p25))} – ${escapeHTML(_fmtNum(distData.p75))}/m²</strong></div>
          <div><span style="color:var(--ink-4)">Transacciones (18m):</span> <strong>${escapeHTML(String(distData.tx))}</strong></div>
        </div>
        <div style="overflow-x:auto">
          <table class="val-hist-table">
            <thead><tr><th>Año</th><th>Mediana USD/m²</th><th>Transacciones</th><th>Var. YoY</th></tr></thead>
            <tbody>${histRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function _upsellCard(service, analyticsEvent) {
    if (!service) return '';
    return `
      <div class="val-upsell-card" onclick="ValuationUI.requestLead('${escapeAttr(service.id)}');RecoAnalytics.track('${escapeAttr(analyticsEvent)}',{from:'estimate_result'})">
        <div style="font-size:24px">${escapeHTML(service.icon)}</div>
        <strong>${escapeHTML(service.name)}</strong>
        <div class="val-upsell-price">${escapeHTML(service.price.display)}</div>
        <div style="font-size:12px;color:var(--ink-3)">${escapeHTML(service.price.suffix || '')}</div>
        <button class="plan-cta outline" style="margin-top:8px;width:100%;padding:8px;font-size:12px">${escapeHTML(service.cta?.label || 'Solicitar')}</button>
      </div>`;
  }

  function setAskingPrice(val) { _askingPrice = val || null; }
  function comparePrice() {
    if (_askingPrice && _result) _rerender();
  }

  function crossSell(type) {
    if (type === 'check') {
      LegalUI.preparePropertyCheck({
        district: _formData.district,
        propertyType: _formData.propertyType,
        area: _formData.area,
      });
      RecoApp.setTab(CATEGORIES.LEGAL);
      return;
    }
    if (type === 'agent') {
      AgentUI.prepareFromEstimate({
        district: _formData.district,
        propertyType: _formData.propertyType,
        area: _formData.area,
      });
      RecoApp.setTab(CATEGORIES.RECO_AGENT);
      return;
    }
    if (type === 'finance') {
      FinanceUI.prepareFromEstimate({
        estimatedPrice: _result ? _result.estimated : '',
        district: _formData.district,
        propertyType: _formData.propertyType,
      });
      RecoApp.setTab(CATEGORIES.FINANZAS);
      return;
    }
  }

  // === REQUEST FLOW (Express, Virtual, Presencial) ===
  function showRequestFlow(serviceId) {
    _requestView = serviceId;
    _requestStep = 0;
    _requestData = { ..._formData };
    _view = 'request-flow';
    RecoAnalytics.track('valuation_lead_created', { serviceId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderRequestFlow() {
    const service = getServiceById(_requestView);
    if (!service) return ErrorState('Servicio no encontrado');

    const steps = _getStepsForService(_requestView);
    const stepNames = steps.map(s => s.name);

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="ValuationUI.backToTiers()">← Volver a opciones</button>

        <div class="val-form-header">
          <div class="val-form-badge">${escapeHTML(service.name)} · ${escapeHTML(service.price.display)}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar ${escapeHTML(service.name)}</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 20px">${escapeHTML(service.description)}</p>
        </div>

        <!-- Progress bar -->
        <div class="val-progress">
          ${stepNames.map((name, i) => `
            <div class="val-progress-step ${i < _requestStep ? 'done' : i === _requestStep ? 'active' : ''}">
              <div class="val-progress-dot">${i < _requestStep ? '✓' : i + 1}</div>
              <div class="val-progress-label">${escapeHTML(name)}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_requestStep].render()}

        ${_requestStep < steps.length - 1 ? `
        <div class="val-nav-buttons">
          ${_requestStep > 0 ? `<button class="plan-cta outline" onclick="ValuationUI.prevStep()">← Anterior</button>` : '<div></div>'}
          <button class="plan-cta" onclick="ValuationUI.nextStep()">${_requestStep === steps.length - 2 ? 'Enviar solicitud' : 'Siguiente →'}</button>
        </div>` : ''}
      </div>`;
  }

  function _getStepsForService(serviceId) {
    const service = getServiceById(serviceId);
    const base = [
      { name: 'Propiedad', render: () => _stepProperty() },
      { name: 'Contacto', render: () => _stepContact() },
    ];

    if (serviceId === 'tas-express') {
      return [
        ...base,
        { name: 'Checkout', render: () => _stepCheckout(service) },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }
    if (serviceId === 'tas-virtual') {
      return [
        ...base,
        { name: 'Horario', render: () => _stepSchedule() },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }
    if (serviceId === 'tas-presencial') {
      return [
        { name: 'Dirección', render: () => _stepAddress() },
        { name: 'Propiedad', render: () => _stepProperty() },
        { name: 'Disponibilidad', render: () => _stepAvailability() },
        { name: 'Contacto', render: () => _stepContact() },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }
    return [...base, { name: 'Confirmación', render: () => _stepConfirmation(service) }];
  }

  function _stepProperty() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de la propiedad</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="ValuationUI.updateRequest('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${escapeAttr(d)}"${_requestData.district === d ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Tipo *</label>
            <select onchange="ValuationUI.updateRequest('propertyType',this.value)">
              <option value="">Selecciona</option>
              ${types.map(t => `<option value="${escapeAttr(t.value)}"${_requestData.propertyType === t.value ? ' selected' : ''}>${escapeHTML(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Área (m²) *</label>
            <input type="number" min="10" placeholder="Ej: 120" value="${escapeAttr(_requestData.area || '')}" oninput="ValuationUI.updateRequest('area',+this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Dormitorios</label>
            <input type="number" min="0" max="10" value="${escapeAttr(_requestData.bedrooms || '')}" oninput="ValuationUI.updateRequest('bedrooms',+this.value)"/>
          </div>
          <div class="val-field">
            <label>Baños</label>
            <input type="number" min="0" max="10" value="${escapeAttr(_requestData.bathrooms || '')}" oninput="ValuationUI.updateRequest('bathrooms',+this.value)"/>
          </div>
          <div class="val-field">
            <label>Antigüedad</label>
            <input type="number" min="0" max="100" placeholder="Años" value="${escapeAttr(_requestData.age || '')}" oninput="ValuationUI.updateRequest('age',+this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepAddress() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Dirección del inmueble</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Dirección completa *</label>
            <input type="text" placeholder="Av. ejemplo 1234, dpto 501" value="${escapeAttr(_requestData.address || '')}" oninput="ValuationUI.updateRequest('address',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="ValuationUI.updateRequest('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${ValuationService.getAvailableDistricts().map(d => `<option value="${escapeAttr(d)}"${_requestData.district === d ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Referencia</label>
            <input type="text" placeholder="Cerca de..., cruce con..." value="${escapeAttr(_requestData.reference || '')}" oninput="ValuationUI.updateRequest('reference',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepContact() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de contacto</h3>
        <div class="val-row">
          <div class="val-field">
            <label for="val-contact-name">Nombre completo *</label>
            <input id="val-contact-name" type="text" placeholder="Tu nombre" value="${escapeAttr(_requestData.contactName || '')}" oninput="ValuationUI.updateRequest('contactName',this.value)"/>
          </div>
          <div class="val-field">
            <label for="val-contact-phone">Teléfono *</label>
            <input id="val-contact-phone" type="tel" placeholder="987 654 321" value="${escapeAttr(_requestData.contactPhone || '')}" oninput="ValuationUI.updateRequest('contactPhone',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label for="val-contact-email">Email *</label>
            <input id="val-contact-email" type="email" placeholder="tu@email.com" value="${escapeAttr(_requestData.contactEmail || '')}" oninput="ValuationUI.updateRequest('contactEmail',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Notas adicionales</label>
            <textarea rows="3" placeholder="Información relevante para el tasador..." oninput="ValuationUI.updateRequest('notes',this.value)">${escapeHTML(_requestData.notes || '')}</textarea>
          </div>
        </div>
      </div>`;
  }

  function _stepSchedule() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Preferencia de horario</h3>
        <p style="font-size:13px;color:var(--ink-3);margin-bottom:16px">Selecciona tu disponibilidad para la videollamada con el tasador.</p>
        <div class="val-row">
          <div class="val-field">
            <label>Fecha preferida *</label>
            <input type="date" min="${_getMinDate()}" value="${escapeAttr(_requestData.preferredDate || '')}" onchange="ValuationUI.updateRequest('preferredDate',this.value)"/>
          </div>
          <div class="val-field">
            <label>Horario preferido</label>
            <select onchange="ValuationUI.updateRequest('preferredTime',this.value)">
              <option value="">Selecciona</option>
              <option value="morning"${_requestData.preferredTime === 'morning' ? ' selected' : ''}>Mañana (9-12h)</option>
              <option value="afternoon"${_requestData.preferredTime === 'afternoon' ? ' selected' : ''}>Tarde (14-17h)</option>
              <option value="evening"${_requestData.preferredTime === 'evening' ? ' selected' : ''}>Noche (18-20h)</option>
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Fecha alternativa</label>
            <input type="date" min="${_getMinDate()}" value="${escapeAttr(_requestData.altDate || '')}" onchange="ValuationUI.updateRequest('altDate',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepAvailability() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Disponibilidad para visita</h3>
        <p style="font-size:13px;color:var(--ink-3);margin-bottom:16px">El tasador realizará una visita presencial al inmueble.</p>
        <div class="val-row">
          <div class="val-field">
            <label>Fecha preferida *</label>
            <input type="date" min="${_getMinDate()}" value="${escapeAttr(_requestData.visitDate || '')}" onchange="ValuationUI.updateRequest('visitDate',this.value)"/>
          </div>
          <div class="val-field">
            <label>Horario</label>
            <select onchange="ValuationUI.updateRequest('visitTime',this.value)">
              <option value="">Selecciona</option>
              <option value="morning"${_requestData.visitTime === 'morning' ? ' selected' : ''}>Mañana (9-12h)</option>
              <option value="afternoon"${_requestData.visitTime === 'afternoon' ? ' selected' : ''}>Tarde (14-17h)</option>
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>¿Quién nos recibirá?</label>
            <input type="text" placeholder="Nombre de quien abrirá" value="${escapeAttr(_requestData.contactAtSite || '')}" oninput="ValuationUI.updateRequest('contactAtSite',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepCheckout(service) {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Resumen y pago</h3>
        <div class="val-checkout-summary">
          <div class="val-checkout-row">
            <span>Servicio</span>
            <strong>${escapeHTML(service.name)}</strong>
          </div>
          <div class="val-checkout-row">
            <span>Propiedad</span>
            <strong>${escapeHTML(_requestData.propertyType ? PROPERTY_TYPES.find(t => t.value === _requestData.propertyType)?.label : '—')} · ${escapeHTML(String(_requestData.area || '—'))} m² · ${escapeHTML(_requestData.district || '—')}</strong>
          </div>
          <div class="val-checkout-row">
            <span>Entrega</span>
            <strong>${escapeHTML(service.price.suffix || '—')}</strong>
          </div>
          <div class="val-checkout-divider"></div>
          <div class="val-checkout-row val-checkout-total">
            <span>Total</span>
            <strong>${escapeHTML(service.price.display)}</strong>
          </div>
        </div>
        <div class="val-checkout-notice">
          <strong>💳 Pago no habilitado aún</strong>
          <span>El procesador de pagos no está conectado. Tu solicitud será registrada y un asesor te contactará para coordinar el pago.</span>
        </div>
      </div>`;
  }

  function _stepConfirmation(service) {
    if (!_currentOrder) {
      _currentOrder = ValuationService.createOrder(
        _requestView,
        { district: _requestData.district, propertyType: _requestData.propertyType, area: _requestData.area, bedrooms: _requestData.bedrooms, bathrooms: _requestData.bathrooms, age: _requestData.age, address: _requestData.address },
        { name: _requestData.contactName, phone: _requestData.contactPhone, email: _requestData.contactEmail, notes: _requestData.notes }
      );
      ValuationService.submitOrder(_currentOrder.id);

      // Bridge to Cloud Function for authenticated users
      if (typeof OrderBridge !== 'undefined') {
        OrderBridge.submit({
          serviceId: _requestView,
          notes: _requestData.notes,
          contactPhone: _requestData.contactPhone
        });
      }
    }

    return `
      <div class="val-step" style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">
          Tu solicitud de <strong>${escapeHTML(service.name)}</strong> ha sido registrada. Un asesor te contactará para confirmar los detalles.
        </p>
        <div class="val-order-card">
          <div class="val-order-row"><span>Orden</span><strong>${escapeHTML(_currentOrder.id)}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${escapeHTML(VAL_ORDER_STATUS_LABELS[_currentOrder.status])}</strong></div>
          <div class="val-order-row"><span>Servicio</span><strong>${escapeHTML(service.name)}</strong></div>
          <div class="val-order-row"><span>Precio</span><strong>${escapeHTML(service.price.display)}</strong></div>
        </div>
        <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="ValuationUI.backToTiers()">Volver a Tasaciones</button>
      </div>`;
  }

  function nextStep() {
    const steps = _getStepsForService(_requestView);
    const currentStepName = steps[_requestStep].name;
    const stepEl = document.querySelector('.val-step');
    if (stepEl) RecoValidation.clearAllErrors(stepEl);

    if (currentStepName === 'Propiedad') {
      const r1 = RecoValidation.validateRequired(_requestData.district, 'Distrito');
      const r2 = RecoValidation.validateRequired(_requestData.propertyType, 'Tipo de propiedad');
      let hasError = false;
      if (stepEl) {
        const selects = stepEl.querySelectorAll('select');
        if (!r1.valid && selects[0]) { RecoValidation.showFieldError(selects[0], r1.error); hasError = true; }
        if (!r2.valid && selects[1]) { RecoValidation.showFieldError(selects[1], r2.error); hasError = true; }
      }
      if (hasError) { RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.FORM_VALIDATION_FAILED, { form: 'valuation_request', step: 'property' }); return; }
    }

    if (currentStepName === 'Contacto') {
      const r1 = RecoValidation.validateName(_requestData.contactName);
      const r2 = RecoValidation.validatePhone(_requestData.contactPhone);
      const r3 = RecoValidation.validateEmail(_requestData.contactEmail);
      let hasError = false;
      if (stepEl) {
        const nameInput = stepEl.querySelector('input[type="text"]');
        const phoneInput = stepEl.querySelector('input[type="tel"]');
        const emailInput = stepEl.querySelector('input[type="email"]');
        if (!r1.valid && nameInput) { RecoValidation.showFieldError(nameInput, r1.error); hasError = true; }
        if (!r2.valid && phoneInput) { RecoValidation.showFieldError(phoneInput, r2.error); hasError = true; }
        if (!r3.valid && emailInput) { RecoValidation.showFieldError(emailInput, r3.error); hasError = true; }
      }
      if (hasError) { RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.FORM_VALIDATION_FAILED, { form: 'valuation_request', step: 'contact' }); return; }
    }

    if (currentStepName === 'Dirección') {
      const r1 = RecoValidation.validateAddress(_requestData.address);
      let hasError = false;
      if (stepEl) {
        const addrInput = stepEl.querySelector('input[type="text"]');
        if (!r1.valid && addrInput) { RecoValidation.showFieldError(addrInput, r1.error); hasError = true; }
      }
      if (hasError) { RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.FORM_VALIDATION_FAILED, { form: 'valuation_request', step: 'address' }); return; }
    }

    if (_requestStep < steps.length - 1) {
      _requestStep++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function prevStep() {
    if (_requestStep > 0) {
      _requestStep--;
      _rerender();
    }
  }

  function updateRequest(field, value) {
    _requestData[field] = value;
  }

  function backToTiers() {
    reset();
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Helpers ---
  function _fmtNum(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function _getMinDate() {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  function requestLead(serviceId) {
    var service = getServiceById(serviceId);
    if (!service) return;
    LeadCaptureModal.open({
      serviceId: serviceId,
      serviceName: service.name,
      category: 'tasaciones',
      icon: service.icon || '📐',
      price: service.price ? service.price.display : null,
      ctaLabel: 'Solicitar tasación',
      extraFields: ['district', 'propertyType', 'area', 'address', 'preferredDate'],
    });
  }

  return {
    render,
    reset,
    getView,
    showEstimateForm,
    showRequestFlow,
    requestLead,
    backToTiers,
    updateField,
    runEstimate,
    setAskingPrice,
    comparePrice,
    crossSell,
    nextStep,
    prevStep,
    updateRequest,
  };
})();
