/**
 * Reco Servicios — Valuation Service Layer
 * Handles property valuation estimation logic.
 *
 * ⚠️ MOCK ENGINE: This uses a simplified model for development.
 * The real engine will connect to Vanet's +40K tasaciones database.
 * All results are clearly marked as mock/referencial.
 */

const ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PAYMENT_PENDING: 'payment_pending',
  PAID: 'paid',
  ASSIGNED: 'assigned',
  IN_REVIEW: 'in_review',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.DRAFT]: 'Borrador',
  [ORDER_STATUS.SUBMITTED]: 'Enviado',
  [ORDER_STATUS.PAYMENT_PENDING]: 'Pendiente de pago',
  [ORDER_STATUS.PAID]: 'Pagado',
  [ORDER_STATUS.ASSIGNED]: 'Asignado a tasador',
  [ORDER_STATUS.IN_REVIEW]: 'En revisión',
  [ORDER_STATUS.COMPLETED]: 'Completado',
  [ORDER_STATUS.CANCELLED]: 'Cancelado',
});

const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

const CONFIDENCE_LABELS = Object.freeze({
  [CONFIDENCE_LEVELS.HIGH]: 'Alto',
  [CONFIDENCE_LEVELS.MEDIUM]: 'Medio',
  [CONFIDENCE_LEVELS.LOW]: 'Bajo',
});

const VERDICT_TYPES = Object.freeze({
  OPPORTUNITY: 'opportunity',
  FAIR: 'fair',
  OVERPRICED: 'overpriced',
});

const VERDICT_LABELS = Object.freeze({
  [VERDICT_TYPES.OPPORTUNITY]: 'Oportunidad',
  [VERDICT_TYPES.FAIR]: 'Precio justo',
  [VERDICT_TYPES.OVERPRICED]: 'Sobrevalorada',
});

// ⚠️ MOCK: Real district median prices from precios_distrito_2025.csv (Vanet data)
const DISTRICT_PRICES_USD_M2 = {
  'Miraflores': { median: 2180, p25: 1820, p75: 2480, tx: 134 },
  'San Isidro': { median: 2290, p25: 1980, p75: 2680, tx: 89 },
  'Barranco': { median: 1570, p25: 1280, p75: 1890, tx: 44 },
  'San Borja': { median: 1836, p25: 1540, p75: 2120, tx: 72 },
  'Surco': { median: 1685, p25: 1380, p75: 1980, tx: 210 },
  'La Molina': { median: 1593, p25: 1280, p75: 1860, tx: 118 },
  'San Miguel': { median: 1328, p25: 1080, p75: 1580, tx: 76 },
  'Jesús María': { median: 1296, p25: 1080, p75: 1560, tx: 52 },
  'Magdalena': { median: 1389, p25: 1120, p75: 1640, tx: 63 },
  'Pueblo Libre': { median: 1259, p25: 1020, p75: 1490, tx: 48 },
  'Lince': { median: 1504, p25: 1240, p75: 1760, tx: 58 },
  'Surquillo': { median: 1163, p25: 940, p75: 1380, tx: 41 },
  'Chorrillos': { median: 1195, p25: 920, p75: 1440, tx: 88 },
  'Ate': { median: 992, p25: 780, p75: 1240, tx: 165 },
  'Los Olivos': { median: 954, p25: 760, p75: 1180, tx: 142 },
  'Breña': { median: 1051, p25: 840, p75: 1280, tx: 29 },
  'San Martín de Porres': { median: 800, p25: 640, p75: 960, tx: 95 },
  'Comas': { median: 600, p25: 460, p75: 750, tx: 70 },
  'San Juan de Lurigancho': { median: 700, p25: 540, p75: 880, tx: 94 },
  'Villa El Salvador': { median: 550, p25: 420, p75: 700, tx: 60 },
  'Cercado de Lima': { median: 1200, p25: 960, p75: 1440, tx: 80 },
  'Rímac': { median: 840, p25: 680, p75: 1020, tx: 30 },
  'La Victoria': { median: 1100, p25: 880, p75: 1340, tx: 55 },
  'Independencia': { median: 750, p25: 580, p75: 920, tx: 45 },
  'Carabayllo': { median: 400, p25: 300, p75: 520, tx: 50 },
  'Puente Piedra': { median: 405, p25: 310, p75: 520, tx: 44 },
  'San Juan de Miraflores': { median: 825, p25: 640, p75: 1010, tx: 58 },
  'Santa Anita': { median: 1050, p25: 840, p75: 1280, tx: 43 },
  'El Agustino': { median: 650, p25: 500, p75: 820, tx: 47 },
  'Callao': { median: 860, p25: 680, p75: 1060, tx: 22 },
  'Bellavista': { median: 850, p25: 680, p75: 1040, tx: 38 },
  'La Perla': { median: 900, p25: 720, p75: 1100, tx: 23 },
};

