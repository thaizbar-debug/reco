/**
 * Reco Servicios — Lead Capture Modal
 * Universal "Solicitar / Cotizar" component that replaces mock checkouts.
 * Collects service + property + client data, saves to Firestore serviceRequests.
 *
 * ⚠️ Falls back to localStorage when Firestore is unavailable (file:// protocol).
 */

const LeadCaptureModal = (() => {
  let _isOpen = false;
  let _submitting = false;
  let _submitted = false;
  let _serviceConfig = null;
  let _formData = {
    name: '',
    email: '',
    phone: '',
    district: '',
    propertyType: '',
    area: '',
    address: '',
    preferredDate: '',
    budget: '',
    notes: '',
  };
  let _orderId = null;
  let _overlayEl = null;

  function open(config) {
    _serviceConfig = config;
    _submitting = false;
    _submitted = false;
    _orderId = null;
    _prefillData();
    _ensureOverlay();
    _overlayEl.innerHTML = _renderModal();
    _overlayEl.classList.add('open');
    _isOpen = true;
    document.body.style.overflow = 'hidden';

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.SERVICE_PURCHASE_STARTED, {
      service_id: config.serviceId,
      service_name: config.serviceName,
      category: config.category,
      source: 'lead_capture',
    });
  }

  function close() {
    if (_submitting) return;
    if (_overlayEl) _overlayEl.classList.remove('open');
    _isOpen = false;
    document.body.style.overflow = '';
  }

  function _prefillData() {
    _formData = {
      name: '', email: '', phone: '',
      district: '', propertyType: '', area: '',
      address: '', preferredDate: '', budget: '', notes: '',
    };

    if (typeof UserService !== 'undefined') {
      var profile = UserService.getUserProfile();
      if (profile) {
        _formData.name = profile.displayName || '';
        _formData.email = profile.email || '';
      }
      UserService.getUserDoc().then(function(doc) {
        if (doc && doc.phone) {
          _formData.phone = doc.phone;
          var phoneInput = document.getElementById('lcPhone');
          if (phoneInput) phoneInput.value = _formData.phone;
        }
      }).catch(function() {});
    }

    if (typeof PropertyContext !== 'undefined' && PropertyContext.hasContext()) {
      _formData.propertyId = PropertyContext.getPropertyId();
    }
  }

  function _ensureOverlay() {
    _overlayEl = document.getElementById('leadCaptureOverlay');
    if (!_overlayEl) {
      _overlayEl = document.createElement('div');
      _overlayEl.id = 'leadCaptureOverlay';
      _overlayEl.className = 'lc-overlay';
      _overlayEl.addEventListener('click', function(e) {
        if (e.target === _overlayEl) close();
      });
      document.body.appendChild(_overlayEl);
    }
  }

  function updateField(field, value) {
    _formData[field] = value;
  }

  function _getExtraFields() {
    if (!_serviceConfig || !_serviceConfig.extraFields) return [];
    return _serviceConfig.extraFields;
  }

  function _renderModal() {
    var cfg = _serviceConfig;
    var ctaLabel = cfg.ctaLabel || 'Solicitar servicio';
    var extra = _getExtraFields();
    var districts = typeof ValuationService !== 'undefined' ? ValuationService.getAvailableDistricts() : [];

    var showDistrict = extra.indexOf('district') !== -1 || extra.length === 0;
    var showArea = extra.indexOf('area') !== -1;
    var showAddress = extra.indexOf('address') !== -1;
    var showDate = extra.indexOf('preferredDate') !== -1;
    var showBudget = extra.indexOf('budget') !== -1;
    var showPropertyType = extra.indexOf('propertyType') !== -1 || extra.length === 0;

    return '<div class="lc-box">' +
      '<button class="lc-close" onclick="LeadCaptureModal.close()" aria-label="Cerrar">&times;</button>' +

      '<div class="lc-header">' +
        '<div class="lc-badge">' + escapeHTML(cfg.icon || '📋') + ' ' + escapeHTML(ctaLabel) + '</div>' +
        '<h3 class="lc-title">' + escapeHTML(cfg.serviceName) + '</h3>' +
        (cfg.price ? '<p class="lc-price">' + escapeHTML(cfg.price) + '</p>' : '') +
        '<p class="lc-desc">Completa tus datos y te contactaremos en las próximas 24 horas para gestionar tu solicitud.</p>' +
      '</div>' +

      '<div class="lc-form" id="lcForm">' +
        '<div class="lc-section-label">Datos de contacto</div>' +
        '<div class="val-row">' +
          '<div class="val-field">' +
            '<label>Nombre completo *</label>' +
            '<input type="text" id="lcName" value="' + escapeAttr(_formData.name) + '" placeholder="Tu nombre" oninput="LeadCaptureModal.updateField(\'name\',this.value)">' +
          '</div>' +
        '</div>' +
        '<div class="val-row">' +
          '<div class="val-field">' +
            '<label>Email *</label>' +
            '<input type="email" id="lcEmail" value="' + escapeAttr(_formData.email) + '" placeholder="tu@email.com" oninput="LeadCaptureModal.updateField(\'email\',this.value)">' +
          '</div>' +
          '<div class="val-field">' +
            '<label>Teléfono *</label>' +
            '<input type="tel" id="lcPhone" value="' + escapeAttr(_formData.phone) + '" placeholder="999 999 999" oninput="LeadCaptureModal.updateField(\'phone\',this.value)">' +
          '</div>' +
        '</div>' +

        '<div class="lc-section-label" style="margin-top:16px">Datos de la propiedad</div>' +
        (showDistrict ? '<div class="val-row">' +
          '<div class="val-field">' +
            '<label>Distrito</label>' +
            '<select id="lcDistrict" onchange="LeadCaptureModal.updateField(\'district\',this.value)">' +
              '<option value="">Seleccionar distrito</option>' +
              districts.map(function(d) { return '<option value="' + escapeAttr(d) + '"' + (_formData.district === d ? ' selected' : '') + '>' + escapeHTML(d) + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          (showPropertyType ? '<div class="val-field">' +
            '<label>Tipo de propiedad</label>' +
            '<select id="lcPropertyType" onchange="LeadCaptureModal.updateField(\'propertyType\',this.value)">' +
              '<option value="">Seleccionar</option>' +
              '<option value="departamento"' + (_formData.propertyType === 'departamento' ? ' selected' : '') + '>Departamento</option>' +
              '<option value="casa"' + (_formData.propertyType === 'casa' ? ' selected' : '') + '>Casa</option>' +
              '<option value="oficina"' + (_formData.propertyType === 'oficina' ? ' selected' : '') + '>Oficina</option>' +
              '<option value="local"' + (_formData.propertyType === 'local' ? ' selected' : '') + '>Local comercial</option>' +
              '<option value="terreno"' + (_formData.propertyType === 'terreno' ? ' selected' : '') + '>Terreno</option>' +
            '</select>' +
          '</div>' : '') +
        '</div>' : '') +

        (showArea || showAddress ? '<div class="val-row">' +
          (showArea ? '<div class="val-field">' +
            '<label>Área (m²)</label>' +
            '<input type="number" id="lcArea" value="' + escapeAttr(_formData.area) + '" placeholder="Ej: 120" oninput="LeadCaptureModal.updateField(\'area\',this.value)">' +
          '</div>' : '') +
          (showAddress ? '<div class="val-field' + (!showArea ? ' val-full' : '') + '">' +
            '<label>Dirección</label>' +
            '<input type="text" id="lcAddress" value="' + escapeAttr(_formData.address) + '" placeholder="Calle, número, urbanización" oninput="LeadCaptureModal.updateField(\'address\',this.value)">' +
          '</div>' : '') +
        '</div>' : '') +

        (showDate || showBudget ? '<div class="val-row">' +
          (showDate ? '<div class="val-field">' +
            '<label>Fecha preferida</label>' +
            '<input type="date" id="lcDate" value="' + escapeAttr(_formData.preferredDate) + '" oninput="LeadCaptureModal.updateField(\'preferredDate\',this.value)">' +
          '</div>' : '') +
          (showBudget ? '<div class="val-field">' +
            '<label>Presupuesto estimado (S/)</label>' +
            '<input type="text" id="lcBudget" value="' + escapeAttr(_formData.budget) + '" placeholder="Ej: 500" oninput="LeadCaptureModal.updateField(\'budget\',this.value)">' +
          '</div>' : '') +
        '</div>' : '') +

        '<div class="val-row">' +
          '<div class="val-field val-full">' +
            '<label>Notas adicionales</label>' +
            '<textarea id="lcNotes" rows="3" placeholder="Describe lo que necesitas, detalles adicionales, horario de contacto..." oninput="LeadCaptureModal.updateField(\'notes\',this.value)">' + escapeHTML(_formData.notes) + '</textarea>' +
          '</div>' +
        '</div>' +

        '<button class="plan-cta lc-submit" id="lcSubmitBtn" onclick="LeadCaptureModal.submit()">' + escapeHTML(ctaLabel) + ' →</button>' +
        '<p class="lc-privacy">🔒 Tus datos están protegidos. Solo los usaremos para gestionar tu solicitud.</p>' +
      '</div>' +
    '</div>';
  }

  function _renderConfirmation() {
    var cfg = _serviceConfig;
    return '<div class="lc-box">' +
      '<div class="lc-confirmation">' +
        '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
        '<h3 class="lc-title">Solicitud enviada</h3>' +
        '<p class="lc-desc" style="margin-bottom:20px">Tu solicitud de <strong>' + escapeHTML(cfg.serviceName) + '</strong> ha sido registrada. Te contactaremos en las próximas 24 horas.</p>' +
        '<div class="lc-summary">' +
          '<div class="lc-summary-row"><span>Referencia</span><strong>' + escapeHTML(_orderId || '—') + '</strong></div>' +
          '<div class="lc-summary-row"><span>Servicio</span><strong>' + escapeHTML(cfg.serviceName) + '</strong></div>' +
          (cfg.price ? '<div class="lc-summary-row"><span>Precio ref.</span><strong>' + escapeHTML(cfg.price) + '</strong></div>' : '') +
          '<div class="lc-summary-row"><span>Contacto</span><strong>' + escapeHTML(_formData.name) + '</strong></div>' +
          '<div class="lc-summary-row"><span>Estado</span><strong style="color:var(--green)">Pendiente de contacto</strong></div>' +
        '</div>' +
        '<button class="plan-cta" style="margin-top:20px" onclick="LeadCaptureModal.close()">Entendido</button>' +
      '</div>' +
    '</div>';
  }

  function submit() {
    if (_submitting) return;

    var form = document.getElementById('lcForm');
    if (form) RecoValidation.clearAllErrors(form);

    var nameRes = RecoValidation.validateName(_formData.name);
    var emailRes = RecoValidation.validateEmail(_formData.email);
    var phoneRes = RecoValidation.validatePhone(_formData.phone);

    var hasError = false;
    if (!nameRes.valid) {
      var el = document.getElementById('lcName');
      if (el) RecoValidation.showFieldError(el, nameRes.error);
      hasError = true;
    }
    if (!emailRes.valid) {
      var el2 = document.getElementById('lcEmail');
      if (el2) RecoValidation.showFieldError(el2, emailRes.error);
      hasError = true;
    }
    if (!phoneRes.valid) {
      var el3 = document.getElementById('lcPhone');
      if (el3) RecoValidation.showFieldError(el3, phoneRes.error);
      hasError = true;
    }
    if (hasError) return;

    _submitting = true;
    var btn = document.getElementById('lcSubmitBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    var cfg = _serviceConfig;
    var requestData = {
      serviceId: cfg.serviceId,
      serviceName: cfg.serviceName,
      category: cfg.category,
      price: cfg.price || null,
      clientName: _formData.name,
      clientEmail: _formData.email,
      clientPhone: _formData.phone,
      district: _formData.district || null,
      propertyType: _formData.propertyType || null,
      area: _formData.area || null,
      address: _formData.address || null,
      preferredDate: _formData.preferredDate || null,
      budget: _formData.budget || null,
      notes: _formData.notes || null,
      propertyId: _formData.propertyId || null,
      userId: typeof UserService !== 'undefined' ? UserService.getUserId() : null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    _orderId = 'SR-' + Date.now().toString(36).toUpperCase();
    requestData.requestId = _orderId;

    _saveRequest(requestData).then(function() {
      if (typeof OrderBridge !== 'undefined') {
        OrderBridge.submit({
          serviceId: cfg.serviceId,
          propertyId: _formData.propertyId || null,
          notes: _formData.notes || '',
          contactPhone: _formData.phone,
        });
      }

      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.SERVICE_PURCHASE_COMPLETED, {
        service_id: cfg.serviceId,
        service_name: cfg.serviceName,
        category: cfg.category,
        request_id: _orderId,
        source: 'lead_capture',
      });

      _submitted = true;
      _submitting = false;
      if (_overlayEl) _overlayEl.innerHTML = _renderConfirmation();
    }).catch(function(err) {
      console.error('[LeadCapture] Save failed:', err);
      _submitting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = (cfg.ctaLabel || 'Solicitar servicio') + ' →';
      }
      _showToast('Error al enviar. Intenta de nuevo.');
    });
  }

  function _saveRequest(data) {
    return new Promise(function(resolve, reject) {
      try {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
          var db = firebase.firestore();
          db.collection('serviceRequests').add(data)
            .then(function(docRef) {
              _orderId = docRef.id;
              data.requestId = docRef.id;
              console.log('[LeadCapture] Saved to Firestore:', docRef.id);
              resolve();
            })
            .catch(function(err) {
              console.warn('[LeadCapture] Firestore failed, falling back to localStorage:', err);
              _saveToLocalStorage(data);
              resolve();
            });
        } else {
          _saveToLocalStorage(data);
          resolve();
        }
      } catch (e) {
        _saveToLocalStorage(data);
        resolve();
      }
    });
  }

  function _saveToLocalStorage(data) {
    try {
      var key = 'reco_service_requests';
      var existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push(data);
      localStorage.setItem(key, JSON.stringify(existing));
      console.log('[LeadCapture:LOCAL] Saved to localStorage:', data.requestId);
    } catch (e) {
      console.warn('[LeadCapture] localStorage save failed:', e);
    }
  }

  function _showToast(msg) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--red,#c53030);color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:10010;box-shadow:0 8px 24px rgba(0,0,0,.2)';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function() { d.remove(); }, 3000);
  }

  return { open: open, close: close, updateField: updateField, submit: submit };
})();
