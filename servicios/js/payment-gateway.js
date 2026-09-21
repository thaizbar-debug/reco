/**
 * Reco Servicios — Payment Gateway (Culqi)
 * Wraps the Culqi Checkout SDK for service payments.
 *
 * Flow: checkout() → createServicePaymentOrder CF → CulqiCheckout modal
 *       → user pays → processServicePayment CF → onSuccess callback
 *
 * Principle 7: prepared for real integration (Culqi SDK + Cloud Functions).
 * Principle 15: separated from UI — all service UIs call this single gateway.
 *
 * Requires: RecoFirebase (firebase-init.js), CulqiCheckout SDK.
 * Cloud Functions: createServicePaymentOrder, processServicePayment.
 */
const ServicePaymentGateway = (() => {
  'use strict';

  var PUBLIC_KEY = 'pk_live_tXxwBBmY9ngPgZRH';
  var _instance = null;
  var _inProgress = false;

  function isAvailable() {
    return typeof CulqiCheckout !== 'undefined' &&
           typeof RecoFirebase !== 'undefined' &&
           RecoFirebase.isReady() &&
           RecoFirebase.auth &&
           RecoFirebase.auth.currentUser;
  }

  function isSdkLoaded() {
    return typeof CulqiCheckout !== 'undefined';
  }

  function checkout(config) {
    var serviceId = config.serviceId;
    var amount = config.amount;
    var description = config.description || 'Servicio Reco';
    var onSuccess = config.onSuccess;
    var onError = config.onError;

    if (!RecoFirebase || !RecoFirebase.auth || !RecoFirebase.auth.currentUser) {
      if (typeof RecoFirebase !== 'undefined') {
        RecoFirebase.openAuthModal('login');
      }
      return;
    }

    if (typeof CulqiCheckout === 'undefined') {
      if (onError) onError('Error cargando la pasarela de pagos. Recarga la página.');
      return;
    }

    if (_inProgress) return;
    _inProgress = true;

    var amountCents = Math.round(amount * 100);

    var fns = RecoFirebase.getFunctions();
    if (!fns) {
      _inProgress = false;
      if (onError) onError('Firebase Functions no disponible.');
      return;
    }

    var orderFn = fns.httpsCallable('createServicePaymentOrder');
    orderFn({ serviceId: serviceId, amount: amountCents, description: description })
      .then(function(orderResult) {
        var orderId = orderResult.data.orderId;
        var serviceOrderId = orderResult.data.serviceOrderId;
        var email = RecoFirebase.auth.currentUser.email || '';

        _instance = new CulqiCheckout(PUBLIC_KEY, {
          settings: {
            title: 'Reco Servicios',
            currency: 'PEN',
            amount: amountCents,
            order: orderId,
          },
          client: { email: email },
          options: {
            lang: 'es',
            modal: true,
            installments: false,
            paymentMethods: {
              tarjeta: true,
              yape: true,
              billetera: true,
              bancaMovil: true,
              agente: false,
              cuotealo: false,
            },
            style: {
              logo: null,
              bannerColor: '#0891b2',
              buttonBackground: '#0891b2',
              menuColor: '#0891b2',
              linksColor: '#0891b2',
              buttonText: '',
              buttonTextColor: '#ffffff',
              priceColor: '#0891b2',
            },
          },
        });

        _instance.culqi = function() {
          if (_instance.token) {
            _instance.close();
            _processCharge({
              tokenId: _instance.token.id,
              serviceOrderId: serviceOrderId,
              amount: amountCents,
              onSuccess: onSuccess,
              onError: onError,
            });
          } else if (_instance.order) {
            _instance.close();
            _processCharge({
              orderId: _instance.order.id,
              serviceOrderId: serviceOrderId,
              amount: amountCents,
              onSuccess: onSuccess,
              onError: onError,
            });
          } else if (_instance.error) {
            _inProgress = false;
            if (onError) onError(_instance.error.user_message || 'Error en el pago.');
          }
        };

        _inProgress = false;
        _instance.open();
      })
      .catch(function(e) {
        _inProgress = false;
        var msg = (e && e.message) || 'Error al preparar el pago.';
        if (onError) onError(msg);
      });
  }

  function _processCharge(params) {
    var fns = RecoFirebase.getFunctions();
    if (!fns) {
      if (params.onError) params.onError('Firebase Functions no disponible.');
      return;
    }

    var fn = fns.httpsCallable('processServicePayment');
    fn({
      tokenId: params.tokenId || null,
      orderId: params.orderId || null,
      serviceOrderId: params.serviceOrderId,
      amount: params.amount,
    })
      .then(function(result) {
        if (result.data && result.data.success) {
          if (params.onSuccess) params.onSuccess(result.data);
        } else {
          if (params.onError) params.onError('El pago no pudo ser procesado.');
        }
      })
      .catch(function(e) {
        var msg = (e && e.message) || 'Error procesando el pago.';
        if (params.onError) params.onError(msg);
      });
  }

  function getSupportedMethods() {
    return [
      { id: 'card', label: 'Tarjeta de crédito / débito', icon: '💳', description: 'Visa, Mastercard, Amex, Diners' },
      { id: 'yape', label: 'Yape', icon: '📱', description: 'Paga con tu billetera Yape' },
    ];
  }

  function init() {
    if (isSdkLoaded() && typeof PaymentProviderRegistry !== 'undefined') {
      PaymentProviderRegistry.setProvider({
        name: 'Culqi',
        _isMock: false,
        createCheckout: function() {
          return { checkoutId: 'culqi-pending', status: 'created', _isMock: false };
        },
        getSupportedMethods: getSupportedMethods,
      });
    }
  }

  return {
    checkout: checkout,
    isAvailable: isAvailable,
    isSdkLoaded: isSdkLoaded,
    getSupportedMethods: getSupportedMethods,
    init: init,
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { ServicePaymentGateway.init(); });
} else {
  ServicePaymentGateway.init();
}
