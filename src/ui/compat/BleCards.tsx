// 适配测试：蓝牙两张卡——中心设备（扫描 / 连接 / GATT 读写订阅）与外设（广播 / 提供值）。
//
// 这两项只能走原生桥（Web Bluetooth 在 WebView / GeckoView 里都没有，壳自己实现了 ble.*）。
// 所以这里的失败分两种，状态里要能看出来：桥不通会直接超时，桥通但系统没给权限
// 会返回具体的错误文字。
import { useEffect, useState } from 'react';

import { fromBase64, invoke, onBridgeEvent, toBase64 } from '../../core/compat/bridge';
import { CompatCard, CompatRow, CompatStatus } from './ui';
import { useBridgeStatus } from './useBridgeStatus';

interface BleDevice {
  address: string;
  name?: string;
  rssi?: number;
}

interface CharOption {
  service: string;
  characteristic: string;
  props: string;
}

/** 壳的 ble.services 事件载荷：服务数组，每个带若干特征值 */
interface ServicesPayload {
  services?: { uuid?: string; characteristics?: { uuid?: string; properties?: unknown }[] }[];
}

interface BleEventPayload {
  address?: string;
  value?: string;
  uuid?: string;
  subscribed?: boolean;
}

const short = (uuid?: string) => (uuid ? uuid.slice(4, 8) : '----');

/* ---------------- 中心设备 ---------------- */

