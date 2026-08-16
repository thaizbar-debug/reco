/**
 * Reco Servicios — Agent Service Layer
 * Agent profiles, matching algorithm, leads, and provider abstraction.
 *
 * ⚠️ MOCK: Uses simulated agent data and scoring.
 * Real implementation will connect to verified agent database.
 */

const LEAD_STATUS = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  MEETING: 'meeting',
  LISTING_CREATED: 'listing_created',
  OFFER_RECEIVED: 'offer_received',
  NEGOTIATION: 'negotiation',
  CLOSED: 'closed',
  LOST: 'lost',
});

const LEAD_STATUS_LABELS = Object.freeze({
  [LEAD_STATUS.NEW]: 'Nuevo',
  [LEAD_STATUS.CONTACTED]: 'Contactado',
  [LEAD_STATUS.MEETING]: 'En reunión',
  [LEAD_STATUS.LISTING_CREATED]: 'Propiedad listada',
  [LEAD_STATUS.OFFER_RECEIVED]: 'Oferta recibida',
  [LEAD_STATUS.NEGOTIATION]: 'En negociación',
  [LEAD_STATUS.CLOSED]: 'Cerrado',
  [LEAD_STATUS.LOST]: 'Perdido',
});

const LEAD_STATUS_ORDER = [
  LEAD_STATUS.NEW,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.MEETING,
  LEAD_STATUS.LISTING_CREATED,
  LEAD_STATUS.OFFER_RECEIVED,
  LEAD_STATUS.NEGOTIATION,
  LEAD_STATUS.CLOSED,
];

const OPERATION_TYPES = Object.freeze({
  SELL: 'venta',
  BUY: 'compra',
  RENT: 'alquiler',
});

const OPERATION_LABELS = Object.freeze({
  [OPERATION_TYPES.SELL]: 'Vender',
  [OPERATION_TYPES.BUY]: 'Comprar',
  [OPERATION_TYPES.RENT]: 'Alquilar',
});

const MONETIZATION_READY = Object.freeze({
  REFERRAL_FEE: 'referral_fee',
  SUCCESS_FEE: 'success_fee',
  SUBSCRIPTION: 'subscription',
});

const PRICE_RANGES = [
  { value: 'under_100k', label: 'Menos de US$ 100K', min: 0, max: 100000 },
  { value: '100k_200k', label: 'US$ 100K – 200K', min: 100000, max: 200000 },
  { value: '200k_400k', label: 'US$ 200K – 400K', min: 200000, max: 400000 },
  { value: '400k_700k', label: 'US$ 400K – 700K', min: 400000, max: 700000 },
  { value: 'over_700k', label: 'Más de US$ 700K', min: 700000, max: Infinity },
];

// --- Mock Agent Profiles ---
// ⚠️ MOCK: No real agents are represented.

