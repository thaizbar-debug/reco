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
    pagos_alquiler() { _toast('Próximamente disponible'); },

    // Mantenimiento
    mant_contact(serviceId) {
      const svc = getServiceById(serviceId);
      _toast(`Contactando proveedor de ${svc ? svc.name : 'servicio'}…`);
      if (svc) RecoAnalytics.ctaClicked(svc, 'contact');
    },

    // Tasaciones
    tas_estimate() { _toast('Abriendo Reco Estimate…'); },
    tas_express() { _toast('Solicitando Tasación Express…'); },
    tas_virtual() { _toast('Agendando Tasación Virtual…'); },
    tas_presencial() { _toast('Reservando visita…'); },

    // Finanzas
    coming_soon() { _toast('Próximamente'); },
    fin_hipotecario() { _toast('Cotizando Crédito Hipotecario…'); },
    fin_prestamo() { _toast('Cotizando Préstamo Personal…'); },
    fin_bnpl() { _toast('Próximamente'); },
    fin_adelanto() { _toast('Solicitando…'); },
    fin_seguro() { _toast('Cotizando…'); },

    // Fotografía
    foto_agendar() { _toast('Agendando sesión…'); },
    foto_tour_ia() { _toast('Generando tour…'); },
    foto_staging() { _toast('Subiendo fotos…'); },
    foto_pack() { _toast('Cotizando pack…'); },

    // Legal
    legal_solicitar() { _toast('Solicitando…'); },
    legal_detalles() { _toast('Solicitando…'); },
    legal_agendar() { _toast('Agendando sesión…'); },

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
