/**
 * Reco Servicios — Data Layer
 * Single source of truth for all service catalog data.
 * Each service follows the canonical schema defined in SERVICE_SCHEMA.
 */

const MONETIZATION_MODELS = Object.freeze({
  FREE: 'free',
  FIXED_PRICE: 'fixed_price',
  COMMISSION: 'commission',
  REFERRAL: 'referral',
  SUCCESS_FEE: 'success_fee',
  SUBSCRIPTION: 'subscription',
});

const SERVICE_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMING_SOON: 'coming_soon',
  BETA: 'beta',
  DISABLED: 'disabled',
});

const CATEGORIES = Object.freeze({
  PAGOS: 'pagos',
  MANTENIMIENTO: 'mantenimiento',
  TASACIONES: 'tasaciones',
  FINANZAS: 'finanzas',
  FOTOGRAFIA: 'fotografia',
  LEGAL: 'legal',
  RECO_AGENT: 'reco_agent',
  PROPERTY_MANAGEMENT: 'property_management',
});

const TABS = [
  { id: CATEGORIES.PAGOS, icon: '💳', label: 'Pagos' },
  { id: CATEGORIES.MANTENIMIENTO, icon: '🔧', label: 'Mantenimiento' },
  { id: CATEGORIES.TASACIONES, icon: '📐', label: 'Tasaciones' },
  { id: CATEGORIES.FINANZAS, icon: '🏦', label: 'Finanzas' },
  { id: CATEGORIES.FOTOGRAFIA, icon: '📸', label: 'Fotografía' },
  { id: CATEGORIES.LEGAL, icon: '⚖️', label: 'Legal' },
  { id: CATEGORIES.RECO_AGENT, icon: '🏠', label: 'Agentes' },
];

// --- PAGOS ---
const PAGOS_SERVICES = [
  {
    id: 'pago-alquiler-tarjeta',
    category: CATEGORIES.PAGOS,
    subcategory: 'core',
    name: 'Paga tu alquiler con tarjeta de crédito',
    shortDescription: 'Transfiere en segundos usando Visa, Mastercard, Amex o Diners.',
    description: 'Transfiere en segundos usando Visa, Mastercard, American Express o Diners. Acumula millas, puntos LATAM Pass o Bonus, y difiere el pago hasta en 12 cuotas.',
    icon: '💳',
    price: { display: '2.9% comisión', value: null },
    priceType: 'commission_percentage',
    tags: ['core'],
    status: SERVICE_STATUS.COMING_SOON,
    featured: true,
    monetizationModel: MONETIZATION_MODELS.COMMISSION,
    cta: { label: 'Pagar mi alquiler', action: 'pagos_alquiler' },
    availability: 'Lima Metropolitana y Callao',
    providerType: 'platform',
    highlights: [
      'Comisión desde 2.9 % — la más baja del mercado peruano',
      'Transferencia inmediata vía CCI / Yape Empresarial',
      'Comprobante electrónico y recordatorios mensuales',
      'Sin contrato ni costos ocultos',
    ],
  },
  {
    id: 'reco-cashback',
    category: CATEGORIES.PAGOS,
    subcategory: 'addon',
    name: 'RecoCashback',
    shortDescription: 'Cada S/ 500 pagados acumulan 1% de cashback aplicable a tu próximo reporte.',
    description: 'Cada S/ 500 pagados acumulan 1% de cashback aplicable a tu próximo reporte de valorización.',
    icon: '💰',
    price: { display: 'Incluido', value: 0 },
    priceType: 'free',
    tags: ['addon'],
    status: SERVICE_STATUS.COMING_SOON,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.FREE,
    cta: null,
    availability: 'Lima Metropolitana y Callao',
    providerType: 'platform',
  },
  {
    id: 'pago-arbitrios-predial',
    category: CATEGORIES.PAGOS,
    subcategory: 'addon',
    name: 'Pago de arbitrios y predial',
    shortDescription: 'Cancela cuotas de junta, predial e impuestos municipales.',
    description: 'Cancela cuotas de junta, predial e impuestos municipales. Comisión 2%. Integración con municipalidades de Lima.',
    icon: '🏛️',
    price: { display: '2% comisión', value: null },
    priceType: 'commission_percentage',
    tags: [],
    status: SERVICE_STATUS.COMING_SOON,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.COMMISSION,
    cta: null,
    availability: 'Lima Metropolitana y Callao',
    providerType: 'platform',
  },
  {
    id: 'recibo-digital-sunat',
    category: CATEGORIES.PAGOS,
    subcategory: 'addon',
    name: 'Recibo digital SUNAT',
    shortDescription: 'Genera tu Formulario 1683 automáticamente.',
    description: 'Genera tu Formulario 1683 automáticamente. S/ 5 por recibo. Automatizado con la data de pago.',
    icon: '📄',
    price: { display: 'S/ 5 / recibo', value: 5 },
    priceType: 'fixed',
    tags: [],
    status: SERVICE_STATUS.COMING_SOON,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.FIXED_PRICE,
    cta: null,
    availability: 'Lima Metropolitana y Callao',
    providerType: 'platform',
  },
];

