# Стенд целиком, 27 октября 2026: три датчика в корпусах v3, у каждого кабель DuPont 4 пин «мама–мама» 70 см,
# корпус ESP32 v3 и внутри него — макетная плата с ESP32 и короткие провода «папа–папа».
# Три шины I2C, все датчики на 0x68, AD0 никуда (прошивка по умолчанию, config.h).
#
# Пересобрать картинку из папки firmware на маке:
#   python3 схема-стенда.py
#   "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1600,1300 \
#     --screenshot="$PWD/схема-стенда.png" "file://$PWD/схема-стенда.svg"

FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"
RED, BLACK, GREEN, GRAY, NAVY, BLUE = "#e03131", "#212529", "#2f9e44", "#868e96", "#1f3a5f", "#1c6dd0"
CASE, CASE_EDGE = "#f1f3f5", "#adb5bd"
PINS = ("VCC", "GND", "SCL", "SDA")
COLOR = {"VCC": RED, "GND": BLACK, "SCL": GRAY, "SDA": GREEN}
RIGHT_ROW = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "D17", "D16", "D4", "D2", "D15", "GND", "3V3"]
# Датчик, шина, столбцы макетной платы для SCL и SDA (столбец k — вывод k правого ряда ESP32), ряд
SENSORS = [
    ("П", "плечо", "шина 0 · D21, D22", {"SCL": 2, "SDA": 5}, 0),
    ("ПР", "предплечье", "шина 1 · D19, D18", {"SCL": 7, "SDA": 6}, 1),
    ("Г", "грудь", "шина 2 · D16, D17, программная", {"SCL": 9, "SDA": 10}, 2),
]

W, H = 1600, 1300
out = []
add = out.append


def text(x, y, s, size=14, fill="#212529", anchor="start", weight="normal"):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>')


def rect(x, y, w, h, fill, rx=0, stroke=None, sw=2, opacity=1.0):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" opacity="{opacity}"{st}/>')


