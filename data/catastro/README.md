# Catastro de Lima Metropolitana

Lotes catastrales por distrito, en GeoJSON optimizado + gzip, cargados **bajo
demanda** por el mapa (capa "📐 Catastro", al acercar a zoom ≥ 14).

## Formato
- Un archivo por distrito: `<slug>.geojson.gz` (FeatureCollection de Polygon/LineString).
- Optimización: sin altura (z), coordenadas a 5 decimales (~1 m), minificado y gzip.
- Descompresión en el navegador con `DecompressionStream` (nativo).
- Registro de slugs en `CATASTRO_FILES` dentro de `index.html`.

## Generar un distrito
Fuente: KML de catastro (carpeta de Drive `1uuv45KVciSMP0MWaMPvD3HSBG7jAqR09`).
Los KML grandes están divididos en partes. Conversor:

```bash
node tools/kml_to_geojson.js data/catastro/<slug>.geojson.gz <in1.kml> [in2.kml ...]
```

El conversor acepta múltiples KML y deduplica features automáticamente por
coordenadas (tipo + primeros 2 vértices + cantidad de vértices).

## Disponibles – completos (16)
barranco, brena, callao, cercado-de-lima, jesus-maria, lince,
magdalena-del-mar, pueblo-libre, punta-hermosa, punta-negra, rimac,
san-bartolo, san-borja, san-isidro, san-luis, surquillo.

## Disponibles – parciales (5)
Convertidos con los KML descargados hasta ahora. Faltan partes por descargar
de Drive para completar la cobertura total del distrito.

| Distrito | Partes cargadas | Lotes | Partes pendientes |
|---|---|---|---|
| ate | 2 de 14 (Sector 9-11, 45-46) | 14,271 | Sectores 1-8, 12-44, 47+ |
| independencia | 1 de 3 (PARTE3) | 7,579 | PARTE1, PARTE2 |
| miraflores | 1 de 2 (PART2) | 668 | PART1 |
| san-miguel | 1 de 2 (PARTE2) | 5,622 | PARTE1 |
| santiago-de-surco | 1 de 5 (PART5) | 5,258 | PART1-4 |

## Pendientes – KML en Drive, sin convertir (7)
KML disponible en la carpeta de Drive pero no descargado aún (conector de
Drive inestable para archivos > 5 MB).

| Distrito | Archivos en Drive | Notas |
|---|---|---|
| carabayllo | 14 partes (~101 MB total) | |
| chorrillos | por confirmar | |
| el-agustino | por confirmar | |
| la-molina | 3 partes (~24.7 MB total) | |
| lurin | 1 archivo (7.0 MB) | |
| san-juan-de-miraflores | por confirmar | |
| santa-anita | 1 archivo (7.2 MB) | |

## Pendientes – sin KML aún (22 · Lima + Callao)
Registrados en `CATASTRO_FILES` para activación automática futura.
Se necesita obtener el KML fuente de cada distrito.

**Lima Provincia:**
la-victoria, los-olivos, san-juan-de-lurigancho, san-martin-de-porres,
comas, puente-piedra, villa-el-salvador, villa-maria-del-triunfo,
chaclacayo, pachacamac, cieneguilla, ancon, santa-rosa, lurigancho, pucusana,
santa-maria-del-mar.

**Callao Provincia:**
bellavista, la-perla, la-punta, ventanilla, carmen-de-la-legua-reynoso, mi-peru.
