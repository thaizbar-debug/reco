/**
 * Reco Servicios — Agent UI
 * Renders: matching wizard, agent cards, profiles, contact requests, dashboard MVP.
 * Uses AgentMatch + AgentProfileRegistry + AgentLeadService for data.
 *
 * ⚠️ MOCK: Agent profiles and matching use simulated data.
 */

const AgentUI = (() => {
  let _view = 'catalog';
  let _wizardStep = 0;
  let _wizardData = {};
  let _matchResults = null;
  let _selectedAgentId = null;
  let _contactStep = 0;
  let _contactData = {};
  let _currentLead = null;
  let _dashboardAgentId = null;

  function reset() {
    _view = 'catalog';
    _wizardStep = 0;
    _wizardData = {};
    _matchResults = null;
    _selectedAgentId = null;
    _contactStep = 0;
    _contactData = {};
    _currentLead = null;
    _dashboardAgentId = null;
  }

  function render() {
    if (_view === 'wizard') return _renderWizard();
    if (_view === 'results') return _renderResults();
    if (_view === 'profile') return _renderProfile();
    if (_view === 'contact') return _renderContactFlow();
    if (_view === 'dashboard') return _renderDashboard();
    return _renderCatalog();
  }

  // === CATALOG VIEW ===
  function _renderCatalog() {
    const topAgents = AgentProfileRegistry.getAll().slice(0, 3);

    return `
      ${SectionHeader('Agentes inmobiliarios', 'Encuentra al agente ideal para tu operación', 'Reco te recomienda agentes verificados según tu zona, tipo de propiedad, presupuesto y objetivo. Sin costo para el usuario.')}

      <div class="agt-hero">
        <div class="leg-mock-tag">⚠️ MOCK — Agentes y datos simulados</div>
        <div class="agt-hero-content">
          <div class="agt-hero-icon">🏠</div>
          <div>
            <h3 class="font-serif" style="font-size:24px;margin:0 0 6px">Reco Match</h3>
            <p style="color:var(--ink-3);margin:0 0 14px;font-size:14px;line-height:1.5">
              Dinos qué buscas y te conectamos con los agentes que mejor se adaptan a tu operación.
              Matching inteligente basado en zona, experiencia y performance.
            </p>
            <ul class="agt-hero-list">
              <li>✓ Agentes verificados con track record</li>
              <li>✓ Match score personalizado</li>
              <li>✓ Sin costo para el usuario</li>
              <li>✓ Respuesta rápida garantizada</li>
            </ul>
          </div>
        </div>
        <div class="agt-entry-grid">
          <button class="agt-entry-btn" onclick="AgentUI.startWizard('venta')">
            <span class="agt-entry-icon">🏷️</span>
            <strong>Quiero vender</strong>
            <span>Encuentra un agente para vender tu propiedad</span>
          </button>
          <button class="agt-entry-btn" onclick="AgentUI.startWizard('compra')">
            <span class="agt-entry-icon">🔑</span>
            <strong>Quiero comprar</strong>
            <span>Te conectamos con agentes de la zona que buscas</span>
          </button>
          <button class="agt-entry-btn" onclick="AgentUI.startWizard('alquiler')">
            <span class="agt-entry-icon">📋</span>
            <strong>Quiero alquilar</strong>
            <span>Agentes especializados en alquiler</span>
          </button>
        </div>
      </div>

      <div class="agt-top-section">
        <h3 class="font-serif" style="font-size:18px;margin:0 0 4px;text-align:center">Agentes destacados</h3>
        <p style="text-align:center;color:var(--ink-3);font-size:13px;margin-bottom:18px">Profesionales verificados con excelente track record en Lima</p>
        <div class="agt-cards-grid">
          ${topAgents.map(a => _agentCard(a, null)).join('')}
        </div>
      </div>

      <div class="val-crosssell" style="margin-top:28px">
        <div class="val-cross-card" onclick="AgentUI.crossSell('tasacion')">
          <div class="val-cross-icon">📐</div>
          <div>
            <strong>¿Quieres saber cuánto vale tu propiedad?</strong>
            <span>Reco Estimate — Estimación gratuita e instantánea</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
        <div class="val-cross-card" onclick="AgentUI.crossSell('check')">
          <div class="val-cross-icon">🔍</div>
          <div>
            <strong>¿Quieres verificar una propiedad?</strong>
            <span>Property Check — Verificación legal</span>
          </div>
          <span class="val-cross-arrow">→</span>
        </div>
      </div>

      ${InfoBanner('🏅 Agentes verificados', 'Todos los agentes pasan verificación de identidad, antecedentes y experiencia profesional. Rating mínimo 4.5/5 con al menos 50 operaciones cerradas.')}`;
  }

  function _agentCard(agent, matchResult) {
    const matchBadge = matchResult
      ? `<div class="agt-match-badge">${matchResult.matchPercentage}% Match</div>`
      : '';
    const initials = agent.name.split(' ').map(w => w[0]).join('').slice(0, 2);

    return `
      <div class="agt-card" onclick="AgentUI.showProfile('${agent.id}')">
        ${matchBadge}
        ${agent.verified ? '<div class="agt-verified-badge">✓ Verificado</div>' : ''}
        <div class="agt-avatar">${initials}</div>
        <div class="agt-card-name">${agent.name}</div>
        <div class="agt-card-rating">⭐ ${agent.rating} (${agent.reviewCount})</div>
        <div class="agt-card-zones">📍 ${agent.zones.slice(0, 3).join(', ')}</div>
        <div class="agt-card-specs">
          ${agent.specialties.map(s => `<span class="agt-spec-tag">${s}</span>`).join('')}
        </div>
        <div class="agt-card-stats">
          <span>⏱️ ${agent.responseTime}</span>
          <span>📅 ${agent.yearsExperience}a exp.</span>
          <span>🏠 ${agent.closedDeals} ops.</span>
        </div>
        ${matchResult && matchResult.reasons.length > 0 ? `
          <div class="agt-match-reason">${AgentMatch.getMatchExplanation(matchResult)}</div>
        ` : ''}
        <button class="svc-fin-cta" style="margin-top:auto" onclick="event.stopPropagation();AgentUI.showProfile('${agent.id}')">Ver perfil →</button>
      </div>`;
  }

  // === MATCHING WIZARD ===
  function startWizard(operation) {
    _wizardStep = 0;
    _wizardData = { operation: operation || '' };
    _matchResults = null;
    _view = 'wizard';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.AGENT_MATCH_STARTED, { operation });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderWizard() {
    const steps = [
      { name: 'Objetivo', render: () => _wizStep1() },
      { name: 'Propiedad', render: () => _wizStep2() },
      { name: 'Preferencias', render: () => _wizStep3() },
    ];

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="AgentUI.backToCatalog()">← Volver a agentes</button>

        <div class="val-form-header">
          <div class="val-form-badge" style="background:#DBEAFE;color:#1E40AF">🏠 Reco Match</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Encuentra tu agente ideal</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 24px">Cuéntanos sobre tu operación para recomendarte los mejores agentes.</p>
        </div>

        <div class="val-progress">
          ${steps.map((s, i) => `
            <div class="val-progress-step ${i < _wizardStep ? 'done' : i === _wizardStep ? 'active' : ''}">
              <div class="val-progress-dot">${i < _wizardStep ? '✓' : i + 1}</div>
              <div class="val-progress-label">${s.name}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_wizardStep].render()}

        <div class="val-nav-buttons">
          ${_wizardStep > 0 ? '<button class="plan-cta outline" onclick="AgentUI.wizardPrev()">← Anterior</button>' : '<div></div>'}
          <button class="plan-cta" onclick="AgentUI.wizardNext()">${_wizardStep === 2 ? '🔍 Buscar agentes' : 'Siguiente →'}</button>
        </div>
      </div>`;
  }

  function _wizStep1() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">¿Qué quieres hacer?</h3>
        <div class="agt-operation-grid">
          ${Object.entries(OPERATION_LABELS).map(([val, label]) => `
            <button class="agt-operation-btn${_wizardData.operation === val ? ' active' : ''}" onclick="AgentUI.updateWizard('operation','${val}')">
              <span class="agt-op-icon">${val === 'venta' ? '🏷️' : val === 'compra' ? '🔑' : '📋'}</span>
              <strong>${label}</strong>
            </button>
          `).join('')}
        </div>
      </div>`;
  }

  function _wizStep2() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de la propiedad</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Distrito *</label>
            <select onchange="AgentUI.updateWizard('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${d}"${_wizardData.district === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Tipo de propiedad *</label>
            <select onchange="AgentUI.updateWizard('propertyType',this.value)">
              <option value="">Selecciona tipo</option>
              ${types.map(t => `<option value="${t.value}"${_wizardData.propertyType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Área (m²)</label>
            <input type="number" min="10" placeholder="Ej: 120" value="${_wizardData.area || ''}" oninput="AgentUI.updateWizard('area',+this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Rango de precio</label>
            <select onchange="AgentUI.updateWizard('priceRange',this.value)">
              <option value="">Selecciona rango</option>
              ${PRICE_RANGES.map(r => `<option value="${r.value}"${_wizardData.priceRange === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`;
  }

  function _wizStep3() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Preferencias adicionales</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>¿Qué es más importante para ti?</label>
            <select onchange="AgentUI.updateWizard('priority',this.value)">
              <option value="">Selecciona (opcional)</option>
              <option value="speed"${_wizardData.priority === 'speed' ? ' selected' : ''}>Rapidez en la operación</option>
              <option value="experience"${_wizardData.priority === 'experience' ? ' selected' : ''}>Experiencia del agente</option>
              <option value="zone"${_wizardData.priority === 'zone' ? ' selected' : ''}>Conocimiento de la zona</option>
              <option value="price"${_wizardData.priority === 'price' ? ' selected' : ''}>Mejor precio/negociación</option>
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Comentarios adicionales</label>
            <textarea rows="3" placeholder="Describe brevemente tu situación o lo que buscas..." oninput="AgentUI.updateWizard('notes',this.value)">${_wizardData.notes || ''}</textarea>
          </div>
        </div>
      </div>`;
  }

  function updateWizard(field, value) {
    _wizardData[field] = value;
    if (field === 'operation') _rerender();
  }

  function wizardNext() {
    if (_wizardStep < 2) {
      _wizardStep++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    _runMatch();
  }

  function wizardPrev() {
    if (_wizardStep > 0) {
      _wizardStep--;
      _rerender();
    }
  }

  function _runMatch() {
    _matchResults = AgentMatch.match(_wizardData);
    _view = 'results';

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.AGENT_MATCH_COMPLETED, {
      operation: _wizardData.operation,
      district: _wizardData.district,
      propertyType: _wizardData.propertyType,
      resultsCount: _matchResults.length,
    });

    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === RESULTS VIEW ===
  function _renderResults() {
    if (!_matchResults) return ErrorState('No hay resultados');

    const opLabel = OPERATION_LABELS[_wizardData.operation] || _wizardData.operation;

    return `
      <div class="val-result-wrap">
        <button class="val-back" onclick="AgentUI.startWizard('${_wizardData.operation}')">← Modificar búsqueda</button>

        <div class="val-mock-badge">⚠️ DATOS SIMULADOS — Agentes y scores de matching son mock</div>

        <div class="agt-results-header">
          <h2 class="section-title font-serif" style="text-align:center;margin:0 0 4px">
            ${_matchResults.length} agente${_matchResults.length !== 1 ? 's' : ''} recomendado${_matchResults.length !== 1 ? 's' : ''}
          </h2>
          <p style="text-align:center;color:var(--ink-3);font-size:13px;margin-bottom:20px">
            Para ${opLabel.toLowerCase()} ${_wizardData.propertyType ? (PROPERTY_TYPES.find(t => t.value === _wizardData.propertyType)?.label || '') : ''} en ${_wizardData.district || 'Lima'}
          </p>
        </div>

        ${_matchResults.length > 0 ? `
          <div class="agt-results-grid">
            ${_matchResults.map(r => _agentCard(r.agent, r)).join('')}
          </div>
        ` : `
          <div style="text-align:center;padding:32px;color:var(--ink-3)">
            <div style="font-size:48px;margin-bottom:12px">🔍</div>
            <p>No encontramos agentes para estos criterios. Intenta ampliar la búsqueda.</p>
            <button class="plan-cta outline" style="margin-top:12px" onclick="AgentUI.startWizard('${_wizardData.operation}')">Modificar búsqueda</button>
          </div>
        `}

        <div class="val-crosssell" style="margin-top:28px">
          <div class="val-cross-card" onclick="AgentUI.crossSell('tasacion')">
            <div class="val-cross-icon">📐</div>
            <div>
              <strong>¿Quieres tasar tu propiedad primero?</strong>
              <span>Reco Estimate — Estimación gratuita</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
          <div class="val-cross-card" onclick="AgentUI.crossSell('check')">
            <div class="val-cross-icon">🔍</div>
            <div>
              <strong>¿Quieres verificar la propiedad?</strong>
              <span>Property Check — Verificación legal</span>
            </div>
            <span class="val-cross-arrow">→</span>
          </div>
        </div>
      </div>`;
  }

  // === PROFILE VIEW ===
  function showProfile(agentId) {
    _selectedAgentId = agentId;
    _view = 'profile';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.AGENT_PROFILE_VIEWED, { agent_id: agentId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderProfile() {
    const agent = AgentProfileRegistry.getById(_selectedAgentId);
    if (!agent) return ErrorState('Agente no encontrado');

    const matchResult = _matchResults
      ? _matchResults.find(r => r.agent.id === agent.id)
      : null;

    const initials = agent.name.split(' ').map(w => w[0]).join('').slice(0, 2);

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="AgentUI.backFromProfile()">← Volver</button>

        <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — Perfil de agente simulado. No representa una persona real.</div>

        <div class="agt-profile-header">
          <div class="agt-avatar agt-avatar-lg">${initials}</div>
          <div class="agt-profile-info">
            <h2 class="font-serif" style="font-size:22px;margin:0 0 4px">${agent.name}</h2>
            ${agent.verified ? '<div class="agt-verified-inline">✓ Agente verificado</div>' : ''}
            <div class="agt-profile-rating">⭐ ${agent.rating}/5 · ${agent.reviewCount} reseñas</div>
          </div>
          ${matchResult ? `<div class="agt-match-badge agt-match-lg">${matchResult.matchPercentage}% Match</div>` : ''}
        </div>

        ${matchResult && matchResult.reasons.length > 0 ? `
        <div class="agt-match-explain">
          <strong>¿Por qué este agente?</strong>
          <p>${AgentMatch.getMatchExplanation(matchResult)}</p>
        </div>` : ''}

        <div class="agt-profile-bio">
          <p>${agent.bio}</p>
        </div>

        <div class="agt-stats-grid">
          <div class="agt-stat-card">
            <div class="agt-stat-value">${agent.yearsExperience}</div>
            <div class="agt-stat-label">Años exp.</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${agent.closedDeals}</div>
            <div class="agt-stat-label">Operaciones</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${agent.avgDaysToClose}d</div>
            <div class="agt-stat-label">Tiempo prom.</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${agent.activeListings}</div>
            <div class="agt-stat-label">Props. activas</div>
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>📍 Zonas de cobertura</h4>
          <div class="agt-zone-tags">
            ${agent.zones.map(z => `<span class="agt-spec-tag">${z}</span>`).join('')}
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>🏠 Especialidades</h4>
          <div class="agt-zone-tags">
            ${agent.specialties.map(s => `<span class="agt-spec-tag">${s}</span>`).join('')}
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>📋 Tipos de propiedad</h4>
          <div class="agt-zone-tags">
            ${agent.propertyTypes.map(t => {
              const pt = PROPERTY_TYPES.find(p => p.value === t);
              return `<span class="agt-spec-tag">${pt ? pt.label : t}</span>`;
            }).join('')}
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>⏱️ Tiempo de respuesta</h4>
          <div class="leg-detail-timeline">${agent.responseTime}</div>
        </div>

        <button class="plan-cta" style="margin-top:16px" onclick="AgentUI.startContact('${agent.id}')">
          Solicitar contacto →
        </button>
      </div>`;
  }

  function backFromProfile() {
    if (_matchResults) {
      _view = 'results';
    } else {
      _view = 'catalog';
    }
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // === CONTACT FLOW ===
  function startContact(agentId) {
    _selectedAgentId = agentId;
    _contactStep = 0;
    _contactData = {
      district: _wizardData.district || '',
      propertyType: _wizardData.propertyType || '',
      area: _wizardData.area || '',
      operation: _wizardData.operation || '',
      priceRange: _wizardData.priceRange || '',
    };
    _currentLead = null;
    _view = 'contact';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.AGENT_CONTACT_REQUESTED, { agent_id: agentId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderContactFlow() {
    const agent = AgentProfileRegistry.getById(_selectedAgentId);
    if (!agent) return ErrorState('Agente no encontrado');

    const steps = [
      { name: 'Propiedad', render: () => _contactStepProperty() },
      { name: 'Contacto', render: () => _contactStepContact() },
      { name: 'Confirmación', render: () => _contactStepConfirmation(agent) },
    ];

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="AgentUI.showProfile('${_selectedAgentId}')">← Volver al perfil</button>

        <div class="val-form-header">
          <div class="val-form-badge">Solicitud para ${agent.name}</div>
          <h2 class="section-title font-serif" style="text-align:center;margin:8px 0 4px">Solicitar contacto</h2>
          <p class="section-sub" style="text-align:center;margin:0 auto 20px">Completa tus datos y el agente te contactará.</p>
        </div>

        <div class="val-progress">
          ${steps.map((s, i) => `
            <div class="val-progress-step ${i < _contactStep ? 'done' : i === _contactStep ? 'active' : ''}">
              <div class="val-progress-dot">${i < _contactStep ? '✓' : i + 1}</div>
              <div class="val-progress-label">${s.name}</div>
            </div>
          `).join('')}
        </div>

        ${steps[_contactStep].render()}

        ${_contactStep < steps.length - 1 ? `
        <div class="val-nav-buttons">
          ${_contactStep > 0 ? '<button class="plan-cta outline" onclick="AgentUI.contactPrev()">← Anterior</button>' : '<div></div>'}
          <button class="plan-cta" onclick="AgentUI.contactNext()">${_contactStep === steps.length - 2 ? 'Enviar solicitud' : 'Siguiente →'}</button>
        </div>` : ''}
      </div>`;
  }

  function _contactStepProperty() {
    const districts = ValuationService.getAvailableDistricts();
    const types = ValuationService.getPropertyTypes();

    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de la propiedad</h3>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Operación *</label>
            <select onchange="AgentUI.updateContact('operation',this.value)">
              <option value="">Selecciona</option>
              ${Object.entries(OPERATION_LABELS).map(([v, l]) => `<option value="${v}"${_contactData.operation === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Distrito *</label>
            <select onchange="AgentUI.updateContact('district',this.value)">
              <option value="">Selecciona distrito</option>
              ${districts.map(d => `<option value="${d}"${_contactData.district === d ? ' selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="val-field">
            <label>Tipo de propiedad</label>
            <select onchange="AgentUI.updateContact('propertyType',this.value)">
              <option value="">Selecciona tipo</option>
              ${types.map(t => `<option value="${t.value}"${_contactData.propertyType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field">
            <label>Área (m²)</label>
            <input type="number" min="10" placeholder="Ej: 120" value="${_contactData.area || ''}" oninput="AgentUI.updateContact('area',+this.value)"/>
          </div>
          <div class="val-field">
            <label>Rango de precio</label>
            <select onchange="AgentUI.updateContact('priceRange',this.value)">
              <option value="">Selecciona</option>
              ${PRICE_RANGES.map(r => `<option value="${r.value}"${_contactData.priceRange === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Dirección (opcional)</label>
            <input type="text" placeholder="Av. ejemplo 1234" value="${_contactData.address || ''}" oninput="AgentUI.updateContact('address',this.value)"/>
          </div>
        </div>
      </div>`;
  }

  function _contactStepContact() {
    return `
      <div class="val-step">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">Datos de contacto</h3>
        <div class="val-row">
          <div class="val-field">
            <label>Nombre completo *</label>
            <input type="text" placeholder="Tu nombre" value="${_contactData.contactName || ''}" oninput="AgentUI.updateContact('contactName',this.value)"/>
          </div>
          <div class="val-field">
            <label>Teléfono *</label>
            <input type="tel" placeholder="987 654 321" value="${_contactData.contactPhone || ''}" oninput="AgentUI.updateContact('contactPhone',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Email *</label>
            <input type="email" placeholder="tu@email.com" value="${_contactData.contactEmail || ''}" oninput="AgentUI.updateContact('contactEmail',this.value)"/>
          </div>
        </div>
        <div class="val-row">
          <div class="val-field val-full">
            <label>Mensaje para el agente</label>
            <textarea rows="3" placeholder="Cuéntale al agente sobre tu situación..." oninput="AgentUI.updateContact('message',this.value)">${_contactData.message || ''}</textarea>
          </div>
        </div>
      </div>`;
  }

  function _contactStepConfirmation(agent) {
    if (!_currentLead) {
      _currentLead = AgentLeadService.createLead(
        _selectedAgentId,
        {
          operation: _contactData.operation,
          district: _contactData.district,
          propertyType: _contactData.propertyType,
          area: _contactData.area,
          priceRange: _contactData.priceRange,
          address: _contactData.address,
        },
        {
          name: _contactData.contactName,
          phone: _contactData.contactPhone,
          email: _contactData.contactEmail,
          message: _contactData.message,
        },
        _matchResults ? 'match' : 'direct'
      );
      RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.AGENT_LEAD_CREATED, {
        agent_id: _selectedAgentId,
        lead_id: _currentLead.id,
        source: _matchResults ? 'match' : 'direct',
      });
    }

    return `
      <div class="val-step" style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 class="font-serif" style="font-size:22px;margin-bottom:8px">Solicitud enviada</h3>
        <p style="color:var(--ink-3);font-size:14px;margin-bottom:20px;max-width:420px;margin-left:auto;margin-right:auto">
          Tu solicitud ha sido enviada a <strong>${agent.name}</strong>.
          El agente te contactará en un máximo de <strong>${agent.responseTime}</strong>.
        </p>

        <div class="val-order-card">
          <div class="val-order-row"><span>Lead</span><strong>${_currentLead.id}</strong></div>
          <div class="val-order-row"><span>Estado</span><strong style="color:var(--green)">${LEAD_STATUS_LABELS[_currentLead.status]}</strong></div>
          <div class="val-order-row"><span>Agente</span><strong>${agent.name}</strong></div>
          <div class="val-order-row"><span>Operación</span><strong>${OPERATION_LABELS[_contactData.operation] || '—'}</strong></div>
          ${_contactData.district ? `<div class="val-order-row"><span>Zona</span><strong>${_contactData.district}</strong></div>` : ''}
        </div>

        <button class="plan-cta" style="margin-top:20px;width:auto;padding:12px 32px" onclick="AgentUI.backToCatalog()">Volver a Agentes</button>
      </div>`;
  }

  function updateContact(field, value) {
    _contactData[field] = value;
  }

  function contactNext() {
    if (_contactStep < 2) {
      _contactStep++;
      _rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function contactPrev() {
    if (_contactStep > 0) {
      _contactStep--;
      _rerender();
    }
  }

  // === DASHBOARD MVP ===
  function showDashboard(agentId) {
    _dashboardAgentId = agentId || (AgentProfileRegistry.getAll()[0]?.id);
    _view = 'dashboard';
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderDashboard() {
    const agent = AgentProfileRegistry.getById(_dashboardAgentId);
    if (!agent) return ErrorState('Agente no encontrado');

    const leads = AgentLeadService.getLeadsByAgent(_dashboardAgentId);
    const byStatus = {};
    Object.values(LEAD_STATUS).forEach(s => { byStatus[s] = leads.filter(l => l.status === s).length; });

    return `
      <div class="val-form-wrap">
        <button class="val-back" onclick="AgentUI.backToCatalog()">← Volver a agentes</button>

        <div class="leg-mock-tag" style="margin-bottom:18px">⚠️ MOCK — Dashboard con datos simulados</div>

        <div style="text-align:center;margin-bottom:24px">
          <h2 class="section-title font-serif" style="text-align:center;margin:0 0 4px">Dashboard: ${agent.name}</h2>
          <p style="color:var(--ink-3);font-size:13px">Vista rápida de leads y actividad</p>
        </div>

        <div class="agt-stats-grid" style="margin-bottom:24px">
          <div class="agt-stat-card">
            <div class="agt-stat-value">${leads.length}</div>
            <div class="agt-stat-label">Total leads</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${byStatus[LEAD_STATUS.NEW] || 0}</div>
            <div class="agt-stat-label">Nuevos</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${agent.activeListings}</div>
            <div class="agt-stat-label">Props. activas</div>
          </div>
          <div class="agt-stat-card">
            <div class="agt-stat-value">${byStatus[LEAD_STATUS.CLOSED] || 0}</div>
            <div class="agt-stat-label">Cerrados</div>
          </div>
        </div>

        <div class="leg-detail-section">
          <h4>📋 Leads recientes</h4>
          ${leads.length > 0 ? `
            <div style="overflow-x:auto">
              <table class="val-hist-table">
                <thead><tr><th>ID</th><th>Estado</th><th>Operación</th><th>Zona</th><th>Fecha</th></tr></thead>
                <tbody>
                  ${leads.map(l => `
                    <tr>
                      <td>${l.id}</td>
                      <td><span class="agt-lead-status">${LEAD_STATUS_LABELS[l.status]}</span></td>
                      <td>${OPERATION_LABELS[l.criteria.operation] || '—'}</td>
                      <td>${l.criteria.district || '—'}</td>
                      <td>${new Date(l.createdAt).toLocaleDateString('es-PE')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p style="color:var(--ink-3);font-size:13px;text-align:center;padding:20px 0">No hay leads registrados aún.</p>'}
        </div>

        <div class="leg-detail-section">
          <h4>📊 Pipeline</h4>
          <div class="agt-pipeline">
            ${LEAD_STATUS_ORDER.map(s => `
              <div class="agt-pipeline-stage">
                <div class="agt-pipeline-count">${byStatus[s] || 0}</div>
                <div class="agt-pipeline-label">${LEAD_STATUS_LABELS[s]}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
  }

  // === NAVIGATION ===
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
    if (type === 'check') {
      RecoApp.setTab(CATEGORIES.LEGAL);
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
  }

  function prepareFromEstimate(propertyData) {
    _wizardData = {
      operation: 'venta',
      district: propertyData.district || '',
      propertyType: propertyData.propertyType || '',
      area: propertyData.area || '',
    };
    _wizardStep = 1;
    _view = 'wizard';
  }

  function prepareFromCheck(propertyData) {
    _wizardData = {
      operation: 'compra',
      district: propertyData.district || '',
      propertyType: propertyData.propertyType || '',
      area: propertyData.area || '',
    };
    _wizardStep = 1;
    _view = 'wizard';
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    startWizard,
    updateWizard,
    wizardNext,
    wizardPrev,
    showProfile,
    backFromProfile,
    startContact,
    updateContact,
    contactNext,
    contactPrev,
    showDashboard,
    backToCatalog,
    crossSell,
    prepareFromEstimate,
    prepareFromCheck,
  };
})();
