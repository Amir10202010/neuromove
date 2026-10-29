# Схема подключения стенда NeuroMove: купленная плата ESP32 DevKit (30 выводов) и три GY-521.
# Выводы платы и датчика — как на фото товаров (Kaspi, 9 октября 2026); шины — как в
# NeuroMoveStand/config.h: шина 0 — D21 (SDA) и D22 (SCL), шина 1 — D32 (SDA) и D33 (SCL).
#
# Пересобрать картинку из папки firmware на маке:
#   python3 схема-подключения.py схема-подключения.svg
#   "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1300,1090 \
#     --screenshot="$PWD/схема-подключения.png" "file://$PWD/схема-подключения.svg"
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "схема-подключения.svg"
W, H = 1300, 1090
FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"

RED, BLACK, GREEN, GRAY, ORANGE = "#e03131", "#212529", "#2f9e44", "#868e96", "#f08c00"
out = []
add = out.append


def text(x, y, s, size=14, fill="#212529", anchor="start", weight="normal", extra=""):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
        f'font-weight="{weight}" {extra}>{s}</text>')


def line(x1, y1, x2, y2, color, width=3):
    add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
        f'stroke-width="{width}" stroke-linecap="round"/>')


def path(d, color, width=3, extra=""):
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
        f'stroke-linecap="round" stroke-linejoin="round" {extra}/>')


def cable(d):
    # Кабель: серая оболочка с тёмным краем
    path(d, "#9aa1a9", 22)
    path(d, "#d3d8de", 17)


# ── Плата ESP32 DevKit ─────────────────────────────────────────────────────────
BX, BY, BW, BH = 520, 150, 260, 620
LX, RX = 546, 754
LEFT = ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"]
RIGHT = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "D17", "D16", "D4", "D2", "D15", "GND", "3V3"]
USED_L = {"D32": GREEN, "D33": GRAY, "GND": BLACK}
USED_R = {"D22": GRAY, "D21": GREEN, "GND": BLACK, "3V3": RED}


def row_y(i):
    return 330 + 29 * i


def ly(name):
    return row_y(LEFT.index(name))


def ry(name):
    return row_y(RIGHT.index(name))


# ── Датчик GY-521: выводы вдоль верхнего края, слева направо — как на фото товара
MOD_W, MOD_H = 250, 162
MOD_PINS = ["INT", "AD0", "XCL", "XDA", "SDA", "SCL", "GND", "VCC"]


def pin_x(mx, k):
    return mx + 25 + 28.6 * k


def module(mx, my, title, sub, ad0_to):
    py = my + 22
    add(f'<rect x="{mx}" y="{my}" width="{MOD_W}" height="{MOD_H}" rx="8" fill="#2457a6" stroke="#173b75" stroke-width="2"/>')
    # Перемычка AD0 — до отверстий, чтобы кольца отверстий легли поверх её концов
    a = pin_x(mx, 1)
    t = pin_x(mx, MOD_PINS.index(ad0_to))
    path(f"M{a:.1f},{py} L{a + 13:.1f},{py + 10} L{a + 13:.1f},{py + 36} L{t + 13:.1f},{py + 36} "
         f"L{t + 13:.1f},{py + 10} L{t:.1f},{py}", ORANGE, 3.5)
    for k, name in enumerate(MOD_PINS):
        x = pin_x(mx, k)
        add(f'<circle cx="{x:.1f}" cy="{py}" r="7" fill="#d4a72c"/>')
        add(f'<circle cx="{x:.1f}" cy="{py}" r="3" fill="#173b75"/>')
        used = name in ("SDA", "SCL", "GND", "VCC", "AD0")
        text(x, py + 23, name, 11, "#ffffff" if used else "#9fb6e0", "middle", "bold" if used else "normal")
    # Чип
    add(f'<rect x="{mx + 192}" y="{my + 72}" width="44" height="44" rx="3" fill="#15181c"/>')
    text(mx + 214, my + 132, "MPU-6050", 10, "#dbe4ff", "middle")
    text(mx + 20, my + 88, f"перемычка AD0 → {ad0_to}", 12, "#ffd8a8", weight="bold")
    text(mx + 20, my + 120, title, 17, "#ffffff", weight="bold")
    text(mx + 20, my + 142, sub, 13, "#dbe4ff")