const AgentProfileRegistry = (() => {
  const _mockAgents = [
    {
      id: 'ag-mock-1',
      name: 'Carolina Méndez',
      photo: null,
      zones: ['Miraflores', 'San Isidro', 'Barranco'],
      specialties: ['Departamentos premium', 'Inversión'],
      propertyTypes: ['departamento', 'oficina'],
      operations: ['venta', 'compra'],
      priceRange: { min: 200000, max: 700000 },
      rating: 4.9,
      reviewCount: 156,
      responseTime: '2 horas',
      yearsExperience: 12,
      activeListings: 18,
      closedDeals: 89,
      avgDaysToClose: 45,
      verified: true,
      bio: 'Especialista en departamentos de alta gama en Miraflores y San Isidro. Más de 10 años conectando compradores con las mejores propiedades de Lima.',
      _isMock: true,
    },
    {
      id: 'ag-mock-2',
      name: 'Roberto Quispe',
      photo: null,
      zones: ['Surco', 'La Molina', 'San Borja'],
      specialties: ['Casas familiares', 'Terrenos'],
      propertyTypes: ['casa', 'terreno'],
      operations: ['venta', 'compra', 'alquiler'],
      priceRange: { min: 100000, max: 400000 },
      rating: 4.8,
      reviewCount: 203,
      responseTime: '4 horas',
      yearsExperience: 8,
      activeListings: 24,
      closedDeals: 134,
      avgDaysToClose: 38,
      verified: true,
      bio: 'Conozco cada calle de Surco y La Molina. Mi enfoque: encontrar el hogar ideal para familias que buscan espacio, seguridad y calidad de vida.',
      _isMock: true,
    },
    {
      id: 'ag-mock-3',
      name: 'Ana Lucía Torres',
      photo: null,
      zones: ['Jesús María', 'Magdalena', 'Pueblo Libre', 'Lince'],
      specialties: ['Primera vivienda', 'Alquileres'],
      propertyTypes: ['departamento', 'casa'],
      operations: ['compra', 'alquiler'],
      priceRange: { min: 50000, max: 200000 },
      rating: 4.7,
      reviewCount: 98,
      responseTime: '1 hora',
      yearsExperience: 5,
      activeListings: 31,
      closedDeals: 67,
      avgDaysToClose: 30,
      verified: true,
      bio: 'Ayudo a jóvenes profesionales y familias nuevas a dar el primer paso. Experta en zonas emergentes con excelente relación calidad-precio.',
      _isMock: true,
    },
    {
      id: 'ag-mock-4',
      name: 'Fernando Castillo',
      photo: null,
      zones: ['San Isidro', 'Miraflores', 'Surco'],
      specialties: ['Locales comerciales', 'Oficinas'],
      propertyTypes: ['oficina', 'local_comercial'],
      operations: ['venta', 'alquiler'],
      priceRange: { min: 100000, max: 700000 },
      rating: 4.6,
      reviewCount: 72,
      responseTime: '6 horas',
      yearsExperience: 15,
      activeListings: 12,
      closedDeals: 210,
      avgDaysToClose: 60,
      verified: true,
      bio: 'Especializado en el segmento corporativo. Manejo cartera de oficinas prime y locales comerciales en los principales ejes empresariales de Lima.',
      _isMock: true,
    },
    {
      id: 'ag-mock-5',
      name: 'Valeria Soto',
      photo: null,
      zones: ['Miraflores', 'Barranco', 'Chorrillos'],
      specialties: ['Departamentos con vista al mar', 'Inversión turística'],
      propertyTypes: ['departamento'],
      operations: ['venta', 'compra', 'alquiler'],
      priceRange: { min: 150000, max: 500000 },
      rating: 4.8,
      reviewCount: 119,
      responseTime: '3 horas',
      yearsExperience: 7,
      activeListings: 15,
      closedDeals: 78,
      avgDaysToClose: 42,
      verified: true,
      bio: 'Apasionada por las propiedades frente al mar. Conozco cada edificio del malecón. Si buscas vista al océano, soy tu agente.',
      _isMock: true,
    },
    {
      id: 'ag-mock-6',
      name: 'Diego Paredes',
      photo: null,
      zones: ['La Molina', 'Ate', 'Santa Anita', 'Chaclacayo'],
      specialties: ['Casas de campo', 'Terrenos rústicos'],
      propertyTypes: ['casa', 'terreno'],
      operations: ['venta', 'compra'],
      priceRange: { min: 80000, max: 300000 },
      rating: 4.5,
      reviewCount: 54,
      responseTime: '8 horas',
      yearsExperience: 10,
      activeListings: 9,
      closedDeals: 45,
      avgDaysToClose: 55,
      verified: true,
      bio: 'El campo es mi territorio. Desde La Molina hasta Chaclacayo, conozco cada lote y condominio. Ideal para quien busca tranquilidad sin perder Lima.',
      _isMock: true,
    },
  ];

  return {
    getAll() { return [..._mockAgents]; },
    getById(id) { return _mockAgents.find(a => a.id === id) || null; },
    _isMock: true,
  };
})();

// --- Agent Match Algorithm ---

