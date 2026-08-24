/* ============================================================
   PropertyContext — Manages property/listing context across
   navigation within Servicios.

   Handles Flow 2 (user arrives from a property page with
   propertyId pre-set) and Flow 3 (context preserved through
   login redirect).

   Uses sessionStorage so context survives page navigation
   but not tab closure.
   ============================================================ */
const PropertyContext = (() => {
  'use strict';

  var STORAGE_KEY = 'reco_svc_property_context';

  function _read() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function _write(ctx) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    } catch (e) {
      // Storage unavailable — degrade silently
    }
  }

  function setContext(propertyId, listingId, source) {
    _write({
      propertyId: propertyId || null,
      listingId: listingId || null,
      source: source || 'manual',
      timestamp: Date.now()
    });
  }

  function getContext() {
    var ctx = _read();
    if (!ctx) return null;
    // Expire after 30 minutes
    if (Date.now() - ctx.timestamp > 30 * 60 * 1000) {
      clear();
      return null;
    }
    return ctx;
  }

  function getPropertyId() {
    var ctx = getContext();
    return ctx ? ctx.propertyId : null;
  }

  function getListingId() {
    var ctx = getContext();
    return ctx ? ctx.listingId : null;
  }

  function hasContext() {
    return getContext() !== null;
  }

  function clear() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // Parse URL params on load (Flow 2: ?propertyId=xxx&listingId=yyy)
  function initFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var propertyId = params.get('propertyId');
      var listingId = params.get('listingId');
      if (propertyId || listingId) {
        setContext(propertyId, listingId, 'url');
      }
    } catch (e) {}
  }

  // Preserve context before auth redirect (Flow 3)
  function preserveForAuth() {
    var ctx = getContext();
    if (ctx) {
      try {
        localStorage.setItem(STORAGE_KEY + '_auth', JSON.stringify(ctx));
      } catch (e) {}
    }
  }

  // Restore context after auth (Flow 3)
  function restoreAfterAuth() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY + '_auth');
      if (!raw) return false;
      localStorage.removeItem(STORAGE_KEY + '_auth');
      var ctx = JSON.parse(raw);
      if (ctx && ctx.propertyId) {
        setContext(ctx.propertyId, ctx.listingId, 'auth_restore');
        return true;
      }
    } catch (e) {}
    return false;
  }

  return {
    setContext: setContext,
    getContext: getContext,
    getPropertyId: getPropertyId,
    getListingId: getListingId,
    hasContext: hasContext,
    clear: clear,
    initFromUrl: initFromUrl,
    preserveForAuth: preserveForAuth,
    restoreAfterAuth: restoreAfterAuth
  };
})();
