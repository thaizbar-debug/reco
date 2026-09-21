/**
 * Reco Servicios — Visual Service Layer
 * Handles photo, video, AI tour, and staging service logic.
 * Provider-agnostic AI abstraction — swap providers without UI changes.
 *
 * ⚠️ MOCK: Uses simulated providers and job processing.
 * Real implementation will connect to actual photo/video providers and AI APIs.
 */

const VISUAL_ORDER_STATUS = Object.freeze({
  REQUESTED: 'requested',
  SCHEDULED: 'scheduled',
  PROVIDER_ASSIGNED: 'provider_assigned',
  IN_PROGRESS: 'in_progress',
  EDITING: 'editing',
  QUALITY_REVIEW: 'quality_review',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

const VISUAL_ORDER_STATUS_LABELS = Object.freeze({
  [VISUAL_ORDER_STATUS.REQUESTED]: 'Solicitado',
  [VISUAL_ORDER_STATUS.SCHEDULED]: 'Agendado',
  [VISUAL_ORDER_STATUS.PROVIDER_ASSIGNED]: 'Proveedor asignado',
  [VISUAL_ORDER_STATUS.IN_PROGRESS]: 'En progreso',
  [VISUAL_ORDER_STATUS.EDITING]: 'En edición',
  [VISUAL_ORDER_STATUS.QUALITY_REVIEW]: 'Control de calidad',
  [VISUAL_ORDER_STATUS.DELIVERED]: 'Entregado',
  [VISUAL_ORDER_STATUS.CANCELLED]: 'Cancelado',
});

const VISUAL_SERVICE_TYPES = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
  AI_TOUR: 'ai_tour',
  STAGING: 'staging',
  PACK: 'pack',
});

const SERVICE_TYPE_MAP = Object.freeze({
  'foto-basica': VISUAL_SERVICE_TYPES.PHOTO,
  'foto-premium': VISUAL_SERVICE_TYPES.PHOTO,
  'foto-video': VISUAL_SERVICE_TYPES.VIDEO,
  'foto-tour-ia': VISUAL_SERVICE_TYPES.AI_TOUR,
  'foto-staging': VISUAL_SERVICE_TYPES.STAGING,
  'foto-pack': VISUAL_SERVICE_TYPES.PACK,
});

const VIDEO_FORMATS = [
  { value: 'horizontal', label: 'Horizontal (16:9)', desc: 'Ideal para web y portales inmobiliarios' },
  { value: 'vertical', label: 'Vertical (9:16)', desc: 'Ideal para Instagram Reels y TikTok' },
];

const VIDEO_ADDONS = [
  { value: 'drone', label: 'Tomas con drone', priceExtra: 'S/ 150 adicional', desc: 'Vista aérea del inmueble y alrededores' },
];

const STAGING_STYLES = [
  { value: 'modern', label: 'Moderno', desc: 'Líneas limpias, colores neutros' },
  { value: 'classic', label: 'Clásico', desc: 'Elegancia atemporal' },
  { value: 'minimalist', label: 'Minimalista', desc: 'Menos es más' },
  { value: 'scandinavian', label: 'Escandinavo', desc: 'Madera clara, texturas naturales' },
  { value: 'industrial', label: 'Industrial', desc: 'Ladrillo, metal, espacios abiertos' },
];

const STAGING_ROOMS = [
  { value: 'living', label: 'Sala' },
  { value: 'bedroom', label: 'Dormitorio' },
  { value: 'kitchen', label: 'Cocina' },
  { value: 'dining', label: 'Comedor' },
  { value: 'bathroom', label: 'Baño' },
  { value: 'office', label: 'Oficina / Estudio' },
];

const FOTOS_PRO = Object.freeze({
  label: 'Fotos Pro',
  eligibleServices: ['foto-basica', 'foto-premium', 'foto-pack'],
});

const IMAGE_TYPES = Object.freeze({
  ORIGINAL: 'original',
  STAGED: 'staged',
  TOUR_FRAME: 'tour_frame',
});

// --- AI Provider Abstraction ---
// ⚠️ MOCK: Swap MockAIProvider for a real adapter (Luma, Kling, REimagineHome)
// without changing any UI code — just call AIProviderRegistry.setProvider(realAdapter).

