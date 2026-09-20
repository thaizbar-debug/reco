/**
 * Reco Servicios — Legal Service Layer
 * Property Check, legal service orders, law firm provider abstraction.
 *
 * ⚠️ MOCK: Uses simulated SUNARP data and mock law firms.
 * Real implementation will connect to SUNARP API and verified law firms.
 */

const LEGAL_ORDER_STATUS = Object.freeze({
  REQUESTED: 'requested',
  ASSIGNED: 'assigned',
  IN_REVIEW: 'in_review',
  REQUIRES_INFORMATION: 'requires_information',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const LEGAL_ORDER_STATUS_LABELS = Object.freeze({
  [LEGAL_ORDER_STATUS.REQUESTED]: 'Solicitado',
  [LEGAL_ORDER_STATUS.ASSIGNED]: 'Asignado a abogado',
  [LEGAL_ORDER_STATUS.IN_REVIEW]: 'En revisión',
  [LEGAL_ORDER_STATUS.REQUIRES_INFORMATION]: 'Requiere información',
  [LEGAL_ORDER_STATUS.COMPLETED]: 'Completado',
  [LEGAL_ORDER_STATUS.CANCELLED]: 'Cancelado',
});

const PROPERTY_CHECK_SCORE = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
});

const PROPERTY_CHECK_SCORE_CONFIG = Object.freeze({
  [PROPERTY_CHECK_SCORE.GREEN]: { label: 'Sin alertas detectadas', icon: '🟢', color: 'var(--green)', bg: 'var(--green-bg)' },
  [PROPERTY_CHECK_SCORE.YELLOW]: { label: 'Requiere revisión', icon: '🟡', color: 'var(--amber)', bg: 'var(--amber-bg)' },
  [PROPERTY_CHECK_SCORE.RED]: { label: 'Riesgo / inconsistencia', icon: '🔴', color: 'var(--red)', bg: 'var(--red-bg)' },
});

const LEGAL_SERVICE_DETAILS = Object.freeze({
  'legal-contrato-alquiler': {
    highlights: ['Cláusulas de garantía y penalidades', 'Inventario detallado del inmueble', 'Condiciones de renovación', 'Legalización ante notario incluida'],
    timeline: '3–5 días hábiles',
    requiredDocs: ['DNI de ambas partes', 'Datos del inmueble (dirección, partida)', 'Términos acordados (monto, duración)'],
  },
  'legal-revision-contrato': {
    highlights: ['Identificación de cláusulas abusivas', 'Análisis de riesgos legales', 'Propuestas de modificación', 'Informe escrito en 48h'],
    timeline: '48 horas',
    requiredDocs: ['Contrato a revisar (PDF o escaneado)', 'DNI del solicitante'],
  },
  'legal-minuta': {
    highlights: ['Redacción conforme a ley peruana', 'Revisión de condiciones de pago', 'Cláusula de saneamiento legal', 'Lista para inscripción en SUNARP'],
    timeline: '5–7 días hábiles',
    requiredDocs: ['DNI de ambas partes', 'Copia literal de SUNARP', 'Acuerdo de precio y condiciones', 'HR y PU de la municipalidad'],
  },
  'legal-asesoria': {
    highlights: ['Sesión de 45 minutos con especialista', 'Orientación en compra, venta o alquiler', 'Cobertura de herencias y conflictos', 'Informe de recomendaciones'],
    timeline: 'Agenda según disponibilidad',
    requiredDocs: ['DNI del solicitante', 'Documentación relevante al caso'],
  },
  'legal-estudio-titulos': {
    highlights: ['Verificación de cadena de titularidad', 'Búsqueda en SUNARP de cargas y gravámenes', 'Detección de hipotecas y embargos', 'Informe ejecutivo firmado'],
    timeline: '3–5 días hábiles',
    requiredDocs: ['Dirección del inmueble', 'Número de partida registral (si disponible)', 'DNI del solicitante'],
  },
  'legal-due-diligence': {
    highlights: ['Auditoría completa de títulos y SUNARP', 'Verificación municipal y tributaria', 'Conformidad de obra y habilitación urbana', 'Declaratoria de fábrica', 'Informe ejecutivo en 5 días hábiles'],
    timeline: '5–10 días hábiles',
    requiredDocs: ['Dirección del inmueble', 'Partida registral', 'DNI del solicitante', 'HR y PU (si disponible)', 'Licencia de construcción (si aplica)'],
  },
});

