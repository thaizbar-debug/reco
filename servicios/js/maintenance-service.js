/**
 * Reco Servicios — Maintenance Marketplace Service Layer
 * Transactional marketplace for home maintenance services.
 *
 * MVP: 6 service categories (Limpieza, Gasfitería, Electricista, Pintura, Mudanza, Remodelación).
 * Provider model with mock providers — no real providers invented.
 *
 * ⚠️ MOCK: All providers and orders are simulated.
 */

const MKT_ORDER_STATUS = Object.freeze({
  REQUESTED: 'requested',
  QUOTED: 'quoted',
  ACCEPTED: 'accepted',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const MKT_ORDER_STATUS_LABELS = Object.freeze({
  [MKT_ORDER_STATUS.REQUESTED]: 'Solicitado',
  [MKT_ORDER_STATUS.QUOTED]: 'Cotizado',
  [MKT_ORDER_STATUS.ACCEPTED]: 'Aceptado',
  [MKT_ORDER_STATUS.SCHEDULED]: 'Programado',
  [MKT_ORDER_STATUS.IN_PROGRESS]: 'En progreso',
  [MKT_ORDER_STATUS.COMPLETED]: 'Completado',
  [MKT_ORDER_STATUS.CANCELLED]: 'Cancelado',
});

const MKT_CONFIG = Object.freeze({
  commissionRate: 0.15,
  currency: 'PEN',
  currencySymbol: 'S/',
  cancellationWindowHours: 24,
  refundPolicy: 'full_before_scheduled',
});

const MaintenanceService = (() => {
  const _serviceCategories = [
    {
      id: 'svc-limpieza',
      name: 'Limpieza profunda',
      icon: '🧹',
      description: 'Limpieza integral de departamentos y casas. Incluye cocina, baños, pisos y ventanas.',
      priceFrom: 99,
      priceUnit: null,
      availability: 'Lunes a sábado · 8am–6pm',
      estimatedDuration: '3–5 horas',
      includes: ['Limpieza de pisos y superficies', 'Cocina y electrodomésticos', 'Baños completos', 'Ventanas interiores', 'Productos incluidos'],
    },
    {
      id: 'svc-gasfiteria',
      name: 'Gasfitería',
      icon: '🔧',
      description: 'Reparación de tuberías, desatoros, instalación de sanitarios y grifería.',
      priceFrom: 70,
      priceUnit: null,
      availability: 'Lunes a domingo · 24/7 emergencias',
      estimatedDuration: '1–3 horas',
      includes: ['Diagnóstico del problema', 'Reparación de fugas', 'Desatoros', 'Instalación de accesorios', 'Garantía 30 días'],
    },
    {
      id: 'svc-electricista',
      name: 'Electricista certificado',
      icon: '⚡',
      description: 'Instalaciones eléctricas, reparaciones, tableros y cableado. Técnicos certificados.',
      priceFrom: 60,
      priceUnit: null,
      availability: 'Lunes a domingo · 24/7 emergencias',
      estimatedDuration: '1–4 horas',
      includes: ['Diagnóstico eléctrico', 'Reparación de circuitos', 'Instalación de tomacorrientes', 'Revisión de tablero', 'Certificado de seguridad'],
    },
    {
      id: 'svc-pintura',
      name: 'Pintura interior',
      icon: '🎨',
      description: 'Pintura de interiores, empaste, acabados. Cotización por m² o por ambiente.',
      priceFrom: 12,
      priceUnit: '/m²',
      availability: 'Lunes a sábado · 8am–6pm',
      estimatedDuration: '1–3 días',
      includes: ['Preparación de superficies', 'Empaste fino', 'Pintura 2 manos', 'Limpieza post-trabajo', 'Pintura de marca incluida'],
    },
    {
      id: 'svc-mudanza',
      name: 'Mudanzas y embalaje',
      icon: '📦',
      description: 'Servicio integral de mudanza: embalaje, transporte, armado y desarmado de muebles.',
      priceFrom: null,
      priceUnit: null,
      availability: 'Lunes a domingo · 7am–8pm',
      estimatedDuration: '4–8 horas',
      includes: ['Embalaje profesional', 'Transporte con seguro', 'Carga y descarga', 'Armado/desarmado de muebles', 'Materiales de embalaje'],
    },
    {
      id: 'svc-remodelacion',
      name: 'Remodelación integral',
      icon: '🏗️',
      description: 'Remodelación de cocinas, baños y espacios completos. Diseño, materiales y ejecución.',
      priceFrom: null,
      priceUnit: null,
      availability: 'Lunes a sábado · Previa cita',
      estimatedDuration: '2–8 semanas',
      includes: ['Visita técnica gratuita', 'Diseño y planos', 'Materiales de primera', 'Mano de obra calificada', 'Garantía 6 meses'],
    },
  ];

  const _mockProviders = [
    {
      id: 'prov-001',
      name: 'LimpiaHogar Express',
      serviceIds: ['svc-limpieza'],
      rating: 4.8,
      reviewCount: 124,
      zones: ['Miraflores', 'San Isidro', 'Surco', 'San Borja', 'Barranco'],
      responseTime: '< 2 horas',
      completedJobs: 312,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-002',
      name: 'Gasfitería Rápida SAC',
      serviceIds: ['svc-gasfiteria'],
      rating: 4.6,
      reviewCount: 89,
      zones: ['Miraflores', 'San Isidro', 'Surco', 'Magdalena', 'Jesús María', 'Lince'],
      responseTime: '< 1 hora',
      completedJobs: 456,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-003',
      name: 'ElectroServ Perú',
      serviceIds: ['svc-electricista'],
      rating: 4.7,
      reviewCount: 67,
      zones: ['Lima Metropolitana'],
      responseTime: '< 3 horas',
      completedJobs: 203,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-004',
      name: 'Pintores Lima SAC',
      serviceIds: ['svc-pintura'],
      rating: 4.5,
      reviewCount: 56,
      zones: ['Lima Metropolitana'],
      responseTime: '< 24 horas',
      completedJobs: 178,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-005',
      name: 'MudaPro Express',
      serviceIds: ['svc-mudanza'],
      rating: 4.4,
      reviewCount: 93,
      zones: ['Lima Metropolitana y Callao'],
      responseTime: '< 4 horas',
      completedJobs: 287,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-006',
      name: 'Renueva Hogar SAC',
      serviceIds: ['svc-remodelacion'],
      rating: 4.9,
      reviewCount: 34,
      zones: ['Miraflores', 'San Isidro', 'Surco', 'La Molina', 'San Borja'],
      responseTime: '< 48 horas',
      completedJobs: 52,
      verified: true,
      _isMock: true,
    },
    {
      id: 'prov-007',
      name: 'Servicios Integrales Lima',
      serviceIds: ['svc-limpieza', 'svc-gasfiteria', 'svc-electricista'],
      rating: 4.3,
      reviewCount: 145,
      zones: ['Lima Metropolitana'],
      responseTime: '< 6 horas',
      completedJobs: 521,
      verified: true,
      _isMock: true,
    },
  ];

  let _orders = [
    {
      id: 'ORD-MOCK-001',
      serviceId: 'svc-gasfiteria',
      providerId: 'prov-002',
      propertyId: 'prop-mock-5',
      status: MKT_ORDER_STATUS.IN_PROGRESS,
      description: 'Fuga en baño principal — reparación de tubería',
      address: 'Av. La Marina 2200, Dpto 803, San Miguel',
      scheduledDate: '2026-08-18',
      scheduledTime: '10:00',
      quotedPrice: 180,
      commission: 27,
      rating: null,
      review: null,
      createdAt: '2026-08-12T09:00:00Z',
      updatedAt: '2026-08-18T10:30:00Z',
      _isMock: true,
    },
    {
      id: 'ORD-MOCK-002',
      serviceId: 'svc-pintura',
      providerId: 'prov-004',
      propertyId: 'prop-mock-1',
      status: MKT_ORDER_STATUS.COMPLETED,
      description: 'Pintura hall de entrada — 15m²',
      address: 'Av. Pardo 456, Dpto 1201, Miraflores',
      scheduledDate: '2026-07-28',
      scheduledTime: '09:00',
      quotedPrice: 280,
      commission: 42,
      rating: 5,
      review: 'Excelente trabajo, muy limpio y puntual.',
      createdAt: '2026-07-20T10:00:00Z',
      updatedAt: '2026-08-01T16:00:00Z',
      _isMock: true,
    },
  ];

  function getServiceCategories() {
    return _serviceCategories.map(s => ({ ...s }));
  }

  function getServiceById(id) {
    const s = _serviceCategories.find(s => s.id === id);
    return s ? { ...s } : null;
  }

  function getProvidersByService(serviceId) {
    return _mockProviders
      .filter(p => p.serviceIds.includes(serviceId))
      .map(p => ({ ...p }));
  }

  function getProviderById(id) {
    const p = _mockProviders.find(p => p.id === id);
    return p ? { ...p } : null;
  }

  function createOrder(serviceId, providerId, propertyId, details) {
    const provider = getProviderById(providerId);
    const price = details.quotedPrice || 0;
    const commission = Math.round(price * MKT_CONFIG.commissionRate * 100) / 100;

    const order = {
      id: 'ORD-' + Date.now().toString(36).toUpperCase(),
      serviceId,
      providerId,
      propertyId: propertyId || null,
      status: MKT_ORDER_STATUS.REQUESTED,
      description: details.description || '',
      address: details.address || '',
      scheduledDate: details.date || null,
      scheduledTime: details.time || null,
      quotedPrice: price,
      commission,
      rating: null,
      review: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _isMock: true,
    };

    _orders.unshift(order);
    return { ...order };
  }

  function simulateQuote(serviceId, details) {
    const svc = getServiceById(serviceId);
    if (!svc) return null;

    let basePrice = svc.priceFrom || 500;
    if (svc.priceUnit === '/m²' && details.area) {
      basePrice = svc.priceFrom * details.area;
    }
    const variation = 0.8 + Math.random() * 0.4;
    const price = Math.round(basePrice * variation);
    const commission = Math.round(price * MKT_CONFIG.commissionRate);

    return {
      price,
      commission,
      total: price,
      estimatedDuration: svc.estimatedDuration,
      _isMock: true,
      _note: 'Cotización simulada. En producción, el proveedor enviará una cotización real.',
    };
  }

  function getOrders() {
    return _orders.map(o => ({ ...o }));
  }

  function getOrderById(id) {
    const o = _orders.find(o => o.id === id);
    return o ? { ...o } : null;
  }

  function getOrdersByProperty(propertyId) {
    return _orders.filter(o => o.propertyId === propertyId).map(o => ({ ...o }));
  }

  function updateOrderStatus(orderId, newStatus) {
    const order = _orders.find(o => o.id === orderId);
    if (!order) return null;
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    return { ...order };
  }

  function rateOrder(orderId, rating, review) {
    const order = _orders.find(o => o.id === orderId);
    if (!order || order.status !== MKT_ORDER_STATUS.COMPLETED) return null;
    order.rating = rating;
    order.review = review || '';
    order.updatedAt = new Date().toISOString();
    return { ...order };
  }

  function cancelOrder(orderId, reason) {
    const order = _orders.find(o => o.id === orderId);
    if (!order) return null;
    const canCancel = [MKT_ORDER_STATUS.REQUESTED, MKT_ORDER_STATUS.QUOTED, MKT_ORDER_STATUS.ACCEPTED, MKT_ORDER_STATUS.SCHEDULED].includes(order.status);
    if (!canCancel) return null;

    const hoursUntilScheduled = order.scheduledDate
      ? (new Date(order.scheduledDate) - new Date()) / (1000 * 60 * 60)
      : Infinity;

    let refundType = 'full';
    if (order.status === MKT_ORDER_STATUS.SCHEDULED && hoursUntilScheduled < MKT_CONFIG.cancellationWindowHours) {
      refundType = 'partial';
    }

    order.status = MKT_ORDER_STATUS.CANCELLED;
    order.updatedAt = new Date().toISOString();

    return {
      order: { ...order },
      refund: { type: refundType, _isMock: true, _note: 'En producción, se procesará el reembolso según la política.' },
    };
  }

  return {
    getServiceCategories,
    getServiceById,
    getProvidersByService,
    getProviderById,
    createOrder,
    simulateQuote,
    getOrders,
    getOrderById,
    getOrdersByProperty,
    updateOrderStatus,
    rateOrder,
    cancelOrder,
    MKT_CONFIG,
  };
})();
