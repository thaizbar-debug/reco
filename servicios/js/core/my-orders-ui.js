/* ============================================================
   MyOrdersUI — "Mis Servicios" panel for authenticated users.
   Shows service orders from ServiceOrderService.
   Accessible from user dropdown menu.
   ============================================================ */
const MyOrdersUI = (() => {
  'use strict';

  var _orders = null;
  var _loading = false;
  var _error = null;

  var STATUS_LABELS = {
    draft: 'Borrador',
    requested: 'Solicitado',
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    in_progress: 'En progreso',
    completed: 'Completado',
    cancelled: 'Cancelado'
  };

  var STATUS_COLORS = {
    draft: '#6B7280',
    requested: '#2563EB',
    pending: '#D97706',
    confirmed: '#059669',
    in_progress: '#7C3AED',
    completed: '#10B981',
    cancelled: '#EF4444'
  };

  function show() {
    _loading = true;
    _error = null;
    _orders = null;
    _renderPanel();

    if (typeof UserService === 'undefined' || !UserService.isAuthenticated()) {
      var localOnly = _mergeLocalRequests([]);
      if (localOnly.length > 0) {
        _orders = localOnly;
        _loading = false;
        _renderPanel();
      } else {
        _loading = false;
        _error = 'auth_required';
        _renderPanel();
      }
      return;
    }

    ServiceOrderService.getUserOrders()
      .then(function(orders) {
        _orders = _mergeLocalRequests(orders || []);
        _loading = false;
        _renderPanel();
      })
      .catch(function() {
        var localOnly = _mergeLocalRequests([]);
        if (localOnly.length > 0) {
          _orders = localOnly;
          _loading = false;
          _renderPanel();
        } else {
          _loading = false;
          _error = 'load_failed';
          _renderPanel();
        }
      });
  }

  function hide() {
    var overlay = document.getElementById('myOrdersOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function _renderPanel() {
    var overlay = document.getElementById('myOrdersOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'myOrdersOverlay';
      overlay.className = 'my-orders-overlay';
      document.body.appendChild(overlay);
    }
    overlay.classList.add('open');

    var content = '';
    if (_loading) {
      content = _loadingState();
    } else if (_error === 'auth_required') {
      content = _authRequiredState();
    } else if (_error) {
      content = _errorState();
    } else if (!_orders || _orders.length === 0) {
      content = _emptyState();
    } else {
      content = _ordersList();
    }

    overlay.innerHTML =
      '<div class="my-orders-panel">' +
        '<div class="my-orders-header">' +
          '<h2>Mis Servicios</h2>' +
          '<button class="my-orders-close" onclick="MyOrdersUI.hide()">&times;</button>' +
        '</div>' +
        '<div class="my-orders-body">' + content + '</div>' +
      '</div>';
  }

  function _loadingState() {
    return '<div class="my-orders-state">' +
      '<div style="font-size:32px">&#9203;</div>' +
      '<p>Cargando tus servicios...</p>' +
    '</div>';
  }

  function _authRequiredState() {
    return '<div class="my-orders-state">' +
      '<div style="font-size:32px">&#128274;</div>' +
      '<p>Inicia sesion para ver tus servicios</p>' +
      '<button class="my-orders-btn" onclick="MyOrdersUI.hide();RecoFirebase.openAuthModal(\'login\')">Ingresar</button>' +
    '</div>';
  }

  function _errorState() {
    return '<div class="my-orders-state">' +
      '<div style="font-size:32px">&#9888;&#65039;</div>' +
      '<p>No se pudieron cargar tus servicios</p>' +
      '<button class="my-orders-btn" onclick="MyOrdersUI.show()">Reintentar</button>' +
    '</div>';
  }

  function _emptyState() {
    return '<div class="my-orders-state">' +
      '<div style="font-size:32px">&#128230;</div>' +
      '<p>Aun no tienes servicios contratados</p>' +
      '<p style="font-size:13px;color:var(--ink-3,#888)">Explora nuestro catalogo de servicios para comenzar.</p>' +
      '<button class="my-orders-btn" onclick="MyOrdersUI.hide()">Explorar servicios</button>' +
    '</div>';
  }

  function _ordersList() {
    var items = '';
    for (var i = 0; i < _orders.length; i++) {
      items += _orderCard(_orders[i]);
    }
    return '<div class="my-orders-list">' + items + '</div>';
  }

  function _mergeLocalRequests(firestoreOrders) {
    var local = [];
    try {
      var raw = localStorage.getItem('reco_service_requests');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          local = parsed.map(function(r) {
            return {
              serviceId: r.serviceId || 'unknown',
              status: 'requested',
              createdAt: r.createdAt || r.timestamp || '',
              _source: 'local',
              _localRef: r.referenceNumber || ''
            };
          });
        }
      }
    } catch (e) { /* ignore */ }

    var existing = {};
    firestoreOrders.forEach(function(o) { existing[o.serviceId + '_' + (o.createdAt || '')] = true; });
    var merged = firestoreOrders.slice();
    local.forEach(function(l) {
      var key = l.serviceId + '_' + l.createdAt;
      if (!existing[key]) merged.push(l);
    });
    merged.sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return merged;
  }

  function _orderCard(order) {
    var statusLabel = STATUS_LABELS[order.status] || order.status;
    var statusColor = STATUS_COLORS[order.status] || '#6B7280';
    var service = typeof ServiceCatalog !== 'undefined' ? ServiceCatalog.getServiceById(order.serviceId) : null;
    var serviceName = service ? service.name : order.serviceId;
    var serviceIcon = service ? service.icon : '&#128295;';
    var date = order.createdAt ? _formatDate(order.createdAt) : '';

    return '<div class="my-order-card">' +
      '<div class="my-order-icon">' + serviceIcon + '</div>' +
      '<div class="my-order-info">' +
        '<div class="my-order-name">' + _escapeHTML(serviceName) + '</div>' +
        '<div class="my-order-date">' + _escapeHTML(date) + '</div>' +
        (order.propertyId ? '<div class="my-order-prop">Propiedad: ' + _escapeHTML(order.propertyId) + '</div>' : '') +
      '</div>' +
      '<div class="my-order-status" style="color:' + statusColor + '">' + _escapeHTML(statusLabel) + '</div>' +
    '</div>';
  }

  function _formatDate(dateStr) {
    try {
      var d = new Date(dateStr);
      return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  function _escapeHTML(str) {
    if (typeof escapeHTML === 'function') return escapeHTML(str);
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    show: show,
    hide: hide
  };
})();
