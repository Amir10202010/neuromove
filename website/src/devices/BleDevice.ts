// Настоящие датчики по Bluetooth LE — способ Б из железо.md: каждый блок сам по себе.
// Web Bluetooth есть в Chrome и Edge; окно выбора открывается только по нажатию кнопки,
// и каждый блок выбирается отдельно (правило браузера).
//
// ⚠️ UUID сервиса и характеристик генерирует прошивка (контракт, софт.md, раздел 1):
// когда Санжар их зафиксирует, вписать в BLE_UUIDS строчными буквами — больше ничего менять не нужно.
// ⚠️ Не проверено на железе. Разбор пакета проверен тестами (contract.test.ts).
// ⚠️ Синхронизация часов блоков (удар о стол в начале теста) ещё не реализована:
//     пока время каждого блока = seq / частота от его собственного старта.

import { parseBlePacket } from './contract';
import { emptyStatus, type DeviceStatus, type NeuroMoveDevice, type Placement, type RawFrame, type Unsubscribe } from './types';

export const BLE_UUIDS = {
  service: '00000000-0000-0000-0000-000000000000', // заменить на uuid4 из прошивки
  data: '00000000-0000-0000-0000-000000000001',
  control: '00000000-0000-0000-0000-000000000002',
  battery: 0x180f,
};
const BLE_RATE_HZ = 50;
const RECONNECT_MAX = 5;

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

interface Block {
  device: BluetoothDevice;
  place: Placement | null;
  control: BluetoothRemoteGATTCharacteristic | null;
  lastSeq: number | null;
}

export class BleDevice implements NeuroMoveDevice {
  readonly kind = 'ble' as const;
  private readonly blocks: Block[] = [];
  private status: DeviceStatus = emptyStatus();
  private streaming = false;
  private readonly statusListeners = new Set<(s: DeviceStatus) => void>();
  private readonly dataListeners = new Set<(f: readonly RawFrame[]) => void>();

  /** Подключить первый блок. Остальные — addBlock(), каждый своим нажатием кнопки. */
  async connect(): Promise<void> {
    await this.addBlock();
  }

  async addBlock(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      this.fail('unsupported', 'Этот браузер не поддерживает Web Bluetooth. Откройте NeuroMove в Chrome или Edge.');
      return;
    }
    this.setStatus({ ...this.status, phase: 'requesting', error: null });
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'NM-' }],
        optionalServices: [BLE_UUIDS.service, BLE_UUIDS.battery],
      });
    } catch {
      this.setStatus({ ...this.status, phase: this.blocks.length ? 'connected' : 'error', error: this.blocks.length ? null : { code: 'cancelled', message: 'Датчик не выбран.' } });
      return;
    }
    // Имя блока: NM-trunk, NM-upper_r … — по нему понятно, где датчик
    const name = device.name?.replace(/^NM-/, '') ?? '';
    const block: Block = { device, place: (name as Placement) || null, control: null, lastSeq: null };
    this.blocks.push(block);
    device.addEventListener('gattserverdisconnected', () => void this.reconnectBlock(block));
    await this.connectBlock(block);
  }

  private async connectBlock(block: Block): Promise<void> {
    this.setStatus({ ...this.status, phase: 'connecting' });
    const server = await block.device.gatt?.connect();
    if (!server) throw new Error('GATT недоступен');
    const service = await server.getPrimaryService(BLE_UUIDS.service);
    const data = await service.getCharacteristic(BLE_UUIDS.data);
    block.control = await service.getCharacteristic(BLE_UUIDS.control).catch(() => null);
    data.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v || !this.streaming) return;
      const pkt = parseBlePacket(v);
      if (!pkt) return;
      block.place = pkt.place;
      let lost = this.status.lost;
      if (block.lastSeq !== null && pkt.seq > block.lastSeq + 1) lost += pkt.seq - block.lastSeq - 1;
      block.lastSeq = pkt.seq;
      this.status = {
        ...this.status,
        received: this.status.received + 1,
        lost,
        sensors: this.status.sensors.map((s) => (s.placement === pkt.place ? { ...s, lowBattery: pkt.lowBattery, online: true } : s)),
      };
      const frame: RawFrame = { seq: pkt.seq, t: pkt.seq / BLE_RATE_HZ, data: { [pkt.place]: pkt.raw } };
      for (const cb of this.dataListeners) cb([frame]);
    });
    await data.startNotifications();
    const battery = await this.readBattery(server);
    const places = this.blocks.map((b) => b.place).filter((p): p is Placement => p !== null);
    this.setStatus({
      ...this.status,
      phase: this.streaming ? 'streaming' : 'connected',
      reconnect: null,
      info: {
        id: 'NM-BLE',
        name: `NeuroMove · ${places.length} блок(а)`,
        kind: 'ble',
        firmware: '–',
        format: 'nm-ble v1',
        rateHz: BLE_RATE_HZ,
        accRangeG: 4,
        gyroRangeDps: 1000,
        placements: places,
        simulated: false,
      },
      sensors: places.map((placement) => {
        const prev = this.status.sensors.find((s) => s.placement === placement);
        return { placement, online: true, battery: placement === block.place ? battery : prev?.battery ?? null, lowBattery: false, link: 1 };
      }),
    });
  }

  private async readBattery(server: BluetoothRemoteGATTServer): Promise<number | null> {
    try {
      const svc = await server.getPrimaryService(BLE_UUIDS.battery);
      const ch = await svc.getCharacteristic(0x2a19);
      return (await ch.readValue()).getUint8(0);
    } catch {
      return null;
    }
  }

  private async reconnectBlock(block: Block): Promise<void> {
    for (let attempt = 1; attempt <= RECONNECT_MAX; attempt++) {
      this.setStatus({ ...this.status, phase: 'reconnecting', reconnect: { attempt, max: RECONNECT_MAX } });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      try {
        await this.connectBlock(block);
        if (this.streaming) await block.control?.writeValue(new Uint8Array([1]));
        return;
      } catch {
        // следующая попытка
      }
    }
    this.fail('connection_lost', `Датчик ${block.place ?? ''} не отвечает. Проверьте заряд и расстояние (до 3 м).`);
  }

  async disconnect(): Promise<void> {
    await this.stop();
    for (const b of this.blocks) b.device.gatt?.disconnect();
    this.blocks.length = 0;
    this.setStatus(emptyStatus());
  }

  async start(): Promise<void> {
    this.streaming = true;
    // control: 1 — начать, 0 — остановить
    for (const b of this.blocks) await b.control?.writeValue(new Uint8Array([1])).catch(() => undefined);
    if (this.status.phase === 'connected') this.setStatus({ ...this.status, phase: 'streaming' });
  }

  async stop(): Promise<void> {
    this.streaming = false;
    for (const b of this.blocks) await b.control?.writeValue(new Uint8Array([0])).catch(() => undefined);
    if (this.status.phase === 'streaming') this.setStatus({ ...this.status, phase: 'connected' });
  }

  getStatus(): DeviceStatus {
    return this.status;
  }

  onStatus(cb: (s: DeviceStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onData(cb: (f: readonly RawFrame[]) => void): Unsubscribe {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  private fail(code: NonNullable<DeviceStatus['error']>['code'], message: string): void {
    this.setStatus({ ...this.status, phase: 'error', reconnect: null, error: { code, message } });
  }

  private setStatus(s: DeviceStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }
}
