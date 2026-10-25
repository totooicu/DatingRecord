// 「功能体验 → 软件适配测试」独立子页。
//
// 这一页是从 geckoview_example 那套壳的 assets/test.html 搬过来的：那边是一个纯 HTML
// 测试页，用 window.postMessage 跟原生桥说话；这里保留同样的协议与检查项，换成
// 本项目的卡片样式，再把「本软件自己依赖什么」补成一卡——适配一个新壳时，先看
// WebAssembly / IndexedDB / Service Worker 在不在，比逐项点原生能力更快定位问题。
//
// 哪些项目靠桥、哪些靠标准 API，卡片说明里写清楚了：桥断了但标准 API 正常，问题在
// 壳的注入；两边都断，先查系统权限或页面是不是被降级成非安全上下文。
import { useCallback, useEffect, useState } from 'react';

import { engineInfo, pingBridge, type EngineInfo } from '../../core/compat/bridge';
import { LabHead } from './LabEdgeSection';
import { setTestResult } from '../compat/report';
import { CompatCard, CompatRow, CompatStatus, CompatSummary, type StatusState } from '../compat/ui';
import { BleCentralCard, BlePeripheralCard } from '../compat/BleCards';
import { FilePrivateCard, FilePublicCard } from '../compat/FileCards';
import { GeoCard, MicCard } from '../compat/MediaCards';
import { ScreenCard } from '../compat/ScreenCard';

/* ---------------- 引擎信息 ---------------- */

function EngineCard() {
  const [info, setInfo] = useState<EngineInfo>(engineInfo);

  const refresh = () => {
    const next = engineInfo();
    setInfo(next);
    setTestResult('engine', 'ok', next.gecko ? 'Gecko 内核' : '非 Gecko 内核');
  };

  useEffect(() => {
    const next = engineInfo();
    setInfo(next);
    setTestResult('engine', 'ok', next.gecko ? 'Gecko 内核' : '非 Gecko 内核');
  }, []);

  return (
    <CompatCard
      title="引擎信息"
      desc="UA 决定有没有 Gecko 专属能力；SecureContext 为「否」时麦克风、定位、剪贴板多半都不可用。"
      right={
        <button className="btn" onClick={refresh}>
          刷新
        </button>
      }
    >
      <dl className="compat-kv">
        <dt>UserAgent</dt>
        <dd className="compat-ua">{info.ua || '(空)'}</dd>
        <dt>SecureContext</dt>
        <dd className={info.secure ? 'compat-ok-text' : 'compat-err-text'}>{info.secure ? '是' : '否'}</dd>
        <dt>Gecko 内核</dt>
        <dd>{info.gecko ? '是' : '否（Chromium / WebKit 系）'}</dd>
        <dt>Android</dt>
        <dd>{info.android ? '是' : '否'}</dd>
        <dt>显示模式</dt>
        <dd>
          {info.displayMode}
          {info.standalone ? '（独立窗口）' : '（浏览器标签）'}
        </dd>
      </dl>
    </CompatCard>
  );
}

/* ---------------- 原生桥 ---------------- */

function BridgeCard() {
  const [state, setState] = useState<StatusState>('idle');
  const [text, setText] = useState('未检查');

  const check = useCallback(async () => {
    setState('wait');
    setText('正在 ping 桥…');
    try {
      const r = await pingBridge();
      setState('ok');
      setText(`桥已连接 ✓ ${JSON.stringify(r)}`);
      setTestResult('bridge', 'ok', '已连接');
    } catch (e) {
      setState('err');
      setText(`桥未连接：${(e as Error).message}`);
      setTestResult('bridge', 'err', 'ping 超时 / 无应答');
    }
  }, []);

  // 和原作一样进来就自动查一次；3 秒的 ping 超时足够判断「对面没接话」
  // （不问「是不是在壳里」——只问这条 postMessage 桥通不通）
  useEffect(() => {
    const t = setTimeout(() => void check(), 600);
    return () => clearTimeout(t);
  }, [check]);

  return (
    <CompatCard
      title="原生桥状态"
      desc="蓝牙 / 文件 / 录屏都走这条 postMessage 桥。在普通浏览器里没人接话，显示「未连接」是正常的。"
      right={
        <button className="btn" onClick={() => void check()}>
          检查桥
        </button>
      }
    >
      <CompatStatus state={state} text={text} />
    </CompatCard>
  );
}

/* ---------------- 应用依赖 ---------------- */

