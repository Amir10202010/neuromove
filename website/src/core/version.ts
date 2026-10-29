// Версии пишутся в каждый сеанс: улучшили формулу — старые тесты можно пересчитать
// из сырых данных и понять, какой версией посчитано старое число (софт.md, раздел 4).

/** Меняется при любой правке формул в src/core. 0.2.0 — локоть в плоскости шарнира (docs/ENGINEERING_10H, F1). */
export const ALGORITHM_VERSION = 'nm-core 0.2.0';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
