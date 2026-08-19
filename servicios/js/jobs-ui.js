/**
 * Reco Servicios — Jobs UI
 * User-need-based navigation: "¿Qué necesitas hacer con tu propiedad?"
 * Renders Job cards and Job detail views, delegates to existing module UIs.
 */

const JobsUI = (() => {
  let _view = 'main';
  let _selectedJobId = null;

  function reset() {
    _view = 'main';
    _selectedJobId = null;
  }

  function render() {
    if (_view === 'detail') return _renderJobDetail();
    return _renderMain();
  }

  // === MAIN: 7 Job Cards ===
  function _renderMain() {
    const jobs = getJobDefinitions();
    const primary = jobs.filter(j => j.priority <= 4);
    const secondary = jobs.filter(j => j.priority > 4);

    return `
      <div class="job-grid-primary">
        ${primary.map(j => _jobCard(j, true)).join('')}
      </div>

      <div class="job-grid-secondary">
        ${secondary.map(j => _jobCard(j, false)).join('')}
      </div>

      ${InfoBanner('🔍 ¿No encuentras lo que buscas?', 'Todos los servicios de Reco están organizados según lo que necesitas hacer. Haz clic en cualquier bloque para explorar los servicios disponibles.')}
    `;
  }

  function _jobCard(job, isPrimary) {
    const services = getServicesByJob(job.id);
    const availableCount = services.filter(s => s.status === 'available').length;

    return `
      <div class="job-card ${isPrimary ? 'job-card-primary' : ''}" onclick="JobsUI.showJob('${job.id}')">
        <div class="job-card-gradient" style="background:${job.gradient}">
          <div class="job-card-icon">${job.icon}</div>
          <h3 class="job-card-title">${job.title}</h3>
          <p class="job-card-desc">${job.description}</p>
          <div class="job-card-count">${availableCount} servicio${availableCount !== 1 ? 's' : ''} disponible${availableCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="job-card-footer">
          <span class="job-card-cta">${job.ctaPrimary.label} →</span>
        </div>
      </div>`;
  }

  // === JOB DETAIL ===
  function showJob(jobId) {
    _selectedJobId = jobId;
    _view = 'detail';
    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.JOB_CLICKED, { job_id: jobId });
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderJobDetail() {
    const job = getJobById(_selectedJobId);
    if (!job) return ErrorState('Bloque no encontrado');

    const services = getServicesByJob(job.id);
    const available = services.filter(s => s.status === 'available');
    const comingSoon = services.filter(s => s.status === 'coming_soon');
    const related = getRelatedServicesForJob(job.id);

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.JOB_VIEWED, { job_id: job.id });

    return `
      <button class="val-back" onclick="JobsUI.backToMain()">← ¿Qué necesitas hacer?</button>

      <div class="job-detail-header" style="background:${job.gradient}">
        <div class="job-detail-icon">${job.icon}</div>
        <h2 class="font-serif job-detail-title">${job.title}</h2>
        <p class="job-detail-desc">${job.description}</p>
      </div>

      ${available.length > 0 ? `
        ${CategoryDivider(job.icon, 'Servicios disponibles', available.length)}
        <div class="job-service-grid">
          ${available.map(s => _serviceCard(s)).join('')}
        </div>
      ` : ''}

      ${comingSoon.length > 0 ? `
        ${CategoryDivider('🕐', 'Próximamente', comingSoon.length)}
        <div class="job-service-grid">
          ${comingSoon.map(s => _serviceCard(s)).join('')}
        </div>
      ` : ''}

      ${related.length > 0 ? `
        <div class="job-related-section">
          <h3 class="job-related-title">Servicios relacionados</h3>
          <div class="job-related-grid">
            ${related.map(s => _relatedCard(s)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="job-cta-footer">
        ${job.ctaPrimary ? `<button class="plan-cta" style="width:auto;padding:12px 28px" onclick="JobsUI.handleJobCTA('${job.id}','primary')">${job.ctaPrimary.label} →</button>` : ''}
        ${job.ctaSecondary ? `<button class="plan-cta outline" style="width:auto;padding:12px 28px" onclick="JobsUI.handleJobCTA('${job.id}','secondary')">${job.ctaSecondary.label}</button>` : ''}
      </div>
    `;
  }

  function _serviceCard(svc) {
    const tag = svc.tags[0] && svc.status !== 'coming_soon'
      ? `<div class="job-svc-tag">${svc.tags[0]}</div>` : '';
    const comingSoon = svc.status === 'coming_soon';

    return `
      <div class="job-svc-card ${comingSoon ? 'job-svc-coming' : ''}" onclick="${comingSoon ? '' : 'JobsUI.navigateToService(\'' + svc.id + '\')'}">
        ${tag}
        <div class="job-svc-icon">${svc.icon}</div>
        <h4 class="job-svc-name">${svc.name}</h4>
        <p class="job-svc-desc">${svc.description}</p>
        <div class="job-svc-price">${svc.price}</div>
        ${comingSoon
          ? '<span class="job-svc-soon">Próximamente</span>'
          : `<span class="job-svc-cta">${svc.cta ? svc.cta.label : 'Ver más'} →</span>`
        }
      </div>`;
  }

  function _relatedCard(svc) {
    return `
      <div class="job-related-card" onclick="JobsUI.navigateToService('${svc.id}')">
        <div class="job-related-icon">${svc.icon}</div>
        <div class="job-related-info">
          <strong>${svc.hook || svc.name}</strong>
          <span>${svc.name}</span>
        </div>
        <span class="val-cross-arrow">→</span>
      </div>`;
  }

  // === NAVIGATION ===
  function navigateToService(svcId) {
    const svc = getRegistryServiceById(svcId);
    if (!svc) return;

    RecoAnalytics.track(RecoAnalytics.EVENT_TYPES.SERVICE_CLICKED, {
      service_id: svc.id,
      service_name: svc.name,
      source_job: _selectedJobId,
    });

    if (svc.navigateTo) {
      RecoApp.setTab(svc.navigateTo);
    }
  }

  function handleJobCTA(jobId, type) {
    const job = getJobById(jobId);
    if (!job) return;

    const cta = type === 'secondary' ? job.ctaSecondary : job.ctaPrimary;
    if (!cta) return;

    const actionMap = {
      job_valorar_primary: CATEGORIES.TASACIONES,
      job_valorar_secondary: CATEGORIES.TASACIONES,
      job_revisar_primary: CATEGORIES.RECO_AGENT,
      job_verificar_primary: CATEGORIES.LEGAL,
      job_pagar_primary: CATEGORIES.PAGOS,
      job_pagar_secondary: CATEGORIES.FINANZAS,
      job_mejorar_primary: CATEGORIES.FOTOGRAFIA,
      job_mantener_primary: CATEGORIES.MANTENIMIENTO,
      job_administrar_primary: CATEGORIES.PROPERTY_MANAGEMENT,
    };

    const target = actionMap[cta.action];
    if (target) {
      RecoApp.setTab(target);
    }
  }

  function backToMain() {
    _view = 'main';
    _selectedJobId = null;
    _rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _rerender() {
    const el = document.getElementById('svcContent');
    if (el) el.innerHTML = render();
  }

  return {
    render,
    reset,
    showJob,
    navigateToService,
    handleJobCTA,
    backToMain,
  };
})();