export function BleCentralCard() {
  const status = useBridgeStatus('bleCentral', '未测试');
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [chars, setChars] = useState<CharOption[]>([]);
  const [picked, setPicked] = useState('');
  const [payload, setPayload] = useState('hello');

  useEffect(() => {
    const offs = [
      onBridgeEvent('ble.deviceFound', (data) => {
        const d = data as BleDevice;
        if (!d?.address) return;
        setDevices((prev) => (prev.some((x) => x.address === d.address) ? prev : [...prev, d]));
      }),
      onBridgeEvent('ble.connected', (data) => {
        status.ok(`已连接 ${(data as BleEventPayload)?.address ?? ''}，正在发现服务…`);
      }),
      onBridgeEvent('ble.disconnected', () => {
        setChars([]);
        setPicked('');
        status.ok('已断开');
      }),
      onBridgeEvent('ble.services', (data) => {
        const p = data as ServicesPayload;
        const list: CharOption[] = [];
        (p?.services ?? []).forEach((s) => {
          (s.characteristics ?? []).forEach((c) => {
            if (!s.uuid || !c.uuid) return;
            const props = Array.isArray(c.properties) ? c.properties.join(',') : String(c.properties ?? '');
            list.push({ service: s.uuid, characteristic: c.uuid, props });
          });
        });
        setChars(list);
        setPicked(list[0] ? `${list[0].service}|${list[0].characteristic}` : '');
        status.ok(`服务发现完成，共 ${p?.services?.length ?? 0} 个服务、${list.length} 个特征值`);
      }),
      onBridgeEvent('ble.characteristicChanged', (data) => {
        const d = data as BleEventPayload;
        status.ok(`收到通知 ${short(d?.uuid)}：${fromBase64(String(d?.value ?? ''))}`);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
    };
    // status 里的三个回调每次渲染都会重建，这里只在挂载时注册一次：
    // 事件处理只依赖 setState，不需要跟着渲染更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = async (action: string, params: Record<string, unknown> = {}, onOk?: (r: Record<string, unknown>) => string) => {
    status.wait(`${action} …`);
    try {
      const r = await invoke(action, params);
      const shown = onOk ? onOk(r) : JSON.stringify(r);
      status.ok(`${action} ✓ ${shown}`);
      return r;
    } catch (e) {
      status.fail(`${action} 失败：${(e as Error).message}`);
      return null;
    }
  };

  const split = () => picked.split('|');
  const svc = () => split()[0] ?? '';
  const chr = () => split()[1] ?? '';

  return (
    <CompatCard title="蓝牙 · 中心设备（扫描 / 连接 / GATT）" desc="扫描到设备点「连接」，发现服务后读写特征值。">
      <CompatRow>
        <button className="btn" onClick={() => void call('ble.status')}>
          状态
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setDevices([]);
            void call('ble.startScan', {}, () => '扫描中，发现设备会列在下方');
          }}
        >
          开始扫描
        </button>
        <button className="btn" onClick={() => void call('ble.stopScan')}>
          停止扫描
        </button>
      </CompatRow>
      <CompatStatus state={status.state} text={status.text} />

      {devices.length > 0 && (
        <div className="compat-devices">
          {devices.map((d) => (
            <div className="compat-dev" key={d.address}>
              <span className="compat-dev-text">
                {d.name || '(未命名)'}
                <small>
                  <br />
                  {d.address} · RSSI {d.rssi ?? '?'} dBm
                </small>
              </span>
              <button className="btn" onClick={() => void call('ble.connect', { address: d.address })}>
                连接
              </button>
            </div>
          ))}
        </div>
      )}

      {chars.length > 0 && (
        <div className="compat-gatt">
          <CompatRow>
            <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="特征值">
              {chars.map((c) => (
                <option key={`${c.service}|${c.characteristic}`} value={`${c.service}|${c.characteristic}`}>
                  {short(c.service)}/{short(c.characteristic)} [{c.props}]
                </option>
              ))}
            </select>
            <button
              className="btn"
              onClick={() =>
                void call('ble.read', { service: svc(), characteristic: chr() }, (r) => {
                  const b64 = String(r.value ?? '');
                  return `${fromBase64(b64)}（base64: ${b64}）`;
                })
              }
            >
              读
            </button>
            <button
              className="btn"
              onClick={() =>
                void call(
                  'ble.write',
                  { service: svc(), characteristic: chr(), value: toBase64(payload) },
                  () => `已写入「${payload}」`,
                )
              }
            >
              写
            </button>
            <button className="btn" onClick={() => void call('ble.subscribe', { service: svc(), characteristic: chr() })}>
              订阅
            </button>
          </CompatRow>
          <CompatRow>
            <input
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="写入的文本（按 UTF-8 转 base64）"
              aria-label="写入内容"
            />
            <button className="btn" onClick={() => void call('ble.disconnect')}>
              断开
            </button>
          </CompatRow>
        </div>
      )}
    </CompatCard>
  );
}

/* ---------------- 外设 ---------------- */

export function BlePeripheralCard() {
  const status = useBridgeStatus('blePeripheral', '未测试');
  const [name, setName] = useState('GeckoBridge');
  const [serviceUuid, setServiceUuid] = useState('0000ffe0-0000-1000-8000-00805f9b34fb');
  const [charUuid, setCharUuid] = useState('0000ffe1-0000-1000-8000-00805f9b34fb');
  const [value, setValue] = useState('');

  useEffect(() => {
    const offs = [
      onBridgeEvent('ble.peripheral.connected', (data) => {
        status.ok(`中心设备已连接：${(data as BleEventPayload)?.address ?? ''}`);
      }),
      onBridgeEvent('ble.peripheral.disconnected', () => status.ok('中心设备已断开')),
      onBridgeEvent('ble.peripheral.write', (data) => {
        status.ok(`中心写入：${fromBase64(String((data as BleEventPayload)?.value ?? ''))}`);
      }),
      onBridgeEvent('ble.peripheral.subscribed', (data) => {
        status.ok(`中心订阅通知：${(data as BleEventPayload)?.subscribed ? '是' : '否'}`);
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = async (action: string, params: Record<string, unknown> = {}, okText?: string) => {
    status.wait(`${action} …`);
    try {
      await invoke(action, params);
      status.ok(okText ?? `${action} ✓`);
    } catch (e) {
      status.fail(`${action} 失败：${(e as Error).message}`);
    }
  };

  return (
    <CompatCard title="蓝牙 · 外设（广播 / GATT Server）" desc="让本机当作蓝牙外设被别的设备发现，用来验证广播与读写回调。">
      <CompatRow>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="设备名" aria-label="设备名" />
        <input value={serviceUuid} onChange={(e) => setServiceUuid(e.target.value)} placeholder="Service UUID" aria-label="Service UUID" />
      </CompatRow>
      <CompatRow>
        <input value={charUuid} onChange={(e) => setCharUuid(e.target.value)} placeholder="Characteristic UUID" aria-label="Characteristic UUID" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="对外提供的值（文本）" aria-label="对外提供的值" />
      </CompatRow>
      <CompatRow>
        <button
          className="btn btn-primary"
          onClick={() =>
            void call(
              'ble.peripheral.start',
              { name, serviceUuid, charUuid, value: value ? toBase64(value) : '' },
              '广播已启动，等待中心设备连接…',
            )
          }
        >
          开始广播
        </button>
        <button className="btn" onClick={() => void call('ble.peripheral.stop', {}, '已停止广播')}>
          停止
        </button>
        <button
          className="btn"
          onClick={() => void call('ble.peripheral.setValue', { charUuid, value: toBase64(value) }, `值已更新：${value}`)}
        >
          更新值
        </button>
      </CompatRow>
      <CompatStatus state={status.state} text={status.text} />
    </CompatCard>
  );
}
