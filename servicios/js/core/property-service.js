/* ============================================================
   CorePropertyService — Unified access to properties from:
   1. Static JSON dataset (data/properties.json loaded at runtime)
   2. User publications (Firestore /publications/{id})

   Reuses CORE entities. NO new property model.
   ============================================================ */
const CorePropertyService = (() => {
  'use strict';

  // Static properties are loaded by the main app into window scope
  function _getStaticProperties() {
    if (typeof window !== 'undefined' && window.propertiesData) {
      return window.propertiesData;
    }
    return [];
  }

  function _getDb() {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      return firebase.firestore();
    }
    return null;
  }

  function getPropertyById(propertyId) {
    if (!propertyId) return Promise.resolve(null);

    // First check static dataset
    var props = _getStaticProperties();
    for (var i = 0; i < props.length; i++) {
      if (props[i].id === propertyId) {
        return Promise.resolve(_normalizeStatic(props[i]));
      }
    }

    // Not in static — check publications
    return getPublicationById(propertyId);
  }

  function getPublicationById(publicationId) {
    var db = _getDb();
    if (!db || !publicationId) return Promise.resolve(null);

    return db.collection('publications').doc(publicationId).get()
      .then(function(doc) {
        if (!doc.exists) return null;
        return _normalizePublication(doc.id, doc.data());
      })
      .catch(function() { return null; });
  }

  function getUserProperties(userId) {
    if (!userId) return Promise.resolve([]);
    var db = _getDb();
    if (!db) return Promise.resolve([]);

    return db.collection('publications')
      .where('userId', '==', userId)
      .where('status', 'in', ['pending', 'approved', 'active'])
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
      .then(function(snapshot) {
        var results = [];
        snapshot.forEach(function(doc) {
          results.push(_normalizePublication(doc.id, doc.data()));
        });
        return results;
      })
      .catch(function() { return []; });
  }

  function _normalizeStatic(prop) {
    return {
      id: prop.id,
      source: 'static',
      address: prop.address || '',
      district: prop.district || '',
      province: prop.province || '',
      department: prop.department || '',
      type: prop.type || '',
      op: prop.op || '',
      price: prop.price || 0,
      currency: prop.cur || 'USD',
      area: prop.area || 0,
      beds: prop.beds || 0,
      baths: prop.baths || 0,
      parking: prop.park || 0,
      lat: prop.lat || null,
      lng: prop.lng || null
    };
  }

  function _normalizePublication(id, data) {
    return {
      id: id,
      source: 'publication',
      userId: data.userId || null,
      address: data.address || '',
      district: data.district || '',
      province: '',
      department: '',
      type: data.type || '',
      op: data.op || '',
      price: data.price || 0,
      currency: data.currency || 'USD',
      area: data.area || 0,
      beds: data.beds || 0,
      baths: data.baths || 0,
      parking: data.parking || 0,
      lat: data.lat || null,
      lng: data.lng || null,
      status: data.status || 'pending',
      title: data.title || '',
      photoUrls: data.photoUrls || []
    };
  }

  function getPropertyLabel(property) {
    if (!property) return '';
    var parts = [];
    if (property.address) parts.push(property.address);
    if (property.district) parts.push(property.district);
    return parts.join(', ') || property.id;
  }

  return {
    getPropertyById: getPropertyById,
    getPublicationById: getPublicationById,
    getUserProperties: getUserProperties,
    getPropertyLabel: getPropertyLabel
  };
})();