const AIProviderRegistry = (() => {
  let _active = null;

  const MockAIProvider = {
    name: 'MockAI',
    _isMock: true,
    _jobs: {},

    generateTour(config) {
      const jobId = 'tour-' + Date.now().toString(36);
      this._jobs[jobId] = {
        id: jobId, type: 'tour', status: 'processing', progress: 0,
        config, createdAt: new Date().toISOString(), result: null,
      };
      return { jobId, estimatedTime: '15-30 minutos', _isMock: true };
    },

    generateStaging(config) {
      const jobId = 'stg-' + Date.now().toString(36);
      this._jobs[jobId] = {
        id: jobId, type: 'staging', status: 'processing', progress: 0,
        config, createdAt: new Date().toISOString(), result: null,
      };
      return { jobId, estimatedTime: '5-10 minutos por imagen', _isMock: true };
    },

    getJobStatus(jobId) {
      return this._jobs[jobId] ? { ...this._jobs[jobId] } : null;
    },
  };

  return {
    setProvider(provider) { _active = provider; },
    getProvider() { return _active || MockAIProvider; },
    MockAIProvider,
  };
})();


const VisualService = (() => {
  let _orders = [];
  let _galleries = {};

  // --- Photo gallery management ---

  function createGallery(propertyRef) {
    if (!_galleries[propertyRef]) {
      _galleries[propertyRef] = {
        propertyRef, images: [], hasFotosPro: false,
        createdAt: new Date().toISOString(),
      };
    }
    return _galleries[propertyRef];
  }

  function addImage(propertyRef, imageData) {
    const gallery = createGallery(propertyRef);
    const image = {
      id: 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      type: imageData.type || IMAGE_TYPES.ORIGINAL,
      url: imageData.url || null,
      filename: imageData.filename || null,
      metadata: imageData.metadata || {},
      uploadedAt: new Date().toISOString(),
    };
    gallery.images.push(image);
    if (FOTOS_PRO.eligibleServices.includes(imageData.serviceId)) {
      gallery.hasFotosPro = true;
    }
    return image;
  }

  function getGallery(propertyRef) {
    return _galleries[propertyRef] || null;
  }

  function getImagesByType(propertyRef, type) {
    const gallery = _galleries[propertyRef];
    if (!gallery) return [];
    return gallery.images.filter(img => img.type === type);
  }

  // --- Order management ---

  function createOrder(serviceId, propertyData, contactData, serviceConfig) {
    const service = getServiceById(serviceId);
    if (!service) return { error: 'Servicio no encontrado' };

    const serviceType = SERVICE_TYPE_MAP[serviceId];
    const order = {
      id: 'VIS-' + Date.now().toString(36).toUpperCase(),
      serviceId, serviceType,
      serviceName: service.name,
      price: service.price,
      status: VISUAL_ORDER_STATUS.REQUESTED,
      propertyData, contactData,
      serviceConfig: serviceConfig || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [{ status: VISUAL_ORDER_STATUS.REQUESTED, at: new Date().toISOString() }],
      deliverables: [],
      aiJobId: null,
    };

    if (serviceType === VISUAL_SERVICE_TYPES.AI_TOUR) {
      const job = AIProviderRegistry.getProvider().generateTour(serviceConfig);
      order.aiJobId = job.jobId;
    }
    if (serviceType === VISUAL_SERVICE_TYPES.STAGING) {
      const job = AIProviderRegistry.getProvider().generateStaging(serviceConfig);
      order.aiJobId = job.jobId;
    }

    _orders.push(order);
    return order;
  }

  function updateOrderStatus(orderId, newStatus) {
    const order = _orders.find(o => o.id === orderId);
    if (!order) return { error: 'Orden no encontrada' };
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({ status: newStatus, at: order.updatedAt });
    return order;
  }

  function getOrder(orderId) {
    return _orders.find(o => o.id === orderId) || null;
  }

  function getOrders() { return [..._orders]; }

  function getServiceType(serviceId) {
    return SERVICE_TYPE_MAP[serviceId] || null;
  }

  function requiresVisit(serviceId) {
    const t = SERVICE_TYPE_MAP[serviceId];
    return t === VISUAL_SERVICE_TYPES.PHOTO || t === VISUAL_SERVICE_TYPES.VIDEO || t === VISUAL_SERVICE_TYPES.PACK;
  }

  return {
    createOrder, updateOrderStatus, getOrder, getOrders,
    getServiceType, requiresVisit,
    createGallery, addImage, getGallery, getImagesByType,
    VISUAL_ORDER_STATUS, VISUAL_ORDER_STATUS_LABELS,
    VISUAL_SERVICE_TYPES, SERVICE_TYPE_MAP,
    VIDEO_FORMATS, VIDEO_ADDONS,
    STAGING_STYLES, STAGING_ROOMS,
    FOTOS_PRO, IMAGE_TYPES,
  };
})();