def fan(ax, ay, mx, my):
    # Четыре жилы от конца кабеля к отверстиям SDA, SCL, GND, VCC модуля
    py = my + 22
    for name, color in (("SDA", GREEN), ("SCL", GRAY), ("GND", BLACK), ("VCC", RED)):
        line(ax, ay, pin_x(mx, MOD_PINS.index(name)), py, color)


UPPER = (930, 190)
FORE = (930, 470)
CHEST = (80, 560)

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">')
add(f'<rect width="{W}" height="{H}" fill="#fbfaf7"/>')
text(40, 52, "Схема подключения стенда: ESP32 DevKit и три датчика GY-521", 25, weight="bold")
text(40, 81, "Купленная плата: ESP32-WROOM-32, CH340C, USB Type-C, 30 выводов. Вид сверху, чипы к нам — как на фото товара.", 15, "#495057")

# ── Концы кабелей: A — у платы, B — у датчика. У датчика жилы расходятся веером к отверстиям
ARM_A, ARM_B = (850, 545), (1112, 120)
FORE_B = (1112, 432)
CH_A, CH_B = (450, 600), (262, 505)
fan(ARM_B[0], ARM_B[1], *UPPER)
fan(FORE_B[0], FORE_B[1], *FORE)
fan(CH_B[0], CH_B[1], *CHEST)

# ── Плата
add(f'<rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" rx="12" fill="#1d2430" stroke="#0d1117" stroke-width="2"/>')
add(f'<rect x="565" y="170" width="170" height="120" rx="4" fill="#c8ccd2" stroke="#8a9099" stroke-width="2"/>')
path("M585,186 L600,186 L600,198 L615,198 L615,186 L630,186 L630,198 L645,198", "#8a9099", 2)
text(650, 245, "ESP32-WROOM-32", 14, "#3a3f45", "middle", "bold")
add('<rect x="622" y="596" width="56" height="40" rx="3" fill="#0d1117" stroke="#3a4250"/>')
text(650, 621, "CH340C", 11, "#9aa5b1", "middle")
for bx, label in ((627, "EN"), (673, "BOOT")):
    add(f'<rect x="{bx - 9}" y="664" width="18" height="18" rx="3" fill="#c8ccd2"/>')
    text(bx, 697, label, 10, "#9aa5b1", "middle")
for i in range(15):
    y = row_y(i)
    for name, x, used, anchor, tx in ((LEFT[i], LX, USED_L, "start", LX + 16), (RIGHT[i], RX, USED_R, "end", RX - 16)):
        if name in used:
            add(f'<circle cx="{x}" cy="{y}" r="11" fill="none" stroke="{used[name]}" stroke-width="4"/>')
        add(f'<circle cx="{x}" cy="{y}" r="7" fill="#d4a72c"/>')
        add(f'<circle cx="{x}" cy="{y}" r="3" fill="#1d2430"/>')
        text(tx, y + 5, name, 13, "#ffffff" if name in used else "#8b96a3", anchor, "bold" if name in used else "normal")

# ── Жилы у платы рисуются поверх неё: каждая выходит из своего вывода горизонтально
# и только за краем платы сходится в кабель — видно, какая жила к какому выводу
for name, color in USED_R.items():
    path(f"M{RX},{ry(name)} L805,{ry(name)} L{ARM_A[0]},{ARM_A[1]}", color)
for name, color in USED_L.items():
    path(f"M{LX},{ly(name)} L495,{ly(name)} L{CH_A[0]},{CH_A[1]}", color)
