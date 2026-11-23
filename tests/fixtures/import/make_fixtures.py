# Genera los archivos de prueba de importación de documentos (tests/import-documents.spec.js).
# Uso: python3 make_fixtures.py <salida> <carpeta temporal>  (requiere Pillow, python-docx y python-pptx)
# El PDF se imprime después con make_pdf.js a partir de <carpeta temporal>/doc.html.
import io, base64, sys
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches
from pptx import Presentation
from pptx.util import Inches as PInches, Pt

OUT = sys.argv[1]
SCR = sys.argv[2]

def photo(color, label, size=(480, 360)):
    im = Image.new('RGB', size, color)
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, size[0]-20, size[1]-20], outline=(255, 255, 255), width=6)
    d.text((40, 40), label, fill=(255, 255, 255))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80); return b.getvalue()

def logo():
    im = Image.new('RGB', (48, 48), (200, 30, 30))
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

def scan_page():
    # Página "escaneada": el texto es parte de la imagen, no hay capa de texto.
    im = Image.new('RGB', (900, 500), (250, 250, 245))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
    except Exception:
        f = ImageFont.load_default()
    for i, line in enumerate(['TERRENO EN VENTA - LURIN', 'Lote de 500 m2', 'Precio: US$ 90,000', 'Zonificacion residencial']):
        d.text((40, 40 + i * 70), line, fill=(20, 20, 20), font=f)
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

sala, cocina, fachada, playa = photo((60, 90, 160), 'SALA'), photo((160, 90, 60), 'COCINA'), photo((60, 140, 80), 'FACHADA'), photo((40, 120, 170), 'PLAYA')
open(f'{SCR}/sala.jpg', 'wb').write(sala); open(f'{SCR}/cocina.jpg', 'wb').write(cocina)
open(f'{SCR}/fachada.jpg', 'wb').write(fachada); open(f'{SCR}/logo.png', 'wb').write(logo())
open(f'{SCR}/scan.png', 'wb').write(scan_page()); open(f'{SCR}/playa.jpg', 'wb').write(playa)

