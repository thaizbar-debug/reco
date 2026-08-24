/* ============================================================
   OrderBridge — Connects per-category order flows to
   ServiceOrderService (the real Cloud Function path).

   Each category UI still calls its own service's createOrder()
   for local mock state. OrderBridge.submit() is called after
   the local order is created, forwarding to the Cloud Function
   when Firebase is available.

   Principle 7: prepared for real integration.
   Principle 8: falls back gracefully when Firebase is unavailable.
   Principle 14: no duplicate order system — bridges to existing.
   ============================================================ */
const OrderBridge = (() => {
  'use strict';

  function submit(params) {
    if (!params || !params.serviceId) {
      return Promise.resolve({ bridged: false, reason: 'missing_serviceId' });
    }

    // Only submit to Cloud Function when user is authenticated
    if (typeof UserService === 'undefined' || !UserService.isAuthenticated()) {
      return Promise.resolve({ bridged: false, reason: 'not_authenticated' });
    }

    if (typeof ServiceOrderService === 'undefined') {
      return Promise.resolve({ bridged: false, reason: 'service_unavailable' });
    }

    var orderParams = {
      serviceId: params.serviceId,
      propertyId: params.propertyId || (typeof PropertyContext !== 'undefined' ? PropertyContext.getPropertyId() : null),
      listingId: params.listingId || (typeof PropertyContext !== 'undefined' ? PropertyContext.getListingId() : null),
      notes: params.notes || '',
      contactPhone: params.contactPhone || null
    };

    return ServiceOrderService.createOrder(orderParams)
      .then(function(result) {
        _trackOrderCreated(orderParams, result);
        return { bridged: true, order: result };
      })
      .catch(function(err) {
        console.warn('[OrderBridge] Cloud Function failed, local order preserved:', err && err.message);
        return { bridged: false, reason: 'cloud_error', error: err };
      });
  }

  function _trackOrderCreated(params, result) {
    if (typeof RecoAnalytics !== 'undefined') {
      RecoAnalytics.track('service_order_created', {
        serviceId: params.serviceId,
        propertyId: params.propertyId,
        listingId: params.listingId,
        orderId: result && result.orderId,
        userId: typeof UserService !== 'undefined' ? UserService.getUserId() : null
      });
    }
  }

  return {
    submit: submit
  };
})();