// --- Property Data Provider Abstraction ---
// ⚠️ MOCK: Swap MockPropertyDataProvider for a real SUNARP adapter
// without changing UI code — just call PropertyDataRegistry.setProvider(realAdapter).

const PropertyDataRegistry = (() => {
  let _active = null;

  function _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  const MockPropertyDataProvider = {
    name: 'MockSUNARP',
    _isMock: true,

    checkProperty(propertyData) {
      const { district, propertyType, address, partidaRegistral, area } = propertyData;
      const seed = _hash((district || '') + (address || '') + (propertyType || ''));
      const hasPartida = !!partidaRegistral;
      const now = new Date();

      const ownerPool = ['María García López', 'José Rodríguez Pérez', 'Ana Martínez Soto', 'Carlos Sánchez Díaz', 'Luis Torres Quispe'];
      const oi = seed % ownerPool.length;

      const alerts = [];
      const missingInfo = [];

      if (!hasPartida) {
        missingInfo.push('Número de partida registral no proporcionado');
        alerts.push({ level: 'yellow', category: 'Información', message: 'Partida registral no verificada', detail: 'No se proporcionó número de partida registral. Se recomienda verificar directamente en SUNARP.' });
      }

      if (seed % 5 === 0) {
        alerts.push({ level: 'red', category: 'Cargas', message: 'Hipoteca vigente detectada', detail: 'Existe una hipoteca registrada a favor de una entidad bancaria. Verificar estado de deuda antes de proceder.' });
      }

      if (seed % 3 === 0 && area) {
        const diff = (seed % 5) - 2;
        if (diff !== 0) {
          alerts.push({ level: 'yellow', category: 'Área', message: 'Posible diferencia en área registrada', detail: `El área declarada (${area} m²) podría diferir del área inscrita (${area + diff} m²). Se recomienda verificar con planos registrados.` });
        }
      }

      if (seed % 7 === 0) {
        alerts.push({ level: 'yellow', category: 'Titularidad', message: 'Múltiples propietarios registrados', detail: 'El inmueble tiene más de un propietario registrado. Se requiere firma de todos los titulares para cualquier operación.' });
      }

      if (propertyType === 'terreno') {
        alerts.push({ level: 'yellow', category: 'Habilitación', message: 'Verificar habilitación urbana', detail: 'Los terrenos requieren verificación de habilitación urbana y zonificación ante la municipalidad correspondiente.' });
      }

      if (seed % 11 === 0 && hasPartida) {
        alerts.push({ level: 'red', category: 'Litigio', message: 'Proceso judicial en curso', detail: 'Se encontró un proceso judicial relacionado con este inmueble. Se recomienda due diligence completa antes de proceder.' });
      }

      let score = PROPERTY_CHECK_SCORE.GREEN;
      if (alerts.some(a => a.level === 'red')) score = PROPERTY_CHECK_SCORE.RED;
      else if (alerts.some(a => a.level === 'yellow')) score = PROPERTY_CHECK_SCORE.YELLOW;

      if (!area) missingInfo.push('Área del inmueble');
      if (!address) missingInfo.push('Dirección completa');

      const multiOwner = seed % 7 === 0;
      const areaDiff = (seed % 3 === 0 && area) ? (seed % 5) - 2 : 0;

      return {
        _isMock: true,
        propertyId: 'PC-' + Date.now().toString(36).toUpperCase(),
        checkDate: now.toISOString(),

        identification: {
          partidaRegistral: partidaRegistral || null,
          propertyType: propertyType || 'No especificado',
          declaredArea: area || null,
          registeredArea: area ? area + areaDiff : null,
          address: address || 'No proporcionada',
          district: district || 'No especificado',
          source: 'Datos proporcionados por el usuario',
        },

        registralInfo: {
          status: hasPartida ? 'inscrito' : 'no_verificado',
          statusLabel: hasPartida ? 'Inscrito en SUNARP' : 'No verificado',
          inscriptionDate: hasPartida ? '2018-03-15' : null,
          registralZone: district ? 'Zona Registral N° IX — Sede Lima' : null,
          source: 'SUNARP (referencial)',
        },

        ownership: hasPartida ? {
          owners: multiOwner
            ? [{ name: ownerPool[oi], percentage: 50, type: 'Persona natural' }, { name: ownerPool[(oi + 1) % ownerPool.length], percentage: 50, type: 'Persona natural' }]
            : [{ name: ownerPool[oi], percentage: 100, type: 'Persona natural' }],
          ownershipType: multiOwner ? 'Copropiedad' : 'Individual',
          source: 'SUNARP (referencial)',
        } : { owners: null, ownershipType: null, source: 'No disponible sin partida registral' },

        history: hasPartida ? {
          transfers: [
            { date: '2018-03-15', type: 'Compraventa', parties: ownerPool[(oi + 2) % ownerPool.length] + ' → ' + ownerPool[oi] },
            { date: '2010-08-22', type: 'Compraventa', parties: 'Constructora Lima SAC → ' + ownerPool[(oi + 2) % ownerPool.length] },
          ],
          source: 'SUNARP (referencial)',
        } : { transfers: [], source: 'No disponible sin partida registral' },

        encumbrances: {
          mortgages: seed % 5 === 0 ? [{ bank: 'Banco de Crédito del Perú', amount: 'No disponible', date: '2018-04-01', status: 'Vigente' }] : [],
          liens: [],
          litigation: seed % 11 === 0 && hasPartida ? [{ court: 'Juzgado Civil de Lima', case: 'Exp. ' + (1000 + seed % 9000), status: 'En trámite' }] : [],
          source: 'SUNARP (referencial)',
        },

        alerts,
        missingInfo,
        score,
      };
    },
  };

  return {
    setProvider(p) { _active = p; },
    getProvider() { return _active || MockPropertyDataProvider; },
    MockPropertyDataProvider,
  };
})();

