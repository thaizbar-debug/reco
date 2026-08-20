/**
 * Reco Servicios — Property Management UI
 * Renders: portfolio dashboard, property detail (6 sub-tabs), tickets, documents.
 * Target: propietarios with 1-20 properties.
 *
 * ⚠️ MOCK: All property data is simulated.
 */

const PropertyUI = (() => {
  let _view = 'dashboard';
  let _selectedPropertyId = null;
  let _detailTab = 'portfolio';
  let _ticketData = {};
  let _documentData = {};
  let _tracked = false;

  const DETAIL_TABS = [
    { id: 'portfolio', icon: '📊', label: 'Resumen' },
    { id: 'rent', icon: '💰', label: 'Alquiler' },
    { id: 'tenant', icon: '👤', label: 'Inquilino' },
    { id: 'maintenance', icon: '🔧', label: 'Mantenimiento' },
    { id: 'documents', icon: '📄', label: 'Documentos' },
    { id: 'financial', icon: '📈', label: 'Finanzas' },
  ];

  function reset() {
    _view = 'dashboard';
    _selectedPropertyId = null;
    _detailTab = 'portfolio';
    _ticketData = {};
    _documentData = {};
    _tracked = false;
  }

  function render() {
    if (!_tracked) {
      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_MANAGEMENT_VIEWED, {});
      _tracked = true;
    }
    if (_view === 'detail') return _renderDetail();
    if (_view === 'ticket_create') return _renderTicketCreate();
    if (_view === 'document_upload') return _renderDocumentUpload();
    return _renderDashboard();
  }

  // === DASHBOARD ===
  function _renderDashboard() {
    const properties = PropertyService.getProperties();
    const summary = PropertyService.getPortfolioSummary();

    return `
      ${SectionHeader('Propiedades', 'Mis propiedades', 'Gestiona tu portafolio inmobiliario. Controla alquileres, gastos, mantenimiento y documentos desde un solo lugar.')}

      <div class="leg-mock-tag" style="margin-bottom:24px">⚠️ MOCK — Datos simulados. Propiedades de demostración.</div>

      <div class="agt-stats-grid" style="margin-bottom:28px">
        <div class="agt-stat-card">
          <div class="agt-stat-value">${summary.totalProperties}</div>
          <div class="agt-stat-label">Propiedades</div>
        </div>
        <div class="agt-stat-card">
          <div class="agt-stat-value">${_fmtUSD(summary.totalValue)}</div>
          <div class="agt-stat-label">Valor total</div>
        </div>
        <div class="agt-stat-card">
          <div class="agt-stat-value" style="color:var(--green)">${summary.avgYield}%</div>
          <div class="agt-stat-label">Yield promedio</div>
        </div>
        <div class="agt-stat-card">
          <div class="agt-stat-value">${_fmtPEN(summary.netRent)}</div>
          <div class="agt-stat-label">Renta neta/mes</div>
        </div>
      </div>

      ${CategoryDivider('🏢', 'Portafolio', properties.length)}

      <div class="pm-property-grid">
        ${properties.map(p => _propertyCard(p)).join('')}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="PropertyUI.crossSell('estimate')">
          <div class="val-cross-icon">📐</div>
          <div>
            <strong>¿Cuánto valen tus propiedades?</strong>
            <span>Reco Estimate — Valorización gratuita e instantánea</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="PropertyUI.crossSell('agent')">
          <div class="val-cross-icon">🏠</div>
          <div>
            <strong>¿Necesitas un agente inmobiliario?</strong>
            <span>Reco Agent — Compra, vende o alquila</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('🏢 Property Management Lite', 'Gestiona hasta 20 propiedades. Para administración de edificios, cobranza masiva o control de acceso, contáctanos para la versión profesional.')}`;
  }

  function _propertyCard(prop) {
    const yld = PropertyService.getPropertyYield(prop);
    const statusColors = {
      [PROPERTY_STATUS.OCCUPIED]: 'background:var(--green-bg);color:var(--green)',
      [PROPERTY_STATUS.VACANT]: 'background:var(--amber-bg);color:var(--amber)',
      [PROPERTY_STATUS.MAINTENANCE]: 'background:var(--red-bg);color:var(--red)',
      [PROPERTY_STATUS.FOR_SALE]: 'background:var(--accent-light);color:var(--accent)',
    };

    return `
      <div class="pm-property-card" onclick="PropertyUI.showProperty('${escapeAttr(prop.id)}')">
        <div class="pm-mock-tag">MOCK</div>
        <div class="pm-card-header">
          <div>
            <strong class="pm-card-address">${escapeHTML(prop.address)}</strong>
            <span class="pm-card-district">${escapeHTML(prop.district)} · ${escapeHTML(prop.area)}m² · ${escapeHTML(prop.rooms)} hab.</span>
          </div>
          <span class="pm-status-badge" style="${statusColors[prop.status]}">${PROPERTY_STATUS_LABELS[prop.status]}</span>
        </div>

        <div class="pm-card-metrics">
          <div class="pm-card-metric">
            <span>Valor estimado</span>
            <strong>${_fmtUSD(prop.valorEstimado)}</strong>
          </div>
          <div class="pm-card-metric">
            <span>Alquiler</span>
            <strong>${prop.alquilerMensual ? _fmtPEN(prop.alquilerMensual) : '—'}</strong>
          </div>
          <div class="pm-card-metric">
            <span>Yield</span>
            <strong class="pm-yield-value ${yld !== null && yld < 4 ? 'low' : ''}">${yld !== null ? yld + '%' : '—'}</strong>
          </div>
          <div class="pm-card-metric">
            <span>Próx. pago</span>
            <strong>${prop.proximoPago ? _fmtDate(prop.proximoPago) : '—'}</strong>
          </div>
        </div>

        <div class="pm-card-footer">
          <span>${prop.contratoVigente ? '✓ Contrato vigente' : '✗ Sin contrato'}</span>
          <button class="svc-fin-cta" onclick="event.stopPropagation();PropertyUI.showProperty('${escapeAttr(prop.id)}')">Ver detalle →</button>
        </div>
      </div>`;
  }

  // === PROPERTY DETAIL ===
  function showProperty(id) {
    _selectedPropertyId = id;
    _detailTab = 'portfolio';
    _view = 'detail';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setDetailTab(tab) {
    _detailTab = tab;
    _rerender();
  }

  function _renderDetail() {
    const prop = PropertyService.getPropertyById(_selectedPropertyId);
    if (!prop) return ErrorState('Propiedad no encontrada');

    const yld = PropertyService.getPropertyYield(prop);
    const statusColors = {
      [PROPERTY_STATUS.OCCUPIED]: 'background:var(--green-bg);color:var(--green)',
      [PROPERTY_STATUS.VACANT]: 'background:var(--amber-bg);color:var(--amber)',
      [PROPERTY_STATUS.MAINTENANCE]: 'background:var(--red-bg);color:var(--red)',
      [PROPERTY_STATUS.FOR_SALE]: 'background:var(--accent-light);color:var(--accent)',
    };

    let tabContent = '';
    if (_detailTab === 'portfolio') tabContent = _detailPortfolio(prop, yld);
    else if (_detailTab === 'rent') tabContent = _detailRent(prop);
    else if (_detailTab === 'tenant') tabContent = _detailTenant(prop);
    else if (_detailTab === 'maintenance') tabContent = _detailMaintenance(prop);
    else if (_detailTab === 'documents') tabContent = _detailDocuments(prop);
    else if (_detailTab === 'financial') tabContent = _detailFinancial(prop);

    return `
      <button class="val-back" onclick="PropertyUI.backToDashboard()">← Mis propiedades</button>

      <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — Datos simulados</div>

      <div class="pm-detail-header">
        <div>
          <h2 class="font-serif" style="font-size:22px;margin:0 0 4px">${escapeHTML(prop.address)}</h2>
          <span style="color:var(--ink-3);font-size:13px">${escapeHTML(prop.district)} · ${escapeHTML(prop.propertyType)} · ${escapeHTML(prop.area)}m² · ${escapeHTML(prop.rooms)} hab. · ${escapeHTML(prop.bathrooms)} baño${prop.bathrooms > 1 ? 's' : ''}</span>
        </div>
        <span class="pm-status-badge" style="${statusColors[prop.status]}">${PROPERTY_STATUS_LABELS[prop.status]}</span>
      </div>

      <div class="pm-detail-summary">
        <div class="pm-summary-item">
          <span>Valor</span>
          <strong>${_fmtUSD(prop.valorEstimado)}</strong>
        </div>
        <div class="pm-summary-item">
          <span>Alquiler</span>
          <strong>${prop.alquilerMensual ? _fmtPEN(prop.alquilerMensual) + '/mes' : '—'}</strong>
        </div>
        <div class="pm-summary-item">
          <span>Yield</span>
          <strong class="pm-yield-value ${yld !== null && yld < 4 ? 'low' : ''}">${yld !== null ? yld + '%' : '—'}</strong>
        </div>
        <div class="pm-summary-item">
          <span>Próx. pago</span>
          <strong>${prop.proximoPago ? _fmtDate(prop.proximoPago) : '—'}</strong>
        </div>
        <div class="pm-summary-item">
          <span>Contrato</span>
          <strong style="color:${prop.contratoVigente ? 'var(--green)' : 'var(--red)'}">${prop.contratoVigente ? 'Vigente' : 'Sin contrato'}</strong>
        </div>
      </div>

      <div class="pm-detail-tabs">
        ${DETAIL_TABS.map(t => `
          <button class="pm-detail-tab ${_detailTab === t.id ? 'active' : ''}" onclick="PropertyUI.setDetailTab('${t.id}')">
            ${t.icon} ${t.label}
          </button>
        `).join('')}
      </div>

      <div class="pm-tab-content">
        ${tabContent}
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        ${PropertyService.getCrossSellSuggestions(_selectedPropertyId).slice(0, 3).map(s => `
          <div class="val-cross-card" onclick="PropertyUI.crossSell('${escapeAttr(s.target)}')">
            <div class="val-cross-icon">${escapeHTML(s.icon)}</div>
            <div>
              <strong>${escapeHTML(s.title)}</strong>
              <span>${escapeHTML(s.subtitle)}</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
        `).join('')}
      </div>`;
  }

  // --- Detail sub-tabs ---

  function _detailPortfolio(prop, yld) {
    const expenses = PropertyService.getPropertyExpenses(prop);
    const netMonthly = (prop.alquilerMensual || 0) - expenses;

    return `
      <div class="leg-detail-section">
        <h4>📊 Resumen de propiedad</h4>
        <div class="leg-report-row"><span>Tipo</span><strong>${escapeHTML(prop.propertyType)}</strong></div>
        <div class="leg-report-row"><span>Área</span><strong>${escapeHTML(prop.area)} m²</strong></div>
        <div class="leg-report-row"><span>Habitaciones</span><strong>${escapeHTML(prop.rooms)}</strong></div>
        <div class="leg-report-row"><span>Baños</span><strong>${escapeHTML(prop.bathrooms)}</strong></div>
        <div class="leg-report-row"><span>Distrito</span><strong>${escapeHTML(prop.district)}</strong></div>
        <div class="leg-report-row"><span>Valor estimado</span><strong>${_fmtUSD(prop.valorEstimado)}</strong></div>
        <div class="leg-report-row"><span>Alquiler mensual</span><strong>${prop.alquilerMensual ? _fmtPEN(prop.alquilerMensual) : 'No alquilada'}</strong></div>
        <div class="leg-report-row"><span>Gastos mensuales</span><strong>${_fmtPEN(expenses)}</strong></div>
        <div class="leg-report-row"><span>Renta neta mensual</span><strong style="color:${netMonthly >= 0 ? 'var(--green)' : 'var(--red)'}">${_fmtPEN(netMonthly)}</strong></div>
        <div class="leg-report-row"><span>Yield bruto anual</span><strong>${yld !== null ? yld + '%' : 'Pendiente de datos'}</strong></div>
      </div>`;
  }

  function _detailRent(prop) {
    const history = PropertyService.getRentHistory(prop.id);

    return `
      <div class="leg-detail-section">
        <h4>💰 Alquiler</h4>
        ${prop.alquilerMensual ? `
          <div class="leg-report-row"><span>Alquiler esperado</span><strong>${_fmtPEN(prop.alquilerMensual)}/mes</strong></div>
          <div class="leg-report-row"><span>Próximo pago</span><strong>${prop.proximoPago ? _fmtDate(prop.proximoPago) : '—'}</strong></div>
          <div class="leg-report-row"><span>Estado</span><strong style="color:var(--green)">Al día</strong></div>
        ` : `
          <p style="font-size:13px;color:var(--ink-3);margin:0;line-height:1.5">Propiedad no alquilada actualmente. No hay alquiler esperado.</p>
        `}
      </div>

      ${history.length > 0 ? `
        <div class="leg-detail-section">
          <h4>📋 Historial de pagos</h4>
          <div style="overflow-x:auto">
            <table class="val-hist-table">
              <thead><tr><th>Mes</th><th>Monto</th><th>Estado</th><th>Fecha pago</th></tr></thead>
              <tbody>
                ${history.map(r => `
                  <tr>
                    <td>${escapeHTML(r.month)}</td>
                    <td>${_fmtPEN(r.amount)}</td>
                    <td><span class="pm-status-badge" style="${r.status === 'pagado' ? 'background:var(--green-bg);color:var(--green)' : 'background:var(--amber-bg);color:var(--amber)'}">${r.status === 'pagado' ? 'Pagado' : 'Pendiente'}</span></td>
                    <td>${r.date ? _fmtDate(r.date) : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}`;
  }

  function _detailTenant(prop) {
    if (!prop.tenant) {
      return `
        <div class="leg-detail-section" style="text-align:center;padding:32px">
          <div style="font-size:36px;margin-bottom:12px">👤</div>
          <h4 style="margin-bottom:8px">Sin inquilino</h4>
          <p style="font-size:13px;color:var(--ink-3);margin:0 0 16px">Esta propiedad no tiene inquilino actualmente.</p>
          <button class="plan-cta" style="width:auto;padding:10px 24px" onclick="PropertyUI.crossSell('agent')">Encontrar inquilino →</button>
        </div>`;
    }

    const t = prop.tenant;
    return `
      <div class="leg-detail-section">
        <h4>👤 Información del inquilino</h4>
        <div class="leg-report-row"><span>Nombre</span><strong>${escapeHTML(t.name)}</strong></div>
        <div class="leg-report-row"><span>Teléfono</span><strong>${escapeHTML(t.phone)}</strong></div>
        <div class="leg-report-row"><span>Email</span><strong>${escapeHTML(t.email)}</strong></div>
      </div>

      <div class="leg-detail-section">
        <h4>📝 Contrato</h4>
        <div class="leg-report-row"><span>Inicio</span><strong>${_fmtDate(t.leaseStart)}</strong></div>
        <div class="leg-report-row"><span>Fin</span><strong>${_fmtDate(t.leaseEnd)}</strong></div>
        <div class="leg-report-row"><span>Estado</span><strong style="color:${prop.contratoVigente ? 'var(--green)' : 'var(--red)'}">${prop.contratoVigente ? 'Vigente' : 'Vencido'}</strong></div>
        <div class="leg-report-row"><span>Duración</span><strong>${_monthsBetween(t.leaseStart, t.leaseEnd)} meses</strong></div>
      </div>`;
  }

  function _detailMaintenance(prop) {
    const tickets = PropertyService.getTicketsByProperty(prop.id);

    const ticketStatusColors = {
      [TICKET_STATUS.CREATED]: 'background:var(--accent-light);color:var(--accent)',
      [TICKET_STATUS.ASSIGNED]: 'background:var(--amber-bg);color:var(--amber)',
      [TICKET_STATUS.IN_PROGRESS]: 'background:#DBEAFE;color:#1E40AF',
      [TICKET_STATUS.COMPLETED]: 'background:var(--green-bg);color:var(--green)',
      [TICKET_STATUS.CANCELLED]: 'background:var(--paper-3);color:var(--ink-4)',
    };

    const priorityLabels = { low: 'Baja', medium: 'Media', high: 'Alta' };
    const priorityColors = { low: 'color:var(--ink-4)', medium: 'color:var(--amber)', high: 'color:var(--red)' };

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h4 style="font-size:14px;font-weight:700;margin:0">🔧 Tickets de mantenimiento</h4>
        <button class="plan-cta" style="width:auto;padding:8px 18px;font-size:13px" onclick="PropertyUI.showTicketCreate('${escapeAttr(prop.id)}')">+ Nuevo ticket</button>
      </div>

      ${tickets.length > 0 ? tickets.map(t => `
        <div class="pm-ticket-card">
          <div class="pm-ticket-header">
            <div>
              <strong>${escapeHTML(t.title)}</strong>
              <span>${escapeHTML(t.category)} · <span style="${priorityColors[t.priority]}">Prioridad: ${priorityLabels[t.priority]}</span></span>
            </div>
            <span class="pm-status-badge" style="${ticketStatusColors[t.status]}">${TICKET_STATUS_LABELS[t.status]}</span>
          </div>
          <p style="font-size:12px;color:var(--ink-3);margin:8px 0 0;line-height:1.5">${escapeHTML(t.description)}</p>
          ${t.assignedTo ? '<div style="font-size:12px;color:var(--ink-2);margin-top:6px">Asignado: <strong>' + escapeHTML(t.assignedTo) + '</strong></div>' : ''}
          <div style="font-size:11px;color:var(--ink-4);margin-top:6px">Creado: ${_fmtDate(t.createdAt)} · Actualizado: ${_fmtDate(t.updatedAt)}</div>
        </div>
      `).join('') : `
        <div class="leg-detail-section" style="text-align:center;padding:24px">
          <p style="font-size:13px;color:var(--ink-3);margin:0">No hay tickets de mantenimiento para esta propiedad.</p>
        </div>
      `}

      <div class="val-cross-card" style="margin-top:16px" onclick="PropertyUI.crossSell('maintenance')">
        <div class="val-cross-icon">🔧</div>
        <div>
          <strong>Solicitar servicio</strong>
          <span>Encuentra proveedores verificados en el Marketplace de Mantenimiento</span>
        </div>
        <span class="val-cross-arrow">→</span>
      </div>`;
  }

  function _detailDocuments(prop) {
    const docs = PropertyService.getDocumentsByProperty(prop.id);
    const typeIcons = {
      [DOCUMENT_TYPES.CONTRATO]: '📝',
      [DOCUMENT_TYPES.TASACION]: '📐',
      [DOCUMENT_TYPES.PROPERTY_CHECK]: '🔍',
      [DOCUMENT_TYPES.COMPROBANTE]: '🧾',
      [DOCUMENT_TYPES.OTRO]: '📎',
    };

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h4 style="font-size:14px;font-weight:700;margin:0">📄 Documentos</h4>
        <button class="plan-cta" style="width:auto;padding:8px 18px;font-size:13px" onclick="PropertyUI.showDocUpload('${escapeAttr(prop.id)}')">+ Subir documento</button>
      </div>

      ${docs.length > 0 ? `
        <div class="pm-doc-grid">
          ${docs.map(d => `
            <div class="pm-doc-card">
              <div class="pm-doc-icon">${typeIcons[d.type] || '📎'}</div>
              <div class="pm-doc-info">
                <strong>${escapeHTML(d.name)}</strong>
                <span>${DOCUMENT_TYPE_LABELS[d.type]} · ${_fmtDate(d.date)}</span>
              </div>
              <span class="pm-status-badge" style="background:var(--green-bg);color:var(--green)">${d.status === 'vigente' ? 'Vigente' : d.status}</span>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="leg-detail-section" style="text-align:center;padding:24px">
          <p style="font-size:13px;color:var(--ink-3);margin:0">No hay documentos cargados para esta propiedad.</p>
        </div>
      `}`;
  }

  function _detailFinancial(prop) {
    const fin = PropertyService.getFinancialSummary(prop.id);
    if (!fin) return ErrorState('Error obteniendo datos financieros');

    const maxBar = Math.max(fin.ingresos, fin.gastos, 1);

    return `
      <div class="leg-detail-section">
        <h4>📈 Resumen financiero mensual</h4>
        ${fin._note ? '<p style="font-size:12px;color:var(--amber);margin:0 0 12px">' + escapeHTML(fin._note) + '</p>' : ''}

        <div class="pm-financial-row">
          <span>Ingresos (alquiler)</span>
          <div class="pm-financial-bar-wrap">
            <div class="pm-financial-bar income" style="width:${(fin.ingresos / maxBar) * 100}%"></div>
          </div>
          <strong style="color:var(--green)">${_fmtPEN(fin.ingresos)}</strong>
        </div>
        <div class="pm-financial-row">
          <span>Gastos totales</span>
          <div class="pm-financial-bar-wrap">
            <div class="pm-financial-bar expense" style="width:${(fin.gastos / maxBar) * 100}%"></div>
          </div>
          <strong style="color:var(--red)">${_fmtPEN(fin.gastos)}</strong>
        </div>
      </div>

      <div class="leg-detail-section">
        <h4>📋 Desglose de gastos</h4>
        <div class="leg-report-row"><span>Predial</span><strong>${_fmtPEN(fin.desglose.predial)}</strong></div>
        <div class="leg-report-row"><span>Arbitrios</span><strong>${_fmtPEN(fin.desglose.arbitrios)}</strong></div>
        <div class="leg-report-row"><span>Mantenimiento</span><strong>${_fmtPEN(fin.desglose.mantenimiento)}</strong></div>
        <div class="leg-report-row"><span>Seguro</span><strong>${_fmtPEN(fin.desglose.seguro)}</strong></div>
      </div>

      <div class="leg-detail-section">
        <h4>💵 Resultado</h4>
        <div class="leg-report-row"><span>Renta neta mensual</span><strong style="color:${fin.rentaNeta >= 0 ? 'var(--green)' : 'var(--red)'}">${_fmtPEN(fin.rentaNeta)}</strong></div>
        <div class="leg-report-row"><span>Renta neta anual</span><strong style="color:${fin.rentaNeta >= 0 ? 'var(--green)' : 'var(--red)'}">${_fmtPEN(fin.rentaNeta * 12)}</strong></div>
        <div class="leg-report-row"><span>Yield bruto anual</span><strong>${fin.yieldPercent !== null ? fin.yieldPercent + '%' : 'Pendiente de datos'}</strong></div>
      </div>`;
  }

  // === TICKET CREATE ===
  function showTicketCreate(propertyId) {
    _selectedPropertyId = propertyId;
    _ticketData = { title: '', description: '', category: '', priority: 'medium' };
    _view = 'ticket_create';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderTicketCreate() {
    const prop = PropertyService.getPropertyById(_selectedPropertyId);
    if (!prop) return ErrorState('Propiedad no encontrada');

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="PropertyUI.backToDetail()">← Volver a ${escapeHTML(prop.address)}</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#FEF3C7;color:#92400E">🔧 Nuevo ticket</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Reportar problema</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">${escapeHTML(prop.address)}</p>
        </div>

        <div class="val-step">
          <div class="val-row">
            <div class="val-field val-full">
              <label>Título *</label>
              <input type="text" placeholder="Ej: Fuga en baño principal" value="${escapeAttr(_ticketData.title || '')}" oninput="PropertyUI.updateTicket('title',this.value)"/>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field val-full">
              <label>Descripción *</label>
              <textarea rows="3" placeholder="Describe el problema con detalle..." oninput="PropertyUI.updateTicket('description',this.value)">${escapeHTML(_ticketData.description || '')}</textarea>
            </div>
          </div>
          <div class="val-row">
            <div class="val-field">
              <label>Categoría *</label>
              <select onchange="PropertyUI.updateTicket('category',this.value)">
                <option value="">Selecciona categoría</option>
                ${TICKET_CATEGORIES.map(c => '<option value="' + escapeAttr(c) + '"' + (_ticketData.category === c ? ' selected' : '') + '>' + escapeHTML(c) + '</option>').join('')}
              </select>
            </div>
            <div class="val-field">
              <label>Prioridad</label>
              <div class="val-chips">
                ${['low', 'medium', 'high'].map(p => `
                  <button class="val-chip ${_ticketData.priority === p ? 'active' : ''}" onclick="PropertyUI.updateTicket('priority','${p}')">
                    ${{low: '🟢 Baja', medium: '🟡 Media', high: '🔴 Alta'}[p]}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <button class="plan-cta" onclick="PropertyUI.submitTicket()">Crear ticket →</button>
      </div>`;
  }

  function updateTicket(field, value) {
    _ticketData[field] = value;
    if (field === 'priority') _rerender();
  }

  function submitTicket() {
    const formWrap = document.querySelector('.val-form-wrap');
    if (formWrap) RecoValidation.clearAllErrors(formWrap);

    const titleResult = RecoValidation.validateText(_ticketData.title, { required: true, label: 'Titulo' });
    const categoryResult = RecoValidation.validateRequired(_ticketData.category, 'Categoria');
    const descResult = RecoValidation.validateText(_ticketData.description, { required: true, label: 'Descripcion' });

    let hasError = false;
    if (!titleResult.valid) {
      const el = formWrap && formWrap.querySelector('input[type="text"]');
      if (el) RecoValidation.showFieldError(el, titleResult.error);
      hasError = true;
    }
    if (!categoryResult.valid) {
      const el = formWrap && formWrap.querySelector('select');
      if (el) RecoValidation.showFieldError(el, categoryResult.error);
      hasError = true;
    }
    if (!descResult.valid) {
      const el = formWrap && formWrap.querySelector('textarea');
      if (el) RecoValidation.showFieldError(el, descResult.error);
      hasError = true;
    }
    if (hasError) return;

    const ticket = PropertyService.createTicket(
      _selectedPropertyId,
      _ticketData.title,
      _ticketData.description,
      _ticketData.category,
      _ticketData.priority
    );

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.MAINTENANCE_CREATED, {
      ticket_id: ticket.id,
      property_id: _selectedPropertyId,
      category: ticket.category,
      priority: ticket.priority,
    });

    _detailTab = 'maintenance';
    _view = 'detail';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === DOCUMENT UPLOAD ===
  function showDocUpload(propertyId) {
    _selectedPropertyId = propertyId;
    _documentData = { type: '', name: '' };
    _view = 'document_upload';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderDocumentUpload() {
    const prop = PropertyService.getPropertyById(_selectedPropertyId);
    if (!prop) return ErrorState('Propiedad no encontrada');

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="PropertyUI.backToDetail()">← Volver a ${escapeHTML(prop.address)}</button>

        <div class="val-form-header">
          <div class="val-form-badge">📄 Subir documento</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Agregar documento</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">${escapeHTML(prop.address)}</p>
        </div>

        <div class="val-step">
          <div class="val-row">
            <div class="val-field">
              <label>Tipo de documento *</label>
              <select onchange="PropertyUI.updateDoc('type',this.value)">
                <option value="">Selecciona tipo</option>
                ${Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => '<option value="' + escapeAttr(k) + '"' + (_documentData.type === k ? ' selected' : '') + '>' + escapeHTML(v) + '</option>').join('')}
              </select>
            </div>
            <div class="val-field">
              <label>Nombre del documento *</label>
              <input type="text" placeholder="Ej: Contrato de alquiler 2026" value="${escapeAttr(_documentData.name || '')}" oninput="PropertyUI.updateDoc('name',this.value)"/>
            </div>
          </div>
        </div>

        <div class="vis-upload-zone" style="margin-bottom:16px">
          <div class="vis-upload-icon">📄</div>
          <div class="vis-upload-text">
            <strong>Arrastra tu archivo o haz clic</strong>
            <span>PDF, JPG, PNG — Máx 10MB</span>
          </div>
        </div>

        <div class="leg-mock-tag" style="margin-bottom:16px">⚠️ MOCK — La carga de archivos es simulada. No se suben archivos reales.</div>

        <button class="plan-cta" onclick="PropertyUI.submitDoc()">Subir documento →</button>
      </div>`;
  }

  function updateDoc(field, value) {
    _documentData[field] = value;
  }

  function submitDoc() {
    const formWrap = document.querySelector('.val-form-wrap');
    if (formWrap) RecoValidation.clearAllErrors(formWrap);

    const typeResult = RecoValidation.validateRequired(_documentData.type, 'Tipo de documento');
    const nameResult = RecoValidation.validateRequired(_documentData.name, 'Nombre del documento');

    let hasError = false;
    if (!typeResult.valid) {
      const el = formWrap && formWrap.querySelector('select');
      if (el) RecoValidation.showFieldError(el, typeResult.error);
      hasError = true;
    }
    if (!nameResult.valid) {
      const el = formWrap && formWrap.querySelector('input[type="text"]');
      if (el) RecoValidation.showFieldError(el, nameResult.error);
      hasError = true;
    }
    if (hasError) return;

    const doc = PropertyService.addDocument(
      _selectedPropertyId,
      _documentData.type,
      _documentData.name
    );

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.DOCUMENT_UPLOADED, {
      doc_id: doc.id,
      property_id: _selectedPropertyId,
      type: doc.type,
    });

    _detailTab = 'documents';
    _view = 'detail';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === NAVIGATION ===
  function backToDashboard() {
    _view = 'dashboard';
    _selectedPropertyId = null;
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToDetail() {
    _view = 'detail';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function crossSell(type) {
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.PROPERTY_SERVICE_CLICKED, { target: type, property_id: _selectedPropertyId });
    if (type === 'estimate') RecoApp.setTab(CATEGORIES.TASACIONES);
    else if (type === 'agent') RecoApp.setTab(CATEGORIES.RECO_AGENT);
    else if (type === 'legal') RecoApp.setTab(CATEGORIES.LEGAL);
    else if (type === 'finance') RecoApp.setTab(CATEGORIES.FINANZAS);
    else if (type === 'maintenance') {
      if (typeof MaintenanceUI !== 'undefined' && _selectedPropertyId) {
        MaintenanceUI.prepareFromProperty(_selectedPropertyId);
      }
      RecoApp.setTab(CATEGORIES.MANTENIMIENTO);
    }
    else if (type === 'insurance') RecoApp.setTab(CATEGORIES.FINANZAS);
  }

  // === HELPERS ===
  function _fmtPEN(amount) {
    return 'S/ ' + (amount || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function _fmtUSD(amount) {
    return 'US$ ' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function _fmtDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function _monthsBetween(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    return Math.round((e - s) / (1000 * 60 * 60 * 24 * 30));
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    showProperty,
    setDetailTab,
    backToDashboard,
    backToDetail,
    showTicketCreate,
    updateTicket,
    submitTicket,
    showDocUpload,
    updateDoc,
    submitDoc,
    crossSell,
  };
})();