# HTML para el PDF (lo imprime Chromium)
b64 = lambda p, mime: f'data:{mime};base64,' + base64.b64encode(open(p, 'rb').read()).decode()
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:sans-serif}} .pg{{page-break-after:always}} img.f{{width:320px}} img.l{{width:24px}}</style></head><body>
<div class="pg"><img class="l" src="{b64(SCR+'/logo.png','image/png')}"> <b>Inmobiliaria Demo</b>
<h2>Dpto. en Miraflores - Vta.</h2><p>Av. Larco 1150, piso 8. 3 dorm., 2 baños, 1 cochera. Área techada 85 m2.
Precio US$ 185,000. Estado: a estrenar. Vista al mar, gimnasio y piscina del edificio. Cel 987654321</p>
<img class="f" src="{b64(SCR+'/sala.jpg','image/jpeg')}"> <img class="f" src="{b64(SCR+'/cocina.jpg','image/jpeg')}"></div>
<div class="pg"><h2>Casa en La Molina - Alq.</h2><p>Calle Los Pinos 120. Terreno 300 m2, techada 250 m2, 2 pisos. 4 dorm.
S/ 6,500 mensual. E/C (entrega en marzo).</p><img class="f" src="{b64(SCR+'/fachada.jpg','image/jpeg')}"></div>
<div><img style="width:700px" src="{b64(SCR+'/scan.png','image/png')}"></div>
</body></html>'''
open(f'{SCR}/doc.html', 'w').write(html)

# DOCX
doc = Document()
doc.add_heading('Inventario Inmobiliaria Demo', 1)
doc.add_paragraph().add_run().add_picture(f'{SCR}/logo.png', width=Inches(0.3))
doc.add_heading('Depa en San Isidro', 2)
doc.add_paragraph('Calle Las Begonias 450. Venta. 2 dorm, 2 baños. 95 m2 techados. Precio US$ 260 mil. Ascensor: sí.')
t = doc.add_table(rows=2, cols=3)
for i, (a, b) in enumerate([('Estacionamientos', '1'), ('Antigüedad', '2015')]):
    t.cell(i, 0).text = a; t.cell(i, 1).text = b
doc.add_paragraph().add_run().add_picture(f'{SCR}/sala.jpg', width=Inches(3))
doc.add_page_break()
doc.add_heading('Local comercial en Surquillo', 2)
doc.add_paragraph('Av. Angamos 1200. Alquiler. 60 m2. S/. 4,800. Preventa no aplica.')
doc.add_paragraph().add_run().add_picture(f'{SCR}/fachada.jpg', width=Inches(3))
doc.save(f'{OUT}/inventario.docx')

# PPTX
prs = Presentation()
blank = prs.slide_layouts[6]
s1 = prs.slides.add_slide(blank)
tb = s1.shapes.add_textbox(PInches(0.5), PInches(0.3), PInches(9), PInches(1.5)).text_frame
tb.text = 'Casa de playa en Punta Hermosa'
p = tb.add_paragraph(); p.text = 'Venta · US$ 420,000 · Terreno 400 m2 · Techada 280 m2 · 5 dorm · 4 baños · Pet friendly'
s1.shapes.add_picture(f'{SCR}/playa.jpg', PInches(0.5), PInches(2), width=PInches(4))
s1.shapes.add_picture(f'{SCR}/logo.png', PInches(9), PInches(6.8), width=PInches(0.4))
s1.notes_slide.notes_text_frame.text = 'Nota: incluye 2 estacionamientos.'
s2 = prs.slides.add_slide(blank)
tb2 = s2.shapes.add_textbox(PInches(0.5), PInches(0.3), PInches(9), PInches(1.5)).text_frame
tb2.text = 'Of. en San Isidro - Alq.'
p = tb2.add_paragraph(); p.text = 'Av. Camino Real 390, piso 12 · 120 m2 · US$ 3,200 · En const.'
s2.shapes.add_picture(f'{SCR}/cocina.jpg', PInches(0.5), PInches(2), width=PInches(4))
prs.save(f'{OUT}/inventario.pptx')
print('ok')

# Chat de WhatsApp exportado desde Android con fotos (.zip) y desde iPhone (.txt)
import zipfile
android = """24/10/26, 09:12 - Los mensajes y las llamadas están cifrados de extremo a extremo.
24/10/26, 09:15 - Juan Pérez: Buenos días, les comparto inmuebles nuevos
24/10/26, 09:16 - Juan Pérez: IMG-20261024-WA0001.jpg (archivo adjunto)
24/10/26, 09:16 - Juan Pérez: IMG-20261024-WA0002.jpg (archivo adjunto)
24/10/26, 09:17 - Juan Pérez: Dpto en Miraflores, Av. Pardo 500
3 dorm, 2 baños, 110 m2
US$ 240,000. Cel 987654321
24/10/26, 10:02 - María: Interesante! cuánto es el mantenimiento?
25/10/26, 18:40 - Juan Pérez: STK-20261025-WA0003.webp (archivo adjunto)
25/10/26, 18:41 - Juan Pérez: Alquilo local en Surquillo, 60 m2, S/ 4,800
25/10/26, 18:41 - Juan Pérez: IMG-20261025-WA0004.jpg (archivo adjunto)
"""
with zipfile.ZipFile(f'{OUT}/chat-whatsapp.zip', 'w') as z:
    z.writestr('WhatsApp Chat with Corredores.txt', android)
    z.writestr('IMG-20261024-WA0001.jpg', sala)
    z.writestr('IMG-20261024-WA0002.jpg', cocina)
    z.writestr('STK-20261025-WA0003.webp', logo())
    z.writestr('IMG-20261025-WA0004.jpg', fachada)
ios = """[24/10/26, 2:05:33 p. m.] Ana Torres: ‎<adjunto: 00000012-PHOTO-2026-10-24-14-05-33.jpg>
[24/10/26, 2:06:10 p. m.] Ana Torres: Casa en Chorrillos, 4 dorm, terreno 200 m2,
techada 180 m2. Vta. US$ 320 mil
[24/10/26, 2:07:00 p. m.] Ana Torres: ‎imagen omitida
"""
open(f'{OUT}/chat-iphone.txt', 'w').write(ios)
print('chats ok')

# Excel "de corredor": logo y título arriba, títulos en la fila 4, distrito en
# celdas combinadas, una fila vacía, títulos repetidos más abajo, una segunda
# hoja con el mismo formato y una hoja "Instrucciones" que se ignora.
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = 'Ventas'
ws['A1'] = 'INMOBILIARIA DEMO SAC'
ws['A2'] = 'Inventario actualizado al 24/10/2026'
headers = ['Ubicación', 'Sector', 'Tipo inmueble', 'Operación', 'Valor', 'Mts2 const.', 'Dorm', 'Título aviso', 'Comentario']
ws.append([])
for c, h in enumerate(headers, 1):
    ws.cell(row=4, column=c, value=h)
rows = [
    ['Av. Larco 1150', 'Miraflores', 'Dpto.', 'Vta.', 'US$ 185,000', '85 m2', '3 dorm', 'Dpto. con vista', 'A estrenar'],
    ['Calle Berlín 300', None, 'Depa', 'Vta.', 'US$ 210 mil', '95', '3', 'Depa remodelado', 'Cerca al parque'],
]
for r, vals in enumerate(rows, 5):
    for c, v in enumerate(vals, 1):
        ws.cell(row=r, column=c, value=v)
ws.merge_cells('B5:B6')  # "Miraflores" para las dos filas
ws.cell(row=8, column=1, value=None)
for c, h in enumerate(headers, 1):
    ws.cell(row=9, column=c, value=h)  # títulos repetidos
for c, v in enumerate(['Jr. Junín 400', 'Magdalena', 'Casa', 'Alq.', 'S/ 3,500', '120', '4', 'Casa amplia', 'Con patio'], 1):
    ws.cell(row=10, column=c, value=v)
ws2 = wb.create_sheet('Alquileres')
for c, h in enumerate(headers, 1):
    ws2.cell(row=1, column=c, value=h)
for c, v in enumerate(['Av. Angamos 1200', 'Surquillo', 'Local', 'Alquiler', 'S/. 4,800', '60', '0', 'Local en avenida', 'Esquina'], 1):
    ws2.cell(row=2, column=c, value=v)
ws3 = wb.create_sheet('Instrucciones')
ws3['A1'] = 'Esta hoja no tiene inmuebles'
wb.save(f'{OUT}/inventario-corredor.xlsx')
print('excel ok')

# Fotos con EXIF (fecha de captura y GPS) para la agrupación en bloque:
# 2 fotos en Miraflores a las 10:00, 2 en Surco a las 10:05 (lejos: otro
# grupo aunque el tiempo sea cercano) y 1 en Surco a las 11:30 (otro grupo).
from fractions import Fraction
def dms(x):
    x = abs(x); d = int(x); m = int((x - d) * 60); s = round(((x - d) * 60 - m) * 60 * 100)
    return ((d, 1), (m, 1), (s, 100))
def exif_photo(color, when, lat, lng):
    im = Image.new('RGB', (400, 300), color)
    ex = im.getexif()
    ex.get_ifd(0x8769)[0x9003] = when
    gps = ex.get_ifd(0x8825)
    gps[1] = 'S' if lat < 0 else 'N'; gps[2] = tuple(Fraction(a, b) for a, b in dms(lat))
    gps[3] = 'W' if lng < 0 else 'E'; gps[4] = tuple(Fraction(a, b) for a, b in dms(lng))
    b = io.BytesIO(); im.save(b, 'JPEG', exif=ex); return b.getvalue()
import os
os.makedirs(f'{OUT}/fotos-bloque', exist_ok=True)
for name, color, when, lat, lng in [
    ('a1.jpg', (200, 60, 60), '2026:10:20 10:00:00', -12.1211, -77.0297),
    ('a2.jpg', (200, 80, 80), '2026:10:20 10:02:00', -12.1212, -77.0298),
    ('b1.jpg', (60, 60, 200), '2026:10:20 10:05:00', -12.1390, -76.9930),
    ('b2.jpg', (80, 80, 200), '2026:10:20 10:07:00', -12.1391, -76.9931),
    ('c1.jpg', (60, 200, 60), '2026:10:20 11:30:00', -12.1391, -76.9931),
]:
    open(f'{OUT}/fotos-bloque/{name}', 'wb').write(exif_photo(color, when, lat, lng))
print('fotos ok')