const AgentMatch = (() => {
  function _scoreZone(agent, district) {
    if (!district) return 0;
    return agent.zones.includes(district) ? 30 : 0;
  }

  function _scorePropertyType(agent, propertyType) {
    if (!propertyType) return 0;
    return agent.propertyTypes.includes(propertyType) ? 20 : 0;
  }

  function _scoreOperation(agent, operation) {
    if (!operation) return 0;
    return agent.operations.includes(operation) ? 15 : 0;
  }

  function _scorePriceRange(agent, priceRange) {
    if (!priceRange) return 0;
    const range = PRICE_RANGES.find(r => r.value === priceRange);
    if (!range) return 0;
    const overlap = Math.min(agent.priceRange.max, range.max) - Math.max(agent.priceRange.min, range.min);
    return overlap > 0 ? 15 : 0;
  }

  function _scoreExperience(agent) {
    if (agent.yearsExperience >= 10) return 8;
    if (agent.yearsExperience >= 5) return 5;
    return 2;
  }

  function _scorePerformance(agent) {
    let score = 0;
    if (agent.rating >= 4.8) score += 5;
    else if (agent.rating >= 4.5) score += 3;
    if (agent.closedDeals >= 100) score += 4;
    else if (agent.closedDeals >= 50) score += 2;
    if (agent.avgDaysToClose <= 40) score += 3;
    else if (agent.avgDaysToClose <= 60) score += 1;
    return score;
  }

  function match(criteria) {
    const agents = AgentProfileRegistry.getAll();
    const scored = agents.map(agent => {
      const zoneScore = _scoreZone(agent, criteria.district);
      const typeScore = _scorePropertyType(agent, criteria.propertyType);
      const opScore = _scoreOperation(agent, criteria.operation);
      const priceScore = _scorePriceRange(agent, criteria.priceRange);
      const expScore = _scoreExperience(agent);
      const perfScore = _scorePerformance(agent);

      const total = zoneScore + typeScore + opScore + priceScore + expScore + perfScore;

      const reasons = [];
      if (zoneScore > 0) reasons.push(`trabaja en ${criteria.district}`);
      if (typeScore > 0) reasons.push('maneja propiedades similares');
      if (opScore > 0) reasons.push(`experiencia en ${criteria.operation}`);
      if (priceScore > 0) reasons.push('opera en este rango de precios');
      if (expScore >= 5) reasons.push(`${agent.yearsExperience} años de experiencia`);
      if (perfScore >= 8) reasons.push('excelente performance');

      return {
        agent,
        score: total,
        matchPercentage: Math.min(99, Math.max(50, Math.round(total))),
        reasons,
        _isMock: true,
      };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function getMatchExplanation(result) {
    if (result.reasons.length === 0) return '';
    return 'Te recomendamos este agente porque ' + result.reasons.join(', ') + '.';
  }

  return { match, getMatchExplanation };
})();

// --- Lead Management ---

const AgentLeadService = (() => {
  let _leads = [];

  function createLead(agentId, criteria, contactData, source) {
    const agent = AgentProfileRegistry.getById(agentId);
    if (!agent) return { error: 'Agente no encontrado' };

    const lead = {
      id: 'LEAD-' + Date.now().toString(36).toUpperCase(),
      agentId,
      agentName: agent.name,
      status: LEAD_STATUS.NEW,
      criteria,
      contactData,
      source: source || 'match',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [{ status: LEAD_STATUS.NEW, at: new Date().toISOString() }],
      monetization: null,
    };

    _leads.push(lead);
    return lead;
  }

  function updateLeadStatus(leadId, newStatus) {
    const lead = _leads.find(l => l.id === leadId);
    if (!lead) return { error: 'Lead no encontrado' };
    lead.status = newStatus;
    lead.updatedAt = new Date().toISOString();
    lead.statusHistory.push({ status: newStatus, at: lead.updatedAt });
    return lead;
  }

  function getLead(leadId) { return _leads.find(l => l.id === leadId) || null; }
  function getLeads() { return [..._leads]; }
  function getLeadsByAgent(agentId) { return _leads.filter(l => l.agentId === agentId); }
  function getLeadsByStatus(status) { return _leads.filter(l => l.status === status); }

  return {
    createLead, updateLeadStatus,
    getLead, getLeads, getLeadsByAgent, getLeadsByStatus,
  };
})();
