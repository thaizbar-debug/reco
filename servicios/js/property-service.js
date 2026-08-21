/**
 * Reco Servicios — Property Management Service Layer
 * Portfolio management for landlords with 1-20 properties.
 *
 * IMPORTANT: This is NOT a full property management SaaS.
 * - MVP for individual landlords
 * - No building administration, no payroll, no mass billing
 * - Mock data clearly identified
 *
 * ⚠️ MOCK: Uses simulated properties for development.
 */

const PM_PROPERTY_STATUS = Object.freeze({
  OCCUPIED: 'occupied',
  VACANT: 'vacant',
  MAINTENANCE: 'maintenance',
  FOR_SALE: 'for_sale',
});

const PM_PROPERTY_STATUS_LABELS = Object.freeze({
  [PM_PROPERTY_STATUS.OCCUPIED]: 'Alquilada',
  [PM_PROPERTY_STATUS.VACANT]: 'Vacía',
  [PM_PROPERTY_STATUS.MAINTENANCE]: 'En reparación',
  [PM_PROPERTY_STATUS.FOR_SALE]: 'En venta',
});

const PM_TICKET_STATUS = Object.freeze({
  CREATED: 'created',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const PM_TICKET_STATUS_LABELS = Object.freeze({
  [PM_TICKET_STATUS.CREATED]: 'Creado',
  [PM_TICKET_STATUS.ASSIGNED]: 'Asignado',
  [PM_TICKET_STATUS.IN_PROGRESS]: 'En progreso',
  [PM_TICKET_STATUS.COMPLETED]: 'Completado',
  [PM_TICKET_STATUS.CANCELLED]: 'Cancelado',
});

const TICKET_CATEGORIES = Object.freeze([
  'Gasfitería',
  'Electricidad',
  'Pintura',
  'Cerrajería',
  'Limpieza',
  'Carpintería',
  'Otro',
]);

const DOCUMENT_TYPES = Object.freeze({
  CONTRATO: 'contrato',
  TASACION: 'tasacion',
  PROPERTY_CHECK: 'property_check',
  COMPROBANTE: 'comprobante',
  OTRO: 'otro',
});

const DOCUMENT_TYPE_LABELS = Object.freeze({
  [DOCUMENT_TYPES.CONTRATO]: 'Contrato',
  [DOCUMENT_TYPES.TASACION]: 'Tasación',
  [DOCUMENT_TYPES.PROPERTY_CHECK]: 'Property Check',
  [DOCUMENT_TYPES.COMPROBANTE]: 'Comprobante',
  [DOCUMENT_TYPES.OTRO]: 'Otro',
});

const PropertyService = (() => {
  /**
   * Property entity mapping — Reco Core <-> Servicios
   * When integrating with the real API, map these local fields to the core entity:
   *   id         -> property.id (from Reco core)
   *   address    -> property.address
   *   district   -> property.location.district
   *   area       -> property.details.area_m2
   *   rooms      -> property.details.rooms
   *   bathrooms  -> property.details.bathrooms
   *   propertyType -> property.type
   *   status     -> derive from property.status + lease status
   * DO NOT create a separate Property table — consume from Reco core API.
   */
  const _mockProperties = [
    {
      id: 'prop-mock-1',
      address: 'Av. Pardo 456, Dpto 1201',
      district: 'Miraflores',
      propertyType: 'departamento',
      area: 85,
      rooms: 3,
      bathrooms: 2,
      status: PM_PROPERTY_STATUS.OCCUPIED,
      valorEstimado: 680000,
      alquilerMensual: 3200,
      proximoPago: '2026-09-05',
      contratoVigente: true,
      tenant: {
        name: 'Carlos Méndez',
        phone: '987654321',
        email: 'carlos.m@email.com',
        leaseStart: '2025-06-01',
        leaseEnd: '2026-05-31',
      },
      gastos: {
        predial: 180,
        arbitrios: 60,
        mantenimiento: 250,
        seguro: 120,
      },
      _isMock: true,
    },
    {
      id: 'prop-mock-2',
      address: 'Jr. Colina 789, Casa',
      district: 'San Isidro',
      propertyType: 'casa',
      area: 220,
      rooms: 5,
      bathrooms: 3,
      status: PM_PROPERTY_STATUS.OCCUPIED,
      valorEstimado: 950000,
      alquilerMensual: 5500,
      proximoPago: '2026-09-01',
      contratoVigente: true,
      tenant: {
        name: 'Ana Rodríguez',
        phone: '912345678',
        email: 'ana.r@email.com',
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
      },
      gastos: {
        predial: 320,
        arbitrios: 95,
        mantenimiento: 400,
        seguro: 200,
      },
      _isMock: true,
    },
    {
      id: 'prop-mock-3',
      address: 'Calle Los Pinos 234, Dpto 502',
      district: 'Surco',
      propertyType: 'departamento',
      area: 62,
      rooms: 2,
      bathrooms: 1,
      status: PM_PROPERTY_STATUS.VACANT,
      valorEstimado: 320000,
      alquilerMensual: null,
      proximoPago: null,
      contratoVigente: false,
      tenant: null,
      gastos: {
        predial: 100,
        arbitrios: 40,
        mantenimiento: 150,
        seguro: 80,
      },
      _isMock: true,
    },
    {
      id: 'prop-mock-4',
      address: 'Av. Angamos 1100, Of. 305',
      district: 'Miraflores',
      propertyType: 'oficina',
      area: 45,
      rooms: 1,
      bathrooms: 1,
      status: PM_PROPERTY_STATUS.FOR_SALE,
      valorEstimado: 180000,
      alquilerMensual: null,
      proximoPago: null,
      contratoVigente: false,
      tenant: null,
      gastos: {
        predial: 70,
        arbitrios: 30,
        mantenimiento: 120,
        seguro: 50,
      },
      _isMock: true,
    },
    {
      id: 'prop-mock-5',
      address: 'Av. La Marina 2200, Dpto 803',
      district: 'San Miguel',
      propertyType: 'departamento',
      area: 72,
      rooms: 2,
      bathrooms: 1,
      status: PM_PROPERTY_STATUS.MAINTENANCE,
      valorEstimado: 250000,
      alquilerMensual: 1800,
      proximoPago: null,
      contratoVigente: true,
      tenant: {
        name: 'Pedro Gutiérrez',
        phone: '945678123',
        email: 'pedro.g@email.com',
        leaseStart: '2026-03-01',
        leaseEnd: '2027-02-28',
      },
      gastos: {
        predial: 85,
        arbitrios: 35,
        mantenimiento: 180,
        seguro: 65,
      },
      _isMock: true,
    },
  ];

  const _mockTickets = [
    {
      id: 'TKT-001',
      propertyId: 'prop-mock-5',
      title: 'Fuga en baño principal',
      description: 'Fuga de agua debajo del lavabo del baño principal. Se necesita revisar la tubería.',
      category: 'Gasfitería',
      status: PM_TICKET_STATUS.IN_PROGRESS,
      priority: 'high',
      createdAt: '2026-08-10T14:30:00Z',
      updatedAt: '2026-08-12T09:00:00Z',
      assignedTo: 'Gasfitería Express SAC',
      _isMock: true,
    },
    {
      id: 'TKT-002',
      propertyId: 'prop-mock-1',
      title: 'Pintura del hall de entrada',
      description: 'La pintura del hall está descascarada y necesita retoque.',
      category: 'Pintura',
      status: PM_TICKET_STATUS.COMPLETED,
      priority: 'low',
      createdAt: '2026-07-20T10:00:00Z',
      updatedAt: '2026-08-01T16:00:00Z',
      assignedTo: 'Pintores Lima SAC',
      _isMock: true,
    },
    {
      id: 'TKT-003',
      propertyId: 'prop-mock-2',
      title: 'Reparar cerradura puerta principal',
      description: 'La cerradura de la puerta principal está trabada. Inquilina reporta dificultad para abrir.',
      category: 'Cerrajería',
      status: PM_TICKET_STATUS.CREATED,
      priority: 'medium',
      createdAt: '2026-08-15T08:45:00Z',
      updatedAt: '2026-08-15T08:45:00Z',
      assignedTo: null,
      _isMock: true,
    },
    {
      id: 'TKT-004',
      propertyId: 'prop-mock-1',
      title: 'Revisión eléctrica anual',
      description: 'Revisión preventiva del sistema eléctrico del departamento.',
      category: 'Electricidad',
      status: PM_TICKET_STATUS.ASSIGNED,
      priority: 'medium',
      createdAt: '2026-08-14T11:00:00Z',
      updatedAt: '2026-08-16T09:30:00Z',
      assignedTo: 'ElectroServ Perú',
      _isMock: true,
    },
  ];

  const _mockDocuments = [
    { id: 'doc-001', propertyId: 'prop-mock-1', type: DOCUMENT_TYPES.CONTRATO, name: 'Contrato de alquiler 2025-2026', date: '2025-06-01', status: 'vigente', _isMock: true },
    { id: 'doc-002', propertyId: 'prop-mock-1', type: DOCUMENT_TYPES.TASACION, name: 'Tasación Vanet - Dic 2025', date: '2025-12-15', status: 'vigente', _isMock: true },
    { id: 'doc-003', propertyId: 'prop-mock-1', type: DOCUMENT_TYPES.PROPERTY_CHECK, name: 'Property Check SUNARP', date: '2025-05-20', status: 'vigente', _isMock: true },
    { id: 'doc-004', propertyId: 'prop-mock-2', type: DOCUMENT_TYPES.CONTRATO, name: 'Contrato de alquiler 2026', date: '2026-01-01', status: 'vigente', _isMock: true },
    { id: 'doc-005', propertyId: 'prop-mock-2', type: DOCUMENT_TYPES.COMPROBANTE, name: 'Recibo predial 2026', date: '2026-02-15', status: 'vigente', _isMock: true },
    { id: 'doc-006', propertyId: 'prop-mock-3', type: DOCUMENT_TYPES.TASACION, name: 'Tasación Vanet - Mar 2026', date: '2026-03-10', status: 'vigente', _isMock: true },
    { id: 'doc-007', propertyId: 'prop-mock-5', type: DOCUMENT_TYPES.CONTRATO, name: 'Contrato de alquiler 2026-2027', date: '2026-03-01', status: 'vigente', _isMock: true },
    { id: 'doc-008', propertyId: 'prop-mock-4', type: DOCUMENT_TYPES.PROPERTY_CHECK, name: 'Property Check SUNARP', date: '2026-06-01', status: 'vigente', _isMock: true },
  ];

  const _mockRentHistory = [
    { propertyId: 'prop-mock-1', month: '2026-08', amount: 3200, status: 'pagado', date: '2026-08-05' },
    { propertyId: 'prop-mock-1', month: '2026-07', amount: 3200, status: 'pagado', date: '2026-07-04' },
    { propertyId: 'prop-mock-1', month: '2026-06', amount: 3200, status: 'pagado', date: '2026-06-06' },
    { propertyId: 'prop-mock-1', month: '2026-05', amount: 3200, status: 'pagado', date: '2026-05-05' },
    { propertyId: 'prop-mock-2', month: '2026-08', amount: 5500, status: 'pagado', date: '2026-08-01' },
    { propertyId: 'prop-mock-2', month: '2026-07', amount: 5500, status: 'pagado', date: '2026-07-02' },
    { propertyId: 'prop-mock-2', month: '2026-06', amount: 5500, status: 'pagado', date: '2026-06-01' },
    { propertyId: 'prop-mock-5', month: '2026-07', amount: 1800, status: 'pagado', date: '2026-07-03' },
    { propertyId: 'prop-mock-5', month: '2026-06', amount: 1800, status: 'pendiente', date: null },
  ];

  function getProperties() { return _mockProperties.map(p => ({ ...p })); }

  function getPropertyById(id) {
    const p = _mockProperties.find(p => p.id === id);
    return p ? { ...p } : null;
  }

  function getPortfolioSummary() {
    const props = _mockProperties;
    const occupied = props.filter(p => p.status === PM_PROPERTY_STATUS.OCCUPIED || (p.tenant && p.status === PM_PROPERTY_STATUS.MAINTENANCE));
    const vacant = props.filter(p => p.status === PM_PROPERTY_STATUS.VACANT || p.status === PM_PROPERTY_STATUS.FOR_SALE);
    const totalValue = props.reduce((s, p) => s + p.valorEstimado, 0);
    const totalRent = occupied.reduce((s, p) => s + (p.alquilerMensual || 0), 0);
    const totalExpenses = props.reduce((s, p) => {
      const g = p.gastos;
      return s + g.predial + g.arbitrios + g.mantenimiento + g.seguro;
    }, 0);
    const netRent = totalRent - totalExpenses;
    const avgYield = totalValue > 0 ? ((totalRent * 12) / totalValue) * 100 : 0;

    return {
      totalProperties: props.length,
      occupiedCount: occupied.length,
      vacantCount: vacant.length,
      totalValue,
      totalRent,
      totalExpenses,
      netRent,
      avgYield: Math.round(avgYield * 100) / 100,
      _isMock: true,
    };
  }

  function getPropertyYield(property) {
    if (!property.alquilerMensual || property.valorEstimado <= 0) return null;
    return Math.round(((property.alquilerMensual * 12) / property.valorEstimado) * 10000) / 100;
  }

  function getPropertyExpenses(property) {
    const g = property.gastos;
    return g.predial + g.arbitrios + g.mantenimiento + g.seguro;
  }

  function getFinancialSummary(propertyId) {
    const prop = _mockProperties.find(p => p.id === propertyId);
    if (!prop) return null;
    const income = prop.alquilerMensual || 0;
    const expenses = getPropertyExpenses(prop);
    const netRent = income - expenses;
    const yieldPercent = getPropertyYield(prop);

    return {
      ingresos: income,
      gastos: expenses,
      desglose: { ...prop.gastos },
      rentaNeta: netRent,
      yieldPercent,
      _isMock: true,
      _note: income === 0 ? 'Propiedad sin ingresos actuales — no alquilada.' : null,
    };
  }

  function getRentHistory(propertyId) {
    return _mockRentHistory.filter(r => r.propertyId === propertyId);
  }

  function getTicketsByProperty(propertyId) {
    return _mockTickets.filter(t => t.propertyId === propertyId).map(t => ({ ...t }));
  }

  function getAllTickets() {
    return _mockTickets.map(t => ({ ...t }));
  }

  function createTicket(propertyId, title, description, category, priority) {
    const ticket = {
      id: 'TKT-' + Date.now().toString(36).toUpperCase(),
      propertyId,
      title,
      description,
      category,
      status: PM_TICKET_STATUS.CREATED,
      priority: priority || 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignedTo: null,
      _isMock: true,
    };
    _mockTickets.unshift(ticket);
    return { ...ticket };
  }

  function getDocumentsByProperty(propertyId) {
    return _mockDocuments.filter(d => d.propertyId === propertyId).map(d => ({ ...d }));
  }

  function addDocument(propertyId, type, name) {
    const doc = {
      id: 'doc-' + Date.now().toString(36),
      propertyId,
      type,
      name,
      date: new Date().toISOString().split('T')[0],
      status: 'vigente',
      _isMock: true,
    };
    _mockDocuments.unshift(doc);
    return { ...doc };
  }

  function getCrossSellSuggestions(propertyId) {
    const prop = _mockProperties.find(p => p.id === propertyId);
    if (!prop) return [];
    const suggestions = [];
    const yld = getPropertyYield(prop);

    if (yld !== null && yld < 4) {
      suggestions.push({ type: 'analyze', icon: '📊', title: 'Analizar inversión', subtitle: 'Tu yield es bajo. Evalúa opciones de financiamiento.', target: 'finance' });
    }
    if (prop.status === PM_PROPERTY_STATUS.VACANT) {
      suggestions.push({ type: 'find_tenant', icon: '🔑', title: 'Encontrar inquilino', subtitle: 'Conecta con un agente para alquilar tu propiedad.', target: 'agent' });
    }
    if (prop.status === PM_PROPERTY_STATUS.FOR_SALE) {
      suggestions.push({ type: 'find_agent', icon: '🏠', title: 'Encuentra un agente', subtitle: 'Vende con un agente recomendado por Reco.', target: 'agent' });
    }
    if (prop.status === PM_PROPERTY_STATUS.MAINTENANCE) {
      suggestions.push({ type: 'maintenance', icon: '🔧', title: 'Solicitar mantenimiento', subtitle: 'Encuentra proveedores verificados para tu reparación.', target: 'maintenance' });
    }

    suggestions.push({ type: 'estimate', icon: '📐', title: 'Actualizar valorización', subtitle: 'Obtén un estimado actualizado con Reco Estimate.', target: 'estimate' });
    suggestions.push({ type: 'check', icon: '🔍', title: 'Property Check', subtitle: 'Verifica el estado legal de tu propiedad.', target: 'legal' });
    suggestions.push({ type: 'insurance', icon: '🛡️', title: 'Asegurar propiedad', subtitle: 'Protege tu inversión con un seguro de hogar.', target: 'finance' });

    return suggestions;
  }

  return {
    getProperties,
    getPropertyById,
    getPortfolioSummary,
    getPropertyYield,
    getPropertyExpenses,
    getFinancialSummary,
    getRentHistory,
    getTicketsByProperty,
    getAllTickets,
    createTicket,
    getDocumentsByProperty,
    addDocument,
    getCrossSellSuggestions,
    TICKET_CATEGORIES,
  };
})();
