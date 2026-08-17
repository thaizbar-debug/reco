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
    VALUATION_STARTED: 'valuation_started',
    VALUATION_COMPLETED: 'valuation_completed',
    VALUATION_RESULT_VIEWED: 'valuation_result_viewed',
    VALUATION_EXPRESS_CLICKED: 'valuation_express_clicked',
    VALUATION_VIRTUAL_CLICKED: 'valuation_virtual_clicked',
    VALUATION_PRESENTIAL_CLICKED: 'valuation_presential_clicked',
    VALUATION_LEAD_CREATED: 'valuation_lead_created',
    VISUAL_SERVICE_VIEWED: 'visual_service_viewed',
    PHOTO_SERVICE_STARTED: 'photo_service_started',
    PHOTO_BOOKING_COMPLETED: 'photo_booking_completed',
    AI_TOUR_STARTED: 'ai_tour_started',
    AI_TOUR_COMPLETED: 'ai_tour_completed',
    STAGING_STARTED: 'staging_started',
    STAGING_COMPLETED: 'staging_completed',
    VISUAL_PACK_PURCHASED: 'visual_pack_purchased',
    PROPERTY_CHECK_STARTED: 'property_check_started',
    PROPERTY_CHECK_COMPLETED: 'property_check_completed',
    PROPERTY_ALERT_VIEWED: 'property_alert_viewed',
    LEGAL_SERVICE_CLICKED: 'legal_service_clicked',
    LEGAL_LEAD_CREATED: 'legal_lead_created',
    AGENT_MATCH_STARTED: 'agent_match_started',
    AGENT_MATCH_COMPLETED: 'agent_match_completed',
    AGENT_PROFILE_VIEWED: 'agent_profile_viewed',
    AGENT_CONTACT_REQUESTED: 'agent_contact_requested',
    AGENT_LEAD_CREATED: 'agent_lead_created',
    AGENT_LEAD_CLOSED: 'agent_lead_closed',
    RENT_PAYMENT_STARTED: 'rent_payment_started',
    RENT_CHECKOUT_OPENED: 'rent_checkout_opened',
    RENT_PAYMENT_SUCCESS: 'rent_payment_success',
    RENT_PAYMENT_FAILED: 'rent_payment_failed',
    RENT_PAYMENT_REFUNDED: 'rent_payment_refunded',
    MORTGAGE_STARTED: 'mortgage_started',
    MORTGAGE_APPLICATION_STARTED: 'mortgage_application_started',
    MORTGAGE_LEAD_CREATED: 'mortgage_lead_created',
    MORTGAGE_PARTNER_CLICKED: 'mortgage_partner_clicked',
    INSURANCE_VIEWED: 'insurance_viewed',
    INSURANCE_LEAD_CREATED: 'insurance_lead_created',
    PROPERTY_MANAGEMENT_VIEWED: 'property_management_viewed',
    PROPERTY_ADDED: 'property_added',
    RENT_RECORDED: 'rent_recorded',
    MAINTENANCE_CREATED: 'maintenance_created',
    DOCUMENT_UPLOADED: 'document_uploaded',
    PROPERTY_SERVICE_CLICKED: 'property_service_clicked',
    MAINTENANCE_VIEWED: 'maintenance_viewed',
    MAINTENANCE_STARTED: 'maintenance_started',
    MAINTENANCE_REQUESTED: 'maintenance_requested',
    MAINTENANCE_COMPLETED: 'maintenance_completed',
    PROVIDER_RATED: 'provider_rated',
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
