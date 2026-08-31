# Catastro de Lima Metropolitana

Lotes catastrales por distrito, en GeoJSON optimizado + gzip, cargados **bajo
demanda** por el mapa (capa "📐 Catastro", al acercar a zoom ≥ 14).

## Formato
- Un archivo por distrito: `<slug>.geojson.gz` (FeatureCollection de Polygon/LineString).
- Optimización: sin altura (z), coordenadas a 5 decimales (~1 m), minificado y gzip.
- Descompresión en el navegador con `DecompressionStream` (nativo).
- Registro de slugs en `CATASTRO_FILES` dentro de `index.html`.

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

## Pendientes – KML disponible en Drive (12)
Archivos KML > 10 MB; no transferibles por el conector de Drive en CI.
Ya registrados en `CATASTRO_FILES`: basta colocar el `.gz` convertido en
esta carpeta para que se activen automáticamente (sin tocar el HTML).

| Distrito | KML en Drive | Tamaño | Notas |
|---|---|---|---|
| lurin | 150119-LURIN_prod.kml | 7.4 MB | Único bajo 10 MB |
| miraflores | 150122-MIRAFLORES_PROD.kml | 10.0 MB | |
| cercado-de-lima | CERCADO DE LIMA-2/3/4_PROD.kml | 37.4 MB total | 3 archivos, unir features |
| chorrillos | 150108-CHORRILLOS_PROD.kml | 12.1 MB | |
| san-miguel | 150136-SAN MIGUEL_PROD.kml | 13.1 MB | |
| santa-anita | 150137-SANTA ANITA_PROD.kml | 18.0 MB | |
| el-agustino | 150111-EL AGUSTINO_prod.kml | 19.4 MB | |
| la-molina | 150114-LA MOLINA_PROD.kml | 29.5 MB | |
| santiago-de-surco | 150140-SANTIAGO DE SURCO_PROD.kml | 46.1 MB | |
| san-juan-de-miraflores | 150133-SAN JUAN DE MIRAFLORES_prod.kml | 47.3 MB | |
| carabayllo | 150106-CARABAYLLO-1/2_prod.kml | 106.1 MB total | 2 archivos, unir features |
| ate | 150103-ATE-1/2_PROD.kml | 116.8 MB total | 2 archivos, unir features |

## Pendientes – sin KML aún (23 · Lima + Callao)
Registrados en `CATASTRO_FILES` para activación automática futura.
Se necesita obtener el KML fuente de cada distrito.

**Lima Provincia:**
la-victoria, los-olivos, san-juan-de-lurigancho, san-martin-de-porres,
comas, independencia, puente-piedra, villa-el-salvador, villa-maria-del-triunfo,
chaclacayo, pachacamac, cieneguilla, ancon, santa-rosa, lurigancho, pucusana,
santa-maria-del-mar.

**Callao Provincia:**
bellavista, la-perla, la-punta, ventanilla, carmen-de-la-legua-reynoso, mi-peru.