# Красная жила груди — из того же гнезда 3V3, поверх низа платы
path(f"M{RX},{ry('3V3')} L736,757 L505,757 L{CH_A[0]},{CH_A[1]}", RED, 3)

# Кабели плеча и предплечья начинаются в одном месте у платы: их жилы спаяны в общих гнёздах
cable(f"M{ARM_A[0]},{ARM_A[1]} L{ARM_A[0] + 34},{ARM_A[1]} L{ARM_A[0] + 34},{FORE_B[1] - 12} L{FORE_B[0]},{FORE_B[1] - 12} L{FORE_B[0]},{FORE_B[1]}")
cable(f"M{ARM_A[0]},{ARM_A[1]} L{ARM_A[0]},95 L{ARM_B[0]},95 L{ARM_B[0]},{ARM_B[1]}")
text(828, 410, "кабель плеча: 4 жилы, около 60 см", 14, "#495057", extra='transform="rotate(-90 828 410)"')
text(1000, 404, "кабель предплечья: около 90 см", 14, "#495057", "middle")
cable(f"M{CH_A[0]},{CH_A[1]} L{CH_A[0]},{CH_B[1]} L{CH_B[0]},{CH_B[1]}")
text(356, 490, "кабель груди: 4 жилы, около 50 см", 14, "#495057", "middle")

# USB к ноутбуку
add('<rect x="622" y="770" width="56" height="22" rx="4" fill="#aab0b7" stroke="#6c737b" stroke-width="2"/>')
line(650, 792, 650, 845, "#4a4f55", 9)
text(668, 842, "к ноутбуку: кабель USB-A → USB-C с передачей данных", 14, "#495057")

# Подпись к гнезду 3V3
text(794, 796, "3V3: в одно гнездо — красные жилы", 13, RED, weight="bold")
text(794, 814, "плеча, предплечья и груди", 13, RED, weight="bold")
for i, s_ in enumerate(("Кабели плеча и предплечья", "соединяются у платы: в гнёздах", "D21, D22 и GND — по две жилы")):
    text(905, 676 + 18 * i, s_, 13, "#495057")

# Модули — поверх проводов
module(*UPPER, "Плечо", "шина 0 · адрес 0x68", "GND")
module(*FORE, "Предплечье", "шина 0 · адрес 0x69", "VCC")
module(*CHEST, "Грудь", "шина 1 · адрес 0x68", "GND")

# ── Легенда и правила
add('<line x1="40" y1="875" x2="1260" y2="875" stroke="#dee2e6" stroke-width="2"/>')
legend = [(RED, "красная — 3V3, питание"), (BLACK, "чёрная — GND, земля"), (GREEN, "зелёная — SDA, данные"),
          (GRAY, "белая (на схеме серая) — SCL, такт"), (ORANGE, "оранжевая — перемычка AD0 на самом модуле")]
for i, (color, label) in enumerate(legend):
    y = 905 + 26 * i
    line(40, y - 5, 80, y - 5, color, 5)
    text(92, y, label, 14)
text(40, 1045, "Цвет жил любой — главное, одинаково на обоих концах кабеля.", 13, "#6c757d")

notes = [
    "Гребёнки к модулям не паять: провода — прямо в отверстия. Корпус рассчитан на плоскую плату.",
    "AD0 не оставлять висящим: у плеча и груди — к GND, у предплечья — к VCC.",
    "На выводы платы — гнёзда от разрезанных проводов мама-мама. VIN, XDA, XCL, INT не подключать.",
    "Проверка: монитор порта 460 800 бод, команда scan. Должно быть:",
    "шина 0 (SDA 21, SCL 22): 0x68 0x69 · шина 1 (SDA 32, SCL 33): 0x68",
]
for i, s in enumerate(notes):
    text(520, 905 + 28 * i, s, 14, "#212529", weight="bold" if i == 4 else "normal")

add("</svg>")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
print("ok", OUT)
