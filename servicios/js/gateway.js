/* ============================================================
   RecoGateway — Centralized API gateway module
   Addresses audit findings H4 (error handling), H5 (retry logic),
   H7 (auth placeholder).

   Architecture: IIFE on window.RecoGateway.
   Current state: mock mode (Principle 8 — clearly identified).
   Principle 15: clean separation between transport, retry, and auth layers.
   ============================================================ */
const RecoGateway = (() => {
  'use strict';

  // ── 1. Configuration ──────────────────────────────────────
  const _config = {
    baseUrl: '',            // set when integrating with real API
    timeout: 15000,         // ms
    maxRetries: 3,
    retryBaseDelay: 1000,   // ms — exponential backoff base
    isMock: true,           // clearly identified as mock mode (Principle 8)
  };

  let _authToken = null;

  // ── Error type constants ──────────────────────────────────
  const ErrorType = Object.freeze({
    NETWORK_ERROR:    'NETWORK_ERROR',
    TIMEOUT_ERROR:    'TIMEOUT_ERROR',
    AUTH_ERROR:       'AUTH_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SERVER_ERROR:     'SERVER_ERROR',
    UNKNOWN_ERROR:    'UNKNOWN_ERROR',
  });

  // ── Helper: structured result builders ────────────────────
  function _ok(data) {
    return { ok: true, data: data, error: null };
  }

  function _fail(type, message, status) {
    return {
      ok: false,
      data: null,
      error: { type: type, message: message, status: status || null },
    };
  }

  // ── Helper: classify HTTP status into error type ──────────
  function _classifyStatus(status) {
    if (status === 401 || status === 403) return ErrorType.AUTH_ERROR;
    if (status === 400 || status === 422)  return ErrorType.VALIDATION_ERROR;
    if (status >= 500)                     return ErrorType.SERVER_ERROR;
    return ErrorType.UNKNOWN_ERROR;
  }

  // ── Helper: mock-mode console logger ──────────────────────
  function _mockLog(method, endpoint, extra) {
    if (!_config.isMock) return;
    var parts = ['[RecoGateway:MOCK]', method.toUpperCase(), endpoint];
    if (extra !== undefined) parts.push(JSON.stringify(extra));
    console.log(parts.join(' '));
  }

  // ── Helper: generate idempotency key ──────────────────────
  function _generateIdempotencyKey() {
    // Prefer crypto.randomUUID where available; fall back to timestamp + random
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ── 2. Core fetch wrapper (H4) ────────────────────────────
  function request(endpoint, options) {
    options = options || {};
    var method  = (options.method || 'GET').toUpperCase();
    var body    = options.body || null;
    var headers = options.headers || {};
    var timeout = options.timeout || _config.timeout;

    _mockLog(method, endpoint);

    // Build URL
    var url = _config.baseUrl ? _config.baseUrl.replace(/\/+$/, '') + '/' + endpoint.replace(/^\/+/, '') : endpoint;

    // Default headers
    var mergedHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (_authToken) {
      mergedHeaders['Authorization'] = 'Bearer ' + _authToken;
    }
    // Merge caller-supplied headers (override defaults)
    var hkeys = Object.keys(headers);
    for (var i = 0; i < hkeys.length; i++) {
      mergedHeaders[hkeys[i]] = headers[hkeys[i]];
    }

    // Timeout via AbortController
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(function () { controller.abort(); }, timeout);
    }

    var fetchOptions = {
      method: method,
      headers: mergedHeaders,
    };
    if (controller) {
      fetchOptions.signal = controller.signal;
    }
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    return fetch(url, fetchOptions)
      .then(function (response) {
        if (timeoutId) clearTimeout(timeoutId);

        // Try to parse JSON; fall back to text
        return response.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (_e) { data = text; }

          if (response.ok) {
            return _ok(data);
          }

          var errType = _classifyStatus(response.status);
          var errMsg  = (data && typeof data === 'object' && data.message) ? data.message : response.statusText;
          return _fail(errType, errMsg, response.status);
        });
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);

        // AbortController timeout
        if (err && err.name === 'AbortError') {
          return _fail(ErrorType.TIMEOUT_ERROR, 'La solicitud excedio el tiempo limite (' + timeout + 'ms)');
        }
        // Network / offline
        return _fail(ErrorType.NETWORK_ERROR, err ? err.message : 'Error de red desconocido');
      });
  }

  // ── 3. Retry logic (H5) ───────────────────────────────────
  // Retries only NETWORK_ERROR and TIMEOUT_ERROR.
  // Exponential backoff: retryBaseDelay * 2^attempt (1 s, 2 s, 4 s ...)
  function requestWithRetry(endpoint, options) {
    options = options || {};
    var maxRetries = options.maxRetries !== undefined ? options.maxRetries : _config.maxRetries;
    var baseDelay  = options.retryBaseDelay !== undefined ? options.retryBaseDelay : _config.retryBaseDelay;

    // Inject idempotency key when not already present
    var headers = options.headers || {};
    if (!headers['X-Idempotency-Key']) {
      headers['X-Idempotency-Key'] = _generateIdempotencyKey();
    }
    var mergedOptions = {};
    var okeys = Object.keys(options);
    for (var k = 0; k < okeys.length; k++) {
      mergedOptions[okeys[k]] = options[okeys[k]];
    }
    mergedOptions.headers = headers;

    function attempt(n) {
      return request(endpoint, mergedOptions).then(function (result) {
        if (result.ok) return result;

        // Only retry transient errors
        var retryable = result.error &&
          (result.error.type === ErrorType.NETWORK_ERROR || result.error.type === ErrorType.TIMEOUT_ERROR);

        if (!retryable || n >= maxRetries) {
          return result;
        }

        var delay = baseDelay * Math.pow(2, n);
        if (_config.isMock) {
          console.log('[RecoGateway:MOCK] Reintento ' + (n + 1) + '/' + maxRetries + ' en ' + delay + 'ms');
        }

        return new Promise(function (resolve) {
          setTimeout(function () { resolve(attempt(n + 1)); }, delay);
        });
      });
    }

    return attempt(0);
  }

  // ── 4. Convenience methods ────────────────────────────────
  function get(endpoint) {
    return requestWithRetry(endpoint, { method: 'GET' });
  }

  function post(endpoint, data) {
    return requestWithRetry(endpoint, { method: 'POST', body: data });
  }

  function put(endpoint, data) {
    return requestWithRetry(endpoint, { method: 'PUT', body: data });
  }

  function del(endpoint) {
    return requestWithRetry(endpoint, { method: 'DELETE' });
  }

  // ── 5. Auth placeholder (H7) ──────────────────────────────
  function setAuthToken(token) {
    _authToken = token;
    if (_config.isMock) {
      console.log('[RecoGateway:MOCK] Token de autenticacion configurado');
    }
  }

  function clearAuth() {
    _authToken = null;
    if (_config.isMock) {
      console.log('[RecoGateway:MOCK] Token de autenticacion eliminado');
    }
  }

  function isAuthenticated() {
    return _authToken !== null && _authToken !== '';
  }

  // ── 6. Mock-mode helpers ──────────────────────────────────
  function configure(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) {
      if (_config.hasOwnProperty(keys[i])) {
        _config[keys[i]] = overrides[keys[i]];
      }
    }
    if (_config.isMock) {
      console.log('[RecoGateway:MOCK] Configuracion actualizada', JSON.stringify(_config));
    }
  }

  // ── 7. Error display helper ───────────────────────────────
  // Maps error types to user-friendly messages in Spanish.
  var _errorMessages = {};
  _errorMessages[ErrorType.NETWORK_ERROR]    = 'Sin conexion a internet. Verifica tu conexion e intenta nuevamente.';
  _errorMessages[ErrorType.TIMEOUT_ERROR]    = 'El servidor no responde. Intenta nuevamente en unos momentos.';
  _errorMessages[ErrorType.AUTH_ERROR]       = 'No tienes autorizacion para realizar esta accion. Inicia sesion nuevamente.';
  _errorMessages[ErrorType.VALIDATION_ERROR] = 'Los datos enviados no son validos. Revisa el formulario e intenta nuevamente.';
  _errorMessages[ErrorType.SERVER_ERROR]     = 'Error en el servidor. Nuestro equipo ha sido notificado. Intenta mas tarde.';
  _errorMessages[ErrorType.UNKNOWN_ERROR]    = 'Ocurrio un error inesperado. Intenta nuevamente.';

  function showError(error, container) {
    if (!container) return;
    var type = (error && error.type) ? error.type : ErrorType.UNKNOWN_ERROR;
    var userMessage = _errorMessages[type] || _errorMessages[ErrorType.UNKNOWN_ERROR];

    var el = document.createElement('div');
    el.style.cssText = 'padding:14px 18px;background:#FAEAEA;border:1px solid rgba(155,32,32,.18);border-radius:10px;color:#9B2020;font-size:13px;line-height:1.5;margin-bottom:12px;';
    el.setAttribute('role', 'alert');
    el.textContent = userMessage;

    // Clear previous error messages from this container
    var prev = container.querySelectorAll('[role="alert"]');
    for (var i = 0; i < prev.length; i++) {
      prev[i].parentNode.removeChild(prev[i]);
    }
    container.insertBefore(el, container.firstChild);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    // Core
    request:          request,
    requestWithRetry: requestWithRetry,

    // Convenience
    get:  get,
    post: post,
    put:  put,
    del:  del,

    // Auth
    setAuthToken:    setAuthToken,
    clearAuth:       clearAuth,
    isAuthenticated: isAuthenticated,

    // Configuration
    configure: configure,

    // Error display
    showError: showError,

    // Constants
    ErrorType: ErrorType,
  };
})();

window.RecoGateway = RecoGateway;
