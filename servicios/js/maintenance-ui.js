/**
 * Reco Servicios — Maintenance Marketplace UI
 * Transactional flow: browse → detail → request → quote → checkout → complete → rate.
 *
 * ⚠️ MOCK: All providers, quotes, and orders are simulated.
 */

const MaintenanceUI = (() => {
  let _view = 'catalog';
  let _selectedServiceId = null;
  let _selectedProviderId = null;
  let _requestData = { description: '', propertyId: '', address: '', date: '', time: '', area: '' };
  let _quote = null;
  let _currentOrder = null;
  let _ratingData = { stars: 0, review: '' };
  let _tracked = false;

  function reset() {
    _view = 'catalog';
    _selectedServiceId = null;
    _selectedProviderId = null;
    _requestData = { description: '', propertyId: '', address: '', date: '', time: '', area: '' };
    _quote = null;
    _currentOrder = null;
    _ratingData = { stars: 0, review: '' };
    _tracked = false;
  }

  // Registry-to-module service ID mapping for deep navigation
  const _REGISTRY_MAP = {
    'limpieza': 'svc-limpieza',
    'gasfiteria': 'svc-gasfiteria',
    'electricista': 'svc-electricista',
    'pintura': 'svc-pintura',
    'mudanza': 'svc-mudanza',
    'remodelacion': 'svc-remodelacion',
    'aire-acondicionado': 'svc-aire-acondicionado',
    'carpinteria': 'svc-carpinteria',
    'camaras': 'svc-camaras',
    'jardineria': 'svc-jardineria',
    'impermeabilizacion': 'svc-impermeabilizacion',
  };

  function render() {
    if (!_tracked) {
      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MAINTENANCE_VIEWED, {});
      _tracked = true;
    }
    const pendingSvc = RecoApp.getPendingServiceId();
    if (pendingSvc) {
      const mapped = _REGISTRY_MAP[pendingSvc] || pendingSvc;
      const svc = MaintenanceService.getServiceById(mapped);
      if (svc) {
        showDetail(mapped);
        return _renderDetail();
      }
    }
    if (_view === 'detail') return _renderDetail();
    if (_view === 'providers') return _renderProviders();
    if (_view === 'request') return _renderRequest();
    if (_view === 'quote') return _renderQuote();
    if (_view === 'checkout') return _renderCheckout();
    if (_view === 'processing') return _renderProcessing();
    if (_view === 'confirmation') return _renderConfirmation();
    if (_view === 'rate') return _renderRate();
    if (_view === 'orders') return _renderOrders();
    return _renderCatalog();
  }

  // === CATALOG ===
  function _renderCatalog() {
    const services = MaintenanceService.getServiceCategories();
    const orders = MaintenanceService.getOrders();
    const activeOrders = orders.filter(o => ![MKT_ORDER_STATUS.COMPLETED, MKT_ORDER_STATUS.CANCELLED].includes(o.status));

    return `
      ${SectionHeader('Mantenimiento', 'Marketplace de mantenimiento', 'Conecta con profesionales verificados. Solicita, cotiza y agenda servicios para tu propiedad.')}

      <div class="leg-mock-tag" style="margin-bottom:24px">⚠️ MOCK — Proveedores y cotizaciones simulados. No representan servicios reales.</div>

      ${activeOrders.length > 0 ? `
        <div class="mkt-active-orders" style="margin-bottom:24px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;font-weight:700;margin:0">📋 Servicios activos</h3>
            <button class="svc-fin-cta" onclick="MaintenanceUI.showOrders()">Ver todos →</button>
          </div>
          ${activeOrders.slice(0, 2).map(o => _orderMiniCard(o)).join('')}
        </div>
      ` : ''}

      ${CategoryDivider('🔧', 'Servicios disponibles', services.length)}

      <div class="mkt-service-grid">
        ${services.map(s => _serviceCard(s)).join('')}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="MaintenanceUI.crossSell('properties')">
          <div class="val-cross-icon">🏢</div>
          <div>
            <strong>Gestiona tus propiedades</strong>
            <span>Reco Property Management — Control total de tu portafolio</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="MaintenanceUI.crossSell('insurance')">
          <div class="val-cross-icon">🛡️</div>
          <div>
            <strong>Protege tu inversión</strong>
            <span>Reco Insurance — Seguro de hogar desde partners</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${orders.length > 0 ? `
        <div style="text-align:center;margin-top:20px">
          <button class="plan-cta outline" style="width:auto;padding:10px 24px" onclick="MaintenanceUI.showOrders()">📋 Ver historial de servicios</button>
        </div>
      ` : ''}

      ${InfoBanner('🔧 Proveedores verificados', 'Todos los proveedores son evaluados con rating mínimo 4.0/5. Cobertura: Lima Metropolitana y Callao. Soporte por WhatsApp.')}`;
  }

  function _serviceCard(svc) {
    const providers = MaintenanceService.getProvidersByService(svc.id);
    const topRating = providers.length > 0 ? Math.max(...providers.map(p => p.rating)) : null;

    return `
      <div class="mkt-card" onclick="MaintenanceUI.showDetail('${escapeAttr(svc.id)}')">
        <div class="mkt-card-icon">${escapeHTML(svc.icon)}</div>
        <h4 class="mkt-card-title">${escapeHTML(svc.name)}</h4>
        <p class="mkt-card-desc">${escapeHTML(svc.description)}</p>
        <div class="mkt-card-meta">
          ${svc.priceFrom ? `<span class="mkt-card-price">Desde ${MKT_CONFIG.currencySymbol} ${escapeHTML(svc.priceFrom)}${escapeHTML(svc.priceUnit || '')}</span>` : '<span class="mkt-card-price">Cotización</span>'}
          ${topRating ? `<span class="mkt-card-rating">⭐ ${topRating}</span>` : ''}
        </div>
        <div class="mkt-card-avail">${escapeHTML(svc.availability)}</div>
        <div class="mkt-card-providers">${providers.length} proveedor${providers.length !== 1 ? 'es' : ''}</div>
        <button class="plan-cta" style="margin-top:auto;font-size:13px" onclick="event.stopPropagation();MaintenanceUI.showDetail('${escapeAttr(svc.id)}')">Solicitar →</button>
      </div>`;
  }

  function _orderMiniCard(order) {
    const svc = MaintenanceService.getServiceById(order.serviceId);
    const statusColors = _getStatusColors();
    return `
      <div class="mkt-order-mini" onclick="MaintenanceUI.showOrderDetail('${escapeAttr(order.id)}')">
        <div style="font-size:20px">${svc ? escapeHTML(svc.icon) : '🔧'}</div>
        <div style="flex:1">
          <strong style="font-size:13px;display:block">${svc ? escapeHTML(svc.name) : 'Servicio'}</strong>
          <span style="font-size:12px;color:var(--ink-3)">${escapeHTML(order.address.split(',')[0])}</span>
        </div>
        <span class="pm-status-badge" style="${statusColors[order.status]}">${MKT_ORDER_STATUS_LABELS[order.status]}</span>
      </div>`;
  }

  // === SERVICE DETAIL ===
  function showDetail(serviceId) {
    _selectedServiceId = serviceId;
    _view = 'detail';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderDetail() {
    const svc = MaintenanceService.getServiceById(_selectedServiceId);
    if (!svc) return ErrorState('Servicio no encontrado');

    const providers = MaintenanceService.getProvidersByService(svc.id);

    return `
      <div class="val-form-wrap" style="max-width:700px">
        <button class="val-back" onclick="MaintenanceUI.backToCatalog()">← Marketplace</button>

        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:8px">${escapeHTML(svc.icon)}</div>
          <h2 class="font-serif" style="font-size:22px;margin:0 0 6px">${escapeHTML(svc.name)}</h2>
          <p style="color:var(--ink-3);font-size:14px;margin:0;max-width:480px;margin:0 auto">${escapeHTML(svc.description)}</p>
        </div>

        <div class="leg-detail-section">
          <h4>✓ Incluye</h4>
          <ul class="fin-coverage-list">
            ${svc.includes.map(i => '<li><span class="fin-cov-check">✓</span> ' + escapeHTML(i) + '</li>').join('')}
          </ul>
        </div>

        <div class="agt-stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
          <div class="agt-stat-card">
            <div class="agt-stat-value">${svc.priceFrom ? MKT_CONFIG.currencySymbol + ' ' + escapeHTML(svc.priceFrom) + escapeHTML(svc.priceUnit || '') : 'Cotización'}</div>
            <div class="agt-stat-label">Precio desde</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${escapeHTML(svc.estimatedDuration)}</div>
            <div class="agt-stat-label">Duración estimada</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${providers.length}</div>
            <div class="agt-stat-label">Proveedores</div>
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>📅 Disponibilidad</h4>
          <p style="font-size:13px;color:var(--ink-2);margin:0">${escapeHTML(svc.availability)}</p>
        </div>

        ${providers.length > 0 ? `
          ${CategoryDivider('👷', 'Proveedores disponibles', providers.length)}
          <div class="mkt-provider-list">
            ${providers.map(p => _providerCard(p)).join('')}
          </div>
        ` : ''}

        <button class="plan-cta" style="margin-top:20px" onclick="MaintenanceUI.startRequest('${escapeAttr(svc.id)}')">Solicitar servicio →</button>
      </div>`;
  }

  function _providerCard(prov) {
    return `
      <div class="mkt-provider-card">
        <div class="mkt-provider-header">
          <div class="agt-avatar" style="width:40px;height:40px;font-size:14px">${escapeHTML(prov.name.charAt(0))}</div>
          <div style="flex:1">
            <strong style="font-size:14px">${escapeHTML(prov.name)}</strong>
            <div style="font-size:12px;color:var(--ink-3)">⭐ ${escapeHTML(String(prov.rating))} · ${escapeHTML(String(prov.reviewCount))} reseñas · ${escapeHTML(String(prov.completedJobs))} trabajos</div>
          </div>
          ${prov.verified ? '<span class="agt-verified-inline">✓ Verificado</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <span style="font-size:11px;color:var(--ink-4)">⏱️ Respuesta: ${escapeHTML(prov.responseTime)}</span>
          <span style="font-size:11px;color:var(--ink-4)">📍 ${Array.isArray(prov.zones) ? escapeHTML(prov.zones.slice(0, 3).join(', ')) + (prov.zones.length > 3 ? ' +' + (prov.zones.length - 3) : '') : escapeHTML(prov.zones)}</span>
        </div>
        <button class="plan-cta outline" style="margin-top:10px;font-size:12px;padding:8px" onclick="event.stopPropagation();MaintenanceUI.selectProvider('${escapeAttr(prov.id)}')">Seleccionar proveedor</button>
      </div>`;
  }

  function selectProvider(providerId) {
    _selectedProviderId = providerId;
    _view = 'request';
    _requestData = { description: '', propertyId: '', address: '', date: '', time: '', area: '' };
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === REQUEST FORM ===
  function startRequest(serviceId) {
    _selectedServiceId = serviceId;
    _selectedProviderId = null;
    _requestData = { description: '', propertyId: '', address: '', date: '', time: '', area: '' };
    _view = 'request';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MAINTENANCE_STARTED, { serviceId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderRequest() {
    const svc = MaintenanceService.getServiceById(_selectedServiceId);
    if (!svc) return ErrorState('Servicio no encontrado');

    const properties = typeof PropertyService !== 'undefined' ? PropertyService.getProperties() : [];
    const districts = typeof ValuationService !== 'undefined' ? ValuationService.getAvailableDistricts() : [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minDate = tomorrow.toISOString().split('T')[0];

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="MaintenanceUI.showDetail('${escapeAttr(_selectedServiceId)}')">← ${escapeHTML(svc.name)}</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#FEF3C7;color:#92400E">${escapeHTML(svc.icon)} ${escapeHTML(svc.name)}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar servicio</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Completa los detalles para recibir una cotización.</p>
        </div>

        ${_selectedProviderId ? (() => {
          const prov = MaintenanceService.getProviderById(_selectedProviderId);
          return prov ? `
            <div class="mkt-selected-provider">
              <strong>Proveedor seleccionado:</strong> ${escapeHTML(prov.name)} · ⭐ ${escapeHTML(String(prov.rating))}
            </div>
          ` : '';
        })() : ''}

        <div class="val-step">
          ${properties.length > 0 ? `
            <div class="val-row">
              <div class="val-field val-full">
                <label>Propiedad (opcional)</label>
                <select onchange="MaintenanceUI.updateRequest('propertyId',this.value);if(this.value){const p=PropertyService.getPropertyById(this.value);if(p)MaintenanceUI.updateRequest('address',p.address+', '+p.district)}">
                  <option value="">Sin vincular a propiedad</option>
                  ${properties.map(p => '<option value="' + escapeAttr(p.id) + '"' + (_requestData.propertyId === p.id ? ' selected' : '') + '>' + escapeHTML(p.address) + ' — ' + escapeHTML(p.district) + '</option>').join('')}
                </select>
              </div>
            </div>
          ` : ''}

          <div class="val-row">
            <div class="val-field val-full">
              <label>Dirección del servicio *</label>
              <input type="text" placeholder="Ej: Av. Pardo 456, Dpto 1201, Miraflores" value="${escapeAttr(_requestData.address || '')}" oninput="MaintenanceUI.updateRequest('address',this.value)"/>
            </div>
          </div>

          <div class="val-row">
            <div class="val-field val-full">
              <label>Descripción del problema o servicio *</label>
              <textarea rows="3" placeholder="Describe qué necesitas con el mayor detalle posible..." oninput="MaintenanceUI.updateRequest('description',this.value)">${escapeHTML(_requestData.description || '')}</textarea>
            </div>
          </div>

          ${svc.priceUnit === '/m²' ? `
            <div class="val-row">
              <div class="val-field">
                <label>Área aproximada (m²)</label>
                <input type="number" min="1" placeholder="Ej: 25" value="${escapeAttr(_requestData.area || '')}" oninput="MaintenanceUI.updateRequest('area',+this.value)"/>
              </div>
              <div class="val-field"></div>
            </div>
          ` : ''}

          <div class="val-row">
            <div class="val-field">
              <label>Fecha preferida *</label>
              <input type="date" min="${minDate}" value="${escapeAttr(_requestData.date || '')}" oninput="MaintenanceUI.updateRequest('date',this.value)"/>
            </div>
            <div class="val-field">
              <label>Hora preferida</label>
              <select onchange="MaintenanceUI.updateRequest('time',this.value)">
                <option value="">Flexible</option>
                <option value="08:00" ${_requestData.time === '08:00' ? 'selected' : ''}>8:00 AM</option>
                <option value="09:00" ${_requestData.time === '09:00' ? 'selected' : ''}>9:00 AM</option>
                <option value="10:00" ${_requestData.time === '10:00' ? 'selected' : ''}>10:00 AM</option>
                <option value="11:00" ${_requestData.time === '11:00' ? 'selected' : ''}>11:00 AM</option>
                <option value="12:00" ${_requestData.time === '12:00' ? 'selected' : ''}>12:00 PM</option>
                <option value="14:00" ${_requestData.time === '14:00' ? 'selected' : ''}>2:00 PM</option>
                <option value="15:00" ${_requestData.time === '15:00' ? 'selected' : ''}>3:00 PM</option>
                <option value="16:00" ${_requestData.time === '16:00' ? 'selected' : ''}>4:00 PM</option>
              </select>
            </div>
          </div>
        </div>

        <button class="plan-cta" onclick="MaintenanceUI.getQuote()">Obtener cotización →</button>
      </div>`;
  }

  function updateRequest(field, value) {
    _requestData[field] = value;
  }

  // === QUOTE ===
  function getQuote() {
    const formWrap = document.querySelector('.val-form-wrap');
    if (formWrap) RecoValidation.clearAllErrors(formWrap);

    const addressResult = RecoValidation.validateAddress(_requestData.address);
    const descResult = RecoValidation.validateText(_requestData.description, { required: true, label: 'Descripcion' });
    const dateResult = RecoValidation.validateRequired(_requestData.date, 'Fecha preferida');

    let hasError = false;
    if (!addressResult.valid) {
      const el = formWrap && formWrap.querySelector('input[type="text"]');
      if (el) RecoValidation.showFieldError(el, addressResult.error);
      hasError = true;
    }
    if (!descResult.valid) {
      const el = formWrap && formWrap.querySelector('textarea');
      if (el) RecoValidation.showFieldError(el, descResult.error);
      hasError = true;
    }
    if (!dateResult.valid) {
      const el = formWrap && formWrap.querySelector('input[type="date"]');
      if (el) RecoValidation.showFieldError(el, dateResult.error);
      hasError = true;
    }
    if (hasError) return;

    _quote = MaintenanceService.simulateQuote(_selectedServiceId, { area: _requestData.area });
    if (!_quote) return;

    _view = 'quote';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderQuote() {
    const svc = MaintenanceService.getServiceById(_selectedServiceId);
    if (!svc || !_quote) return ErrorState('Error en cotización');

    const provider = _selectedProviderId ? MaintenanceService.getProviderById(_selectedProviderId) : null;

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="MaintenanceUI.startRequest('${escapeAttr(_selectedServiceId)}')">← Modificar solicitud</button>

        <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — Cotización simulada. No es un precio real.</div>

        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:36px;margin-bottom:8px">${escapeHTML(svc.icon)}</div>
          <h2 class="font-serif" style="font-size:22px;margin:0 0 4px">${escapeHTML(svc.name)}</h2>
          <p style="color:var(--ink-3);font-size:13px;margin:0">Cotización estimada</p>
        </div>

        <div class="fin-sim-highlight" style="margin-bottom:24px">
          <div class="fin-sim-highlight-label">Precio estimado</div>
          <div class="fin-sim-highlight-value">${MKT_CONFIG.currencySymbol} ${escapeHTML(String(_quote.price))}</div>
          <div class="fin-sim-highlight-note">Duración estimada: ${escapeHTML(_quote.estimatedDuration)}</div>
        </div>

        <div class="rent-checkout-card">
          <h4>📋 Detalle de solicitud</h4>
          <div class="rent-detail-row"><span>Servicio</span><strong>${escapeHTML(svc.name)}</strong></div>
          <div class="rent-detail-row"><span>Dirección</span><strong>${escapeHTML(_requestData.address)}</strong></div>
          <div class="rent-detail-row"><span>Fecha</span><strong>${_fmtDateStr(_requestData.date)}</strong></div>
          ${_requestData.time ? '<div class="rent-detail-row"><span>Hora</span><strong>' + escapeHTML(_requestData.time) + '</strong></div>' : ''}
          ${provider ? '<div class="rent-detail-row"><span>Proveedor</span><strong>' + escapeHTML(provider.name) + '</strong></div>' : ''}
          <div class="rent-detail-row"><span>Descripción</span><strong style="max-width:60%;text-align:right">${escapeHTML(_requestData.description)}</strong></div>
        </div>

        <div class="val-nav-buttons">
          <button class="plan-cta outline" onclick="MaintenanceUI.startRequest('${escapeAttr(_selectedServiceId)}')">← Modificar</button>
          <button class="plan-cta" onclick="MaintenanceUI.acceptQuote()">Aceptar cotización →</button>
        </div>
      </div>`;
  }

  function acceptQuote() {
    _view = 'checkout';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === CHECKOUT ===
  function _renderCheckout() {
    const svc = MaintenanceService.getServiceById(_selectedServiceId);
    if (!svc || !_quote) return ErrorState('Error en checkout');

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="MaintenanceUI._backToQuote()">← Volver a cotización</button>

        <div class="val-form-header">
          <div class="val-form-badge">${escapeHTML(svc.icon)} Confirmar servicio</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Checkout</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Revisa los datos y confirma tu solicitud.</p>
        </div>

        <div class="rent-checkout-card">
          <h4>💰 Resumen de pago</h4>
          <div class="rent-detail-row"><span>Servicio</span><strong>${escapeHTML(svc.name)}</strong></div>
          <div class="rent-detail-row"><span>Precio cotizado</span><strong>${MKT_CONFIG.currencySymbol} ${escapeHTML(String(_quote.price))}</strong></div>
          <div class="rent-detail-row rent-total"><span>Total</span><strong>${MKT_CONFIG.currencySymbol} ${escapeHTML(String(_quote.price))}</strong></div>
        </div>

        <div class="rent-checkout-card">
          <h4>💳 Método de pago</h4>
          <div class="rent-method-option">
            <div class="rent-method-icon">💳</div>
            <div>
              <strong>Pago al proveedor</strong>
              <span>El pago se coordina directamente con el proveedor al completar el servicio.</span>
            </div>
          </div>
          <div class="rent-mock-notice">⚠️ MOCK — En producción, se integrará pago en línea con PSP.</div>
        </div>

        <div class="rent-security-note">🔒 Tu solicitud está protegida. Cancelación gratuita hasta 24h antes del servicio.</div>

        <button class="plan-cta" style="margin-top:16px" onclick="MaintenanceUI.confirmOrder()">Confirmar solicitud → ${MKT_CONFIG.currencySymbol} ${escapeHTML(String(_quote.price))}</button>
      </div>`;
  }

  function _backToQuote() {
    _view = 'quote';
    _rerender();
  }

  function confirmOrder() {
    _view = 'processing';
    _rerender();

    setTimeout(() => {
      const providers = MaintenanceService.getProvidersByService(_selectedServiceId);
      const providerId = _selectedProviderId || (providers.length > 0 ? providers[0].id : null);

      _currentOrder = MaintenanceService.createOrder(
        _selectedServiceId,
        providerId,
        _requestData.propertyId || null,
        {
          description: _requestData.description,
          address: _requestData.address,
          date: _requestData.date,
          time: _requestData.time,
          quotedPrice: _quote.price,
        }
      );

      MaintenanceService.updateOrderStatus(_currentOrder.id, MKT_ORDER_STATUS.QUOTED);
      _currentOrder.status = MKT_ORDER_STATUS.QUOTED;

      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MAINTENANCE_REQUESTED, {
        order_id: _currentOrder.id,
        service_id: _selectedServiceId,
        price: _quote.price,
      });

      _view = 'confirmation';
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 1500);
  }

  // === PROCESSING ===
  function _renderProcessing() {
    return `
      <div class="val-form-wrap" style="text-align:center;padding:48px 24px">
        <div class="rent-processing-spinner"></div>
        <h3 class="font-serif" style="font-size:20px;margin:16px 0 8px">Procesando solicitud...</h3>
        <p style="color:var(--ink-3);font-size:14px">Conectando con el proveedor.</p>
      </div>`;
  }

  // === CONFIRMATION ===
  function _renderConfirmation() {
    if (!_currentOrder) return ErrorState('Error en confirmación');

    const svc = MaintenanceService.getServiceById(_currentOrder.serviceId);
    const prov = MaintenanceService.getProviderById(_currentOrder.providerId);

    return `
      <div class="val-form-wrap" style="text-align:center;padding:32px 24px">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud confirmada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto">
          Tu solicitud ha sido enviada${prov ? ' a ' + escapeHTML(prov.name) : ''}. Te contactarán para confirmar fecha y hora.
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Orden</span><strong>${escapeHTML(_currentOrder.id)}</strong></div>
          <div class="val-order-row"><span>Servicio</span><strong>${svc ? escapeHTML(svc.name) : ''}</strong></div>
          <div class="val-order-row"><span>Proveedor</span><strong>${prov ? escapeHTML(prov.name) : 'Por asignar'}</strong></div>
          <div class="val-order-row"><span>Fecha</span><strong>${_fmtDateStr(_currentOrder.scheduledDate)}</strong></div>
          <div class="val-order-row"><span>Precio</span><strong>${MKT_CONFIG.currencySymbol} ${escapeHTML(String(_currentOrder.quotedPrice))}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${MKT_ORDER_STATUS_LABELS[_currentOrder.status]}</strong></div>
        </div>

        <div class="leg-mock-tag" style="margin-top:16px">⚠️ MOCK — No se envió una solicitud real al proveedor.</div>

        <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
          <button class="plan-cta" style="width:auto;padding:12px 24px" onclick="MaintenanceUI.backToCatalog()">Volver al marketplace</button>
          <button class="plan-cta outline" style="width:auto;padding:12px 24px" onclick="MaintenanceUI.showOrders()">Ver mis servicios</button>
        </div>
      </div>`;
  }

  // === ORDERS LIST ===
  function showOrders() {
    _view = 'orders';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderOrders() {
    const orders = MaintenanceService.getOrders();
    const statusColors = _getStatusColors();

    return `
      <button class="val-back" onclick="MaintenanceUI.backToCatalog()">← Marketplace</button>

      <h2 class="section-title font-serif" style="margin-bottom:4px">Mis servicios</h2>
      <p class="section-sub">Historial de servicios solicitados.</p>

      ${orders.length > 0 ? `
        <div style="overflow-x:auto">
          <table class="val-hist-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Servicio</th>
                <th>Fecha</th>
                <th>Precio</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${orders.map(o => {
                const svc = MaintenanceService.getServiceById(o.serviceId);
                return `<tr>
                  <td>${escapeHTML(o.id)}</td>
                  <td>${svc ? escapeHTML(svc.name) : '—'}</td>
                  <td>${o.scheduledDate ? _fmtDateStr(o.scheduledDate) : '—'}</td>
                  <td>${MKT_CONFIG.currencySymbol} ${escapeHTML(String(o.quotedPrice))}</td>
                  <td><span class="pm-status-badge" style="${statusColors[o.status]}">${MKT_ORDER_STATUS_LABELS[o.status]}</span></td>
                  <td>${o.status === MKT_ORDER_STATUS.COMPLETED && !o.rating ? '<button class="svc-fin-cta" onclick="MaintenanceUI.startRate(\'' + escapeAttr(o.id) + '\')">Calificar</button>' : o.rating ? '⭐ ' + escapeHTML(String(o.rating)) : ''}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="text-align:center;padding:32px;color:var(--ink-3)">
          <div style="font-size:36px;margin-bottom:12px">📋</div>
          <p>No tienes servicios solicitados aún.</p>
        </div>
      `}`;
  }

  function showOrderDetail(orderId) {
    const order = MaintenanceService.getOrderById(orderId);
    if (!order) return;
    if (order.status === MKT_ORDER_STATUS.COMPLETED && !order.rating) {
      startRate(orderId);
    } else {
      showOrders();
    }
  }

  // === RATING ===
  function startRate(orderId) {
    _currentOrder = MaintenanceService.getOrderById(orderId);
    if (!_currentOrder) return;
    _ratingData = { stars: 0, review: '' };
    _view = 'rate';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderRate() {
    if (!_currentOrder) return ErrorState('Orden no encontrada');

    const svc = MaintenanceService.getServiceById(_currentOrder.serviceId);
    const prov = MaintenanceService.getProviderById(_currentOrder.providerId);

    return `
      <div class="val-form-wrap" style="text-align:center">
        <button class="val-back" onclick="MaintenanceUI.showOrders()" style="text-align:left;display:block">← Mis servicios</button>

        <div style="font-size:48px;margin-bottom:8px">${svc ? escapeHTML(svc.icon) : '🔧'}</div>
        <h2 class="font-serif" style="font-size:22px;margin:0 0 4px">Califica el servicio</h2>
        <p style="color:var(--ink-3);font-size:14px;margin:0 0 24px">${svc ? escapeHTML(svc.name) : ''} · ${prov ? escapeHTML(prov.name) : ''}</p>

        <div class="mkt-stars" style="margin-bottom:20px">
          ${[1,2,3,4,5].map(n => `
            <button class="mkt-star ${_ratingData.stars >= n ? 'active' : ''}" onclick="MaintenanceUI.setRating(${n})">★</button>
          `).join('')}
        </div>

        <div class="val-step" style="text-align:left">
          <div class="val-row">
            <div class="val-field val-full">
              <label>Comentario (opcional)</label>
              <textarea rows="3" placeholder="¿Cómo fue tu experiencia?" oninput="MaintenanceUI.updateReview(this.value)">${escapeHTML(_ratingData.review || '')}</textarea>
            </div>
          </div>
        </div>

        <button class="plan-cta" style="margin-top:16px" onclick="MaintenanceUI.submitRating()">Enviar calificación →</button>
      </div>`;
  }

  function setRating(stars) {
    _ratingData.stars = stars;
    _rerender();
  }

  function updateReview(text) {
    _ratingData.review = text;
  }

  function submitRating() {
    const formWrap = document.querySelector('.val-form-wrap');
    if (formWrap) RecoValidation.clearAllErrors(formWrap);

    if (_ratingData.stars < 1) {
      const starsEl = formWrap && formWrap.querySelector('.mkt-stars');
      if (starsEl) RecoValidation.showFieldError(starsEl, 'Selecciona una calificacion');
      return;
    }

    if (_ratingData.review) {
      const commentResult = RecoValidation.validateText(_ratingData.review, { required: false, label: 'Comentario' });
      if (!commentResult.valid) {
        const el = formWrap && formWrap.querySelector('textarea');
        if (el) RecoValidation.showFieldError(el, commentResult.error);
        return;
      }
    }

    MaintenanceService.rateOrder(_currentOrder.id, _ratingData.stars, _ratingData.review);

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROVIDER_RATED, {
      order_id: _currentOrder.id,
      provider_id: _currentOrder.providerId,
      rating: _ratingData.stars,
    });

    _view = 'orders';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === ENTRY POINTS (cross-sell integration) ===
  function prepareFromProperty(propertyId) {
    const prop = typeof PropertyService !== 'undefined' ? PropertyService.getPropertyById(propertyId) : null;
    if (prop) {
      _requestData.propertyId = propertyId;
      _requestData.address = prop.address + ', ' + prop.district;
    }
  }

  function prepareFromTicket(propertyId, category) {
    prepareFromProperty(propertyId);
    const categoryMap = {
      'Gasfitería': 'svc-gasfiteria',
      'Electricidad': 'svc-electricista',
      'Pintura': 'svc-pintura',
      'Cerrajería': 'svc-gasfiteria',
      'Limpieza': 'svc-limpieza',
      'Carpintería': 'svc-remodelacion',
    };
    const serviceId = categoryMap[category];
    if (serviceId) {
      _selectedServiceId = serviceId;
      _view = 'detail';
    }
  }

  // === NAVIGATION ===
  function backToCatalog() {
    _view = 'catalog';
    _selectedServiceId = null;
    _selectedProviderId = null;
    _quote = null;
    _currentOrder = null;
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function crossSell(type) {
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_SERVICE_CLICKED, { target: type, source: 'maintenance' });
    if (type === 'properties') RecoApp.setTab(CATEGORIES.PROPERTY_MANAGEMENT);
    else if (type === 'insurance') RecoApp.setTab(CATEGORIES.FINANZAS);
    else if (type === 'estimate') RecoApp.setTab(CATEGORIES.TASACIONES);
    else if (type === 'agent') RecoApp.setTab(CATEGORIES.RECO_AGENT);
  }

  // === HELPERS ===
  function _fmtDateStr(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function _getStatusColors() {
    return {
      [MKT_ORDER_STATUS.REQUESTED]: 'background:var(--accent-light);color:var(--accent)',
      [MKT_ORDER_STATUS.QUOTED]: 'background:var(--amber-bg);color:var(--amber)',
      [MKT_ORDER_STATUS.ACCEPTED]: 'background:#DBEAFE;color:#1E40AF',
      [MKT_ORDER_STATUS.SCHEDULED]: 'background:#DBEAFE;color:#1E40AF',
      [MKT_ORDER_STATUS.IN_PROGRESS]: 'background:#FEF3C7;color:#92400E',
      [MKT_ORDER_STATUS.COMPLETED]: 'background:var(--green-bg);color:var(--green)',
      [MKT_ORDER_STATUS.CANCELLED]: 'background:var(--paper-3);color:var(--ink-4)',
    };
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    showDetail,
    selectProvider,
    startRequest,
    updateRequest,
    getQuote,
    acceptQuote,
    _backToQuote,
    confirmOrder,
    showOrders,
    showOrderDetail,
    startRate,
    setRating,
    updateReview,
    submitRating,
    prepareFromProperty,
    prepareFromTicket,
    backToCatalog,
    crossSell,
  };
})();
