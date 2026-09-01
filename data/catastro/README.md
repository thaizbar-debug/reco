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
Los KML grandes están divididos en partes. Conversor individual:

```bash
node tools/kml_to_geojson.js data/catastro/<slug>.geojson.gz <in1.kml> [in2.kml ...]
```

El conversor acepta múltiples KML y deduplica features automáticamente por
coordenadas (tipo + primeros 2 vértices + cantidad de vértices).

### Conversión masiva

Para convertir todos los KML de una vez:

1. Descargar los KML de LOTES desde Drive a `data/catastro/kml/`
2. Ejecutar:
```bash
node tools/convert_all_catastro.js
```

El script detecta el distrito por nombre de archivo, agrupa las partes y
convierte cada distrito automáticamente. Ignora archivos de MANZANAS.

## Disponibles – completos (16)
barranco, brena, callao, cercado-de-lima, jesus-maria, lince,
magdalena-del-mar, pueblo-libre, punta-hermosa, punta-negra, rimac,
san-bartolo, san-borja, san-isidro, san-luis, surquillo.

## Disponibles – parciales (6)
Convertidos con los KML descargados hasta ahora. Faltan partes por descargar
de Drive para completar la cobertura total del distrito.

| Distrito | Partes cargadas | Lotes | Partes pendientes |
|---|---|---|---|
| ate | 2 de 14 (Sector 9-11, 45-46) | 14,271 | Sectores 1-8, 12-44, 47+ |
| el-agustino | 1 de 3 (Parte 3) | 5,532 | Partes 1, 2 |
| independencia | 1 de 3 (PARTE3) | 7,579 | PARTE1, PARTE2 |
| miraflores | 1 de 2 (PART2) | 668 | PART1 |
| san-miguel | 1 de 2 (PARTE2) | 5,622 | PARTE1 |
| santiago-de-surco | 1 de 5 (PART5) | 5,258 | PART1-4 |

## Pendientes – KML en Drive, sin convertir (6)
KML disponible en la carpeta de Drive pero no descargado aún (archivos > 6 MB
exceden el límite del conector de Drive).

| Distrito | Archivos en Drive | Tamaño |
|---|---|---|
| carabayllo | 14 partes (sectores 01-92) | ~107 MB total |
| chorrillos | 1 archivo (150108-CHORRILLOS_PROD) | 12.7 MB |
| la-molina | 3 partes (LOTE-PART 1-3) | ~25.8 MB total |
| lurin | 1 archivo (LOTES-LURIN) | 7.4 MB |
| san-juan-de-miraflores | 1 archivo (150133-SAN JUAN DE MIRAFLORES_prod) | 49.6 MB |
| santa-anita | 1 archivo (LOTES-SANTA ANITA PARTE1) | 7.6 MB |

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
