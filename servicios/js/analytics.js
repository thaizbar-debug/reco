/**
 * Reco Servicios — Analytics Abstraction Layer
 * Emits structured events without coupling to any specific provider.
 * When a real analytics provider is connected, implement the adapter in _dispatch().
 */

const RecoAnalytics = (() => {
  const EVENT_TYPES = Object.freeze({
    SERVICE_VIEWED: 'service_viewed',
    SERVICE_CLICKED: 'service_clicked',
    SERVICE_STARTED: 'service_started',
    SERVICE_COMPLETED: 'service_completed',
    SERVICE_PURCHASE_STARTED: 'service_purchase_started',
    SERVICE_PURCHASE_COMPLETED: 'service_purchase_completed',
    TAB_SWITCHED: 'tab_switched',
    SEARCH_PERFORMED: 'search_performed',
    CTA_CLICKED: 'cta_clicked',
    PAGE_VIEWED: 'page_viewed',
  });

  const _queue = [];
  let _provider = null;
  let _debug = false;

  function _timestamp() {
    return new Date().toISOString();
  }

  function _basePayload() {
    return {
      timestamp: _timestamp(),
      page: 'servicios',
      url: window.location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  }

  function _dispatch(event) {
    if (_debug) {
      console.log('[RecoAnalytics]', event.type, event);
    }

    if (_provider && typeof _provider.track === 'function') {
      _provider.track(event.type, event.payload);
    } else {
      _queue.push(event);
    }
  }

  function track(eventType, payload = {}) {
    const event = {
      type: eventType,
      payload: { ..._basePayload(), ...payload },
    };
    _dispatch(event);
  }

  function serviceViewed(service) {
    track(EVENT_TYPES.SERVICE_VIEWED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      monetization_model: service.monetizationModel,
    });
  }

  function serviceClicked(service, context) {
    track(EVENT_TYPES.SERVICE_CLICKED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      context: context || 'card',
    });
  }

  function serviceStarted(service) {
    track(EVENT_TYPES.SERVICE_STARTED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      monetization_model: service.monetizationModel,
    });
  }

  function serviceCompleted(service, result) {
    track(EVENT_TYPES.SERVICE_COMPLETED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      result: result || 'success',
    });
  }

  function servicePurchaseStarted(service) {
    track(EVENT_TYPES.SERVICE_PURCHASE_STARTED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      price: service.price,
      monetization_model: service.monetizationModel,
    });
  }

  function servicePurchaseCompleted(service, transactionData) {
    track(EVENT_TYPES.SERVICE_PURCHASE_COMPLETED, {
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      price: service.price,
      monetization_model: service.monetizationModel,
      transaction: transactionData || {},
    });
  }

  function tabSwitched(fromTab, toTab) {
    track(EVENT_TYPES.TAB_SWITCHED, { from: fromTab, to: toTab });
  }

  function searchPerformed(category, query, resultsCount) {
    track(EVENT_TYPES.SEARCH_PERFORMED, {
      category,
      query,
      results_count: resultsCount,
    });
  }

  function ctaClicked(service, ctaLabel) {
    track(EVENT_TYPES.CTA_CLICKED, {
      service_id: service.id,
      service_name: service.name,
      cta_label: ctaLabel,
      category: service.category,
    });
  }

  function pageViewed() {
    track(EVENT_TYPES.PAGE_VIEWED, {});
  }

  function setProvider(provider) {
    _provider = provider;
    while (_queue.length > 0) {
      const event = _queue.shift();
      _dispatch(event);
    }
  }

  function enableDebug() {
    _debug = true;
  }

  function getQueue() {
    return [..._queue];
  }

  return {
    EVENT_TYPES,
    track,
    serviceViewed,
    serviceClicked,
    serviceStarted,
    serviceCompleted,
    servicePurchaseStarted,
    servicePurchaseCompleted,
    tabSwitched,
    searchPerformed,
    ctaClicked,
    pageViewed,
    setProvider,
    enableDebug,
    getQueue,
  };
})();
