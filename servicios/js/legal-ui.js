/**
 * Reco Servicios — Legal UI
 * Renders: Property Check form/results, legal service details, booking flows.
 * Uses LegalService + PropertyDataRegistry for data, LEGAL_SERVICES from data.js.
 *
 * @requires AgentUI (agent-ui.js) — prepareFromCheck()
 *
 * ⚠️ MOCK: Property data and law firms are simulated.
 */

const LegalUI = (() => {
  let _view = 'catalog';
  let _checkFormData = {};
  let _checkResult = null;
  let _selectedServiceId = null;
  let _bookingStep = 0;
  let _bookingData = {};
  let _currentOrder = null;

  function reset() {
    _view = 'catalog';
    _checkFormData = {};
    _checkResult = null;
    _selectedServiceId = null;
    _bookingStep = 0;
    _bookingData = {};
    _currentOrder = null;
  }

  function render() {
    if (_view === 'check-form') return _renderCheckForm();
    if (_view === 'check-results') return _renderCheckResults();
    if (_view === 'service-detail') return _renderServiceDetail();
    if (_view === 'booking') return _renderBooking();
    return _renderCatalog();
  }

  // === CATALOG VIEW ===
  function _renderCatalog() {
    const services = getServicesByCategory(CATEGORIES.LEGAL);
    const contratos = services.filter(s => s.subcategory === 'contratos');
    const dueDiligence = services.filter(s => s.subcategory === 'due_diligence');

    return `
      ${SectionHeader('Legal e inmobiliario', 'Protección jurídica para tu operación', 'Abogados especializados en derecho inmobiliario peruano. Cada servicio incluye seguimiento digital y documentación verificada.')}

      <div class="leg-check-hero">
        <div class="leg-mock-tag">⚠️ MOCK — Datos simulados</div>
        <div class="leg-check-hero-content">
          <div class="leg-check-hero-icon">🔍</div>
          <div>
            <h3 class="font-serif" style="font-size:24px;margin:0 0 6px">Property Check</h3>
            <p style="color:var(--ink-3);margin:0 0 14px;font-size:14px;line-height:1.5">
              Verifica el estado legal de cualquier propiedad antes de comprar o alquilar.
              Consulta titularidad, cargas, hipotecas y alertas de riesgo.
            </p>
            <ul class="leg-check-hero-list">
              <li>✓ Titularidad y cadena de propietarios</li>
              <li>✓ Cargas, hipotecas y embargos</li>
              <li>✓ Información registral SUNARP</li>
              <li>✓ Score de riesgo con alertas</li>
            </ul>
            <button class="plan-cta" style="width:auto;padding:12px 28px;margin-top:8px" onclick="LegalUI.showPropertyCheck()">
              Verificar esta propiedad →
            </button>
          </div>
        </div>
      </div>

      ${CategoryDivider('📋', 'Contratos', contratos.length)}
      <div class="svc-legal-grid">
        ${contratos.map(s => _legalCard(s)).join('')}
      </div>

      ${CategoryDivider('🔎', 'Due diligence', dueDiligence.length)}
      <div class="svc-legal-grid">
        ${dueDiligence.map(s => _legalCard(s)).join('')}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="LegalUI.crossSell('tasacion')">
          <div class="val-cross-icon">📐</div>
          <div>
            <strong>¿Necesitas tasar tu propiedad?</strong>
            <span>Reco Estimate — Estimación gratuita e instantánea</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="LegalUI.crossSell('foto')">
          <div class="val-cross-icon">📸</div>
          <div>
            <strong>¿Quieres fotos profesionales?</strong>
            <span>Reco Visual — Foto, video e IA</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('⚖️ Abogados verificados', 'Todos los abogados están colegiados en el CAL, con mínimo 5 años de experiencia en derecho inmobiliario y rating 4.7/5 en la plataforma.')}`;
  }

  function _legalCard(service) {
    const tag = service.tags[0] ? FinTag(service.tags[0], service.tags[0] === 'Nuevo') : '';
    return `
      <div class="svc-legal-card">
        ${tag}
        <div class="svc-fin-icon">${escapeHTML(service.icon)}</div>
        <div class="svc-fin-title">${escapeHTML(service.name)}</div>
        <div class="svc-fin-desc">${escapeHTML(service.description)}</div>
        <div class="svc-fin-price">${escapeHTML(service.price.display)}</div>
        <button class="svc-fin-cta" onclick="LegalUI.showServiceDetail('${escapeAttr(service.id)}')">Ver detalles →</button>
      </div>`;
  }

  // === PROPERTY CHECK FORM ===
  function showPropertyCheck() {
    _view = 'check-form';
    _checkResult = null;
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_CHECK_STARTED);
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderCheckForm() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="LegalUI.backToCatalog()">← Volver a servicios legales</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#DBEAFE;color:#1E40AF">🔍 Property Check</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Verificar propiedad</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Ingresa los datos del inmueble para consultar su estado legal, titularidad y posibles alertas.</p>
        </div>

        <div class="leg-mock-tag" style="margin-bottom:18px">
          ⚠️ MOCK — Esta verificación utiliza datos simulados. No constituye una consulta real a SUNARP.
        </div>

        <div class="val-form">
          <div class="val-row">
            <div class="val-field val-full">
              <label>Distrito *</label>
              <select onchange="LegalUI.updateCheckField('district',this.value)">
                <option value="">Selecciona distrito</option>
                ${districts.map(d => `<option value="${escapeAttr(d)}"${_checkFormData.district === d ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Tipo de propiedad *</label>
              <select onchange="LegalUI.updateCheckField('propertyType',this.value)">
                <option value="">Selecciona tipo</option>
                ${types.map(t => `<option value="${escapeAttr(t.value)}"${_checkFormData.propertyType === t.value ? ' selected' : ''}>${escapeHTML(t.label)}</option>`).join('')}
              </select>
            </div>
            <div class="val-field">
              <label>Área (m²)</label>
              <input type="number" min="10" placeholder="Ej: 120" value="${escapeAttr(_checkFormData.area || '')}" oninput="LegalUI.updateCheckField('area',+this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Dirección</label>
              <input type="text" placeholder="Av. ejemplo 1234, dpto 501" value="${escapeAttr(_checkFormData.address || '')}" oninput="LegalUI.updateCheckField('address',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Número de partida registral (opcional)</label>
              <input type="text" placeholder="Ej: 12345678" value="${escapeAttr(_checkFormData.partidaRegistral || '')}" oninput="LegalUI.updateCheckField('partidaRegistral',this.value)"/>
              <small style="color:var(--ink-4);font-size:11px;margin-top:4px;display:block">Si tienes la partida, la verificación será más completa. La encuentras en la copia literal de SUNARP.</small>
            </div>
          </div>

          <button class="val-submit" onclick="LegalUI.runPropertyCheck()" ${!_canCheck() ? 'disabled' : ''}>
            🔍 Verificar propiedad
          </button>
        </div>

        <div class="val-disclaimer">
          ⚠️ Esta verificación es referencial y no constituye un informe legal, dictamen jurídico ni opinión profesional.
          Para una revisión completa, solicite un servicio de due diligence con un abogado especializado.
        </div>
      </div>`;
  }

  function _canCheck() {
    return _checkFormData.district && _checkFormData.propertyType;
  }

  function updateCheckField(field, value) {
    _checkFormData[field] = value;
    const btn = document.querySelector('.val-submit');
    if (btn) btn.disabled = !_canCheck();
  }

  function runPropertyCheck() {
    if (!_canCheck()) return;
    _checkResult = LegalService.runPropertyCheck(_checkFormData);
    _view = 'check-results';

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_CHECK_COMPLETED, {
      district: _checkFormData.district,
      propertyType: _checkFormData.propertyType,
      score: _checkResult.score,
      alertCount: _checkResult.alerts.length,
    });

    _checkResult.alerts.forEach(a => {
      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_ALERT_VIEWED, {
        level: a.level,
        category: a.category,
        message: a.message,
      });
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === CHECK RESULTS ===
  function _renderCheckResults() {
    const r = _checkResult;
    if (!r) return ErrorState('No hay resultados');

    const scoreConfig = PROPERTY_CHECK_SCORE_CONFIG[r.score];
    const checkDate = new Date(r.checkDate).toLocaleDateString('es-PE', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return `
      <div class="val-result-wrap">
        <button class="val-back" onclick="LegalUI.showPropertyCheck()">← Modificar datos</button>

        <div class="val-mock-badge">⚠️ DATOS SIMULADOS — Esta verificación utiliza un proveedor mock, no SUNARP real</div>

        <div class="leg-score-hero" style="background:${scoreConfig.bg};border:1.5px solid ${scoreConfig.color}">
          <div class="leg-score-icon">${scoreConfig.icon}</div>
          <div>
            <div class="leg-score-label" style="color:${scoreConfig.color}">${escapeHTML(scoreConfig.label)}</div>
            <div class="leg-score-id">ID: ${escapeHTML(r.propertyId)} · ${escapeHTML(checkDate)}</div>
          </div>
        </div>

        ${_renderReportSection('Identificación del inmueble', [
          { label: 'Tipo', value: r.identification.propertyType },
          { label: 'Distrito', value: r.identification.district },
          { label: 'Dirección', value: r.identification.address },
          { label: 'Área declarada', value: r.identification.declaredArea ? r.identification.declaredArea + ' m²' : 'No proporcionada' },
          r.identification.registeredArea ? { label: 'Área registrada', value: r.identification.registeredArea + ' m²' } : null,
          { label: 'Partida registral', value: r.identification.partidaRegistral || 'No proporcionada' },
        ].filter(Boolean), r.identification.source)}

        ${_renderReportSection('Información registral', [
          { label: 'Estado', value: r.registralInfo.statusLabel },
          r.registralInfo.inscriptionDate ? { label: 'Fecha de inscripción', value: r.registralInfo.inscriptionDate } : null,
          r.registralInfo.registralZone ? { label: 'Zona registral', value: r.registralInfo.registralZone } : null,
        ].filter(Boolean), r.registralInfo.source)}

        ${_renderOwnership(r.ownership)}

        ${_renderHistory(r.history)}

        ${_renderEncumbrances(r.encumbrances)}

        ${r.alerts.length > 0 ? `
        <div class="leg-report-section">
          <h4>⚠️ Alertas detectadas (${r.alerts.length})</h4>
          ${r.alerts.map(a => {
            const colors = {
              red: { bg: 'var(--red-bg)', border: '#FCA5A5', color: 'var(--red)', icon: '🔴' },
              yellow: { bg: 'var(--amber-bg)', border: '#FCD34D', color: 'var(--amber)', icon: '🟡' },
            };
            const c = colors[a.level] || colors.yellow;
            return `
              <div class="leg-alert" style="background:${c.bg};border-color:${c.border}">
                <div class="leg-alert-icon">${c.icon}</div>
                <div>
                  <strong style="color:${c.color}">${escapeHTML(a.category)}: ${escapeHTML(a.message)}</strong>
                  <span>${escapeHTML(a.detail)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>` : `
        <div class="leg-report-section">
          <h4>✅ Sin alertas</h4>
          <p style="color:var(--ink-3);font-size:13px">No se detectaron alertas en la verificación preliminar.</p>
        </div>`}

        ${r.missingInfo.length > 0 ? `
        <div class="leg-report-section">
          <h4>📋 Información faltante</h4>
          <ul class="leg-missing-list">
            ${r.missingInfo.map(m => `<li>${escapeHTML(m)}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div class="leg-disclaimer">
          <strong>⚠️ Importante</strong>
          <p>Este reporte es una verificación preliminar referencial y <strong>no constituye una conclusión jurídica, dictamen legal ni opinión profesional</strong>. Los datos presentados provienen de fuentes simuladas (mock) y no representan información oficial de SUNARP ni de ninguna entidad estatal.</p>
          <p>Para una verificación vinculante, solicite un servicio de due diligence o estudio de títulos con un abogado colegiado.</p>
        </div>

        <div class="leg-services-cta">
          <h3 class="font-serif" style="text-align:center;margin-bottom:4px">¿Necesitas revisión legal profesional?</h3>
          <p style="text-align:center;color:var(--ink-3);font-size:13px;margin-bottom:18px">Abogados especializados analizarán a fondo la situación legal de este inmueble.</p>
          <div class="leg-services-cta-grid">
            ${_legalServiceQuickCard('legal-asesoria')}
            ${_legalServiceQuickCard('legal-estudio-titulos')}
            ${_legalServiceQuickCard('legal-due-diligence')}
          </div>
        </div>

        <div class="val-crosssell">
          <div class="val-cross-card" onclick="LegalUI.crossSell('agent')">
            <div class="val-cross-icon">🏠</div>
            <div>
              <strong>¿Quieres avanzar con la compra?</strong>
              <span>Reco Agent — Te conectamos con un agente</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="LegalUI.crossSell('mortgage')">
            <div class="val-cross-icon">🏦</div>
            <div>
              <strong>¿Necesitas financiarla?</strong>
              <span>Crédito hipotecario — Compara tasas</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="LegalUI.crossSell('tasacion')">
            <div class="val-cross-icon">📐</div>
            <div>
              <strong>¿Quieres saber cuánto vale?</strong>
              <span>Reco Estimate — Estimación gratuita</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
        </div>
      </div>`;
  }

  function _legalServiceQuickCard(serviceId) {
    const service = getServiceById(serviceId);
    if (!service) return '';
    return `
      <div class="leg-quick-card" onclick="LegalUI.showServiceDetail('${escapeAttr(service.id)}')">
        <div style="font-size:24px">${escapeHTML(service.icon)}</div>
        <strong>${escapeHTML(service.name)}</strong>
        <div style="color:var(--accent);font-weight:700;font-size:14px">${escapeHTML(service.price.display)}</div>
        <button class="plan-cta outline" style="margin-top:8px;width:100%;padding:8px;font-size:12px">Ver detalles</button>
      </div>`;
  }

  function _renderReportSection(title, rows, source) {
    return `
      <div class="leg-report-section">
        <h4>${title}</h4>
        ${rows.map(r => `
          <div class="leg-report-row">
            <span>${escapeHTML(r.label)}</span>
            <strong>${escapeHTML(r.value)}</strong>
          </div>
        `).join('')}
        ${source ? `<div class="leg-source-tag">Fuente: ${escapeHTML(source)}</div>` : ''}
      </div>`;
  }

  function _renderOwnership(ownership) {
    if (!ownership.owners) {
      return _renderReportSection('Titularidad', [
        { label: 'Estado', value: 'No disponible sin partida registral' },
      ], ownership.source);
    }
    const rows = [{ label: 'Tipo', value: ownership.ownershipType }];
    ownership.owners.forEach((o, i) => {
      rows.push({ label: 'Propietario ' + (i + 1), value: o.name + ' (' + o.percentage + '% · ' + o.type + ')' });
    });
    return _renderReportSection('Titularidad', rows, ownership.source);
  }

  function _renderHistory(history) {
    if (!history.transfers || history.transfers.length === 0) {
      return _renderReportSection('Historial de transferencias', [
        { label: 'Estado', value: history.source || 'Sin historial disponible' },
      ], null);
    }
    return `
      <div class="leg-report-section">
        <h4>Historial de transferencias</h4>
        <div style="overflow-x:auto">
          <table class="val-hist-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Partes</th></tr></thead>
            <tbody>
              ${history.transfers.map(t => `
                <tr>
                  <td>${escapeHTML(t.date)}</td>
                  <td>${escapeHTML(t.type)}</td>
                  <td>${escapeHTML(t.parties)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="leg-source-tag">Fuente: ${escapeHTML(history.source)}</div>
      </div>`;
  }

  function _renderEncumbrances(enc) {
    const hasMortgages = enc.mortgages.length > 0;
    const hasLitigation = enc.litigation.length > 0;
    const hasLiens = enc.liens.length > 0;

    if (!hasMortgages && !hasLitigation && !hasLiens) {
      return _renderReportSection('Cargas y gravámenes', [
        { label: 'Estado', value: 'No se encontraron cargas registradas' },
      ], enc.source);
    }

    const rows = [];
    enc.mortgages.forEach(m => {
      rows.push({ label: '🏦 Hipoteca', value: m.bank + ' · ' + m.status + ' · Desde ' + m.date });
    });
    enc.litigation.forEach(l => {
      rows.push({ label: '⚖️ Litigio', value: l.court + ' · ' + l.case + ' · ' + l.status });
    });

    return _renderReportSection('Cargas y gravámenes', rows, enc.source);
  }

  // === SERVICE DETAIL ===
  function showServiceDetail(serviceId) {
    _selectedServiceId = serviceId;
    _view = 'service-detail';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.LEGAL_SERVICE_CLICKED, { service_id: serviceId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderServiceDetail() {
    const service = getServiceById(_selectedServiceId);
    if (!service) return ErrorState('Servicio no encontrado');

    const details = LegalService.getServiceDetails(_selectedServiceId);
    const providers = LegalProviderRegistry.getProviders();

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="LegalUI.backToCatalog()">← Volver a servicios legales</button>

        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:40px;margin-bottom:8px">${escapeHTML(service.icon)}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:0 0 4px">${escapeHTML(service.name)}</h2>
          <div style="color:var(--accent);font-weight:700;font-size:20px;margin-bottom:8px">${escapeHTML(service.price.display)}</div>
          <p class="section-sub" style="text-align:center;margin:0 auto 0">${escapeHTML(service.description)}</p>
        </div>

        ${details ? `
        <div class="leg-detail-section">
          <h4>✓ Incluye</h4>
          <ul class="leg-detail-list">
            ${details.highlights.map(h => `<li>✓ ${escapeHTML(h)}</li>`).join('')}
          </ul>
        </div>

        <div class="leg-detail-section">
          <h4>⏱️ Tiempo de entrega</h4>
          <div class="leg-detail-timeline">${escapeHTML(details.timeline)}</div>
        </div>

        <div class="leg-detail-section">
          <h4>📄 Documentos requeridos</h4>
          <ul class="leg-detail-list leg-detail-docs">
            ${details.requiredDocs.map(d => `<li>• ${escapeHTML(d)}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div class="leg-detail-section">
          <h4>👨‍⚖️ Estudios disponibles</h4>
          <div class="leg-mock-tag" style="margin-bottom:12px">⚠️ MOCK — Estudios de abogados simulados. No representan firmas reales.</div>
          <div class="leg-provider-grid">
            ${providers.map(p => `
              <div class="leg-provider-card">
                <div class="leg-provider-name">${escapeHTML(p.name)}</div>
                <div class="leg-provider-rating">⭐ ${escapeHTML(String(p.rating))} (${escapeHTML(String(p.reviewCount))} reseñas)</div>
                <div class="leg-provider-meta">
                  <span>📍 ${escapeHTML(p.zones.join(', '))}</span>
                  <span>⏱️ Respuesta: ${escapeHTML(p.responseTime)}</span>
                  <span>📅 ${escapeHTML(String(p.yearsExperience))} años exp.</span>
                </div>
                <div class="leg-provider-specialties">
                  ${p.specialties.map(s => `<span class="leg-spec-tag">${escapeHTML(s)}</span>`).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <button class="plan-cta" style="margin-top:12px" onclick="LegalUI.showBooking('${escapeAttr(service.id)}')">
          Solicitar ${escapeHTML(service.name)} →
        </button>
      </div>`;
  }

  // === BOOKING FLOW ===
  function showBooking(serviceId) {
    _selectedServiceId = serviceId;
    _bookingStep = 0;
    _bookingData = { ..._checkFormData };
    _currentOrder = null;
    _view = 'booking';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderBooking() {
    const service = getServiceById(_selectedServiceId);
    if (!service) return ErrorState('Servicio no encontrado');

    const steps = _getBookingSteps(service);
    const stepNames = steps.map(s => s.name);

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="LegalUI.showServiceDetail('${escapeAttr(_selectedServiceId)}')">← Volver a detalles</button>

        <div class="val-form-header">
          <div class="val-form-badge">${escapeHTML(service.name)} · ${escapeHTML(service.price.display)}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar ${escapeHTML(service.name)}</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 20px">${escapeHTML(service.description)}</p>
        </div>

        <div class="val-progress">
          ${stepNames.map((name, i) => `
            <div class="val-progress-step ${i < _bookingStep ? 'done' : i === _bookingStep ? 'active' : ''}">
              <div class="val-progress-dot">${i < _bookingStep ? '✓' : i + 1}</div>
              <div class="val-progress-label">${name}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_bookingStep].render()}

        ${_bookingStep < steps.length - 1 ? `
        <div class="val-nav-buttons">
          ${_bookingStep > 0 ? '<button class="plan-cta outline" onclick="LegalUI.prevStep()">← Anterior</button>' : '<div></div>'}
          <button class="plan-cta" onclick="LegalUI.nextStep()">${_bookingStep === steps.length - 2 ? 'Enviar solicitud' : 'Siguiente →'}</button>
        </div>` : ''}
      </div>`;
  }

  function _getBookingSteps(service) {
    return [
      { name: 'Propiedad', render: () => _stepProperty() },
      { name: 'Contacto', render: () => _stepContact() },
      { name: 'Checkout', render: () => _stepCheckout(service) },
      { name: 'Confirmación', render: () => _stepConfirmation(service) },
    ];
  }

  function _stepProperty() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos del inmueble</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="LegalUI.updateBooking('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${escapeAttr(d)}"${_bookingData.district === d ? ' selected' : ''}>${escapeHTML(d)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Tipo de propiedad *</label>
            <select onchange="LegalUI.updateBooking('propertyType',this.value)">
              <option value="">Selecciona tipo</option>
              ${types.map(t => `<option value="${escapeAttr(t.value)}"${_bookingData.propertyType === t.value ? ' selected' : ''}>${escapeHTML(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Área (m²)</label>
            <input type="number" min="10" placeholder="Ej: 120" value="${escapeAttr(_bookingData.area || '')}" oninput="LegalUI.updateBooking('area',+this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Dirección</label>
            <input type="text" placeholder="Av. ejemplo 1234, dpto 501" value="${escapeAttr(_bookingData.address || '')}" oninput="LegalUI.updateBooking('address',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Partida registral (si disponible)</label>
            <input type="text" placeholder="Ej: 12345678" value="${escapeAttr(_bookingData.partidaRegistral || '')}" oninput="LegalUI.updateBooking('partidaRegistral',this.value)"/>
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
            <label>Nombre completo *</label>
            <input type="text" placeholder="Tu nombre" value="${escapeAttr(_bookingData.contactName || '')}" oninput="LegalUI.updateBooking('contactName',this.value)"/>
          </div>
          <div class="val-field">
            <label>Teléfono *</label>
            <input type="tel" placeholder="987 654 321" value="${escapeAttr(_bookingData.contactPhone || '')}" oninput="LegalUI.updateBooking('contactPhone',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Email *</label>
            <input type="email" placeholder="tu@email.com" value="${escapeAttr(_bookingData.contactEmail || '')}" oninput="LegalUI.updateBooking('contactEmail',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Descripción del caso</label>
            <textarea rows="3" placeholder="Describe brevemente tu situación o necesidad legal..." oninput="LegalUI.updateBooking('notes',this.value)">${escapeHTML(_bookingData.notes || '')}</textarea>
          </div>
        </div>
      </div>`;
  }

  function _stepCheckout(service) {
    const propLabel = _bookingData.propertyType
      ? (PROPERTY_TYPES.find(t => t.value === _bookingData.propertyType)?.label || _bookingData.propertyType)
      : '—';
    const details = LegalService.getServiceDetails(_selectedServiceId);

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
            <strong>${escapeHTML(propLabel)} · ${escapeHTML(String(_bookingData.area || '—'))} m² · ${escapeHTML(_bookingData.district || '—')}</strong>
          </div>
          ${details ? `
          <div class="val-checkout-row">
            <span>Entrega</span>
            <strong>${escapeHTML(details.timeline)}</strong>
          </div>` : ''}
          ${_checkResult ? `
          <div class="val-checkout-row">
            <span>Property Check</span>
            <strong>${escapeHTML(_checkResult.propertyId)}</strong>
          </div>` : ''}
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
      _currentOrder = LegalService.createOrder(
        _selectedServiceId,
        {
          district: _bookingData.district,
          propertyType: _bookingData.propertyType,
          area: _bookingData.area,
          address: _bookingData.address,
          partidaRegistral: _bookingData.partidaRegistral,
        },
        {
          name: _bookingData.contactName,
          phone: _bookingData.contactPhone,
          email: _bookingData.contactEmail,
          notes: _bookingData.notes,
        },
        _checkResult ? _checkResult.propertyId : null
      );
      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.LEGAL_LEAD_CREATED, {
        service_id: _selectedServiceId,
        order_id: _currentOrder.id,
        has_check: !!_checkResult,
      });
    }

    return `
      <div class="val-step" style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">
          Tu solicitud de <strong>${escapeHTML(service.name)}</strong> ha sido registrada.
          Un abogado especializado te contactará para confirmar los detalles y documentación requerida.
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Orden</span><strong>${escapeHTML(_currentOrder.id)}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${escapeHTML(LEGAL_ORDER_STATUS_LABELS[_currentOrder.status])}</strong></div>
          <div class="val-order-row"><span>Servicio</span><strong>${escapeHTML(service.name)}</strong></div>
          <div class="val-order-row"><span>Precio</span><strong>${escapeHTML(service.price.display)}</strong></div>
          ${_currentOrder.checkId ? `<div class="val-order-row"><span>Property Check</span><strong style="color:var(--ink-4)">${escapeHTML(_currentOrder.checkId)}</strong></div>` : ''}
        </div>

        <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="LegalUI.backToCatalog()">Volver a Legal</button>
      </div>`;
  }

  // === NAVIGATION ===
  function nextStep() {
    const service = getServiceById(_selectedServiceId);
    const steps = _getBookingSteps(service);

    // Validate before advancing to confirmation step
    if (_bookingStep === steps.length - 2) {
      const container = document.querySelector('.val-form-wrap');
      if (container) RecoValidation.clearAllErrors(container);

      const nameRes = RecoValidation.validateName(_bookingData.contactName);
      const emailRes = RecoValidation.validateEmail(_bookingData.contactEmail);
      const phoneRes = RecoValidation.validatePhone(_bookingData.contactPhone);
      const districtRes = RecoValidation.validateRequired(_bookingData.district, 'Distrito');

      let hasError = false;
      if (container) {
        const inputs = container.querySelectorAll('input, select');
        for (const inp of inputs) {
          const oi = inp.getAttribute('oninput') || inp.getAttribute('onchange') || '';
          if (oi.includes("'contactName'") && !nameRes.valid) { RecoValidation.showFieldError(inp, nameRes.error); hasError = true; }
          if (oi.includes("'contactEmail'") && !emailRes.valid) { RecoValidation.showFieldError(inp, emailRes.error); hasError = true; }
          if (oi.includes("'contactPhone'") && !phoneRes.valid) { RecoValidation.showFieldError(inp, phoneRes.error); hasError = true; }
          if (oi.includes("'district'") && !districtRes.valid) { RecoValidation.showFieldError(inp, districtRes.error); hasError = true; }
        }
      }
      if (hasError) return;
    }

    if (_bookingStep < steps.length - 1) {
      _bookingStep++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function prevStep() {
    if (_bookingStep > 0) {
      _bookingStep--;
      _rerender();
    }
  }

  function updateBooking(field, value) {
    _bookingData[field] = value;
  }

  function backToCatalog() {
    reset();
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function crossSell(type) {
    if (type === 'tasacion') {
      RecoApp.setTab(CATEGORIES.TASACIONES);
      return;
    }
    if (type === 'foto') {
      RecoApp.setTab(CATEGORIES.FOTOGRAFIA);
      return;
    }
    if (type === 'mortgage') {
      RecoApp.setTab(CATEGORIES.FINANZAS);
      return;
    }
    if (type === 'agent') {
      AgentUI.prepareFromCheck({
        district: _checkFormData.district,
        propertyType: _checkFormData.propertyType,
        area: _checkFormData.area,
      });
      RecoApp.setTab(CATEGORIES.RECO_AGENT);
      return;
    }
  }

  function preparePropertyCheck(propertyData) {
    _checkFormData = { ...propertyData };
    _view = 'check-form';
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    showPropertyCheck,
    showServiceDetail,
    showBooking,
    runPropertyCheck,
    backToCatalog,
    updateCheckField,
    updateBooking,
    nextStep,
    prevStep,
    crossSell,
    preparePropertyCheck,
  };
})();
