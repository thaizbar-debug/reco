# Catastro de Lima Metropolitana

Lotes catastrales por distrito, en GeoJSON optimizado + gzip, cargados **bajo
demanda** por el mapa (capa "📐 Catastro", al acercar a zoom ≥ 14).

## Formato
- Un archivo por distrito: `<slug>.geojson.gz` (FeatureCollection de Polygon/LineString).
- Optimización: sin altura (z), coordenadas a 5 decimales (~1 m), minificado y gzip.
- Descompresión en el navegador con `DecompressionStream` (nativo).
- Registro de slugs en `CATASTRO_FILES` dentro de `Versión final Thaiz.html`.

## Generar un distrito
Fuente: KML de catastro (carpeta de Drive de RECO). Conversor:

```bash
node tools/kml_to_geojson.js "150122-MIRAFLORES_PROD.kml" data/catastro/miraflores.geojson.gz
```

Para distritos partidos en varios KML (ATE-1/-2, CARABAYLLO-1/-2, CERCADO DE
LIMA-2/3/4), conviene unir los features en un solo `<slug>.geojson.gz`.

## Disponibles (15)
barranco, brena, callao, jesus-maria, lince, magdalena-del-mar, pueblo-libre,
punta-hermosa, punta-negra, rimac, san-bartolo, san-borja, san-isidro,
san-luis, surquillo.

## Pendientes (archivos KML > ~6 MB; no transferibles por el conector de Drive en CI)
lurin, miraflores, cercado-de-lima, chorrillos, san-miguel, santa-anita,
el-agustino, la-molina, santiago-de-surco, san-juan-de-miraflores, carabayllo, ate.

Ya están registrados en `CATASTRO_FILES`: basta colocar el `.gz` convertido en
esta carpeta para que se activen automáticamente (sin tocar el HTML).
