// Carga de datos para las páginas SEO. Ver scripts/build-seo-pages.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAX_PHOTOS = 8;

// El feed usa "Lima" para el Cercado; en las páginas se muestra el nombre
// del distrito para no confundirlo con "Lima" (la ciudad).
const DISTRICT_ALIASES = { Lima: 'Cercado de Lima' };

function normDistrict(d) { return DISTRICT_ALIASES[d] || d; }

// Hay avisos con área mal cargada (p. ej. 1 m²); se tratan como "sin dato"
// para no mostrarlos ni distorsionar el precio por m².
const MIN_VALID_AREA = 10;
function cleanArea(v) { const a = Number(v) || 0; return a >= MIN_VALID_AREA ? a : 0; }

// Mismo esquema de llaves que driveAssets() en index.html.
function drivePhotos(p, drive) {
  const numId = (String(p.id).match(/^(\d+)/) || [])[1] || String(p.id);
  const entry = drive[numId + '-' + (p.op === 'Alquiler' ? 'Alq' : 'Com')] || {};
  return ['foto1', 'foto2', 'foto3', 'foto4', 'foto5', 'foto6', 'foto7', 'foto8']
    .map(k => entry[k]).filter(Boolean)
    .map(id => `https://lh3.googleusercontent.com/d/${id}=w800`);
}

// Registros Venta/Alquiler de data/properties.json. Los Histórico NO se
// publican: su detalle se desbloquea con llaves en la app.
function loadStatic() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/properties.json'), 'utf8'));
  const drive = data.drive || {};
  return (data.properties || [])
    .filter(p => (p.op === 'Venta' || p.op === 'Alquiler') && Number(p.price) > 0)
    .map(p => ({
      id: String(p.id), address: p.address, district: normDistrict(p.district), province: p.province,
      type: p.type, op: p.op, price: Number(p.price), cur: p.cur,
      area: cleanArea(p.area), areaTerr: cleanArea(p.areaTerr),
      beds: Number(p.beds) || 0, baths: Number(p.baths) || 0, park: Number(p.park) || 0,
      floor: Number(p.floor) || 0, floors: Number(p.floors) || 0, age: Number(p.age) || 0,
      lat: p.lat, lng: p.lng, features: p.features || [],
      desc: p.desc && p.desc !== p.address ? p.desc : '',
      date: p.publishedAt || p.listedAt || null,
      photos: drivePhotos(p, drive),
    }));
}

// Publicaciones de usuarios aprobadas en Firestore. Solo si existe
// FIREBASE_SERVICE_ACCOUNT (JSON de una cuenta de servicio) y firebase-admin
// está instalado; si no, se omiten con un aviso.
async function loadPublications() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[seo] FIREBASE_SERVICE_ACCOUNT no está definido: se omiten las publicaciones de usuarios.');
    return [];
  }
  let admin;
  try { admin = require('firebase-admin'); } catch (e) {
    console.warn('[seo] firebase-admin no está instalado: se omiten las publicaciones de usuarios.');
    return [];
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const snap = await admin.firestore().collection('publications').where('status', '==', 'approved').get();
  // Mismo mapeo que _pubDocToProperty() en index.html, sin campos del dueño.
  return snap.docs.map(d => {
    const p = d.data();
    return {
      id: d.id, address: p.address || p.title || '', district: normDistrict(p.district || ''), province: 'Lima',
      type: p.type || 'Departamento', op: p.op || 'Venta', price: Number(p.price) || 0,
      cur: p.currency === 'PEN' ? 'S/' : '$',
      area: cleanArea(p.area), areaTerr: cleanArea(p.areaTerr),
      beds: Number(p.beds) || 0, baths: Number(p.baths) || 0, park: Number(p.parking) || 0,
      floor: Number(p.floor) || 0, floors: Number(p.floors) || 0, age: Number(p.age) || 0,
      lat: p.lat || null, lng: p.lng || null,
      features: Array.isArray(p.features) ? p.features : [],
      desc: p.desc || '',
      date: p.listedAt ? String(p.listedAt).slice(0, 10) : null,
      photos: Array.isArray(p.photoUrls) ? p.photoUrls.slice(0, MAX_PHOTOS) : [],
    };
  }).filter(p => (p.op === 'Venta' || p.op === 'Alquiler') && p.price > 0 && p.address && p.district);
}

// Serie de medianas de tasaciones (USD/m²) por distrito, la misma fuente que
// el gráfico de la ficha en la app. Llave: nombre en mayúsculas sin tildes.
function loadTasaciones() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/serie_precios_tasaciones_compact.json'), 'utf8'));
}

module.exports = { ROOT, loadStatic, loadPublications, loadTasaciones };
