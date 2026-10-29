# Стенд без пайки: три GY-521 со штырьками, провода мама-папа и макетная плата.
# Макетная плата раздаёт один вывод 3V3, GND, D21 и D22 нескольким датчикам — проводами
# мама-папа это иначе не сделать. Шины и адреса — как в NeuroMoveStand/config.h, прошивку менять
# не нужно: шина 0 (D21, D22) — «П» на 0x68 и «ПР» на 0x69; шина 1 (D32, D33) — «Г» на 0x68.
# Цвета — как в схема-подключения.py.
#
# Пересобрать картинку из папки firmware на маке:
#   python3 схема-без-пайки.py схема-без-пайки.svg
#   "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1300,1000 \
#     --screenshot="$PWD/схема-без-пайки.png" "file://$PWD/схема-без-пайки.svg"
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "схема-без-пайки.svg"
W, H = 1300, 1000
FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"

RED, BLACK, GREEN, GRAY, ORANGE = "#e03131", "#212529", "#2f9e44", "#868e96", "#f08c00"
out = []
add = out.append


def text(x, y, s, size=14, fill="#212529", anchor="start", weight="normal"):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>')


def wire(x1, y1, x2, y2, color, width=4):
    # Провод — плавная кривая от вывода к дырке макетной платы
    mx = (x1 + x2) / 2
    add(f'<path d="M {x1:.1f} {y1:.1f} C {mx:.1f} {y1:.1f} {mx:.1f} {y2:.1f} {x2:.1f} {y2:.1f}" fill="none" '
        f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')


def hole(x, y, used=True):
    add(f'<circle cx="{x}" cy="{y}" r="6" fill="{"#495057" if used else "#ced4da"}"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
text(40, 52, "Без пайки: три датчика через макетную плату", 28, weight="bold")
text(40, 84, "Провода мама-папа: «мама» — на штырёк датчика или платы ESP32, «папа» — в дырку макетной платы. USB отключён, пока собираешь.", 15, "#495057")

# ── Сети на макетной плате ───────────────────────────────────────────────────────
BX0, BX1 = 400, 760
add(f'<rect x="{BX0 - 20}" y="150" width="{BX1 - BX0 + 40}" height="560" rx="12" fill="#f8f9fa" stroke="#ced4da" stroke-width="2"/>')
text((BX0 + BX1) / 2, 140, "макетная плата", 15, "#495057", "middle", "bold")
NETS = [  # имя, цвет, высота, подпись
    ("3V3", RED, 210, "длинная полоса «+» по краю — 3V3"),
    ("GND", BLACK, 280, "длинная полоса «−» по краю — GND"),
    ("SDA0", GREEN, 390, "полоска из 5 дырок — D21, SDA шины 0"),
    ("SCL0", GRAY, 460, "полоска из 5 дырок — D22, SCL шины 0"),
    ("SDA1", GREEN, 570, "полоска из 5 дырок — D32, SDA шины 1"),
    ("SCL1", GRAY, 640, "полоска из 5 дырок — D33, SCL шины 1"),
]
NET_Y = {}
for name, color, y, label in NETS:
    NET_Y[name] = y
    add(f'<line x1="{BX0}" y1="{y}" x2="{BX1}" y2="{y}" stroke="{color}" stroke-width="3" opacity="0.35"/>')
    text(BX0, y - 14, label, 13, "#495057")
HX = {"esp": 420, "П": 560, "Пad": 600, "ПР": 640, "ПРad": 680, "Г": 715, "Гad": 750}

# ── ESP32 ────────────────────────────────────────────────────────────────────────
add('<rect x="40" y="170" width="200" height="500" rx="12" fill="#1f3a5f"/>')
text(140, 205, "ESP32", 20, "#ffffff", "middle", "bold")
text(140, 228, "DevKit", 14, "#d0ebff", "middle")
ESP = [("3V3", "3V3", RED), ("GND", "GND", BLACK), ("D21", "SDA0", GREEN), ("D22", "SCL0", GRAY), ("D32", "SDA1", GREEN), ("D33", "SCL1", GRAY)]
for pin, net, color in ESP:
    y = NET_Y[net]
    add(f'<rect x="222" y="{y - 9}" width="18" height="18" rx="3" fill="#f1c232"/>')
    text(212, y + 5, pin, 15, "#ffffff", "end", "bold")
    wire(240, y, HX["esp"], y, color)
    hole(HX["esp"], y)
text(140, 700, "D21, D22, 3V3 и GND — справа на плате,", 13, "#495057", "middle")
text(140, 718, "D32 и D33 — слева.", 13, "#495057", "middle")
text(140, 736, "Сюда — короткие мама-папа 10–30 см", 13, "#495057", "middle")
text(140, 754, "VIN — только в запасном варианте", 13, "#495057", "middle")

# ── Датчики ──────────────────────────────────────────────────────────────────────
SENS = [
    ("П — плечо", "П", 165, "SDA0", "SCL0", False, "шина 0, адрес 0x68"),
    ("ПР — предплечье", "ПР", 370, "SDA0", "SCL0", True, "шина 0, адрес 0x69"),
    ("Г — грудь", "Г", 575, "SDA1", "SCL1", False, "шина 1, адрес 0x68"),
]
for title, key, top, sda, scl, ad0_high, addr in SENS:
    x0 = 930
    add(f'<rect x="{x0}" y="{top}" width="310" height="170" rx="12" fill="#1c6dd0"/>')
    text(x0 + 155, top + 28, title, 18, "#ffffff", "middle", "bold")
    text(x0 + 155, top + 50, addr, 13, "#d0ebff", "middle")
    pins = [("VCC", "3V3", RED), ("GND", "GND", BLACK), ("SCL", scl, GRAY), ("SDA", sda, GREEN),
            ("AD0", "3V3" if ad0_high else "GND", ORANGE)]
    for i, (pin, net, color) in enumerate(pins):
        y = top + 74 + i * 20
        add(f'<rect x="{x0 - 9}" y="{y - 6}" width="18" height="12" rx="2" fill="#f1c232"/>')
        text(x0 + 16, y + 5, pin, 13, "#ffffff", weight="bold")
        hx = HX[key + "ad"] if pin == "AD0" else HX[key]
        wire(x0 - 9, y, hx, NET_Y[net], color, 3)
        hole(hx, NET_Y[net])
    note = "AD0 → «+»: адрес 0x69" if ad0_high else "AD0 → «−»: адрес 0x68"
    text(x0 + 300, top + 160, note, 13, "#ffd8a8", "end", "bold")

# ── Как собрать ──────────────────────────────────────────────────────────────────
y0 = 790
text(40, y0, "Как собрать", 18, weight="bold")
steps = [
    "1. Кабель к датчику — полоска из 5 проводов мама-папа, не разрывать: четыре на VCC, GND, SCL, SDA подряд, пятый на AD0. Две полоски по 40 см — 80 см.",
    "2. Цвет одной жилы везде один: красная — VCC, чёрная — GND, зелёная — SDA, белая или серая — SCL. Флажок из скотча на обоих концах: П, ПР, Г.",
    "3. Всё воткнуть при отключённом USB. Потом USB, монитор порта 460800, scan: шина 0 — 0x68 0x69, шина 1 — 0x68.",
    "4. Пошевелить каждый кабель, глядя в монитор: строки «перезапускаю шину» — плохой стык. Перемотать изолентой, проверить снова.",
    "Нет макетной платы — только два датчика: «П» на 3V3, GND справа, D21, D22; «Г» на VIN, GND слева, D32, D33.",
    "AD0 у обоих свободен. Перед подключением D32 и D33 замерить у «Г», запитанного от VIN, SDA и SCL относительно GND: около 3,3 В, не 5.",
]
for i, s in enumerate(steps):
    text(40, y0 + 30 + i * 26, s, 14, "#c92a2a" if i >= 4 else "#212529", weight="bold" if i == 4 else "normal")

add("</svg>")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("ok", OUT)
