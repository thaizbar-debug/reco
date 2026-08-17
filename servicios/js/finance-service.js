/**
 * Reco Servicios — Finance Service Layer
 * Partner abstraction for mortgage, insurance, and financial products.
 *
 * IMPORTANT: Reco NO ES una entidad financiera.
 * - Los productos financieros son de partners.
 * - Reco genera leads/referrals.
 * - NO se inventan tasas reales ni productos bancarios.
 * - NO se afirman convenios que no existan.
 * - El simulador hipotecario es REFERENCIAL — no es oferta bancaria.
 *
 * ⚠️ MOCK: Uses mock providers for development.
 * Real implementation: register real providers via FinancialProviderRegistry / InsuranceProviderRegistry.
 */

const MORTGAGE_STATUS = Object.freeze({
  STARTED: 'started',
  SUBMITTED: 'submitted',
  CONTACTED: 'contacted',
  PREQUALIFIED: 'prequalified',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CLOSED: 'closed',
});

const MORTGAGE_STATUS_LABELS = Object.freeze({
  [MORTGAGE_STATUS.STARTED]: 'Iniciado',
  [MORTGAGE_STATUS.SUBMITTED]: 'Enviado',
  [MORTGAGE_STATUS.CONTACTED]: 'Contactado',
  [MORTGAGE_STATUS.PREQUALIFIED]: 'Precalificado',
  [MORTGAGE_STATUS.APPROVED]: 'Aprobado',
  [MORTGAGE_STATUS.REJECTED]: 'Rechazado',
  [MORTGAGE_STATUS.CLOSED]: 'Cerrado',
});

const INSURANCE_TYPES = Object.freeze({
  HOME: 'hogar',
  RENT: 'alquiler',
});

const PARTNER_MONETIZATION = Object.freeze({
  REFERRAL: 'referral',
  CPA: 'cpa',
  SUCCESS_FEE: 'success_fee',
});

// --- Financial Provider Abstraction ---

const FinancialProviderRegistry = (() => {
  let _providers = [];

  const MockFinancialProvider = {
    id: 'mock-bank',
    name: 'Entidad financiera (mock)',
    _isMock: true,

    getOffers(criteria) {
      return {
        _isMock: true,
        _note: 'En producción, se consultarán ofertas reales de entidades financieras partners.',
        offers: [],
      };
    },

    createLead(leadData) {
      return {
        leadId: 'MLEAD-' + Date.now().toString(36).toUpperCase(),
        status: MORTGAGE_STATUS.STARTED,
        _isMock: true,
      };
    },

    getLeadStatus(leadId) {
      return { leadId, status: MORTGAGE_STATUS.STARTED, _isMock: true };
    },
  };

  return {
    register(provider) { _providers.push(provider); },
    getAll() { return _providers.length > 0 ? [..._providers] : [MockFinancialProvider]; },
    getById(id) { return _providers.find(p => p.id === id) || MockFinancialProvider; },
    MockFinancialProvider,
  };
})();

// --- Insurance Provider Abstraction ---

const InsuranceProviderRegistry = (() => {
  let _providers = [];

  const MockInsuranceProvider = {
    id: 'mock-insurance',
    name: 'Aseguradora (mock)',
    _isMock: true,

    getOffers(type, criteria) {
      return {
        _isMock: true,
        _note: 'En producción, se mostrarán ofertas reales de aseguradoras partners.',
        offers: [],
      };
    },

    createLead(leadData) {
      return {
        leadId: 'ILEAD-' + Date.now().toString(36).toUpperCase(),
        status: 'submitted',
        _isMock: true,
      };
    },

    getLeadStatus(leadId) {
      return { leadId, status: 'submitted', _isMock: true };
    },
  };

  return {
    register(provider) { _providers.push(provider); },
    getAll() { return _providers.length > 0 ? [..._providers] : [MockInsuranceProvider]; },
    getById(id) { return _providers.find(p => p.id === id) || MockInsuranceProvider; },
    MockInsuranceProvider,
  };
})();

// --- Mortgage Simulator ---

