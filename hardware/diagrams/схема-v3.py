# Две схемы под покупку 27 октября: кабель DuPont 4 пин «мама–мама» 70 см (на каждом конце одна колодка
# на 4 гнезда, проверено по фото товара на ampermarket.kz) и провода «мама–папа» 40 см.
#
#   схема-1-датчик.svg  — завтрашний тест: один датчик «П», прошивка как есть, без макетной платы
#   стенд целиком на трёх датчиках — схема-стенда.py
#
# Выводы правого ряда ESP32 DevKit (HW-394A, 30 выводов) — от антенны к USB: D23, D22, TX0, RX0, D21, D19,
# D18, D5, TX2, RX2, D4, D2, D15, GND, 3V3. Цвета — как в схема-подключения.py.
#
# Пересобрать картинки из папки firmware на маке:
#   python3 схема-v3.py
#   (для каждого .svg) "/Applications/Google Chrome.website/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1400,1000 \
#     --screenshot="$PWD/схема-1-датчик.png" "file://$PWD/схема-1-датчик.svg"

FONT = "Inter, 'Helvetica Neue', Arial, sans-serif"
RED, BLACK, GREEN, GRAY, ORANGE, NAVY, BLUE = "#e03131", "#212529", "#2f9e44", "#868e96", "#f08c00", "#1f3a5f", "#1c6dd0"
RIGHT_ROW = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "D17", "D16", "D4", "D2", "D15", "GND", "3V3"]
PIN_COLOR = {"VCC": RED, "GND": BLACK, "SCL": GRAY, "SDA": GREEN}


class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.out = w, h, []
        self.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">')
        self.add(f'<rect width="{w}" height="{h}" fill="#ffffff"/>')

    def add(self, s):
        self.out.append(s)

    def text(self, x, y, s, size=14, fill="#212529", anchor="start", weight="normal"):
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>')

    def rect(self, x, y, w, h, fill, rx=0, stroke=None, opacity=1.0):
        st = f' stroke="{stroke}" stroke-width="2"' if stroke else ""
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" opacity="{opacity}"{st}/>')

    def wire(self, x1, y1, x2, y2, color, width=4):
        # Провод — плавная кривая сверху вниз
        my = (y1 + y2) / 2
        self.add(f'<path d="M {x1:.1f} {y1:.1f} C {x1:.1f} {my:.1f} {x2:.1f} {my:.1f} {x2:.1f} {y2:.1f}" fill="none" '
                 f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>')

    def save(self, path):
        self.add("</svg>")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(self.out) + "\n")
        print("ok", path)


def sensor(s, x, y, title, sub, pins=("VCC", "GND", "SCL", "SDA"), w=300):
    """Датчик GY-521 сверху; выводы снизу. Возвращает x каждого вывода."""
    s.rect(x, y, w, 110, BLUE, rx=12)
    s.text(x + w / 2, y + 32, title, 19, "#ffffff", "middle", "bold")
    s.text(x + w / 2, y + 56, sub, 13, "#d0ebff", "middle")
    xs = {}
    # Колодка кабеля на четырёх выводах подряд
    s.rect(x + 34, y + 96, 4 * 50 + 12, 26, "#111111", rx=3)
    for i, p in enumerate(pins):
        px = x + 50 + i * 50
        xs[p] = px
        s.text(px, y + 84, p, 13, "#ffffff", "middle", "bold")
    s.text(x + w - 10, y + 84, "AD0 —", 12, "#a5d8ff", "end")
    return xs


# ── 1. Завтра: один датчик ───────────────────────────────────────────────────────


def one_sensor(path):
    s = Svg(1400, 980)
    s.text(40, 50, "Завтра: один датчик «П», кабель 4 пин мама–мама 70 см прямо на ESP32", 27, weight="bold")
    s.text(40, 82, "Прошивка как есть, макетная плата не нужна. USB отключён, пока подключаешь.", 15, "#495057")
    xs = sensor(s, 520, 120, "П — плечо", "шина 0, адрес 0x68, AD0 никуда")
    # ESP32 сверху: правый ряд выводов по верхнему краю, антенна слева, USB справа
    pitch, x1 = 60, 230
    top = 560
    s.rect(x1 - 120, top - 30, 15 * pitch + 260, 230, NAVY, rx=14)
    s.rect(x1 - 110, top + 55, 230, 125, "#c9c9c9", rx=6)
    s.text(x1 + 5, top + 122, "модуль ESP32", 15, "#495057", "middle")
    s.rect(x1 + 14 * pitch + 70, top + 70, 90, 70, "#9a9a9a", rx=6)
    s.text(x1 + 14 * pitch + 115, top + 112, "USB", 15, "#ffffff", "middle", "bold")
    s.text(x1 + 7 * pitch, top + 180, "ESP32 DevKit, вид сверху: антенна слева, USB справа", 15, "#d0ebff", "middle")
    px = {}
    for i, name in enumerate(RIGHT_ROW):
        x = x1 + i * pitch
        px[name] = x
        used = name in ("3V3", "GND", "D21", "D22")
        s.rect(x - 11, top - 11, 22, 22, "#f1c232" if used else "#8a7a3a", rx=3)
        s.text(x, top + 34, name, 14 if used else 12, "#ffffff" if used else "#a5b4c8", "middle", "bold" if used else "normal")
    links = [("VCC", "3V3"), ("GND", "GND"), ("SCL", "D22"), ("SDA", "D21")]
    for sp, ep in links:
        s.wire(xs[sp], 242, px[ep], top - 14, PIN_COLOR[sp], 5)
        # Гнездо «мама» переходника на выводе ESP32
        s.rect(px[ep] - 9, top - 46, 18, 32, "#111111", rx=3)
    s.text(1040, 205, "колодка на 4 вывода подряд:", 14, "#495057")
    s.text(1040, 225, "VCC, GND, SCL, SDA", 14, "#495057", weight="bold")
    s.text(40, top - 90, "у ESP32 — 4 коротких провода", 14, "#495057")
    s.text(40, top - 70, "мама–папа: «папа» в колодку", 14, "#495057")
    s.text(40, top - 50, "кабеля, «мама» на вывод ESP32", 14, "#495057")
    y0 = 830
    steps = [
        "1. Одна колодка кабеля — на датчик: VCC, GND, SCL, SDA. Ничего не разбирать.",
        "2. Во вторую колодку — «папы» четырёх коротких проводов мама–папа (10–20 см, можно и 40). Их «мамы» — на ESP32:",
        "   VCC на 3V3, GND на GND, SCL на D22, SDA на D21. Стык колодки и переходников обмотать изолентой, чтобы не разошёлся.",
        "3. USB, монитор порта 460800, scan: шина 0 — 0x68. Пошевелить кабель, глядя в монитор: строк «перезапускаю шину» быть не должно.",
        "Цвета жил у купленного кабеля могут быть другими: сверять по месту в колодке, а не по цвету.",
    ]
    for i, t in enumerate(steps):
        s.text(40, y0 + i * 26, t, 14, "#c92a2a" if i == 4 else "#212529")
    s.save(path)


if __name__ == "__main__":
    one_sensor("схема-1-датчик.svg")
