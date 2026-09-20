/* ============================================================
   ListingService — Wraps Firestore /publications/{id}
   A "listing" in Servicios context = a CORE publication.
   Reuses existing publication entity (no new model).
   ============================================================ */
const ListingService = (() => {
  'use strict';

  function _getDb() {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      return firebase.firestore();
    }
    return null;
  }

  var LISTING_STATUSES = Object.freeze({
    PENDING: 'pending',
    APPROVED: 'approved',
    ACTIVE: 'active',
    REJECTED: 'rejected',
    EXPIRED: 'expired'
  });

  function getListingById(listingId) {
    var db = _getDb();
    if (!db || !listingId) return Promise.resolve(null);

    return db.collection('publications').doc(listingId).get()
      .then(function(doc) {
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data());
      })
      .catch(function() { return null; });
  }

  function getUserListings(userId) {
    var db = _getDb();
    if (!db || !userId) return Promise.resolve([]);

    return db.collection('publications')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
      .then(function(snapshot) {
        var results = [];
        snapshot.forEach(function(doc) {
          results.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return results;
      })
      .catch(function() { return []; });
  }

  function getActiveListings(userId) {
    var db = _getDb();
    if (!db || !userId) return Promise.resolve([]);

    return db.collection('publications')
      .where('userId', '==', userId)
      .where('status', 'in', [LISTING_STATUSES.APPROVED, LISTING_STATUSES.ACTIVE])
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
      .then(function(snapshot) {
        var results = [];
        snapshot.forEach(function(doc) {
          results.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return results;
      })
      .catch(function() { return []; });
  }

  function getListingLabel(listing) {
    if (!listing) return '';
    if (listing.title) return listing.title;
    var parts = [];
    if (listing.address) parts.push(listing.address);
    if (listing.district) parts.push(listing.district);
    return parts.join(', ') || listing.id;
  }

  return {
    STATUSES: LISTING_STATUSES,
    getListingById: getListingById,
    getUserListings: getUserListings,
    getActiveListings: getActiveListings,
    getListingLabel: getListingLabel
  };
})();
