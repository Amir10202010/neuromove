# Как спаять один датчик GY-521: какая жила в какое отверстие, перемычка AD0, пайка в разрезе.
# Порядок выводов и цвета жил — как в сборка-датчиков.md, раздел 2; цвета линий — как
# в схема-подключения.py. Модуль лежит чипом вверх, рядом выводов от себя.
#
# Пересобрать картинку из папки firmware на маке:
#   python3 пайка-датчика.py пайка-датчика.svg
#   "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1300,980 \
#     --screenshot="$PWD/пайка-датчика.png" "file://$PWD/пайка-датчика.svg"
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "пайка-датчика.svg"
W, H = 1300, 980
FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"

RED, BLACK, GREEN, GRAY, ORANGE = "#e03131", "#212529", "#2f9e44", "#868e96", "#f08c00"
MUTED = "#adb5bd"
out = []
add = out.append


def text(x, y, s, size=14, fill="#212529", anchor="start", weight="normal"):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>')


def line(x1, y1, x2, y2, color, width=3):
    add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')


def path(d, color, width=3):
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
text(40, 52, "Пайка одного датчика GY-521", 28, weight="bold")
text(40, 84, "Модуль чипом вверх, рядом выводов от себя. Жилы входят сверху, паять снизу. USB от ноутбука отключён.", 16, "#495057")

# ── Модуль сверху ───────────────────────────────────────────────────────────────
BX, BY, BW, BH = 70, 250, 560, 420  # плата 21 × 16 мм в масштабе
add(f'<rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" rx="14" fill="#1c6dd0" stroke="#174a8b" stroke-width="3"/>')
add(f'<rect x="{BX + BW / 2 - 70}" y="{BY + BH / 2 - 40}" width="140" height="140" rx="8" fill="#212529"/>')
text(BX + BW / 2, BY + BH / 2 + 35, "MPU-6050", 16, "#f8f9fa", "middle", "bold")
text(BX + BW / 2, BY + BH - 22, "сторона с чипом — к крышке корпуса", 14, "#e7f5ff", "middle")

PINS = ["INT", "AD0", "XCL", "XDA", "SDA", "SCL", "GND", "VCC"]
step = (BW - 80) / (len(PINS) - 1)
px = {name: BX + 40 + i * step for i, name in enumerate(PINS)}
py = BY + 38
for name, x in px.items():
    add(f'<circle cx="{x:.1f}" cy="{py}" r="15" fill="#f1c232" stroke="#a37f00" stroke-width="2"/>')
    add(f'<circle cx="{x:.1f}" cy="{py}" r="6" fill="#174a8b"/>')
    text(x, py + 40, name, 15, "#ffffff", "middle", "bold")

# Жилы кабеля — сверху в отверстия; каждая на своей высоте, чтобы не перекрещивались
WIRES = [("SDA", GREEN, "зелёная", 118), ("SCL", GRAY, "белая", 150), ("GND", BLACK, "чёрная", 182), ("VCC", RED, "красная", 214)]
for pin, color, name, top in WIRES:
    x = px[pin]
    path(f"M {x:.1f} {py - 4} L {x:.1f} {top + 24} Q {x:.1f} {top} {x + 24:.1f} {top} L {BX + BW + 60:.1f} {top}", color, 7)
    text(BX + BW + 84, top + 6, f"{name} жила → {pin}", 16, color if color != GRAY else "#495057", weight="bold")
add(f'<rect x="{BX + BW + 52}" y="104" width="22" height="124" rx="6" fill="#9aa1a9"/>')
text(BX + BW + 63, 248, "кабель", 13, "#495057", "middle")

# Перемычка AD0 → GND вдоль ряда (у ПР — к VCC): лежит на плате сверху
x0, x1 = px["AD0"], px["GND"]
path(f"M {x0:.1f} {py - 4} C {x0:.1f} {py - 34} {x1:.1f} {py - 34} {x1 - 4:.1f} {py - 6}", ORANGE, 5)
text(BX + BW / 2, py + 76, "оранжевая — перемычка AD0 → GND; у «ПР» — AD0 → VCC", 15, "#ffd8a8", "middle", "bold")