const MortgageSimulator = (() => {
  const TERM_OPTIONS = [10, 15, 20, 25, 30];

  function simulate(params) {
    const { propertyPrice, downPayment, termYears, referentialRate } = params;
    const financedAmount = propertyPrice - downPayment;
    const downPaymentPercent = (downPayment / propertyPrice) * 100;

    const rate = referentialRate || 8;
    const monthlyRate = rate / 100 / 12;
    const totalMonths = termYears * 12;

    const monthlyPayment = financedAmount *
      (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
      (Math.pow(1 + monthlyRate, totalMonths) - 1);

    const totalPayment = monthlyPayment * totalMonths;
    const totalInterest = totalPayment - financedAmount;

    return {
      _referential: true,
      _note: 'Simulación referencial. Las tasas y condiciones reales varían según cada entidad financiera. Consulta directamente con el banco.',
      propertyPrice,
      downPayment,
      downPaymentPercent: Math.round(downPaymentPercent * 10) / 10,
      financedAmount,
      termYears,
      totalMonths,
      referentialRate: rate,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalPayment: Math.round(totalPayment * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
    };
  }

  return { simulate, TERM_OPTIONS };
})();

// --- Finance Service (lead management + product catalog) ---

const FinanceService = (() => {
  let _mortgageLeads = [];
  let _insuranceLeads = [];

  const _insuranceProducts = [
    {
      id: 'ins-hogar',
      type: INSURANCE_TYPES.HOME,
      name: 'Seguro de hogar',
      icon: '🏠',
      description: 'Protege tu vivienda contra incendios, sismos, inundaciones y robo. Cobertura de estructura y contenido.',
      coverages: [
        'Incendio y explosión',
        'Terremoto y tsunami',
        'Inundación',
        'Robo y asalto',
        'Daño eléctrico',
        'Responsabilidad civil',
      ],
      priceNote: 'El precio varía según ubicación, área, tipo de construcción y cobertura elegida. Consulta con la aseguradora partner.',
      _isMock: true,
    },
    {
      id: 'ins-alquiler',
      type: INSURANCE_TYPES.RENT,
      name: 'Seguro de alquiler',
      icon: '🛡️',
      description: 'Protege al propietario contra impago de alquiler. Cobertura de rentas impagas y daños al inmueble.',
      coverages: [
        'Rentas impagas (hasta 12 meses)',
        'Daños al inmueble por inquilino',
        'Gastos legales de desalojo',
        'Vandalismo',
        'Asesoría legal incluida',
      ],
      priceNote: 'El precio varía según el monto del alquiler y la duración del contrato. Consulta con la aseguradora partner.',
      _isMock: true,
    },
  ];

  function getInsuranceProducts() { return [..._insuranceProducts]; }
  function getInsuranceProduct(id) { return _insuranceProducts.find(p => p.id === id) || null; }

  function createMortgageLead(userData, propertyData, simulationData) {
    const lead = {
      id: 'MLEAD-' + Date.now().toString(36).toUpperCase(),
      status: MORTGAGE_STATUS.STARTED,
      user: { ...userData },
      property: { ...propertyData },
      requestedAmount: simulationData.financedAmount,
      downPayment: simulationData.downPayment,
      term: simulationData.termYears,
      simulation: { ...simulationData },
      partner: null,
      monetization: PARTNER_MONETIZATION.REFERRAL,
      createdAt: new Date().toISOString(),
      _isMock: true,
    };
    _mortgageLeads.unshift(lead);
    return lead;
  }

  function createInsuranceLead(userData, productId, propertyData) {
    const lead = {
      id: 'ILEAD-' + Date.now().toString(36).toUpperCase(),
      status: 'submitted',
      user: { ...userData },
      product: productId,
      property: { ...propertyData },
      partner: null,
      monetization: PARTNER_MONETIZATION.CPA,
      createdAt: new Date().toISOString(),
      _isMock: true,
    };
    _insuranceLeads.unshift(lead);
    return lead;
  }

  function getMortgageLeads() { return [..._mortgageLeads]; }
  function getInsuranceLeads() { return [..._insuranceLeads]; }

  // P2 — Architecture only
  const P2_PRODUCTS = Object.freeze({
    REFINANCING: {
      id: 'refinanciamiento',
      name: 'Refinanciamiento hipotecario',
      icon: '🔄',
      description: 'Mejora las condiciones de tu crédito hipotecario actual. Evalúa opciones de refinanciamiento con partners.',
      status: 'architecture_only',
      _note: 'P2 — Solo arquitectura preparada.',
    },
    RENT_ADVANCE: {
      id: 'adelanto-alquileres',
      name: 'Adelanto de alquileres',
      icon: '⚡',
      description: 'Para propietarios: recibe hasta 12 meses de rentas futuras por adelantado.',
      status: 'architecture_only',
      _note: 'P2 — Solo arquitectura preparada.',
    },
    RNPL: {
      id: 'rnpl',
      name: 'Rent Now Pay Later',
      icon: '💳',
      description: 'Paga tu alquiler en cuotas sin interés. Scoring crediticio requerido.',
      status: 'architecture_only',
      _note: 'P2 — Solo arquitectura preparada.',
    },
  });

  return {
    getInsuranceProducts,
    getInsuranceProduct,
    createMortgageLead,
    createInsuranceLead,
    getMortgageLeads,
    getInsuranceLeads,
    P2_PRODUCTS,
  };
})();
