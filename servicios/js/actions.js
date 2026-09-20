/**
 * Reco Servicios — Actions Layer
 * Handles all user interactions (CTA clicks, navigation, etc.)
 * Decoupled from UI rendering — components call RecoActions.handle().
 */

const RecoActions = (() => {
  function _toast(msg) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.2)';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2500);
  }

  const _handlers = {
    // Pagos
    pagos_alquiler() { RecoApp.setTab(CATEGORIES.PAGOS); },

    // Mantenimiento
    mant_contact(serviceId) {
      const svc = getServiceById(serviceId);
      if (svc) RecoAnalytics.ctaClicked(svc, 'contact');
      RecoApp.setTab(CATEGORIES.MANTENIMIENTO);
    },

    // Tasaciones
    tas_estimate() { RecoApp.setTab(CATEGORIES.TASACIONES, 'reco-estimate'); },
    tas_express() { RecoApp.setTab(CATEGORIES.TASACIONES, 'tasacion-express'); },
    tas_virtual() { RecoApp.setTab(CATEGORIES.TASACIONES, 'tasacion-virtual'); },
    tas_presencial() { RecoApp.setTab(CATEGORIES.TASACIONES, 'tasacion-presencial'); },

    // Finanzas
    coming_soon() { _toast('Próximamente'); },
    fin_hipotecario() { RecoApp.setTab(CATEGORIES.FINANZAS); },
    fin_prestamo() { RecoApp.setTab(CATEGORIES.FINANZAS); },
    fin_bnpl() { _toast('Próximamente'); },
    fin_adelanto() { RecoApp.setTab(CATEGORIES.FINANZAS); },
    fin_seguro() { RecoApp.setTab(CATEGORIES.FINANZAS); },

    // Fotografía
    foto_agendar() { RecoApp.setTab(CATEGORIES.FOTOGRAFIA); },
    foto_tour_ia() { RecoApp.setTab(CATEGORIES.FOTOGRAFIA, 'tour-virtual-ia'); },
    foto_staging() { RecoApp.setTab(CATEGORIES.FOTOGRAFIA, 'home-staging-ia'); },
    foto_pack() { RecoApp.setTab(CATEGORIES.FOTOGRAFIA, 'pack-reco-visual'); },

    // Legal
    legal_solicitar() { RecoApp.setTab(CATEGORIES.LEGAL); },
    legal_detalles() { RecoApp.setTab(CATEGORIES.LEGAL); },
    legal_agendar() { RecoApp.setTab(CATEGORIES.LEGAL); },

    // Fallback
    noop() {},
  };

  function handle(actionId, serviceId) {
    const handler = _handlers[actionId];
    if (handler) {
      handler(serviceId);
    } else {
      console.warn('[RecoActions] Unknown action:', actionId);
      _toast('Acción no disponible');
    }

    if (serviceId) {
      const svc = getServiceById(serviceId);
      if (svc) RecoAnalytics.serviceClicked(svc, actionId);
    }
  }

  function registerHandler(actionId, fn) {
    _handlers[actionId] = fn;
  }

  return { handle, registerHandler };
})();
