// ─────────────────────────────────────────────────────────────────────────────
// Datos de PRUEBA para revisar flujos sin backend (modo demo).
//
// Solo se cargan cuando la URL lleva ?demo=1 o cuando index.html se abre
// directo desde el disco (file://). En producción normal NO se cargan.
// Los anunciantes y propiedades son ficticios; los IDs empiezan con DEMO-.
// Las fotos son SVG generados aquí mismo, así funcionan sin internet.
// El formato es el de un doc de /publications (lo mapea _pubDocToProperty).
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  var PALETTES = [
    ['#0e7490', '#67e8f9'], ['#7c3aed', '#c4b5fd'], ['#b45309', '#fcd34d'],
    ['#be123c', '#fda4af'], ['#15803d', '#86efac'], ['#1d4ed8', '#93c5fd']
  ];
  function photo(label, n, seed){
    var c = PALETTES[(seed + n) % PALETTES.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560" viewBox="0 0 800 560">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>'
      + '<rect width="800" height="560" fill="url(#g)"/>'
      + '<g fill="rgba(255,255,255,.88)"><path d="M250 330 L400 210 L550 330 Z"/><rect x="285" y="330" width="230" height="140"/></g>'
      + '<g fill="' + c[0] + '"><rect x="375" y="390" width="50" height="80"/><rect x="310" y="355" width="45" height="40"/><rect x="445" y="355" width="45" height="40"/></g>'
      + '<text x="400" y="90" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="#fff">' + label + '</text>'
      + '<text x="400" y="132" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="22" fill="rgba(255,255,255,.85)">Foto de prueba ' + n + '</text>'
      + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function photos(label, count, seed){
    var out = [];
    for (var i = 1; i <= count; i++) out.push(photo(label, i, seed));
    return out;
  }

  var ANDINA = { userId: 'demo-inmobiliaria-andina', userName: 'Inmobiliaria Andina (demo)' };
  var CARLA  = { userId: 'demo-carla-rojas',         userName: 'Carla Rojas (demo)' };

  // [id, anunciante, op, tipo, distrito, dirección, moneda, precio, área, dorm, baños, coch, piso, pisos, antigüedad, lat, lng, fecha, extras]
  var rows = [
    ['DEMO-001', ANDINA, 'Venta',    'Departamento', 'Miraflores',        'Av. Larco 1150, Dpto 802',          'USD',  320000, 110, 3, 2, 1,  8, 15,  0, -12.1265, -77.0297, '2026-09-28', ['Vista al mar', 'Gimnasio', 'Ascensor']],
    ['DEMO-002', ANDINA, 'Venta',    'Departamento', 'Miraflores',        'Calle Berlín 245, Dpto 401',        'USD',  245000,  85, 2, 2, 1,  4,  8,  5, -12.1219, -77.0329, '2026-09-20', ['Terraza', 'Ascensor']],
    ['DEMO-003', ANDINA, 'Venta',    'Departamento', 'San Isidro',        'Av. Pezet 610, Dpto 1201',          'USD',  480000, 150, 3, 3, 2, 12, 16,  0, -12.1006, -77.0472, '2026-09-25', ['Piscina', 'Gimnasio', 'Walk-in Closet']],
    ['DEMO-004', ANDINA, 'Venta',    'Casa',         'La Molina',         'Calle Los Fresnos 320',             'USD',  690000, 380, 4, 4, 3,  0,  2, 12, -12.0838, -76.9415, '2026-08-30', ['Jardín', 'Piscina', 'Cuarto de servicio']],
    ['DEMO-005', ANDINA, 'Venta',    'Departamento', 'Santiago de Surco', 'Av. Primavera 1880, Dpto 303',      'PEN',  720000,  90, 3, 2, 1,  3, 10,  2, -12.1110, -76.9876, '2026-09-15', ['Área de lavandería', 'Ascensor']],
    ['DEMO-006', ANDINA, 'Venta',    'Departamento', 'Santiago de Surco', 'Jr. Monte Rosa 255, Dpto 702',      'USD',  210000,  95, 3, 2, 1,  7, 12,  8, -12.1050, -76.9746, '2026-09-10', ['Balcón']],
    ['DEMO-007', ANDINA, 'Venta',    'Otros',        'Lince',             'Av. Arequipa 2450, Oficina 504',    'USD',  175000,  70, 0, 1, 1,  5, 12, 10, -12.0857, -77.0352, '2026-09-05', ['Recepción', 'Ascensor']],
    ['DEMO-008', ANDINA, 'Venta',    'Departamento', 'Barranco',          'Jr. Domeyer 140, Dpto 201',         'USD',  295000, 105, 2, 2, 1,  2,  6,  0, -12.1491, -77.0213, '2026-09-30', ['Terraza', 'Vista a parque']],
    ['DEMO-009', ANDINA, 'Alquiler', 'Departamento', 'Miraflores',        'Calle Alcanfores 455, Dpto 602',    'USD',    1400,  80, 2, 2, 1,  6, 10,  4, -12.1240, -77.0280, '2026-09-27', ['Amoblado', 'Ascensor']],
    ['DEMO-010', ANDINA, 'Alquiler', 'Departamento', 'San Isidro',        'Av. Camino Real 390, Dpto 901',     'USD',    2100, 120, 3, 3, 2,  9, 14,  6, -12.0975, -77.0377, '2026-09-22', ['Piscina', 'Gimnasio']],
    ['DEMO-011', ANDINA, 'Alquiler', 'Departamento', 'Santiago de Surco', 'Av. El Polo 670, Dpto 304',         'PEN',    4200,  95, 3, 2, 1,  3,  8,  7, -12.0920, -76.9690, '2026-09-18', ['Área común']],
    ['DEMO-012', ANDINA, 'Alquiler', 'Casa',         'La Molina',         'Av. La Fontana 1020',               'USD',    3200, 300, 4, 4, 2,  0,  2, 15, -12.0790, -76.9530, '2026-09-12', ['Jardín', 'Cochera']],
    ['DEMO-013', CARLA,  'Venta',    'Departamento', 'Jesús María',       'Av. Salaverry 1520, Dpto 1003',     'USD',  185000,  78, 2, 2, 1, 10, 18,  3, -12.0790, -77.0470, '2026-09-26', ['Vista a parque', 'Ascensor']],
    ['DEMO-014', CARLA,  'Alquiler', 'Departamento', 'Pueblo Libre',      'Jr. Ica 455, Dpto 301',             'PEN',    2300,  70, 2, 1, 0,  3,  5, 20, -12.0757, -77.0636, '2026-09-29', ['Patio']],
    ['DEMO-015', CARLA,  'Alquiler', 'Otros',        'Magdalena del Mar', 'Av. Brasil 3500, Local 2',          'USD',     950,  60, 0, 1, 0,  1,  4, 25, -12.0904, -77.0685, '2026-09-08', ['Avenida', 'Comercial']]
  ];

  var properties = rows.map(function(r, i){
    var extras = r[18];
    var label = r[3] + ' · ' + r[4];
    return {
      id: r[0],
      userId: r[1].userId, userName: r[1].userName,
      op: r[2], type: r[3], district: r[4], address: r[5],
      currency: r[6], price: r[7], area: r[8], beds: r[9], baths: r[10], parking: r[11],
      floor: r[12], floors: r[13], unitFloors: 1, age: r[14], lat: r[15], lng: r[16],
      listedAt: r[17],
      features: extras,
      desc: 'PROPIEDAD DE PRUEBA (modo demo). ' + r[3] + ' en ' + r[4] + ' de ' + r[8] + ' m²'
        + (r[9] ? ', ' + r[9] + ' dormitorios' : '') + (r[10] ? ' y ' + r[10] + ' baños' : '')
        + '. Sirve para revisar el detalle completo, la ficha PDF y el perfil del anunciante.',
      photoUrls: photos(label, 4, i)
    };
  });

  window.RECO_DEMO = { properties: properties, publishers: [ANDINA, CARLA] };
})();
