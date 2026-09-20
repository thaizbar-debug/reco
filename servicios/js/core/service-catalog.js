/* ============================================================
   ServiceCatalog — Formalized service catalog access layer.
   Wraps data.js queries with a clean interface for the
   integration contract. Maps jobs → services.
   Reuses existing SERVICE_CATALOG and JOB_DEFINITIONS.
   ============================================================ */
const ServiceCatalog = (() => {
  'use strict';

  function getServiceById(serviceId) {
    if (!serviceId) return null;
    if (typeof SERVICE_CATALOG === 'undefined') return null;

    // Resolve ID through the catalog/registry mapping
    var resolvedId = serviceId;
    if (typeof _REVERSE_ID_MAP !== 'undefined' && _REVERSE_ID_MAP[serviceId]) {
      resolvedId = _REVERSE_ID_MAP[serviceId];
    }

    var cats = Object.keys(SERVICE_CATALOG);
    for (var i = 0; i < cats.length; i++) {
      var services = SERVICE_CATALOG[cats[i]];
      for (var j = 0; j < services.length; j++) {
        if (services[j].id === resolvedId || services[j].id === serviceId) return services[j];
      }
    }
    return null;
  }

  function getServicesByCategory(categoryId) {
    if (typeof SERVICE_CATALOG === 'undefined') return [];
    return SERVICE_CATALOG[categoryId] || [];
  }

  function getActiveServices(categoryId) {
    var services = getServicesByCategory(categoryId);
    return services.filter(function(s) {
      return s.status === 'active';
    });
  }

  function getServicesByJob(jobId) {
    if (!jobId || typeof JOB_DEFINITIONS === 'undefined') return [];
    for (var i = 0; i < JOB_DEFINITIONS.length; i++) {
      if (JOB_DEFINITIONS[i].id === jobId) {
        var serviceIds = JOB_DEFINITIONS[i].services || [];
        var results = [];
        for (var j = 0; j < serviceIds.length; j++) {
          var svc = getServiceById(serviceIds[j]);
          if (svc) results.push(svc);
        }
        return results;
      }
    }
    return [];
  }

  function getAllJobs() {
    if (typeof JOB_DEFINITIONS === 'undefined') return [];
    return JOB_DEFINITIONS;
  }

  function getJobById(jobId) {
    if (!jobId || typeof JOB_DEFINITIONS === 'undefined') return null;
    for (var i = 0; i < JOB_DEFINITIONS.length; i++) {
      if (JOB_DEFINITIONS[i].id === jobId) return JOB_DEFINITIONS[i];
    }
    return null;
  }

  function isServiceAvailable(serviceId) {
    var svc = getServiceById(serviceId);
    return svc !== null && svc.status === 'active';
  }

  function getServicePrice(serviceId) {
    var svc = getServiceById(serviceId);
    if (!svc) return null;
    return {
      model: svc.monetization || null,
      price: svc.price || null,
      currency: svc.currency || 'PEN',
      description: svc.priceDescription || null
    };
  }

  return {
    getServiceById: getServiceById,
    getServicesByCategory: getServicesByCategory,
    getActiveServices: getActiveServices,
    getServicesByJob: getServicesByJob,
    getAllJobs: getAllJobs,
    getJobById: getJobById,
    isServiceAvailable: isServiceAvailable,
    getServicePrice: getServicePrice
  };
})();