# Не подключать
for pin in ("INT", "XCL", "XDA"):
    x = px[pin]
    line(x - 9, py - 9, x + 9, py + 9, "#ffffff", 3)
    line(x - 9, py + 9, x + 9, py - 9, "#ffffff", 3)
text(BX, BY + BH + 34, "INT, XCL, XDA — не подключать. Гребёнку не паять: плата должна лечь в корпус плоской.", 15, "#495057")
text(BX, BY + BH + 60, "Если на вашей плате порядок другой — верить надписям у отверстий, а не картинке.", 15, "#495057")

# ── Три модуля ──────────────────────────────────────────────────────────────────
CX, CY = 860, 318
text(CX, CY - 18, "Какой модуль — что паять", 18, weight="bold")
cards = [
    ("П — плечо", "кабель 60 см", "AD0 → GND", "шина 0, адрес 0x68", "в пятницу, первым"),
    ("ПР — предплечье", "кабель 90 см", "AD0 → VCC", "шина 0, адрес 0x69", "в понедельник"),
    ("Г — грудь", "кабель 50 см", "AD0 → GND", "шина 1, адрес 0x68", "в понедельник"),
]
for i, (title, cab, jumper, addr, when) in enumerate(cards):
    y = CY + i * 128
    add(f'<rect x="{CX}" y="{y}" width="400" height="112" rx="10" fill="#f8f9fa" stroke="#dee2e6" stroke-width="2"/>')
    text(CX + 18, y + 32, title, 18, weight="bold")
    text(CX + 18, y + 58, f"{cab} · {addr}", 15, "#495057")
    text(CX + 18, y + 84, jumper, 16, "#c66900", weight="bold")
    text(CX + 382, y + 32, when, 14, "#2f9e44", "end", "bold")

# ── Пайка в разрезе ─────────────────────────────────────────────────────────────
SX, SY = 70, 790
text(SX, SY, "Пайка в разрезе", 18, weight="bold")
add(f'<rect x="{SX}" y="{SY + 60}" width="300" height="22" fill="#1c6dd0"/>')
add(f'<rect x="{SX + 136}" y="{SY + 56}" width="28" height="30" fill="#f1c232"/>')
path(f"M {SX + 150} {SY + 18} L {SX + 150} {SY + 92}", RED, 6)
add(f'<path d="M {SX + 128} {SY + 86} Q {SX + 150} {SY + 112} {SX + 172} {SY + 86} Z" fill="#c0c5cc" stroke="#868e96" stroke-width="2"/>')
line(SX + 118, SY + 103, SX + 182, SY + 103, "#495057", 2)
text(SX + 320, SY + 30, "жила входит сверху, со стороны чипа", 15, "#495057")
text(SX + 320, SY + 76, "плата", 15, "#495057")
text(SX + 320, SY + 110, "снизу — бугорок припоя, хвост откусить вровень:", 15, "#495057")
text(SX + 320, SY + 132, "плата должна лечь на скотч ровно", 15, "#495057")

TX, TY = 860, 724
text(TX, TY, "Каждая точка", 18, weight="bold")
steps = [
    ("Жало 330–350 °C: прижать к колечку и жиле,", "1–2 с, подать припой, убрать. Дольше 4 с — нельзя."),
    ("Точка блестящая, припой затёк в отверстие.", "Соседние не слиплись — особенно SDA и SCL."),
    ("Мультиметр: между VCC и GND — не 0 Ом;", "каждая жила звонится до своего конца кабеля."),
    ("Подёргать кабель: жилы сидят.", "Подписать модуль на обороте: П, ПР или Г."),
]
for i, (a, b) in enumerate(steps):
    text(TX, TY + 34 + i * 54, f"{i + 1}. {a}", 15, "#212529")
    text(TX + 20, TY + 55 + i * 54, b, 15, "#212529")

add("</svg>")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("ok", OUT)