interface DepItem {
  label: string;
  ok: boolean;
  note: string;
}

/** 本软件自己离不开的几样；任何一条 ✗ 都说明这个壳里跑不全 */
async function checkDeps(): Promise<DepItem[]> {
  const items: DepItem[] = [];

  let wasm = false;
  try {
    wasm = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch {
    wasm = false;
  }
  items.push({ label: 'WebAssembly', ok: wasm, note: wasm ? 'sql.js 能实例化' : 'sql.js 起不来，库打不开' });

  const idb = typeof indexedDB !== 'undefined';
  items.push({ label: 'IndexedDB', ok: idb, note: idb ? '库文件落盘用' : '库无法持久化' });

  const blob = typeof Blob === 'function' && typeof URL.createObjectURL === 'function';
  items.push({ label: 'Blob 下载', ok: blob, note: blob ? '导出的备份 / 分享包靠它' : '导出会失败' });

  const sw = 'serviceWorker' in navigator;
  const controlled = sw && !!navigator.serviceWorker.controller;
  items.push({
    label: 'Service Worker',
    ok: sw,
    note: sw ? (controlled ? '已接管，可离线' : '可用，但当前页面还没被接管') : '不能离线，每次都要联网',
  });

  const pointer = 'PointerEvent' in window;
  items.push({ label: 'PointerEvent', ok: pointer, note: pointer ? '拖动、点按走指针事件' : '退回触摸事件' });

  let quota = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) {
      const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)}MB`;
      quota = `已用 ${mb(est.usage ?? 0)} / 配额 ${mb(est.quota)}`;
    }
  } catch {
    quota = '查询失败';
  }
  items.push({ label: '存储配额', ok: !!quota && quota !== '查询失败', note: quota || '浏览器没给配额信息' });

  items.push({
    label: '屏幕',
    ok: true,
    note: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
  });

  return items;
}

function DepsCard() {
  const [items, setItems] = useState<DepItem[]>([]);

  const run = useCallback(async () => {
    const list = await checkDeps();
    setItems(list);
    // 只把「跑不跑得起来」的三样算进汇总；SW / 指针之类缺了也不至于不能用
    const core = list.filter((i) => ['WebAssembly', 'IndexedDB', 'Blob 下载'].includes(i.label));
    const missing = core.filter((i) => !i.ok).map((i) => i.label);
    setTestResult('deps', missing.length ? 'err' : 'ok', missing.length ? `缺 ${missing.join('、')}` : '齐全');
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <CompatCard
      title="应用依赖（本软件自检）"
      desc="这几样是这本软件自己离不开的：缺 WebAssembly 打不开库，缺 IndexedDB 存不住，缺 Blob 导不出。"
      right={
        <button className="btn" onClick={() => void run()}>
          重新检测
        </button>
      }
    >
      {items.length === 0 ? (
        <CompatStatus state="wait" text="检测中…" />
      ) : (
        <ul className="compat-deps">
          {items.map((i) => (
            <li key={i.label} className={i.ok ? 'compat-deps-ok' : 'compat-deps-err'}>
              <span className="compat-deps-name">
                {i.label}
                <em>{i.ok ? '✓' : '✗'}</em>
              </span>
              <span className="muted small">{i.note}</span>
            </li>
          ))}
        </ul>
      )}
    </CompatCard>
  );
}

/* ---------------- 页面 ---------------- */

export function LabCompatSection() {
  return (
    <div className="lab-page">
      <LabHead title="软件适配测试" subKey="labCompat" />

      <p className="muted small compat-lead">
        换一台机器、换一个壳（安卓壳的系统 WebView / 浏览器 / 装成 PWA）之后先跑一遍：标准 API 那几张卡不用壳也能测，
        蓝牙 · 文件 · 录屏要靠壳注入的原生桥。测过的项会记在顶部汇总里，离开这一页再回来还在。
      </p>

      <CompatSummary />

      <EngineCard />
      <BridgeCard />
      <DepsCard />
      <MicCard />
      <GeoCard />
      <BleCentralCard />
      <BlePeripheralCard />
      <FilePrivateCard />
      <FilePublicCard />
      <ScreenCard />

      <CompatRow>
        <span className="muted small">
          协议与壳里的 assets/test.html 一致：请求 gv-bridge-request、响应 gv-bridge-response、事件 gv-bridge-event；
          改一边记得同步另一边。
        </span>
      </CompatRow>
    </div>
  );
}