def curve(x1, y1, x2, y2, color, width=3, bend=0.5):
    # Провод — кривая: выходит горизонтально, входит сверху
    mx = x1 + (x2 - x1) * bend
    add(f'<path d="M {x1:.1f} {y1:.1f} C {mx:.1f} {y1:.1f} {x2:.1f} {y1:.1f} {x2:.1f} {y2:.1f}" fill="none" '
        f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')


def hcurve(x1, y1, x2, y2, color, width=3):
    mx = (x1 + x2) / 2
    add(f'<path d="M {x1:.1f} {y1:.1f} C {mx:.1f} {y1:.1f} {mx:.1f} {y2:.1f} {x2:.1f} {y2:.1f}" fill="none" '
        f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">')
rect(0, 0, W, H, "#ffffff")
text(40, 52, "Стенд NeuroMove: три датчика, три шины, кабели по 4 жилы", 28, weight="bold")
text(40, 84, "Вид сверху, крышки сняты. Все датчики на адресе 0x68, AD0 никуда. Резисторов нет: подтяжки 4,7 кОм уже стоят на каждом GY-521.", 15, "#495057")

# ── Корпус ESP32 v3 ──────────────────────────────────────────────────────────
HX0, HY0, HX1, HY1 = 560, 140, 1560, 1000
rect(HX0 - 18, HY0 - 18, HX1 - HX0 + 36, HY1 - HY0 + 36, CASE, rx=26, stroke=CASE_EDGE, sw=3)
rect(HX0, HY0, HX1 - HX0, HY1 - HY0, "#ffffff", rx=12, stroke=CASE_EDGE)
text((HX0 + HX1) / 2, HY1 + 48, "корпус ESP32 v3 · 58 × 45 × 32 мм · крышка с дверцей прижимает три кабеля", 15, "#495057", "middle")

# Макетная плата и ESP32
pitch, bx = 50, 690
col_x = [bx + i * pitch for i in range(17)]
row_y = [560 + i * 38 for i in range(5)]
rect(bx - 34, 512, 16 * pitch + 68, 230, "#f8f9fa", rx=10, stroke="#ced4da")
text(bx - 34, 502, "макетная плата 170 точек: в столбце пять дырок a–e соединены", 13, "#868e96")
for i, x in enumerate(col_x):
    text(x, 540, str(i + 1), 11, "#adb5bd", "middle")
for r, y in enumerate(row_y):
    text(bx - 50, y + 5, "abcde"[r], 13, "#868e96", "middle", "bold")
    for x in col_x:
        add(f'<circle cx="{x}" cy="{y}" r="5" fill="#dee2e6"/>')
e = row_y[4]
rect(col_x[0] - 130, e - 22, HX1 - 6 - (col_x[0] - 130), 270, NAVY, rx=12, opacity=0.96)
rect(col_x[0] - 120, e + 60, 180, 150, "#c9c9c9", rx=6)
text(col_x[0] - 30, e + 140, "модуль ESP32", 13, "#495057", "middle")
rect(HX1 - 60, e + 95, 80, 70, "#9a9a9a", rx=6)
text(HX1 - 20, e + 136, "USB", 15, "#ffffff", "middle", "bold")
text(col_x[8], e + 232, "ESP32 воткнута в ряд e правым рядом выводов: D23 в столбец 1, 3V3 в 15. Левый ряд висит, к нему ничего", 13, "#d0ebff", "middle")
used = {"D22", "D21", "D19", "D18", "D17", "D16", "GND", "3V3"}
for i, name in enumerate(RIGHT_ROW):
    on = name in used
    rect(col_x[i] - 8, e - 8, 16, 16, "#f1c232" if on else "#7c6d34", rx=3)
    text(col_x[i], e + 30, name, 12 if on else 10, "#ffffff" if on else "#9fb0c4", "middle", "bold" if on else "normal")

# ── Датчики и кабели ─────────────────────────────────────────────────────────
for k, (letter, place, bus, sig, row) in enumerate(SENSORS):
    sy = 150 + k * 300
    # Корпус датчика v3: 36 × 28 мм, основание с прорезями под ремешок
    cx, cw, ch = 50, 300, 210
    rect(cx - 16, sy - 30, cw + 32, ch + 60, "#e9ecef", rx=18, stroke=CASE_EDGE)
    rect(cx + 40, sy - 22, cw - 80, 12, "#ffffff", rx=4, stroke=CASE_EDGE, sw=1)
    rect(cx + 40, sy + ch + 10, cw - 80, 12, "#ffffff", rx=4, stroke=CASE_EDGE, sw=1)
    rect(cx, sy, cw, ch, CASE, rx=16, stroke=CASE_EDGE, sw=3)
    # Плата GY-521: штырьки к выходу кабеля (вправо), колодка кабеля на VCC, GND, SCL, SDA
    rect(cx + 40, sy + 22, 150, ch - 44, BLUE, rx=8)
    text(cx + 115, sy + 70, letter, 40, "#ffffff", "middle", "bold")
    text(cx + 115, sy + 98, place, 14, "#d0ebff", "middle")
    text(cx + 115, sy + 122, "0x68", 13, "#a5d8ff", "middle")
    rect(cx + 190, sy + 28, 26, ch - 56, "#111111", rx=3)  # колодка
    for j, p in enumerate(PINS):
        py = sy + 52 + j * 30
        text(cx + 184, py + 4, p, 11, "#ffffff", "end", "bold")
        curve(cx + 216, py, cx + cw + 8, sy + ch / 2 - 9 + j * 6, COLOR[p], 3, 0.9)
    text(cx + cw / 2, sy + ch + 48, f"корпус датчика v3 «{letter}» · {bus}", 13, "#495057", "middle")
    # Кабель 70 см — четыре жилы рядом до ложбинки в торце корпуса ESP32
    chy = 330 + k * 60
    for j, p in enumerate(PINS):
        hcurve(cx + cw + 8, sy + ch / 2 - 9 + j * 6, HX0 - 18, chy - 9 + j * 6, COLOR[p], 3)
    # Ложбинка в стенке и буква над ней
    rect(HX0 - 22, chy - 14, 26, 28, "#ffffff", rx=3, stroke=CASE_EDGE, sw=1)
    text(HX0 - 44, chy + 5, letter, 15, "#495057", "end", "bold")
    # Внутри: колодка кабеля и четыре провода папа–папа 10 см в ряд «row» нужных столбцов
    kx = HX0 + 30
    rect(kx, chy - 16, 22, 32 + 0, "#111111", rx=3)
    for j, p in enumerate(PINS):
        hcurve(HX0 + 4, chy - 9 + j * 6, kx, chy - 9 + j * 6, COLOR[p], 3)
        col = 15 if p == "VCC" else 14 if p == "GND" else sig[p]
        hx, hy = col_x[col - 1], row_y[row]
        curve(kx + 22, chy - 9 + j * 6, hx, hy - 6, COLOR[p], 3, 0.55)
        add(f'<circle cx="{hx}" cy="{hy}" r="7" fill="#495057"/>')

text(HX0 + 30, 300, "колодка кабеля → 4 провода папа–папа 10 см", 13, "#495057")
text(455, 230, "кабели 4 пин", 13, "#868e96", "middle")
text(455, 248, "мама–мама 70 см", 13, "#868e96", "middle")

# ── Внизу: что подключено и что купить ───────────────────────────────────────
y0 = 1100
rows = [
    "Ряд a — «П», ряд b — «ПР», ряд c — «Г». Столбец 15 (3V3): VCC всех трёх. Столбец 14 (GND): GND всех трёх. Ряд d закрыт краем ESP32.",
    "SCL и SDA: «П» — столбцы 2 и 5 (D22, D21), «ПР» — 7 и 6 (D18, D19), «Г» — 9 и 10 (D17, D16; на других платах их зовут TX2 и RX2).",
    "Купить: кабель DuPont 4 пин мама–мама 70 см — 3 шт. по 200 ₸; провода папа–папа 10 см — 2 упаковки по 10 шт. по 150 ₸ (нужно 12). Около 900 ₸.",
    "Прошивка: по умолчанию три шины (NeuroMoveStand/config.h). scan: шина 0 — 0x68, шина 1 — 0x68, шина 2 — 0x68.",
    "Цвета жил у купленного кабеля могут быть другими: сверять по месту в колодке — VCC, GND, SCL, SDA, как на датчике.",
]
for i, t in enumerate(rows):
    text(40, y0 + i * 28, t, 14, "#c92a2a" if i == 4 else "#212529")
add("</svg>")
with open("схема-стенда.svg", "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("ok схема-стенда.svg")