const PROPERTY_TYPES = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'casa', label: 'Casa' },
  { value: 'terreno', label: 'Terreno' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'local_comercial', label: 'Local comercial' },
];

const DISTRICTS = Object.keys(DISTRICT_PRICES_USD_M2).sort();

const ValuationService = (() => {
  const TC_USD_PEN = 3.72;

  /**
   * ⚠️ MOCK ENGINE — Generates a plausible valuation from district medians.
   * Real engine should query Vanet API with property attributes.
   */
  function estimate(params) {
    const { district, propertyType, area, bedrooms, bathrooms, age, floor, parking } = params;

    const distData = DISTRICT_PRICES_USD_M2[district];
    if (!distData) {
      return { error: 'Distrito no disponible para estimación' };
    }

    // ⚠️ MOCK: Simplified adjustments — real model uses ML on Vanet data
    let basePriceM2 = distData.median;

    // Type adjustment
    if (propertyType === 'casa') basePriceM2 *= 0.92;
    if (propertyType === 'oficina') basePriceM2 *= 1.08;
    if (propertyType === 'local_comercial') basePriceM2 *= 1.15;
    if (propertyType === 'terreno') basePriceM2 *= 0.65;

    // Age adjustment
    if (age !== undefined && age !== null) {
      if (age <= 2) basePriceM2 *= 1.08;
      else if (age <= 5) basePriceM2 *= 1.03;
      else if (age <= 10) basePriceM2 *= 0.98;
      else if (age <= 20) basePriceM2 *= 0.92;
      else if (age <= 30) basePriceM2 *= 0.85;
      else basePriceM2 *= 0.78;
    }

    // Floor adjustment (apartments)
    if (propertyType === 'departamento' && floor) {
      if (floor >= 10) basePriceM2 *= 1.06;
      else if (floor >= 5) basePriceM2 *= 1.03;
      else if (floor <= 2) basePriceM2 *= 0.97;
    }

    // Bedrooms density adjustment
    if (bedrooms && area) {
      const density = area / bedrooms;
      if (density > 40) basePriceM2 *= 1.04;
      else if (density < 20) basePriceM2 *= 0.96;
    }

    // Parking adjustment
    if (parking >= 2) basePriceM2 *= 1.05;
    else if (parking === 0 && propertyType !== 'terreno') basePriceM2 *= 0.94;

    basePriceM2 = Math.round(basePriceM2);

    const estimatedValueUSD = basePriceM2 * area;
    const estimatedValuePEN = Math.round(estimatedValueUSD * TC_USD_PEN);

    const rangeFactorLow = distData.p25 / distData.median;
    const rangeFactorHigh = distData.p75 / distData.median;
    const minValuePEN = Math.round(estimatedValuePEN * rangeFactorLow);
    const maxValuePEN = Math.round(estimatedValuePEN * rangeFactorHigh);

    // Confidence based on transaction count
    let confidence;
    if (distData.tx >= 80) confidence = CONFIDENCE_LEVELS.HIGH;
    else if (distData.tx >= 40) confidence = CONFIDENCE_LEVELS.MEDIUM;
    else confidence = CONFIDENCE_LEVELS.LOW;

    // Comparables
    const comparablesCount = Math.min(distData.tx, Math.floor(distData.tx * 0.6));
    const comparablesRadius = distData.tx >= 100 ? 500 : distData.tx >= 50 ? 800 : 1200;

    // ⚠️ MOCK: Yield estimation — real calc uses actual rental data
    const yieldPct = _estimateYield(district, propertyType);

    // ⚠️ MOCK: Investment score
    const investmentScore = _calcInvestmentScore(distData, yieldPct, age);

    return {
      _isMock: true,
      estimatedValue: estimatedValuePEN,
      minValue: minValuePEN,
      maxValue: maxValuePEN,
      pricePerM2: Math.round(basePriceM2 * TC_USD_PEN),
      pricePerM2USD: basePriceM2,
      confidence,
      comparablesCount,
      comparablesRadius,
      yieldEstimated: yieldPct,
      investmentScore,
      district,
      propertyType,
      area,
      tcUsdPen: TC_USD_PEN,
      timestamp: new Date().toISOString(),
    };
  }

  function getVerdict(estimatedValue, askingPrice) {
    if (!askingPrice || !estimatedValue) return null;
    const diff = ((askingPrice - estimatedValue) / estimatedValue) * 100;
    if (diff < -8) return { type: VERDICT_TYPES.OPPORTUNITY, diff: Math.round(diff) };
    if (diff > 8) return { type: VERDICT_TYPES.OVERPRICED, diff: Math.round(diff) };
    return { type: VERDICT_TYPES.FAIR, diff: Math.round(diff) };
  }

  function _estimateYield(district, propertyType) {
    // ⚠️ MOCK: Based on typical Lima rental yields
    const baseYields = {
      'Miraflores': 5.2, 'San Isidro': 4.8, 'Barranco': 5.5,
      'Surco': 5.0, 'San Borja': 5.1, 'La Molina': 4.5,
      'Lince': 6.2, 'Jesús María': 5.8, 'Magdalena': 5.6,
      'Pueblo Libre': 5.9, 'San Miguel': 6.0, 'Surquillo': 6.4,
      'Breña': 6.1, 'Chorrillos': 5.3, 'Ate': 6.8,
      'Los Olivos': 6.5, 'Cercado de Lima': 6.0, 'La Victoria': 6.3,
    };
    let y = baseYields[district] || 5.5;
    if (propertyType === 'oficina') y += 0.8;
    if (propertyType === 'local_comercial') y += 1.2;
    if (propertyType === 'casa') y -= 0.5;
    return Math.round(y * 10) / 10;
  }

  function _calcInvestmentScore(distData, yieldPct, age) {
    // ⚠️ MOCK: Simplified scoring
    let score = 5.0;
    if (distData.tx >= 100) score += 1.5;
    else if (distData.tx >= 50) score += 1.0;
    else score += 0.5;
    if (yieldPct >= 6) score += 1.0;
    else if (yieldPct >= 5) score += 0.5;
    if (age !== undefined) {
      if (age <= 5) score += 1.0;
      else if (age <= 15) score += 0.5;
      else score -= 0.5;
    }
    return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
  }

  function getDistrictHistory(district) {
    // Returns historical price data if available from TASACIONES_HIST (loaded in index.html)
    // ⚠️ MOCK: Return a simplified version for standalone servicios page
    if (typeof TASACIONES_HIST !== 'undefined') {
      const norm = district.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return TASACIONES_HIST[norm] || null;
    }
    return null;
  }

  function getAvailableDistricts() {
    return DISTRICTS;
  }

  function getPropertyTypes() {
    return PROPERTY_TYPES;
  }

  // --- Tasación order management ---
  let _orders = [];

  function createOrder(serviceId, propertyData, contactData) {
    const service = getServiceById(serviceId);
    if (!service) return { error: 'Servicio no encontrado' };

    const order = {
      id: 'ORD-' + Date.now().toString(36).toUpperCase(),
      serviceId,
      serviceName: service.name,
      price: service.price,
      status: ORDER_STATUS.DRAFT,
      propertyData,
      contactData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [{ status: ORDER_STATUS.DRAFT, at: new Date().toISOString() }],
    };

    _orders.push(order);
    return order;
  }

  function submitOrder(orderId) {
    return _updateOrderStatus(orderId, ORDER_STATUS.SUBMITTED);
  }

  function _updateOrderStatus(orderId, newStatus) {
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

  function getOrders() {
    return [..._orders];
  }

  return {
    estimate,
    getVerdict,
    getDistrictHistory,
    getAvailableDistricts,
    getPropertyTypes,
    createOrder,
    submitOrder,
    getOrder,
    getOrders,
    ORDER_STATUS,
    ORDER_STATUS_LABELS,
    CONFIDENCE_LEVELS,
    CONFIDENCE_LABELS,
    VERDICT_TYPES,
    VERDICT_LABELS,
    DISTRICT_PRICES_USD_M2,
  };
})();
