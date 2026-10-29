// Состояние устройства, подключённого вне сеанса (страница «Устройства»),
// — чтобы боковая панель и обзор показывали его так же, как устройство сеанса.

import { create } from 'zustand';
import type { DeviceStatus } from '../devices/types';

export const useDeviceMonitor = create<{ status: DeviceStatus | null; publish(s: DeviceStatus | null): void }>((set) => ({
  status: null,
  publish: (status) => set({ status }),
}));