// --- MANTENIMIENTO ---
const MANTENIMIENTO_SERVICES = [
  { id: 'mant-aire', category: CATEGORIES.MANTENIMIENTO, subcategory: 'climatización', name: 'Servicio técnico de aire', shortDescription: 'Instalación, mantenimiento y reparación de aire acondicionado.', description: 'Instalación, mantenimiento y reparación de aire acondicionado.', icon: '❄️', price: { display: 'Desde S/ 89', value: 89 }, priceType: 'starting_at', tags: ['Hasta 30% off'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-mudanzas', category: CATEGORIES.MANTENIMIENTO, subcategory: 'logística', name: 'Mudanzas y embalaje', shortDescription: 'Servicio completo de mudanza con embalaje profesional.', description: 'Servicio completo de mudanza con embalaje profesional.', icon: '🚚', price: { display: 'Cotización', value: null }, priceType: 'quote', tags: ['Mejor precio'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Cotizar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-pintura', category: CATEGORIES.MANTENIMIENTO, subcategory: 'acabados', name: 'Pintura interior', shortDescription: 'Pintura profesional de interiores con acabado garantizado.', description: 'Pintura profesional de interiores con acabado garantizado.', icon: '🎨', price: { display: 'Desde S/ 12/m²', value: 12 }, priceType: 'per_unit', tags: ['Hasta 25% off'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Cotizar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-limpieza', category: CATEGORIES.MANTENIMIENTO, subcategory: 'limpieza', name: 'Limpieza profunda', shortDescription: 'Limpieza profunda de departamento o casa.', description: 'Limpieza profunda de departamento o casa.', icon: '🧹', price: { display: 'Desde S/ 99', value: 99 }, priceType: 'starting_at', tags: ['Hasta 60% off'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-remodelacion', category: CATEGORIES.MANTENIMIENTO, subcategory: 'remodelación', name: 'Remodelación integral', shortDescription: 'Remodelación completa con diseño, materiales y mano de obra.', description: 'Remodelación completa con diseño, materiales y mano de obra.', icon: '🏗️', price: { display: 'Cotización', value: null }, priceType: 'quote', tags: ['Premium'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Cotizar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-electricista', category: CATEGORIES.MANTENIMIENTO, subcategory: 'instalaciones', name: 'Electricista certificado', shortDescription: 'Reparaciones, instalaciones y certificaciones eléctricas.', description: 'Reparaciones, instalaciones y certificaciones eléctricas.', icon: '⚡', price: { display: 'Desde S/ 60', value: 60 }, priceType: 'starting_at', tags: ['24/7'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-carpinteria', category: CATEGORIES.MANTENIMIENTO, subcategory: 'acabados', name: 'Carpintería y melamine', shortDescription: 'Muebles a medida, closets, cocinas y reparaciones.', description: 'Muebles a medida, closets, cocinas y reparaciones.', icon: '🪜', price: { display: 'Desde S/ 80', value: 80 }, priceType: 'starting_at', tags: ['Express'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-gasfiteria', category: CATEGORIES.MANTENIMIENTO, subcategory: 'instalaciones', name: 'Gasfitería y desatoros', shortDescription: 'Reparación de tuberías, desatoros y mantenimiento sanitario.', description: 'Reparación de tuberías, desatoros y mantenimiento sanitario.', icon: '🔧', price: { display: 'Desde S/ 70', value: 70 }, priceType: 'starting_at', tags: ['24/7'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-camaras', category: CATEGORIES.MANTENIMIENTO, subcategory: 'seguridad', name: 'Instalación de cámaras', shortDescription: 'Instalación de sistemas de videovigilancia y CCTV.', description: 'Instalación de sistemas de videovigilancia y CCTV.', icon: '📹', price: { display: 'Desde S/ 250', value: 250 }, priceType: 'starting_at', tags: ['Nuevo'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-jardineria', category: CATEGORIES.MANTENIMIENTO, subcategory: 'exteriores', name: 'Jardinería y paisajismo', shortDescription: 'Diseño, mantenimiento y cuidado de jardines.', description: 'Diseño, mantenimiento y cuidado de jardines.', icon: '🌿', price: { display: 'Desde S/ 100', value: 100 }, priceType: 'starting_at', tags: ['Nuevo'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Solicitar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
  { id: 'mant-impermeabilizacion', category: CATEGORIES.MANTENIMIENTO, subcategory: 'estructura', name: 'Impermeabilización y techado', shortDescription: 'Protección contra filtraciones y reparación de techos.', description: 'Protección contra filtraciones y reparación de techos.', icon: '💧', price: { display: 'Desde S/ 18/m²', value: 18 }, priceType: 'per_unit', tags: ['Garantía 2a'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Cotizar', action: 'mant_contact' }, availability: 'Lima Metropolitana y Callao', providerType: 'independent' },
];

// --- TASACIONES ---
const TASACIONES_SERVICES = [
  {
    id: 'tas-estimate',
    category: CATEGORIES.TASACIONES,
    subcategory: 'digital',
    name: 'Reco Estimate',
    shortDescription: 'Estimación basada en +40K tasaciones Vanet.',
    description: 'Estimación basada en +40K tasaciones Vanet. Veredicto: sobrevaluado / subvaluado / justo.',
    icon: '📊',
    price: { display: 'S/ 0', value: 0, suffix: '· instantáneo' },
    priceType: 'free',
    tags: ['Gratis'],
    status: SERVICE_STATUS.ACTIVE,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.FREE,
    cta: { label: 'Probar gratis', action: 'tas_estimate', style: 'outline' },
    availability: 'Lima Metropolitana',
    providerType: 'platform',
    highlights: [
      'Estimación basada en +40K tasaciones Vanet',
      'Veredicto: sobrevaluado / subvaluado / justo',
      'Comparables del distrito',
      '⚠️ Referencial — no apta para trámites',
    ],
  },
  {
    id: 'tas-express',
    category: CATEGORIES.TASACIONES,
    subcategory: 'digital',
    name: 'Express',
    shortDescription: 'Informe con IA + revisión humana en 24h.',
    description: 'Informe con IA + revisión humana. Comparables Vanet. Ideal para pre-compra y negociación.',
    icon: '⚡',
    price: { display: 'S/ 149', value: 149, suffix: '· 24 horas' },
    priceType: 'fixed',
    tags: ['Más rápido'],
    status: SERVICE_STATUS.ACTIVE,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.FIXED_PRICE,
    cta: { label: 'Solicitar Express', action: 'tas_express', style: 'outline' },
    availability: 'Lima Metropolitana',
    providerType: 'platform',
    highlights: [
      'Informe con IA + revisión humana',
      'Comparables Vanet del distrito',
      'Ideal para pre-compra y negociación',
      'PDF descargable, no apto para bancos',
    ],
  },
  {
    id: 'tas-virtual',
    category: CATEGORIES.TASACIONES,
    subcategory: 'profesional',
    name: 'Virtual',
    shortDescription: 'Videollamada con tasador REPEV. Informe firmado.',
    description: 'Videollamada con tasador REPEV. Agendamiento flexible 7 días. Informe firmado válido para créditos.',
    icon: '📹',
    price: { display: 'S/ 349', value: 349, suffix: '· 48 horas' },
    priceType: 'fixed',
    tags: ['Recomendado'],
    status: SERVICE_STATUS.ACTIVE,
    featured: true,
    monetizationModel: MONETIZATION_MODELS.FIXED_PRICE,
    cta: { label: 'Agendar Virtual', action: 'tas_virtual', style: 'solid' },
    availability: 'Lima Metropolitana',
    providerType: 'professional',
    highlights: [
      'Videollamada con tasador REPEV',
      'Agendamiento flexible 7 días',
      'Informe firmado válido para créditos',
      'Plano referencial + registro fotográfico',
    ],
  },
  {
    id: 'tas-presencial',
    category: CATEGORIES.TASACIONES,
    subcategory: 'profesional',
    name: 'Presencial',
    shortDescription: 'Visita técnica al inmueble. Aceptada por bancos.',
    description: 'Visita técnica al inmueble. Aceptada por BCP, BBVA, Interbank, Scotiabank.',
    icon: '🏠',
    price: { display: 'S/ 590', value: 590, suffix: '· 3-5 días' },
    priceType: 'fixed',
    tags: ['Bancaria'],
    status: SERVICE_STATUS.ACTIVE,
    featured: false,
    monetizationModel: MONETIZATION_MODELS.FIXED_PRICE,
    cta: { label: 'Reservar visita', action: 'tas_presencial', style: 'outline' },
    availability: 'Lima Metropolitana',
    providerType: 'professional',
    highlights: [
      'Visita técnica al inmueble',
      'Aceptada por BCP, BBVA, Interbank, Scotiabank',
      'Informe REPEV / RTM firmado digitalmente',
      'Asesoría para levantamiento de observaciones',
    ],
  },
];

// --- FINANZAS ---
const FINANZAS_SERVICES = [
  { id: 'fin-pago-alquiler', category: CATEGORIES.FINANZAS, subcategory: 'pagos', name: 'Pago de alquiler con tarjeta', shortDescription: 'Paga tu renta mensual con tarjeta de crédito o débito.', description: 'Paga tu renta mensual con tarjeta de crédito o débito. Acumula puntos o millas. Integración con Niubiz / Mercado Pago.', icon: '💳', price: { display: '2.9% comisión', value: null }, priceType: 'commission_percentage', tags: ['Core'], status: SERVICE_STATUS.COMING_SOON, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Próximamente', action: 'coming_soon' }, availability: 'Lima Metropolitana y Callao', providerType: 'platform' },
  { id: 'fin-recibo-sunat', category: CATEGORIES.FINANZAS, subcategory: 'pagos', name: 'Recibo digital SUNAT', shortDescription: 'Generación automática del Formulario 1683.', description: 'Generación automática del Formulario 1683 (impuesto renta de primera categoría).', icon: '📄', price: { display: 'S/ 5 / recibo', value: 5 }, priceType: 'fixed', tags: ['Nuevo'], status: SERVICE_STATUS.COMING_SOON, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Próximamente', action: 'coming_soon' }, availability: 'Lima Metropolitana y Callao', providerType: 'platform' },
  { id: 'fin-arbitrios', category: CATEGORIES.FINANZAS, subcategory: 'pagos', name: 'Pago de arbitrios y predial', shortDescription: 'Paga cuotas municipales y mantenimiento desde Reco.', description: 'Paga cuotas municipales y mantenimiento desde Reco. Integración con municipalidades de Lima.', icon: '🏛️', price: { display: '2% comisión', value: null }, priceType: 'commission_percentage', tags: ['Nuevo'], status: SERVICE_STATUS.COMING_SOON, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Próximamente', action: 'coming_soon' }, availability: 'Lima Metropolitana y Callao', providerType: 'platform' },
  { id: 'fin-credito-hipotecario', category: CATEGORIES.FINANZAS, subcategory: 'credito', name: 'Crédito hipotecario', shortDescription: 'Comparador de TCEA en tiempo real.', description: 'Comparador de TCEA en tiempo real. Convenios con BCP, BBVA, Interbank, Scotiabank.', icon: '🏦', price: { display: 'Referral fee', value: null }, priceType: 'referral', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.REFERRAL, cta: { label: 'Ver opciones', action: 'fin_hipotecario' }, availability: 'Nacional', providerType: 'partner' },
  { id: 'fin-prestamo-personal', category: CATEGORIES.FINANZAS, subcategory: 'credito', name: 'Préstamo personal', shortDescription: 'Para remodelación, amoblado o cuota inicial.', description: 'Para remodelación, amoblado o cuota inicial. Hasta S/ 80K. Cross-sell natural después de compra.', icon: '💵', price: { display: 'Hasta S/ 80K', value: null }, priceType: 'referral', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.REFERRAL, cta: { label: 'Ver opciones', action: 'fin_prestamo' }, availability: 'Nacional', providerType: 'partner' },
  { id: 'fin-bnpl', category: CATEGORIES.FINANZAS, subcategory: 'credito', name: 'Renta Ahora, Paga Después', shortDescription: 'BNPL para alquiler — paga en 3 cuotas sin interés.', description: 'BNPL para alquiler — paga en 3 cuotas sin interés. Requiere scoring crediticio.', icon: '💳', price: { display: '3 cuotas s/interés', value: null }, priceType: 'bnpl', tags: ['Nuevo'], status: SERVICE_STATUS.COMING_SOON, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Ver opciones', action: 'fin_bnpl' }, availability: 'Lima Metropolitana', providerType: 'partner' },
  { id: 'fin-adelanto-alquileres', category: CATEGORIES.FINANZAS, subcategory: 'proteccion', name: 'Adelanto de alquileres', shortDescription: 'Reco adelanta hasta 12 meses de rentas futuras.', description: 'Para propietarios: Reco adelanta hasta 12 meses de rentas futuras cobrando un descuento de 8-15%.', icon: '⚡', price: { display: 'Hasta 12 meses', value: null }, priceType: 'success_fee', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.SUCCESS_FEE, cta: { label: 'Solicitar', action: 'fin_adelanto' }, availability: 'Lima Metropolitana', providerType: 'platform' },
  { id: 'fin-seguro-hogar', category: CATEGORIES.FINANZAS, subcategory: 'proteccion', name: 'Seguro de hogar', shortDescription: 'Contra incendios, sismos y robo.', description: 'Contra incendios, sismos y robo. Alianza con Rímac, Pacífico o La Positiva. Comisión: 15-20% de prima.', icon: '🛡️', price: { display: 'Desde S/ 25/mes', value: 25 }, priceType: 'starting_at', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.COMMISSION, cta: { label: 'Cotizar', action: 'fin_seguro' }, availability: 'Nacional', providerType: 'partner' },
];

// --- FOTOGRAFIA ---
const FOTOGRAFIA_SERVICES = [
  { id: 'foto-basica', category: CATEGORIES.FOTOGRAFIA, subcategory: 'foto', name: 'Foto básica', shortDescription: '15 fotos HDR editadas. Entrega en 24h.', description: '15 fotos HDR editadas. Entrega en 24h. Ideal para alquiler o venta rápida.', icon: '📷', price: { display: 'S/ 199', value: 199 }, priceType: 'fixed', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Agendar', action: 'foto_agendar' }, availability: 'Lima Metropolitana (distritos selectos)', providerType: 'professional' },
  { id: 'foto-premium', category: CATEGORIES.FOTOGRAFIA, subcategory: 'foto', name: 'Foto premium', shortDescription: '30 fotos HDR + retoque + plano de distribución.', description: '30 fotos HDR + retoque profesional + plano de distribución. Entrega en 48h.', icon: '📸', price: { display: 'S/ 399', value: 399 }, priceType: 'fixed', tags: ['Recomendado'], status: SERVICE_STATUS.ACTIVE, featured: true, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Agendar', action: 'foto_agendar' }, availability: 'Lima Metropolitana (distritos selectos)', providerType: 'professional' },
  { id: 'foto-video', category: CATEGORIES.FOTOGRAFIA, subcategory: 'video', name: 'Video recorrido', shortDescription: 'Video profesional de 60-90s.', description: 'Video profesional de 60-90s. Música con licencia, color grading cinematográfico.', icon: '🎥', price: { display: 'S/ 349', value: 349 }, priceType: 'fixed', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Agendar', action: 'foto_agendar' }, availability: 'Lima Metropolitana (distritos selectos)', providerType: 'professional' },
  { id: 'foto-tour-ia', category: CATEGORIES.FOTOGRAFIA, subcategory: 'ia', name: 'Tour virtual IA', shortDescription: 'Tour inmersivo generado con Luma Dream Machine Ray 2.', description: 'Tour inmersivo generado con Luma Dream Machine Ray 2. A partir de fotos existentes, sin visita presencial.', icon: '🌐', price: { display: 'S/ 149', value: 149 }, priceType: 'fixed', tags: ['IA'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'foto_tour_ia' }, availability: 'Nacional (solo requiere fotos)', providerType: 'platform' },
  { id: 'foto-staging', category: CATEGORIES.FOTOGRAFIA, subcategory: 'ia', name: 'Home staging virtual', shortDescription: 'Amobla virtualmente cualquier ambiente con REimagineHome.', description: 'Amobla virtualmente cualquier ambiente con REimagineHome. Toggle amoblado/real en la ficha.', icon: '🛋️', price: { display: 'S/ 199', value: 199 }, priceType: 'fixed', tags: ['IA'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'foto_staging' }, availability: 'Nacional (solo requiere fotos)', providerType: 'platform' },
  { id: 'foto-pack', category: CATEGORIES.FOTOGRAFIA, subcategory: 'pack', name: 'Pack Reco Visual', shortDescription: 'Foto premium + video + tour IA + staging virtual.', description: 'Foto premium + video + tour IA + staging virtual. El paquete completo con 25% de descuento.', icon: '🎯', price: { display: 'S/ 899', value: 899 }, priceType: 'fixed', tags: ['Pack'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Ver pack', action: 'foto_pack' }, availability: 'Lima Metropolitana (distritos selectos)', providerType: 'professional' },
];

// --- LEGAL ---
const LEGAL_SERVICES = [
  { id: 'legal-contrato-alquiler', category: CATEGORIES.LEGAL, subcategory: 'contratos', name: 'Contrato de alquiler', shortDescription: 'Redacción a medida con cláusulas de garantía y penalidades.', description: 'Redacción de contrato de arrendamiento a medida. Incluye cláusulas de garantía, penalidades, inventario y condiciones de renovación. Legalizado ante notario.', icon: '📝', price: { display: 'S/ 150 – 300', value: 150 }, priceType: 'range', tags: ['Nuevo'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'legal_solicitar' }, availability: 'Nacional', providerType: 'professional' },
  { id: 'legal-revision-contrato', category: CATEGORIES.LEGAL, subcategory: 'contratos', name: 'Revisión de contrato', shortDescription: 'Análisis de contrato existente. Informe en 48h.', description: 'Análisis de contrato existente (alquiler o compraventa). Identifica cláusulas abusivas, riesgos legales y propone modificaciones. Informe en 48h.', icon: '🔍', price: { display: 'S/ 100 – 200', value: 100 }, priceType: 'range', tags: ['Nuevo'], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'legal_solicitar' }, availability: 'Nacional', providerType: 'professional' },
  { id: 'legal-minuta', category: CATEGORIES.LEGAL, subcategory: 'contratos', name: 'Minuta de compraventa', shortDescription: 'Elaboración de minuta para inscripción en Registros Públicos.', description: 'Elaboración de minuta de compraventa para inscripción en Registros Públicos. Incluye revisión de condiciones, forma de pago y saneamiento legal.', icon: '📄', price: { display: 'S/ 300 – 500', value: 300 }, priceType: 'range', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Ver detalles', action: 'legal_detalles' }, availability: 'Nacional', providerType: 'professional' },
  { id: 'legal-asesoria', category: CATEGORIES.LEGAL, subcategory: 'due_diligence', name: 'Asesoría legal inmobiliaria', shortDescription: 'Consulta con abogado especializado. Sesión de 45 min.', description: 'Consulta con abogado especializado en derecho inmobiliario. Orientación sobre compra, venta, alquiler, herencias y conflictos vecinales. Sesión de 45 minutos.', icon: '⚖️', price: { display: 'S/ 150', value: 150 }, priceType: 'fixed', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Agendar', action: 'legal_agendar' }, availability: 'Nacional (virtual)', providerType: 'professional' },
  { id: 'legal-estudio-titulos', category: CATEGORIES.LEGAL, subcategory: 'due_diligence', name: 'Estudio de títulos', shortDescription: 'Verificación de cadena de titularidad en SUNARP.', description: 'Verificación de la cadena de titularidad en SUNARP. Identifica cargas, gravámenes, hipotecas, embargos y litigios pendientes sobre el inmueble.', icon: '🏛️', price: { display: 'S/ 200 – 400', value: 200 }, priceType: 'range', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'legal_solicitar' }, availability: 'Nacional', providerType: 'professional' },
  { id: 'legal-due-diligence', category: CATEGORIES.LEGAL, subcategory: 'due_diligence', name: 'Due diligence documental', shortDescription: 'Auditoría completa: títulos, municipalidad, SUNARP, deudas.', description: 'Auditoría completa: títulos, municipalidad, SUNARP, deudas tributarias, conformidad de obra, habilitación urbana y declaratoria de fábrica. Informe ejecutivo en 5 días hábiles.', icon: '📑', price: { display: 'S/ 350 – 800', value: 350 }, priceType: 'range', tags: [], status: SERVICE_STATUS.ACTIVE, featured: false, monetizationModel: MONETIZATION_MODELS.FIXED_PRICE, cta: { label: 'Solicitar', action: 'legal_solicitar' }, availability: 'Nacional', providerType: 'professional' },
];

// --- RECO AGENT (prepared, no products yet) ---
const RECO_AGENT_SERVICES = [];

// --- PROPERTY MANAGEMENT (prepared, no products yet) ---
const PROPERTY_MANAGEMENT_SERVICES = [];

// --- Aggregated catalog ---
const SERVICE_CATALOG = {
  [CATEGORIES.PAGOS]: PAGOS_SERVICES,
  [CATEGORIES.MANTENIMIENTO]: MANTENIMIENTO_SERVICES,
  [CATEGORIES.TASACIONES]: TASACIONES_SERVICES,
  [CATEGORIES.FINANZAS]: FINANZAS_SERVICES,
  [CATEGORIES.FOTOGRAFIA]: FOTOGRAFIA_SERVICES,
  [CATEGORIES.LEGAL]: LEGAL_SERVICES,
  [CATEGORIES.RECO_AGENT]: RECO_AGENT_SERVICES,
  [CATEGORIES.PROPERTY_MANAGEMENT]: PROPERTY_MANAGEMENT_SERVICES,
};

// --- Query helpers ---
function getServicesByCategory(categoryId) {
  return SERVICE_CATALOG[categoryId] || [];
}

function getServicesBySubcategory(categoryId, subcategory) {
  return getServicesByCategory(categoryId).filter(s => s.subcategory === subcategory);
}

function getServiceById(id) {
  for (const cat of Object.values(SERVICE_CATALOG)) {
    const found = cat.find(s => s.id === id);
    if (found) return found;
  }
  return null;
}

function getActiveServices(categoryId) {
  return getServicesByCategory(categoryId).filter(s => s.status === SERVICE_STATUS.ACTIVE);
}

function getFeaturedServices(categoryId) {
  return getServicesByCategory(categoryId).filter(s => s.featured);
}

function searchServices(categoryId, query) {
  const q = query.toLowerCase().trim();
  if (!q) return getServicesByCategory(categoryId);
  return getServicesByCategory(categoryId).filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.shortDescription.toLowerCase().includes(q) ||
    s.tags.some(t => t.toLowerCase().includes(q))
  );
}