// --- Legal Provider Abstraction (Law Firms) ---
// ⚠️ MOCK: No real law firms are represented.

const LegalProviderRegistry = (() => {
  const _mockProviders = [
    { id: 'lf-mock-1', name: 'Estudio Jurídico Lima Norte', rating: 4.8, reviewCount: 127, specialties: ['Compraventa', 'Due diligence', 'Contratos'], zones: ['Lima Norte', 'Lima Centro', 'Callao'], responseTime: '24 horas', yearsExperience: 12, _isMock: true },
    { id: 'lf-mock-2', name: 'Abogados Asociados San Isidro', rating: 4.9, reviewCount: 89, specialties: ['Due diligence', 'Estudio de títulos', 'Minuta'], zones: ['San Isidro', 'Miraflores', 'Surco', 'La Molina'], responseTime: '12 horas', yearsExperience: 18, _isMock: true },
    { id: 'lf-mock-3', name: 'Defensa Inmobiliaria Perú', rating: 4.7, reviewCount: 203, specialties: ['Contratos', 'Asesoría legal', 'Litigios'], zones: ['Lima Metropolitana'], responseTime: '48 horas', yearsExperience: 8, _isMock: true },
  ];

  return {
    getProviders() { return [..._mockProviders]; },
    getProviderById(id) { return _mockProviders.find(p => p.id === id) || null; },
    _isMock: true,
  };
})();

// --- Legal Service ---

const LegalService = (() => {
  let _orders = [];
  let _checks = [];

  function runPropertyCheck(propertyData) {
    const report = PropertyDataRegistry.getProvider().checkProperty(propertyData);
    _checks.push(report);
    return report;
  }

  function getChecks() { return [..._checks]; }

  function createOrder(serviceId, propertyData, contactData, checkId) {
    const service = getServiceById(serviceId);
    if (!service) return { error: 'Servicio no encontrado' };

    const order = {
      id: 'LEG-' + Date.now().toString(36).toUpperCase(),
      serviceId,
      serviceName: service.name,
      price: service.price,
      status: LEGAL_ORDER_STATUS.REQUESTED,
      propertyData,
      contactData,
      checkId: checkId || null,
      assignedProvider: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [{ status: LEGAL_ORDER_STATUS.REQUESTED, at: new Date().toISOString() }],
    };

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

  function getOrder(orderId) { return _orders.find(o => o.id === orderId) || null; }
  function getOrders() { return [..._orders]; }

  function getServiceDetails(serviceId) {
    return LEGAL_SERVICE_DETAILS[serviceId] || null;
  }

  return {
    runPropertyCheck, getChecks,
    createOrder, updateOrderStatus, getOrder, getOrders,
    getServiceDetails,
    LEGAL_ORDER_STATUS, LEGAL_ORDER_STATUS_LABELS,
    PROPERTY_CHECK_SCORE, PROPERTY_CHECK_SCORE_CONFIG,
  };
})();
