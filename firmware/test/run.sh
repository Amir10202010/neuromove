#!/bin/sh
# Проверка прошивки на компьютере, без платы. Нужен компилятор C++ (clang++ или g++).
#   test/run.sh                    — проверить
#   UPDATE_GOLDEN=1 test/run.sh    — перезаписать эталон test/golden.csv после намеренной правки формата
set -e
cd "$(dirname "$0")/.."
CXX="${CXX:-c++}"
mkdir -p .pio
# C++11 — как у ядра Arduino-ESP32 2.x: что собралось здесь, соберётся и на плате
"$CXX" -std=c++11 -Wall -Wextra -Werror -O1 -o .pio/host_test test/host_test.cpp
.pio/host_test
# Прежняя разводка: две шины, у предплечья AD0 на 3V3 (config.h, NM_TWO_BUSES)
echo "— то же для двух шин (NM_TWO_BUSES):" >&2
"$CXX" -std=c++11 -Wall -Wextra -Werror -O1 -DNM_TWO_BUSES -o .pio/host_test_two test/host_test.cpp
.pio/host_test_two
