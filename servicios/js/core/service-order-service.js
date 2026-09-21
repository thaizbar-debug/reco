/* ============================================================
   ServiceOrderService — Creates and manages service orders
   via Firebase Cloud Function (createServiceOrder).

   Order structure follows CORE integration contract:
   { orderId, userId, serviceId, propertyId, listingId,
     status, price, currency, createdAt, updatedAt }

   States: draft, requested, pending, confirmed,
           in_progress, completed, cancelled

   Principle 7: prepared for real Cloud Function.
   Principle 8: mock mode clearly identified.
   ============================================================ */
const ServiceOrderService = (() => {
  'use strict';

  var ORDER_STATUS = Object.freeze({
    DRAFT:       'draft',
    REQUESTED:   'requested',
    PENDING:     'pending',
    CONFIRMED:   'confirmed',
    IN_PROGRESS: 'in_progress',
    COMPLETED:   'completed',
    CANCELLED:   'cancelled'
  });

  function _isMock() {
    return typeof RecoGateway !== 'undefined' && RecoGateway.configure && true;
  }

  function createOrder(params) {
    if (!params || !params.serviceId) {
      return Promise.reject({ type: 'VALIDATION_ERROR', message: 'serviceId es requerido.' });
    }

    // Require authentication
    if (typeof UserService !== 'undefined' && !UserService.isAuthenticated()) {
      if (typeof RecoFirebase !== 'undefined') {
        RecoFirebase.openAuthModal('login');
      }
      return Promise.reject({ type: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    }

    var orderData = {
      serviceId: params.serviceId,
      propertyId: params.propertyId || null,
      listingId: params.listingId || null,
      notes: params.notes || '',
      contactPhone: params.contactPhone || null
    };

    // Use Firebase Cloud Function via gateway
    if (typeof RecoGateway !== 'undefined' && typeof RecoGateway.callFirebaseWithRetry === 'function') {
      return RecoGateway.callFirebaseWithRetry('createServiceOrder', orderData)
        .then(function(result) {
          if (!result.ok) {
            return Promise.reject(result.error);
          }
          return result.data;
        });
    }

    // Fallback mock (Principle 8)
    console.log('[ServiceOrderService:MOCK] createOrder', JSON.stringify(orderData));
    var mockOrder = {
      orderId: 'mock-' + Date.now().toString(36),
      userId: (typeof UserService !== 'undefined' ? UserService.getUserId() : null),
      serviceId: orderData.serviceId,
      propertyId: orderData.propertyId,
      listingId: orderData.listingId,
      status: ORDER_STATUS.REQUESTED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mock: true
    };
    return Promise.resolve(mockOrder);
  }

  function getOrder(orderId) {
    if (!orderId) return Promise.resolve(null);

    if (typeof RecoGateway !== 'undefined' && typeof RecoGateway.callFirebase === 'function') {
      return RecoGateway.callFirebase('getServiceOrder', { orderId: orderId })
        .then(function(result) {
          if (!result.ok) return null;
          return result.data;
        });
    }

    return Promise.resolve(null);
  }

  function getUserOrders() {
    if (typeof UserService !== 'undefined' && !UserService.isAuthenticated()) {
      return Promise.resolve([]);
    }

    if (typeof RecoGateway !== 'undefined' && typeof RecoGateway.callFirebase === 'function') {
      return RecoGateway.callFirebase('getUserServiceOrders', {})
        .then(function(result) {
          if (!result.ok) return [];
          return result.data || [];
        });
    }

    return Promise.resolve([]);
  }

  function cancelOrder(orderId) {
    if (!orderId) return Promise.reject({ type: 'VALIDATION_ERROR', message: 'orderId es requerido.' });

    if (typeof RecoGateway !== 'undefined' && typeof RecoGateway.callFirebaseWithRetry === 'function') {
      return RecoGateway.callFirebaseWithRetry('cancelServiceOrder', { orderId: orderId })
        .then(function(result) {
          if (!result.ok) return Promise.reject(result.error);
          return result.data;
        });
    }

    return Promise.resolve({ orderId: orderId, status: ORDER_STATUS.CANCELLED });
  }

  return {
    ORDER_STATUS: ORDER_STATUS,
    createOrder: createOrder,
    getOrder: getOrder,
    getUserOrders: getUserOrders,
    cancelOrder: cancelOrder
  };
})();
