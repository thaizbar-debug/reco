/**
 * Reco Servicios — Visual UI
 * Renders: Photography catalog, booking flows, AI service requests.
 * Uses VisualService for order/gallery logic, FOTOGRAFIA_SERVICES from data.js.
 *
 * ⚠️ MOCK: Photo upload, AI processing, and payment are simulated.
 */

const VisualUI = (() => {
  let _view = 'catalog';
  let _selectedServiceId = null;
  let _step = 0;
  let _bookingData = {};
  let _currentOrder = null;
  let _mockPhotoCount = 0;

  function reset() {
    _view = 'catalog';
    _selectedServiceId = null;
    _step = 0;
    _bookingData = {};
    _currentOrder = null;
    _mockPhotoCount = 0;
  }

  function render() {
    if (_view === 'booking') return _renderBooking();
    return _renderCatalog();
  }

  // === CATALOG VIEW ===
  function _renderCatalog() {
    const services = getServicesByCategory(CATEGORIES.FOTOGRAFIA);
    const foto = services.filter(s => s.subcategory === 'foto');
    const video = services.filter(s => s.subcategory === 'video');
    const ia = services.filter(s => s.subcategory === 'ia');
    const pack = services.filter(s => s.subcategory === 'pack');

    return `
      ${SectionHeader('Fotografía, Video e IA', 'Vende más rápido con imágenes profesionales',
        'Fotos profesionales, video recorrido, tours virtuales con IA y home staging virtual. Tu propiedad destaca desde el primer clic.')}

      <div class="vis-pro-banner">
        <div class="vis-pro-icon">⭐</div>
        <div>
          <strong>Fotos Pro</strong>
          <span>Las propiedades con fotos profesionales de Reco reciben el sello "Fotos Pro" en su publicación, destacando en los resultados de búsqueda.</span>
        </div>
      </div>

      ${CategoryDivider('📷', 'Fotografía y video', foto.length + video.length)}
      <div class="svc-foto-grid">
        ${[...foto, ...video].map(s => _visualCard(s)).join('')}
      </div>

      ${CategoryDivider('🤖', 'Servicios con IA', ia.length)}
      <div class="vis-ai-notice">
        ⚠️ Los servicios de IA utilizan proveedores simulados (mock). La integración con proveedores reales está en desarrollo.
      </div>
      <div class="svc-foto-grid">
        ${ia.map(s => _visualCard(s)).join('')}
      </div>

      ${CategoryDivider('🎯', 'Pack completo', pack.length)}
      <div class="svc-foto-grid">
        ${pack.map(s => _visualCard(s)).join('')}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="VisualUI.crossSell('tasacion')">
          <div class="val-cross-icon">📐</div>
          <div>
            <strong>¿Necesitas tasar tu propiedad?</strong>
            <span>Reco Estimate — Estimación gratuita e instantánea</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="VisualUI.crossSell('agent')">
          <div class="val-cross-icon">🏠</div>
          <div>
            <strong>¿Quieres vender tu propiedad?</strong>
            <span>Reco Agent — Próximamente</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('📍 Disponibilidad presencial', 'Servicios de foto y video presencial disponibles en Miraflores, San Isidro, Barranco, Surco, San Borja, La Molina, Jesús María, Magdalena, Lince y Pueblo Libre. Los servicios IA están disponibles para todo el Perú.')}`;
  }

  function _visualCard(service) {
    const badge = service.featured
      ? '<div class="foto-badge">Recomendado</div>'
      : service.tags[0] === 'Pack'
        ? '<div class="foto-badge" style="background:var(--green-mid)">Pack</div>'
        : service.tags[0] === 'IA'
          ? '<div class="foto-badge" style="background:#FEF3C7;color:#92400E">IA</div>'
          : service.tags[0]
            ? FinTag(service.tags[0], true)
            : '';
    const featuredClass = service.featured ? ' featured' : '';

    return `
      <div class="svc-foto-card${featuredClass}">
        ${badge}
        <div class="svc-fin-icon">${service.icon}</div>
        <div class="svc-fin-title">${service.name}</div>
        <div class="svc-fin-desc">${service.description}</div>
        <div class="svc-fin-price">${service.price.display}</div>
        <button class="svc-fin-cta" onclick="VisualUI.showBooking('${service.id}')">${service.cta?.label || 'Solicitar'} →</button>
      </div>`;
  }

  // === BOOKING FLOW ===
  function showBooking(serviceId) {
    _selectedServiceId = serviceId;
    _step = 0;
    _bookingData = {};
    _currentOrder = null;
    _mockPhotoCount = 0;
    _view = 'booking';

    RecoAnalytics.track('visual_service_viewed', { service_id: serviceId });

    const serviceType = VisualService.getServiceType(serviceId);
    if (serviceType === VISUAL_SERVICE_TYPES.PHOTO || serviceType === VISUAL_SERVICE_TYPES.VIDEO) {
      RecoAnalytics.track('photo_service_started', { service_id: serviceId });
    } else if (serviceType === VISUAL_SERVICE_TYPES.AI_TOUR) {
      RecoAnalytics.track('ai_tour_started', { service_id: serviceId });
    } else if (serviceType === VISUAL_SERVICE_TYPES.STAGING) {
      RecoAnalytics.track('staging_started', { service_id: serviceId });
    }

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderBooking() {
    const service = getServiceById(_selectedServiceId);
    if (!service) return ErrorState('Servicio no encontrado');

    const steps = _getStepsForService(_selectedServiceId);
    const stepNames = steps.map(s => s.name);

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="VisualUI.backToCatalog()">← Volver a servicios</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:var(--accent-light);color:var(--accent)">${service.name} · ${service.price.display}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar ${service.name}</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 20px">${service.description}</p>
        </div>

        <div class="val-progress">
          ${stepNames.map((name, i) => `
            <div class="val-progress-step ${i < _step ? 'done' : i === _step ? 'active' : ''}">
              <div class="val-progress-dot">${i < _step ? '✓' : i + 1}</div>
              <div class="val-progress-label">${name}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_step].render()}

        ${_step < steps.length - 1 ? `
        <div class="val-nav-buttons">
          ${_step > 0 ? '<button class="plan-cta outline" onclick="VisualUI.prevStep()">← Anterior</button>' : '<div></div>'}
          <button class="plan-cta" onclick="VisualUI.nextStep()">${_step === steps.length - 2 ? 'Enviar solicitud' : 'Siguiente →'}</button>
        </div>` : ''}
      </div>`;
  }

  function _getStepsForService(serviceId) {
    const service = getServiceById(serviceId);
    const serviceType = VisualService.getServiceType(serviceId);

    if (serviceType === VISUAL_SERVICE_TYPES.PHOTO) {
      return [
        { name: 'Propiedad', render: _stepProperty },
        { name: 'Dirección', render: _stepAddress },
        { name: 'Agenda', render: _stepScheduleVisit },
        { name: 'Contacto', render: _stepContact },
        { name: 'Checkout', render: () => _stepCheckout(service) },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }

    if (serviceType === VISUAL_SERVICE_TYPES.VIDEO) {
      return [
        { name: 'Propiedad', render: _stepProperty },
        { name: 'Dirección', render: _stepAddress },
        { name: 'Video', render: _stepVideoConfig },
        { name: 'Agenda', render: _stepScheduleVisit },
        { name: 'Contacto', render: _stepContact },
        { name: 'Checkout', render: () => _stepCheckout(service) },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }

    if (serviceType === VISUAL_SERVICE_TYPES.AI_TOUR) {
      return [
        { name: 'Propiedad', render: _stepProperty },
        { name: 'Fotos', render: _stepPhotoUpload },
        { name: 'Contacto', render: _stepContact },
        { name: 'Checkout', render: () => _stepCheckout(service) },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }

    if (serviceType === VISUAL_SERVICE_TYPES.STAGING) {
      return [
        { name: 'Propiedad', render: _stepProperty },
        { name: 'Fotos', render: _stepPhotoUpload },
        { name: 'Estilo', render: _stepStagingConfig },
        { name: 'Contacto', render: _stepContact },
        { name: 'Checkout', render: () => _stepCheckout(service) },
        { name: 'Confirmación', render: () => _stepConfirmation(service) },
      ];
    }

    return [
      { name: 'Propiedad', render: _stepProperty },
      { name: 'Dirección', render: _stepAddress },
      { name: 'Agenda', render: _stepScheduleVisit },
      { name: 'Contacto', render: _stepContact },
      { name: 'Checkout', render: () => _stepCheckout(service) },
      { name: 'Confirmación', render: () => _stepConfirmation(service) },
    ];
  }

  // === STEP RENDERERS ===

  function _stepProperty() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de la propiedad</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="VisualUI.updateBooking('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${d}"${_bookingData.district === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Tipo de propiedad *</label>
            <select onchange="VisualUI.updateBooking('propertyType',this.value)">
              <option value="">Selecciona tipo</option>
              ${types.map(t => `<option value="${t.value}"${_bookingData.propertyType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Área (m²)</label>
            <input type="number" min="10" placeholder="Ej: 120" value="${_bookingData.area || ''}" oninput="VisualUI.updateBooking('area',+this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Ambientes a fotografiar</label>
            <input type="number" min="1" max="20" placeholder="Ej: 6" value="${_bookingData.rooms || ''}" oninput="VisualUI.updateBooking('rooms',+this.value)"/>
          </div>
          <div class="val-field">
            <label>Notas para el fotógrafo</label>
            <input type="text" placeholder="Ej: mascotas en casa, portero" value="${_bookingData.propertyNotes || ''}" oninput="VisualUI.updateBooking('propertyNotes',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepAddress() {
    const districts = ValuationService.getAvailableDistricts();
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Dirección del inmueble</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Dirección completa *</label>
            <input type="text" placeholder="Av. ejemplo 1234, dpto 501" value="${_bookingData.address || ''}" oninput="VisualUI.updateBooking('address',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="VisualUI.updateBooking('addressDistrict',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${d}"${(_bookingData.addressDistrict || _bookingData.district) === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Referencia</label>
            <input type="text" placeholder="Cerca de..., cruce con..." value="${_bookingData.reference || ''}" oninput="VisualUI.updateBooking('reference',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepScheduleVisit() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Agenda tu sesión</h3>
        <p style="font-size:13px;color:var(--ink-3);margin-bottom:16px">El fotógrafo/videógrafo visitará el inmueble en la fecha y hora seleccionada.</p>
        <div class="val-row">
          <div class="val-field">
            <label>Fecha preferida *</label>
            <input type="date" min="${_getMinDate()}" value="${_bookingData.visitDate || ''}" onchange="VisualUI.updateBooking('visitDate',this.value)"/>
          </div>
          <div class="val-field">
            <label>Horario preferido</label>
            <select onchange="VisualUI.updateBooking('visitTime',this.value)">
              <option value="">Selecciona</option>
              <option value="morning"${_bookingData.visitTime === 'morning' ? ' selected' : ''}>Mañana (9-12h)</option>
              <option value="afternoon"${_bookingData.visitTime === 'afternoon' ? ' selected' : ''}>Tarde (14-17h)</option>
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Fecha alternativa</label>
            <input type="date" min="${_getMinDate()}" value="${_bookingData.altDate || ''}" onchange="VisualUI.updateBooking('altDate',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>¿Quién nos recibirá?</label>
            <input type="text" placeholder="Nombre de quien abrirá" value="${_bookingData.contactAtSite || ''}" oninput="VisualUI.updateBooking('contactAtSite',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _stepVideoConfig() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Configuración de video</h3>

        <div class="val-row">
          <div class="val-field val-full">
            <label>Formato de video *</label>
            <div class="vis-option-grid">
              ${VIDEO_FORMATS.map(f => `
                <button class="vis-option-card${_bookingData.videoFormat === f.value ? ' active' : ''}" onclick="VisualUI.updateBooking('videoFormat','${f.value}');VisualUI.refresh()">
                  <strong>${f.label}</strong>
                  <span>${f.desc}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="val-row">
          <div class="val-field val-full">
            <label>Complementos</label>
            ${VIDEO_ADDONS.map(a => `
              <label class="vis-addon-check">
                <input type="checkbox" ${_bookingData.droneAddon ? 'checked' : ''} onchange="VisualUI.updateBooking('droneAddon',this.checked)"/>
                <div>
                  <strong>${a.label}</strong>
                  <span>${a.desc} · ${a.priceExtra}</span>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      </div>`;
  }

  function _stepPhotoUpload() {
    const serviceType = VisualService.getServiceType(_selectedServiceId);
    const isStaging = serviceType === VISUAL_SERVICE_TYPES.STAGING;
    const minPhotos = isStaging ? 1 : 5;
    const desc = isStaging
      ? 'Sube las fotos del ambiente que deseas amueblar virtualmente.'
      : 'Sube fotos de la propiedad para generar el tour virtual.';

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Sube tus fotos</h3>
        <p style="font-size:13px;color:var(--ink-3);margin-bottom:16px">${desc}</p>

        <div class="vis-upload-zone" onclick="VisualUI.mockAddPhoto()">
          <div class="vis-upload-icon">📁</div>
          <div class="vis-upload-text">
            <strong>Haz clic para seleccionar fotos</strong>
            <span>JPG o PNG · Mínimo ${minPhotos} fotos · Máximo 20</span>
          </div>
        </div>

        <div class="vis-mock-badge">
          ⚠️ MOCK — La carga de archivos no está habilitada. Se simulará la subida de fotos.
        </div>

        ${_mockPhotoCount > 0 ? `
        <div class="vis-upload-count">
          📷 ${_mockPhotoCount} foto${_mockPhotoCount > 1 ? 's' : ''} simulada${_mockPhotoCount > 1 ? 's' : ''}
          <button class="vis-upload-clear" onclick="VisualUI.mockClearPhotos()">Limpiar</button>
        </div>` : ''}
      </div>`;
  }

  function _stepStagingConfig() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Configuración de staging</h3>

        <div class="val-row">
          <div class="val-field val-full">
            <label>Estilo de amoblado *</label>
            <div class="vis-option-grid vis-option-grid-3">
              ${STAGING_STYLES.map(s => `
                <button class="vis-option-card${_bookingData.stagingStyle === s.value ? ' active' : ''}" onclick="VisualUI.updateBooking('stagingStyle','${s.value}');VisualUI.refresh()">
                  <strong>${s.label}</strong>
                  <span>${s.desc}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="val-row">
          <div class="val-field">
            <label>Tipo de ambiente *</label>
            <select onchange="VisualUI.updateBooking('stagingRoom',this.value)">
              <option value="">Selecciona ambiente</option>
              ${STAGING_ROOMS.map(r => `<option value="${r.value}"${_bookingData.stagingRoom === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Cantidad de imágenes</label>
            <div class="val-chips">
              ${[1, 3, 5].map(n => `
                <button class="val-chip${_bookingData.stagingCount === n ? ' active' : ''}" onclick="VisualUI.updateBooking('stagingCount',${n});VisualUI.refresh()">${n} img</button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="vis-staging-preview">
          <div class="vis-staging-col">
            <div class="vis-staging-label">Original</div>
            <div class="vis-staging-placeholder">📷 Foto original</div>
          </div>
          <div class="vis-staging-col">
            <div class="vis-staging-label">Con staging</div>
            <div class="vis-staging-placeholder vis-staged">🛋️ Amoblado virtual (IA)</div>
          </div>
        </div>

        <div class="vis-mock-badge">
          ⚠️ MOCK — El preview usa placeholders. La generación real requiere integración con el proveedor de IA.
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
            <input type="text" placeholder="Tu nombre" value="${_bookingData.contactName || ''}" oninput="VisualUI.updateBooking('contactName',this.value)"/>
          </div>
          <div class="val-field">
            <label>Teléfono *</label>
            <input type="tel" placeholder="987 654 321" value="${_bookingData.contactPhone || ''}" oninput="VisualUI.updateBooking('contactPhone',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Email *</label>
            <input type="email" placeholder="tu@email.com" value="${_bookingData.contactEmail || ''}" oninput="VisualUI.updateBooking('contactEmail',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Notas adicionales</label>
            <textarea rows="3" placeholder="Información relevante para el servicio..." oninput="VisualUI.updateBooking('notes',this.value)">${_bookingData.notes || ''}</textarea>
          </div>
        </div>
      </div>`;
  }

  function _stepCheckout(service) {
    const serviceType = VisualService.getServiceType(_selectedServiceId);
    const hasDrone = _bookingData.droneAddon && serviceType === VISUAL_SERVICE_TYPES.VIDEO;
    const dronePrice = hasDrone ? 150 : 0;
    const totalValue = service.price.value + dronePrice;
    const totalDisplay = hasDrone ? 'S/ ' + totalValue.toLocaleString() : service.price.display;
    const requiresVisit = VisualService.requiresVisit(_selectedServiceId);
    const propLabel = _bookingData.propertyType
      ? (PROPERTY_TYPES.find(t => t.value === _bookingData.propertyType)?.label || _bookingData.propertyType)
      : '—';

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Resumen y pago</h3>
        <div class="val-checkout-summary">
          <div class="val-checkout-row">
            <span>Servicio</span>
            <strong>${service.name}</strong>
          </div>
          <div class="val-checkout-row">
            <span>Propiedad</span>
            <strong>${propLabel} · ${_bookingData.area || '—'} m² · ${_bookingData.district || '—'}</strong>
          </div>
          ${requiresVisit && _bookingData.visitDate ? `
          <div class="val-checkout-row">
            <span>Fecha</span>
            <strong>${_bookingData.visitDate}${_bookingData.visitTime ? ' · ' + _getTimeLabel(_bookingData.visitTime) : ''}</strong>
          </div>` : ''}
          ${serviceType === VISUAL_SERVICE_TYPES.VIDEO && _bookingData.videoFormat ? `
          <div class="val-checkout-row">
            <span>Formato</span>
            <strong>${VIDEO_FORMATS.find(f => f.value === _bookingData.videoFormat)?.label || _bookingData.videoFormat}</strong>
          </div>` : ''}
          ${serviceType === VISUAL_SERVICE_TYPES.STAGING && _bookingData.stagingStyle ? `
          <div class="val-checkout-row">
            <span>Staging</span>
            <strong>${STAGING_STYLES.find(s => s.value === _bookingData.stagingStyle)?.label || ''} · ${STAGING_ROOMS.find(r => r.value === _bookingData.stagingRoom)?.label || ''} · ${_bookingData.stagingCount || 1} img</strong>
          </div>` : ''}
          ${hasDrone ? `
          <div class="val-checkout-row">
            <span>Add-on: Drone</span>
            <strong>+ S/ 150</strong>
          </div>` : ''}
          <div class="val-checkout-divider"></div>
          <div class="val-checkout-row val-checkout-total">
            <span>Total</span>
            <strong>${totalDisplay}</strong>
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
      const serviceType = VisualService.getServiceType(_selectedServiceId);
      _currentOrder = VisualService.createOrder(
        _selectedServiceId,
        { district: _bookingData.district, propertyType: _bookingData.propertyType, area: _bookingData.area, rooms: _bookingData.rooms, address: _bookingData.address },
        { name: _bookingData.contactName, phone: _bookingData.contactPhone, email: _bookingData.contactEmail, notes: _bookingData.notes },
        {
          videoFormat: _bookingData.videoFormat,
          droneAddon: _bookingData.droneAddon,
          stagingStyle: _bookingData.stagingStyle,
          stagingRoom: _bookingData.stagingRoom,
          stagingCount: _bookingData.stagingCount,
          visitDate: _bookingData.visitDate,
          visitTime: _bookingData.visitTime,
          mockPhotoCount: _mockPhotoCount,
        }
      );

      if (serviceType === VISUAL_SERVICE_TYPES.PHOTO || serviceType === VISUAL_SERVICE_TYPES.VIDEO) {
        RecoAnalytics.track('photo_booking_completed', { service_id: _selectedServiceId, order_id: _currentOrder.id });
      } else if (serviceType === VISUAL_SERVICE_TYPES.AI_TOUR) {
        RecoAnalytics.track('ai_tour_completed', { service_id: _selectedServiceId, order_id: _currentOrder.id });
      } else if (serviceType === VISUAL_SERVICE_TYPES.STAGING) {
        RecoAnalytics.track('staging_completed', { service_id: _selectedServiceId, order_id: _currentOrder.id });
      } else if (serviceType === VISUAL_SERVICE_TYPES.PACK) {
        RecoAnalytics.track('visual_pack_purchased', { service_id: _selectedServiceId, order_id: _currentOrder.id });
      }
    }

    const serviceType = VisualService.getServiceType(_selectedServiceId);
    const isAI = serviceType === VISUAL_SERVICE_TYPES.AI_TOUR || serviceType === VISUAL_SERVICE_TYPES.STAGING;

    return `
      <div class="val-step" style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">
          Tu solicitud de <strong>${service.name}</strong> ha sido registrada.
          ${isAI ? 'El procesamiento con IA comenzará una vez confirmado el pago.' : 'Un asesor te contactará para confirmar los detalles.'}
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Orden</span><strong>${_currentOrder.id}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${VISUAL_ORDER_STATUS_LABELS[_currentOrder.status]}</strong></div>
          <div class="val-order-row"><span>Servicio</span><strong>${service.name}</strong></div>
          <div class="val-order-row"><span>Precio</span><strong>${service.price.display}</strong></div>
          ${_currentOrder.aiJobId ? `<div class="val-order-row"><span>Job IA</span><strong style="color:var(--ink-4)">${_currentOrder.aiJobId} (mock)</strong></div>` : ''}
        </div>

        ${isAI ? `
        <div class="vis-mock-badge" style="margin-top:16px">
          ⚠️ MOCK — El procesamiento IA es simulado. No se generará contenido real.
        </div>` : ''}

        <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="VisualUI.backToCatalog()">Volver a Fotografía</button>
      </div>`;
  }

  // === NAVIGATION ===
  function nextStep() {
    const steps = _getStepsForService(_selectedServiceId);
    if (_step < steps.length - 1) {
      _step++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function prevStep() {
    if (_step > 0) {
      _step--;
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
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.2)';
    d.textContent = 'Reco Agent — Próximamente';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2500);
  }

  function mockAddPhoto() {
    if (_mockPhotoCount >= 20) return;
    _mockPhotoCount += 3;
    if (_mockPhotoCount > 20) _mockPhotoCount = 20;
    _rerender();
  }

  function mockClearPhotos() {
    _mockPhotoCount = 0;
    _rerender();
  }

  // === HELPERS ===
  function _getMinDate() {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  }

  function _getTimeLabel(value) {
    const labels = { morning: 'Mañana (9-12h)', afternoon: 'Tarde (14-17h)' };
    return labels[value] || value;
  }

  function refresh() {
    _rerender();
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    showBooking,
    backToCatalog,
    updateBooking,
    nextStep,
    prevStep,
    crossSell,
    mockAddPhoto,
    mockClearPhotos,
    refresh,
  };
})();
