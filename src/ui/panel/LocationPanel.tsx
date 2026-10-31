// 功能面板 · 定位。
//
// 页面拆成四个切换区（借 AI 对话页那套分段切换条）：
//   地图 —— 轨迹、蓝点（当前位置）、黄点（文件记录）、红点（选中）
//   记录 —— 打点 / 自动打点 / 阈值 / 点位列表
//   文件 —— 新建 / 选择 / 导入 .drloc（兼容旧 CSV）/ 经纬度偏移修正
//   说明 —— 高德 key 与格式说明
//
// 数据与自动打点定时器在 core/runtime/locationAuto.ts 单例里：
// 离开本页照样打点（服务语义），本页只是订阅式视图 + 地图渲染。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FilePickInput } from '../common';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';
import { bump } from '../../store';
import { createLocation, importLocationText, readLocation } from '../../core/location/locationFile';
import {
  applyOffset,
  effectiveOffsetAt,
  metersBetween,
  metersFromOffset,
  offsetFromMeters,
  refLatOf,
  segmentRange,
  segmentSpeeds,
  type LocationOffset,
  type LocationPoint,
} from '../../core/location/format';
import {
  getAmapKey,
  locateMe as locateOnce,
  nextSampleMs,
  openLocationFile,
  punch,
  removeLocationOffsetSegment,
  removePoint,
  setAmapKey,
  setLocationOffset,
  setLocationOffsetSegment,
  setSampleStrategy,
  setThreshold,
  startAuto,
  stopAuto,
  useLocationAuto,
} from '../../core/runtime/locationAuto';
import type { SampleStrategy } from '../../core/runtime/locationNative';
import { maxTrackSpeed, speedColors, speedLines } from './locationPaint';

// 色号、半径、档位表、格式化函数都在 ./locationPanel/model；
// Leaflet 的图标与箭头在 ./locationPanel/mapKit。本文件只留交互。
import {
  COLOR_CURRENT,
  COLOR_PLAY,
  COLOR_SELECTED,
  DOT_RADIUS,
  HIST_RADIUS,
  LINE_WEIGHT,
  OFFSET_MODES,
  RATE_DOT,
  RATE_TIME,
  STEP_DOT,
  STEP_TIME,
  TABS,
  clockOf,
  exampleLocationName,
  esc,
  fmtMeters,
  fmtSpeed,
  fmtTime,
  type OffsetMode,
  type PlayMode,
  type PlayOrder,
  type TabKey,
} from './locationPanel/model';
import { addArrows, dotIcon, playIcon, pointStyle } from './locationPanel/mapKit';

export function LocationPanel() {
  const la = useLocationAuto();
  const { fileId, fileName, rows, offset, offsets: segments, current, threshold, strategy, streak, running: auto, native, busy } = la;

  const [tab, setTab] = useState<TabKey>('map');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  /** 新建文件名：给一个带日期的示例名当底子，用户改完就是这次的记录（见 exampleLocationName） */
  const [newName, setNewName] = useState(exampleLocationName);
  /** 用户动过输入框就别再拿示例名覆盖他写的东西 */
  const [nameTouched, setNameTouched] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  /** 记录列表里刚定位到哪个点：闪一下，让眼睛跟得上 */
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  /** 位置修正是「三选一」的填法，输入框含义随模式变化 */
  const [offsetMode, setOffsetMode] = useState<OffsetMode>('m');
  /** 修正范围：整份文件（锚点=第 1 个点）/ 从选中点起（写一段分段修正） */
  const [offsetScope, setOffsetScope] = useState<'file' | 'seg'>('file');
  const [offsetA, setOffsetA] = useState('0');
  const [offsetB, setOffsetB] = useState('0');
  const [amapKey, setAmapKeyState] = useState(getAmapKey);
  /** 记录页一次渲染多少条：点可能上万，全量 DOM 会卡 */
  const [listLimit, setListLimit] = useState(300);

  /*
   * 回放。播放头用「游标」表示：按时间时是毫秒时间戳，按点时是点序号（浮点，
   * 便于按速率连续推进）；渲染用的是取整后的点序号 playIdx。
   * 手动步进和自动播放共用同一个游标，所以按一下暂停再按前进，会从原处接着走。
   */
  const [playMode, setPlayMode] = useState<PlayMode>('time');
  const [playOrder, setPlayOrder] = useState<PlayOrder>('fwd');
  /** 速度：按时间 = 秒/秒（1 = 原速），按点 = 点/秒 */
  const [rateTime, setRateTime] = useState(60);
  const [rateDot, setRateDot] = useState(2);
  /** 步长：按时间 = 秒/步，按点 = 点/步 */
  const [stepTime, setStepTime] = useState(10);
  const [stepDot, setStepDot] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  /** 是否已经开始回放过：只有开始后才画高亮和播放头，避免一进地图就多一个紫点 */
  const [playActive, setPlayActive] = useState(false);
  /** 单位 / 顺序 / 步长这些一年调一次的东西收进抽屉，主界面只留进度和播放 */
  const [playMore, setPlayMore] = useState(false);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** 记录列表：地图选中一个点后要靠它把那一行滚进视野 */
  const listRef = useRef<HTMLUListElement | null>(null);
  /** 列表刚为某个点撑大窗口时置位：撑完必须把它滚进视野，否则等于没定位 */
  const wantScrollRef = useRef(false);
  /** 轨迹图层（线 + 历史点）；蓝点单独一层，避免每秒定位重画整条轨迹 */
  const trackRef = useRef<L.LayerGroup | null>(null);
  const pointMarkers = useRef<L.CircleMarker[]>([]);
  const currentMarker = useRef<L.Marker | null>(null);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedIdx;
  /** 已经对哪个文件做过 fitBounds：自动打点持续加点时不再反复缩放 */
  const fittedFile = useRef<string | null>(null);
  /** 选中点追踪最新：记上一帧的点数，发现追加且选中在末尾就跟着走 */
  const prevRowsLen = useRef(rows.length);

  /* 回放的渲染层与计时器：rAF 里只写游标，点序号变化才触发 React 重渲染 */
  const playLayerRef = useRef<L.LayerGroup | null>(null);
  const playLineRef = useRef<L.Polyline | null>(null);
  const playMarkerRef = useRef<L.Marker | null>(null);
  const rafRef = useRef(0);
  const cursorRef = useRef(0);
  const playIdxRef = useRef(0);
  const playingRef = useRef(false);
  const lastFrameRef = useRef(0);
  const lastPaintRef = useRef(0);

  /** 每条记录的时间轴（毫秒）。老 CSV 里解析不出来的时间沿用上一个点，保证单调 */
  const timeline = useMemo(() => {
    const out: number[] = [];
    let last = 0;
    for (const r of rows) {
      const t = Date.parse(r.ts);
      if (Number.isFinite(t)) last = t;
      out.push(last);
    }
    return out;
  }, [rows]);
  const timelineRef = useRef<number[]>([]);
  timelineRef.current = timeline;
  const nPts = rows.length;
  const tFirst = timeline.length > 0 ? timeline[0] : 0;
  const tLast = timeline.length > 0 ? timeline[timeline.length - 1] : 0;

  /** 时间 → 最后一个 ts ≤ 它的点序号（二分；时间游标落在两点之间时停在前一个点上） */
  const idxAtTime = useCallback((ms: number) => {
    const ts = timelineRef.current;
    let lo = 0;
    let hi = ts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= ms) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, []);

  /** 当前模式下的取值范围（游标单位），顺序/逆序决定从哪头开始 */
  const playRange = (mode: PlayMode = playMode): [number, number] =>
    mode === 'time' ? [tFirst, tLast] : [0, Math.max(0, nPts - 1)];

  const idxOfCursor = (cursor: number, mode: PlayMode = playMode) =>
    mode === 'time' ? idxAtTime(cursor) : Math.max(0, Math.min(nPts - 1, Math.round(cursor)));

  const startCursor = (mode: PlayMode = playMode, order: PlayOrder = playOrder) => {
    const [lo, hi] = playRange(mode);
    return order === 'fwd' ? lo : hi;
  };

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlaying(false);
  }, []);

  /** rAF 里读的配置：state 在闭包里会过期，统一走 ref */
  const playCfg = useRef({ mode: playMode, order: playOrder, rateTime, rateDot, lo: 0, hi: 0 });
  playCfg.current = { mode: playMode, order: playOrder, rateTime, rateDot, lo: playRange()[0], hi: playRange()[1] };

  const tick = useCallback(
    (now: number) => {
      if (!playingRef.current) return;
      const c = playCfg.current;
      // 卡顿/切后台回来时限制单帧步长，别一下跳过一大段
      const dt = Math.min(0.25, Math.max(0, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const dir = c.order === 'fwd' ? 1 : -1;
      if (c.mode === 'time') cursorRef.current += dir * Math.max(0, c.rateTime) * 1000 * dt;
      else cursorRef.current += dir * Math.max(0, c.rateDot) * dt;

      let done = false;
      if (dir > 0 && cursorRef.current >= c.hi) {
        cursorRef.current = c.hi;
        done = true;
      } else if (dir < 0 && cursorRef.current <= c.lo) {
        cursorRef.current = c.lo;
        done = true;
      }

      const idx = c.mode === 'time' ? idxAtTime(cursorRef.current) : Math.max(0, Math.min(c.hi, Math.round(cursorRef.current)));
      // 密集轨迹下索引可能每帧都变：重渲染节流到 ~14fps，地图上的移动仍然连贯
      if (idx !== playIdxRef.current && (done || now - lastPaintRef.current > 70)) {
        lastPaintRef.current = now;
        playIdxRef.current = idx;
        setPlayIdx(idx);
      }
      if (done) {
        stopPlayback();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [idxAtTime, stopPlayback],
  );

  const togglePlay = () => {
    if (nPts < 2) return;
    if (playingRef.current) {
      stopPlayback();
      return;
    }
    const [lo, hi] = playRange();
    if (!playActive) cursorRef.current = startCursor();
    // 已经停在这一方向的尽头：再按播放 = 从头来
    if (playOrder === 'fwd' && cursorRef.current >= hi) cursorRef.current = lo;
    if (playOrder === 'rev' && cursorRef.current <= lo) cursorRef.current = hi;
    const idx = idxOfCursor(cursorRef.current);
    playIdxRef.current = idx;
    setPlayIdx(idx);
    setPlayActive(true);
    playingRef.current = true;
    setPlaying(true);
    lastFrameRef.current = performance.now();
    lastPaintRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  };

  /** 手动步进：forward=1 沿播放顺序方向，-1 反向 */
  const stepPlay = (forward: 1 | -1) => {
    if (nPts < 2) return;
    stopPlayback();
    const [lo, hi] = playRange();
    if (!playActive) cursorRef.current = startCursor();
    const dir = (playOrder === 'fwd' ? 1 : -1) * forward;
    const amount = playMode === 'time' ? Math.max(0, stepTime) * 1000 : Math.max(1, Math.round(stepDot));
    cursorRef.current = Math.min(hi, Math.max(lo, cursorRef.current + dir * amount));
    const idx = idxOfCursor(cursorRef.current);
    playIdxRef.current = idx;
    setPlayIdx(idx);
    setPlayActive(true);
  };

  const resetPlay = () => {
    stopPlayback();
    setPlayActive(false);
    playIdxRef.current = 0;
    setPlayIdx(0);
    cursorRef.current = 0;
  };

  /** 换单位时保留「看到哪了」：把游标换算到新单位，而不是回到起点 */
  const switchPlayMode = (mode: PlayMode) => {
    if (mode === playMode) return;
    stopPlayback();
    if (playActive && nPts > 0) {
      const i = idxOfCursor(cursorRef.current);
      cursorRef.current = mode === 'time' ? (timeline[i] ?? tFirst) : i;
    }
    setPlayMode(mode);
  };

  const switchPlayOrder = (order: PlayOrder) => {
    if (order === playOrder) return;
    setPlayOrder(order);
    const [lo, hi] = playRange();
    if (!playActive || nPts < 2) {
      cursorRef.current = startCursor(playMode, order);
      return;
    }
    // 已经在新方向的尽头，就拉回起点，免得按播放毫无反应
    if (order === 'fwd' && cursorRef.current >= hi) cursorRef.current = lo;
    if (order === 'rev' && cursorRef.current <= lo) cursorRef.current = hi;
    const idx = idxOfCursor(cursorRef.current);
    playIdxRef.current = idx;
    setPlayIdx(idx);
  };

  /**
   * 拖进度条 / 跳到首尾：一律先暂停，再定位到某个点序号。
   * 游标按当前模式换算，所以拖完接着按播放是从这一头继续走，不会弹回起点。
   */
  const seekPlay = (idx: number) => {
    if (nPts < 2) return;
    stopPlayback();
    const i = Math.max(0, Math.min(nPts - 1, Math.round(idx)));
    cursorRef.current = playMode === 'time' ? (timeline[i] ?? tFirst) : i;
    playIdxRef.current = i;
    setPlayIdx(i);
    setPlayActive(true);
  };

  /** « / »：按当前播放顺序取「首」「尾」，逆序时两头对调，别按完还停在原地 */
  const jumpPlay = (to: 'start' | 'end') => {
    const last = Math.max(0, nPts - 1);
    const fwd = to === 'start';
    seekPlay(playOrder === 'fwd' ? (fwd ? 0 : last) : fwd ? last : 0);
  };

  // 换文件 / 离开地图页：停止回放，别在后台空转
  useEffect(() => {
    stopPlayback();
    setPlayActive(false);
    playIdxRef.current = 0;
    setPlayIdx(0);
    cursorRef.current = 0;
  }, [fileId, stopPlayback]);
  useEffect(() => {
    if (tab !== 'map') stopPlayback();
  }, [tab, stopPlayback]);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** 参考纬度：按点的平均纬度把米换算成度；没有点就没法换算经度 */
  const refLat = useMemo(() => refLatOf(rows), [fileId, la.rev]);
  /** 目标坐标的锚点：文件第 1 个点（原始坐标）。用固定的起点而不是平均值，补点时才不会偷偷改变目标 */
  const anchor = rows.length > 0 ? { lat: rows[0].lat, lng: rows[0].lng } : null;
  /** 当前选中的原始点（seg 范围的修正锚点） */
  const selRow = selectedIdx != null ? rows[selectedIdx] ?? null : null;

  /** 第 i 个点显示用的坐标：按「整份偏移 + 分段修正」加，原始点不动 */
  const shifted = (p: LocationPoint, i: number): LocationPoint => {
    const o = effectiveOffsetAt(segments, offset, i);
    return o.lat || o.lng ? { ...p, lat: p.lat + o.lat, lng: p.lng + o.lng } : p;
  };

  const selected = selRow ? shifted(selRow, selectedIdx!) : null;
  /** 选中点当前生效的偏移：自己的段 / 继承更早的段 / 整份 offset */
  const segEffective = selectedIdx != null ? effectiveOffsetAt(segments, offset, selectedIdx) : offset;
  /** 选中点自己是不是修正锚点（决定「删除这段」能不能用） */
  const segIsAnchor = selectedIdx != null && segments.some((s) => s.fromIndex === selectedIdx);
  /** 分段修正的显示键：只有段真的变了才重排输入框，免得每秒打点把用户输入冲掉 */
  const segKey = segments.map((s) => `${s.fromIndex}:${s.lat},${s.lng}`).join('|');

  /** 只渲染最近 listLimit 条，避免几千个 DOM 节点拖慢每秒刷新 */
  const shownRows = useMemo(() => {
    const start = Math.max(0, rows.length - listLimit);
    const out: { p: LocationPoint; idx: number }[] = [];
    for (let i = rows.length - 1; i >= start; i -= 1) out.push({ p: shifted(rows[i], i), idx: i });
    return out;
    // offset / rows 都会变，但只切片最近 N 条，成本是 O(N) 而不是 O(总点数)
  }, [rows, offset.lat, offset.lng, segments, listLimit]);

  /**
   * 每个点的累计里程（米），回放时「已走多少」直接查这张表。
   * 用的是修正后的坐标——和地图上画的那条线同一份数据，别一个偏一个不偏。
   */
  const cumMeters = useMemo(() => {
    const pts = applyOffset(rows, offset, segments);
    const out: number[] = new Array(pts.length);
    let acc = 0;
    for (let i = 0; i < pts.length; i += 1) {
      if (i > 0) acc += metersBetween(pts[i - 1], pts[i]);
      out[i] = acc;
    }
    return out;
  }, [rows, offset.lat, offset.lng, segments]);

  /** 列表只渲染最近 listLimit 条：要露出第 idx 条，就得把窗口撑到够得着它 */
  const limitForIdx = (idx: number) => {
    const need = rows.length - idx;
    return Math.max(listLimit, Math.ceil(need / 300) * 300);
  };

  /**
   * 把某个点在列表里露出来：窗口不够就先撑大、标一下要高亮，滚动交给下面的 effect
   * ——撑大窗口之后那一行要等 React 渲染出来才找得到。
   */
  const locateInList = (idx: number) => {
    setListLimit((n) => Math.max(n, limitForIdx(idx)));
    setFlashIdx(idx);
  };

  /** 地图上选中点之后的「在记录里定位」：切到记录页 + 露出来。 */
  const revealInList = (idx: number) => {
    setTab('record');
    locateInList(idx);
  };

  // 选中点变了 / 列表窗口刚撑大：把那一行滚进视野。找不到就先跳过，等下一次渲染再试
  useEffect(() => {
    if (tab !== 'record' || selectedIdx === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    if (!el) {
      const need = limitForIdx(selectedIdx);
      if (need > listLimit) {
        setListLimit(need);
        wantScrollRef.current = true; // 为它撑过窗，撑完就得滚过去
      }
      return;
    }
    // 只有「点了定位」或「刚为它撑过窗」才动滚动条：用户自己在列表里点的行别抢
    if (wantScrollRef.current || flashIdx === selectedIdx) {
      wantScrollRef.current = false;
      // 不用 smooth：几千行的列表滚到那一行要一两秒，高亮 1.6 秒就灭了，等于白闪
      el.scrollIntoView({ block: 'center' });
    }
    // listLimit / rows.length 是这条 effect 的实际驱动量：滚动位置只在列表变化时有意义
  }, [tab, selectedIdx, listLimit, rows.length, flashIdx]);

  // 高亮闪一下就收，别一直挂着像个 bug
  useEffect(() => {
    if (flashIdx === null) return;
    const t = setTimeout(() => setFlashIdx(null), 1600);
    return () => clearTimeout(t);
  }, [flashIdx]);

  // 进「文件」页时，没动过输入框就把示例名刷成当天（隔天再进来能跟着换日期）
  useEffect(() => {
    if (tab === 'file' && !nameTouched) setNewName(exampleLocationName());
  }, [tab, nameTouched]);

  const saveText =
    la.saving === 'saving'
      ? '保存中…'
      : la.saving === 'error'
        ? '保存失败'
        : la.saving === 'saved'
          ? '已保存'
          : '自动保存';

  // 输入框跟当前文件 / 模式同步：文件里只存度数，三种填法互相换算后显示
  useEffect(() => {
    if (refLat == null || !anchor) {
      setOffsetA('0');
      setOffsetB('0');
      return;
    }
    // 分段范围：显示「选中点当前生效的偏移」（自己的段 / 继承 / 全局），锚点是选中的点
    if (offsetScope === 'seg') {
      if (selectedIdx == null || !selRow) {
        setOffsetA('');
        setOffsetB('');
        return;
      }
      if (offsetMode === 'deg') {
        setOffsetA(String(segEffective.lat));
        setOffsetB(String(segEffective.lng));
        return;
      }
      if (offsetMode === 'target') {
        setOffsetA((selRow.lat + segEffective.lat).toFixed(6));
        setOffsetB((selRow.lng + segEffective.lng).toFixed(6));
        return;
      }
      const m = metersFromOffset(segEffective, refLat);
      const fmt = (n: number) => String(Math.round(n * 100) / 100);
      setOffsetA(fmt(m.north));
      setOffsetB(fmt(m.east));
      return;
    }
    if (offsetMode === 'deg') {
      setOffsetA(String(offset.lat));
      setOffsetB(String(offset.lng));
      return;
    }
    if (offsetMode === 'target') {
      // 目标 = 锚点原始坐标 + 偏移
      setOffsetA((anchor.lat + offset.lat).toFixed(6));
      setOffsetB((anchor.lng + offset.lng).toFixed(6));
      return;
    }
    const m = metersFromOffset(offset, refLat);
    const fmt = (n: number) => String(Math.round(n * 100) / 100);
    setOffsetA(fmt(m.north));
    setOffsetB(fmt(m.east));
  }, [
    fileId,
    offset.lat,
    offset.lng,
    refLat,
    offsetMode,
    offsetScope,
    selectedIdx,
    segEffective.lat,
    segEffective.lng,
    anchor?.lat,
    anchor?.lng,
    selRow?.lat,
    selRow?.lng,
    segKey,
  ]);

  useEffect(() => {
    setSelectedIdx(null);
    setListLimit(300);
    setOffsetScope('file');
    fittedFile.current = null;
    prevRowsLen.current = rows.length;
  }, [fileId]);

  // 选中点追踪最新：选中的一直是最后一个点时，新点追加后跟着走，地图也跟着pan
  useEffect(() => {
    const prev = prevRowsLen.current;
    prevRowsLen.current = rows.length;
    if (rows.length > prev && selectedIdx === prev - 1) {
      const i = rows.length - 1;
      setSelectedIdx(i);
      const p = shifted(rows[i], i);
      mapRef.current?.setView([p.lat, p.lng], mapRef.current.getZoom());
    }
  }, [rows.length, selectedIdx]);

  // 初始化地图（只一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // canvas 渲染 + 8px 命中容差：上千个点时 SVG 会卡；小点也要点得中
    const map = L
      .map(containerRef.current, { preferCanvas: true, renderer: L.canvas({ tolerance: 8 }) })
      .setView([30.2741, 120.1551], 12);
    mapRef.current = map;
    L.control.scale({ imperial: false, metric: true }).addTo(map);
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '© 高德地图' },
    ).addTo(map);
    trackRef.current = L.layerGroup().addTo(map);
    // 回放层压在轨迹之上：高亮线和紫色播放头
    playLayerRef.current = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapRef.current = null;
      trackRef.current = null;
      playLayerRef.current = null;
      playLineRef.current = null;
      playMarkerRef.current = null;
      pointMarkers.current = [];
      currentMarker.current = null;
    };
  }, []);

  // 切回地图页时补一次尺寸计算：隐藏期间容器宽高是 0
  useEffect(() => {
    if (tab !== 'map') return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 80);
    return () => clearTimeout(t);
  }, [tab]);

  // 轨迹结构变化才重建（新增 / 删除 / 换文件 / 改偏移 / 改分段修正）；
  // 自动打点去重只改最后一条时间，不会触发这里。选中和蓝点各走各的。
  useEffect(() => {
    const map = mapRef.current;
    const layer = trackRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    pointMarkers.current = [];

    const pts = applyOffset(rows, offset, segments);
    let lines: ReturnType<typeof speedLines> = [];
    if (pts.length > 1) {
      // 按相邻两点的速度分档染色：同档且首尾相接的段合并，最多 7 条 polyline
      lines = speedLines(pts);
      for (const line of lines) {
        L.polyline(line.parts, {
          color: line.color,
          weight: LINE_WEIGHT,
          // 回放时把整条轨迹压暗，让已走过的紫色段显出来
          opacity: playActive ? 0.3 : 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layer);
      }
      // 折线上的方向箭头：按段中点放旋转三角，点密时均摊数量
      addArrows(layer, pts);
    }

    const speeds = segmentSpeeds(pts);
    const lastIdx = pts.length - 1;
    const sel = selectedRef.current;
    pts.forEach((r, i) => {
      const spd = i > 0 ? speeds[i - 1] : null;
      const marker = L
        .circleMarker([r.lat, r.lng], pointStyle(i === sel, i === lastIdx))
        .on('click', () => setSelectedIdx(i))
        .bindPopup(
          `<div><strong>${esc(fmtTime(r.ts))}</strong><br/>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}` +
            `${spd !== null ? `<br/>上一段约 ${fmtSpeed(spd)}` : ''}` +
            `${r.accuracy ? `<br/>±${Math.round(r.accuracy)}m` : ''}${r.note ? `<br/>${esc(r.note)}` : ''}</div>`,
        );
      marker.addTo(layer);
      if (i === sel) marker.bringToFront();
      pointMarkers.current.push(marker);
    });

    // 点和线都画在 canvas 上，DOM 里查不到：把这一帧的结果挂成 data-*，调试和 e2e 都靠它
    const el = map.getContainer();
    el.dataset.locPoints = String(pts.length);
    el.dataset.locDot = String(DOT_RADIUS * 2);
    el.dataset.locHist = String(HIST_RADIUS * 2);
    el.dataset.locLast = pts.length ? String(pts.length - 1) : '';
    el.dataset.locSelected = sel === null ? '' : String(sel);
    el.dataset.locLines = String(lines.length);
    el.dataset.locColors = lines.map((l) => l.color).join(',');

    if (pts.length > 0 && fittedFile.current !== fileId) {
      fittedFile.current = fileId;
      map.fitBounds(L.latLngBounds(pts.map((r) => [r.lat, r.lng] as [number, number])).pad(0.2));
    }
    // rows / offset 是这条 effect 的数据源；用 rev + 偏移值当依赖，避免每秒重画
  }, [la.rev, offset.lat, offset.lng, fileId, segments, playActive]);

  // 选中只换样式，不重建整层（canvas 上没有 zIndexOffset，用 bringToFront）
  useEffect(() => {
    const lastIdx = pointMarkers.current.length - 1;
    pointMarkers.current.forEach((m, i) => {
      m.setStyle(pointStyle(i === selectedIdx, i === lastIdx));
      if (i === selectedIdx) m.bringToFront();
    });
    const el = mapRef.current?.getContainer();
    if (el) el.dataset.locSelected = selectedIdx === null ? '' : String(selectedIdx);
  }, [selectedIdx]);

  // 蓝点属于「现在」，不写进文件；单独更新，自动打点每秒只动它一个
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!current) {
      if (currentMarker.current) {
        map.removeLayer(currentMarker.current);
        currentMarker.current = null;
      }
      return;
    }
    const popup =
      `<div><strong>当前位置</strong><br/>${current.lat.toFixed(6)}, ${current.lng.toFixed(6)}` +
      `${current.accuracy ? `<br/>±${Math.round(current.accuracy)}m` : ''}</div>`;
    if (currentMarker.current) {
      currentMarker.current.setLatLng([current.lat, current.lng]);
      currentMarker.current.setPopupContent(popup);
    } else {
      currentMarker.current = L.marker([current.lat, current.lng], {
        icon: dotIcon(COLOR_CURRENT),
        zIndexOffset: 2000,
      })
        .addTo(map)
        .bindPopup(popup);
    }
  }, [current]);

  // 回放：高亮已走过的轨迹 + 播放头。播放中只在跑出视野时平移，避免每帧抖动
  useEffect(() => {
    const map = mapRef.current;
    const layer = playLayerRef.current;
    if (!map || !layer) return;
    if (!playActive || rows.length === 0) {
      layer.clearLayers();
      playLineRef.current = null;
      playMarkerRef.current = null;
      return;
    }
    const pts = applyOffset(rows, offset, segments);
    const i = Math.max(0, Math.min(playIdx, pts.length - 1));
    const latlng = L.latLng(pts[i].lat, pts[i].lng);
    if (i >= 1) {
      const slice = pts.slice(0, i + 1).map((p) => [p.lat, p.lng] as [number, number]);
      if (playLineRef.current) playLineRef.current.setLatLngs(slice);
      else
        // 比轨迹宽一圈、半透明：白芯点会盖在上面，看到的是「走过的那一段染了色」
        playLineRef.current = L.polyline(slice, {
          color: COLOR_PLAY,
          weight: LINE_WEIGHT * 2.5,
          opacity: 0.75,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layer);
    } else if (playLineRef.current) {
      playLineRef.current.setLatLngs([]);
    }
    if (playMarkerRef.current) playMarkerRef.current.setLatLng(latlng);
    else playMarkerRef.current = L.marker(latlng, { icon: playIcon(), zIndexOffset: 3000 }).addTo(layer);
    if (playing && !map.getBounds().pad(-0.15).contains(latlng)) map.panTo(latlng, { animate: false });
  }, [playActive, playIdx, playing, la.rev, offset.lat, offset.lng, fileId, segments]);

  /** 当前回放状态的展示值：卡在末尾时也别越界 */
  const playIdxClamped = Math.max(0, Math.min(playIdx, nPts - 1));
  const playClock = timeline[playIdxClamped] ?? 0;
  const playRate = playMode === 'time' ? rateTime : rateDot;
  const playStep = playMode === 'time' ? stepTime : stepDot;
  const setPlayRate = (v: number) => (playMode === 'time' ? setRateTime(v) : setRateDot(v));
  const setPlayStep = (v: number) => (playMode === 'time' ? setStepTime(v) : setStepDot(v));

  /** 档位读数：按时间说「几倍速」，按点说「一秒走几个点」 */
  const rateLabel = (v: number) => (playMode === 'time' ? `${v}×` : `${v} 点/s`);
  const stepLabel = (v: number) => (playMode === 'time' ? (v >= 60 ? `${v / 60} 分` : `${v} 秒`) : `${v} 点`);
  const rateOptions = playMode === 'time' ? RATE_TIME : RATE_DOT;
  const stepOptions = playMode === 'time' ? STEP_TIME : STEP_DOT;
  /** 进度条的读数：已走里程、全程里程、百分比（百分比用来把滑条左半边染成播放色） */
  const walkedM = cumMeters[playIdxClamped] ?? 0;
  const totalM = cumMeters.length > 0 ? cumMeters[cumMeters.length - 1] : 0;
  const playPct = nPts > 1 ? (playIdxClamped / (nPts - 1)) * 100 : 0;

  const selectPoint = (idx: number) => {
    setSelectedIdx(idx);
    const p = rows[idx] ? shifted(rows[idx], idx) : null;
    if (p) mapRef.current?.setView([p.lat, p.lng], 16);
    setTab('map');
  };

  const openExisting = async (f: { id: string; name: string }) => {
    try {
      const doc = await readLocation(f.id);
      openLocationFile(f.id, f.name, doc);
      setPicking(false);
      setTab('record');
      toast(`已打开「${f.name}」，${doc.points.length} 个点`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const createNew = async () => {
    try {
      const f = await createLocation({ name: newName.trim() || exampleLocationName() });
      const doc = await readLocation(f);
      openLocationFile(f.id, f.name, doc);
      // 建完把输入框换回当天的示例名：连着建第二个文件时不用重打日期
      setNewName(exampleLocationName());
      setNameTouched(false);
      setTab('record');
      bump();
      toast(`已创建「${f.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const saved = await importLocationText(await f.text(), f.name);
      const doc = await readLocation(saved);
      openLocationFile(saved.id, saved.name, doc);
      setTab('record');
      bump();
      toast(`已导入「${saved.name}」，${doc.points.length} 个点`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const record = async () => {
    if (!fileId) {
      toast('先选或新建一个定位文件');
      setTab('file');
      return;
    }
    try {
      const r = await punch(note);
      setNote('');
      if (r) {
        setSelectedIdx(r.index);
        const p = shifted(r.point, r.index);
        mapRef.current?.setView([p.lat, p.lng], 16);
        toast('已记录并保存');
      }
    } catch (e) {
      toast(`定位失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const locateMe = () => {
    locateOnce()
      .then((fix) => {
        if (fix) mapRef.current?.setView([fix.lat, fix.lng], 16);
        else toast('定位失败');
      })
      .catch(() => toast('定位失败'));
  };

  const removeAt = async (idx: number) => {
    const p = rows[idx] ? shifted(rows[idx], idx) : null;
    if (!p) return;
    if (!window.confirm(`删除第 ${idx + 1} 个点（${fmtTime(p.ts)}）？`)) return;
    try {
      const left = await removePoint(idx);
      if (left == null) {
        toast('这个点已经不存在了');
        return;
      }
      setSelectedIdx((cur) => (cur == null ? null : cur === idx ? null : cur > idx ? cur - 1 : cur));
      toast(`已删除并保存，剩 ${left} 个点`);
    } catch (e) {
      toast(`删除失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const saveOffset = async () => {
    if (!fileId) return;
    if (refLat == null) {
      toast('文件还没有点，先打点再修正位置');
      return;
    }
    if (offsetScope === 'seg' && (selectedIdx == null || !selRow)) {
      toast('先在地图或记录里选中一个点，再填这段的修正');
      return;
    }
    // 目标方式的锚点：整份范围取第 1 个点，分段范围取选中的点
    const anchorPt = offsetScope === 'seg' ? selRow : rows[0];
    let next: LocationOffset;
    if (offsetMode === 'target') {
      const a = offsetA.trim();
      const b = offsetB.trim();
      if (!a && !b) {
        next = { lat: 0, lng: 0 }; // 留空 = 不偏移
      } else if (!a || !b) {
        toast('目标经纬度要一起填，或都留空表示不偏移');
        return;
      } else {
        const lat = Number(a);
        const lng = Number(b);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          toast('目标经纬度要填数字（单位：度）');
          return;
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          toast('目标经纬度超出范围');
          return;
        }
        if (!anchorPt) {
          toast('目标坐标以锚点为准，文件里还没有点');
          return;
        }
        next = { lat: lat - anchorPt.lat, lng: lng - anchorPt.lng };
      }
    } else if (offsetMode === 'deg') {
      const lat = Number(offsetA);
      const lng = Number(offsetB);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast('偏移度数要填数字（单位：度）');
        return;
      }
      next = { lat, lng };
    } else {
      const north = Number(offsetA);
      const east = Number(offsetB);
      if (!Number.isFinite(north) || !Number.isFinite(east)) {
        toast('偏移距离要填数字（单位：米）');
        return;
      }
      next = offsetFromMeters(north, east, refLat);
    }
    try {
      fittedFile.current = null; // 偏移变了，让地图重新框住轨迹
      if (offsetScope === 'seg') {
        await setLocationOffsetSegment(selectedIdx!, next);
        toast(`已写入：从第 ${selectedIdx! + 1} 个点起的轨迹按此偏移修正`);
      } else {
        await setLocationOffset(next);
        toast(
          offsetMode === 'target'
            ? next.lat || next.lng
              ? '已按目标坐标修正并写入文件'
              : '目标留空，偏移已归零'
            : '偏移已写入文件',
        );
      }
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const removeSeg = async (fromIndex: number) => {
    try {
      await removeLocationOffsetSegment(fromIndex);
      fittedFile.current = null;
      toast(`已删除第 ${fromIndex + 1} 点起的修正`);
    } catch (e) {
      toast(`删除失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const clearOffset = async () => {
    if (!fileId) return;
    setOffsetA('0');
    setOffsetB('0');
    try {
      await setLocationOffset({ lat: 0, lng: 0 });
      fittedFile.current = null;
      toast('偏移已归零');
    } catch (e) {
      toast(`保存失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const saveKey = () => {
    setAmapKey(amapKey);
    toast('高德 key 已保存');
  };

  // 图例与地图共用固定彩虹色阶。
  const speedRamp = speedColors().ramp;
  const trackSpeedInfo = useMemo(() => {
    const speeds = segmentSpeeds(applyOffset(rows, offset, segments));
    return { speeds, max: maxTrackSpeed(speeds) };
  }, [la.rev, offset.lat, offset.lng, fileId, segments]);
  const currentSpeed = trackSpeedInfo.speeds[playActive ? playIdxClamped - 1 : trackSpeedInfo.speeds.length - 1] ?? null;

  return (
    <div className="loc-panel">
      <div className="aichat-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'aichat-tab aichat-tab-on' : 'aichat-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'record' && rows.length > 0 && <span className="aichat-tab-n">{rows.length}</span>}
          </button>
        ))}
      </div>

      {/* ---------- 地图 ---------- */}
      <div className="loc-view" hidden={tab !== 'map'}>
        <div className="loc-legend">
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_CURRENT }} />当前位置</span>
          <span className="loc-legend-item" title="最新打的那个点：与线条同粗">
            <i className="loc-dot loc-dot-point" />最新点
          </span>
          <span className="loc-legend-item" title="更早的记录点：直径是线宽的一半">
            <i className="loc-dot loc-dot-hist" />历史点
          </span>
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_SELECTED }} />选中</span>
          <span
            className="loc-legend-item"
            title="两段平均速度：蓝 → 青 → 绿 → 黄 → 橙 → 红，红色对应轨迹最高速度；静止为蓝色，未知为灰色"
          >
            <i className="loc-speedbar" style={{ background: `linear-gradient(90deg, ${speedRamp.join(', ')})` }} />
            <span className="loc-max-speed">最高速度（红色）：{trackSpeedInfo.max === null ? '未知' : fmtSpeed(trackSpeedInfo.max)}</span>
          </span>
          <span className="loc-legend-item loc-current-speed">
            当前速度：{currentSpeed === null ? '未知' : fmtSpeed(currentSpeed)}
          </span>
          {playActive && (
            <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_PLAY }} />回放</span>
          )}
          <span className="muted small">{rows.length} 个点</span>
        </div>
        <div ref={containerRef} className="map-leaflet loc-map" />

        {/*
         * 回放：一条进度条 + 一排走带键，单位/顺序/步长收进「更多」。
         * 之前是三行按钮加两个数字框，找个位置只能一步一步按；现在拖条就能到任意一段。
         * 键帽符号只用 « ‹ ▶ › » 这类文本字形（▶ 还补了 U+FE0E）：⏮ 在安卓上会被
         * 当成 emoji 渲成橙色方块，跟卡片其它控件不是一个体系。
         */}
        {nPts > 1 && (
          <div className="loc-card loc-play">
            <div className="loc-card-head">
              <strong>回放</strong>
              <span className="muted small loc-play-read">
                {playActive ? (
                  <>
                    第 <b>{playIdxClamped + 1}</b> / {nPts} 点 · {clockOf(playClock)}
                  </>
                ) : (
                  <>
                    共 {nPts} 点 · {clockOf(tFirst)} → {clockOf(tLast)}
                  </>
                )}
              </span>
              {playActive && (
                <button className="loc-play-reset" onClick={resetPlay} title="回到起点并清除回放高亮">
                  清除
                </button>
              )}
            </div>

            <input
              className="loc-scrub"
              type="range"
              min={0}
              max={nPts - 1}
              step={1}
              value={playIdxClamped}
              onChange={(e) => seekPlay(Number(e.target.value))}
              onPointerDown={stopPlayback}
              aria-label="回放进度：拖动直接看到那一段"
              style={{ '--loc-pct': `${playPct.toFixed(1)}%`, '--loc-play': COLOR_PLAY } as CSSProperties}
            />
            <div className="loc-scrub-meta">
              <span className="muted small">{clockOf(tFirst)}</span>
              <span className="muted small">
                {playActive ? `已走 ${fmtMeters(walkedM)} / ${fmtMeters(totalM)}` : `全程 ${fmtMeters(totalM)}`}
              </span>
              <span className="muted small">{clockOf(tLast)}</span>
            </div>

            <div className="loc-transport">
              <button className="loc-tp" onClick={() => jumpPlay('start')} title="回到本方向的第一个点" aria-label="回到开头">
                «
              </button>
              <button className="loc-tp" onClick={() => stepPlay(-1)} title={`后退 ${stepLabel(playStep)}`} aria-label="后退一步">
                ‹
              </button>
              <button className="loc-tp loc-tp-play" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
                {playing ? '❚❚' : '▶\uFE0E'}
              </button>
              <button className="loc-tp" onClick={() => stepPlay(1)} title={`前进 ${stepLabel(playStep)}`} aria-label="前进一步">
                ›
              </button>
              <button className="loc-tp" onClick={() => jumpPlay('end')} title="跳到本方向的最后一个点" aria-label="跳到末尾">
                »
              </button>
              <div className="loc-seg loc-chips" role="group" aria-label="播放速度">
                {rateOptions.map((v) => (
                  <button
                    key={v}
                    className={playRate === v ? 'on' : undefined}
                    onClick={() => setPlayRate(v)}
                    aria-pressed={playRate === v}
                    title={playMode === 'time' ? `1 秒真实时间走 ${v} 秒记录` : `每秒走 ${v} 个点`}
                  >
                    {rateLabel(v)}
                  </button>
                ))}
              </div>
              <button
                className={playMore ? 'loc-tp loc-tp-more on' : 'loc-tp loc-tp-more'}
                onClick={() => setPlayMore((o) => !o)}
                aria-expanded={playMore}
                title="单位 / 顺序 / 步长"
              >
                更多
              </button>
            </div>

            {playMore && (
              <div className="loc-play-more">
                <div className="loc-play-row">
                  <span className="muted small">单位</span>
                  <div className="loc-seg" role="group" aria-label="回放单位">
                    <button className={playMode === 'time' ? 'on' : undefined} onClick={() => switchPlayMode('time')} aria-pressed={playMode === 'time'}>
                      时间
                    </button>
                    <button className={playMode === 'dot' ? 'on' : undefined} onClick={() => switchPlayMode('dot')} aria-pressed={playMode === 'dot'}>
                      点
                    </button>
                  </div>
                  <span className="muted small">顺序</span>
                  <div className="loc-seg" role="group" aria-label="播放顺序">
                    <button className={playOrder === 'fwd' ? 'on' : undefined} onClick={() => switchPlayOrder('fwd')} aria-pressed={playOrder === 'fwd'}>
                      顺序
                    </button>
                    <button className={playOrder === 'rev' ? 'on' : undefined} onClick={() => switchPlayOrder('rev')} aria-pressed={playOrder === 'rev'}>
                      逆序
                    </button>
                  </div>
                </div>
                <div className="loc-play-row">
                  <span className="muted small">步长</span>
                  <div className="loc-seg loc-chips" role="group" aria-label="步进大小">
                    {stepOptions.map((v) => (
                      <button
                        key={v}
                        className={playStep === v ? 'on' : undefined}
                        onClick={() => setPlayStep(v)}
                        aria-pressed={playStep === v}
                        title={playMode === 'time' ? `每步推进 ${v} 秒记录` : `每步 ${v} 个点`}
                      >
                        {stepLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="loc-play-row">
                  <label className="muted small">
                    自定义速度
                    <input
                      className="loc-num"
                      type="number"
                      min={0}
                      step={playMode === 'time' ? 1 : 0.5}
                      value={playRate}
                      onChange={(e) => setPlayRate(Number(e.target.value) || 0)}
                      aria-label={playMode === 'time' ? '每秒推进多少秒记录' : '每秒走多少个点'}
                    />
                    {playMode === 'time' ? '秒/秒' : '点/秒'}
                  </label>
                </div>
                <p className="muted small loc-play-hint">
                  按时间：1 秒真实时间推进 N 秒记录（中间没有点的空档会停在原地等）；按点：每秒走 N 个点。
                  进度条两端固定是第 1 点和最后一点，逆序只改播放方向。
                </p>
              </div>
            )}
          </div>
        )}

        <div className="music-add">
          <button className="music-add-btn" onClick={locateMe}>定位到我的位置</button>
          <button className="music-add-btn" onClick={() => setTab('record')}>去记录</button>
        </div>
        {selected ? (
          <div className="loc-card loc-selected">
            <div className="loc-card-head">
              <strong>选中的点</strong>
              <span className="muted small">
                第 {selectedIdx! + 1} / {rows.length} 个 · {fmtTime(selected.ts)}
              </span>
            </div>
            <div className="loc-coord">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</div>
            <div className="muted small">
              {selected.accuracy ? `±${Math.round(selected.accuracy)}m` : '精度未知'}
              {` · 这一头到这里 ${fmtMeters(cumMeters[selectedIdx!] ?? 0)}`}
              {selected.note ? ` · ${selected.note}` : ''}
            </div>
            <div className="loc-row">
              {/* 列表只渲染最近 300 条，光切过去常常还不够：这一条把窗口撑到够得着它并滚到中间 */}
              <button className="music-add-btn" onClick={() => revealInList(selectedIdx!)}>
                在记录里定位
              </button>
              {fileId && rows.length > 1 && (
                <button className="music-add-btn" onClick={() => { setOffsetScope('seg'); setTab('file'); }}>
                  从这点起修正
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="muted small">点地图上的白芯小点可看坐标，选中的那个会变成红心；选中后能直接「在记录里定位」。</p>
        )}
      </div>

      {/* ---------- 记录 ---------- */}
      <div className="loc-view" hidden={tab !== 'record'}>
        {!fileId ? (
          <div className="loc-empty">
            <p>还没有选择定位文件。</p>
            <button className="music-add-btn primary" onClick={() => setTab('file')}>去选择 / 新建</button>
          </div>
        ) : (
          <>
            <div className="loc-card">
              <div className="loc-card-head">
                <strong>{fileName}</strong>
                <span className={la.saving === 'error' ? 'music-save-state is-error' : 'music-save-state'}>{saveText}</span>
              </div>
              <div className="muted small">
                {rows.length} 个点 · 偏移 Δ{offset.lat.toFixed(6)}, Δ{offset.lng.toFixed(6)}
              </div>
            </div>

            <input
              className="music-name-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注（可选，手动打点时带上）"
            />
            <div className="music-add">
              <button className="music-add-btn primary" onClick={record} disabled={busy || auto}>
                {busy ? '定位中…' : '记录位置'}
              </button>
              <button className="music-add-btn" onClick={locateMe}>我的位置</button>
              <button className="music-add-btn" onClick={() => setTab('file')}>切换文件</button>
            </div>

            <div className="loc-row">
              <label className="muted small">
                去重阈值
                <input
                  type="number"
                  min={0}
                  className="loc-num"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                />
                米
              </label>
              {auto ? (
                <button className="music-add-btn" onClick={stopAuto}>⏹ 停止自动打点</button>
              ) : (
                <button
                  className="music-add-btn primary"
                  onClick={() => {
                    if (!startAuto()) toast('先选或新建一个定位文件');
                  }}
                >
                  ▶ 自动打点
                </button>
              )}
            </div>
            <div className="loc-row">
              <label className="muted small">
                连续打点
                <select
                  className="loc-num loc-select"
                  value={strategy}
                  onChange={(e) => setSampleStrategy(e.target.value as SampleStrategy)}
                >
                  <option value="backoff">同点退避</option>
                  <option value="fixed">定时</option>
                </select>
              </label>
              <span className="muted small">
                {strategy === 'fixed'
                  ? '每 1 秒取一次'
                  : native
                    ? '由壳按同一策略调度：同点越久等得越久，最多 64 秒'
                    : auto
                      ? `同点连续 ${streak} 次 · 下次约 ${Math.round(nextSampleMs(streak, strategy) / 1000)} 秒`
                      : '同点连续 n 次后等 2ⁿ 秒（1→2→4→…→64 秒封顶），移位即回到 1 秒'}
              </span>
            </div>
            {auto && native && (
              <p className="muted small loc-native-hint">
                记录由安卓壳的原生服务接管：退到后台、熄屏都继续，回到这一页会把断开的点补回来。
              </p>
            )}

            {selectedIdx !== null && (
              <div className="loc-sel-bar">
                <span className="loc-sel-bar-txt">
                  已选中第 <b>{selectedIdx + 1}</b> 个点
                  {selRow ? ` · ${fmtTime(selRow.ts)}` : ''}
                </span>
                <button
                  type="button"
                  className="loc-sel-bar-btn"
                  onClick={() => locateInList(selectedIdx)}
                >
                  跳到它
                </button>
                <button type="button" className="loc-sel-bar-btn" onClick={() => setTab('map')}>
                  看地图
                </button>
              </div>
            )}

            <ul className="music-list loc-list" ref={listRef}>
              {rows.length === 0 && <li className="muted small">打点会出现在地图上。</li>}
              {shownRows.map(({ p: r, idx }) => {
                const isSel = idx === selectedIdx;
                const isAnchor = segments.some((s) => s.fromIndex === idx);
                return (
                  <li
                    key={`${r.ts}-${idx}`}
                    data-idx={idx}
                    className={`music-row${isSel ? ' on' : ''}${idx === flashIdx ? ' loc-row-flash' : ''}`}
                    onClick={() => selectPoint(idx)}
                  >
                    <span className="music-row-idx">{idx + 1}</span>
                    <span className="music-row-name">
                      {fmtTime(r.ts)} · {r.lat.toFixed(6)},{r.lng.toFixed(6)}
                      {r.note ? ` · ${r.note}` : ''}
                      {isAnchor && <span className="loc-anchor-tag">修正起点</span>}
                    </span>
                    <span className="music-row-size muted small">±{Math.round(r.accuracy)}m</span>
                    <button
                      type="button"
                      className="loc-del"
                      aria-label={`删除第 ${idx + 1} 个点`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeAt(idx);
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
              {rows.length > listLimit && (
                <li className="loc-more">
                  <span className="muted small">
                    列表只渲染最近 {listLimit} 个（共 {rows.length} 个）
                  </span>
                  <button
                    type="button"
                    className="music-add-btn"
                    onClick={() => setListLimit((n) => n + 300)}
                  >
                    再看早 300 个（还有 {rows.length - listLimit} 个）
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {/* ---------- 文件 ---------- */}
      <div className="loc-view" hidden={tab !== 'file'}>
        {picking ? (
          <>
            <div className="music-pick-back">
              <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回</button>
              <span className="muted small">点文件即可打开</span>
            </div>
            <FilesPanel onPick={(f) => void openExisting(f)} onlyKinds={['location']} pickLabel="打开" compact />
          </>
        ) : (
          <>
            <div className="loc-card">
              <div className="loc-card-head">
                <strong>{fileId ? fileName : '未选择定位文件'}</strong>
                <span className="muted small">{rows.length} 个点</span>
              </div>
              <p className="muted small">
                定位数据保存在文件库的 <code>.drloc</code> 文件里，可按「定位」类型筛选、随备份同步。
              </p>
              {fileId && (
                <button className="music-add-btn" onClick={() => openLocationFile(null, '', null)}>
                  关闭当前文件
                </button>
              )}
            </div>

            <div className="loc-row">
              <input
                className="music-name-input"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder="例如：10-27 通勤、周末爬山"
                aria-label="新定位文件名"
              />
              <button className="music-add-btn primary" onClick={createNew}>新建</button>
            </div>
            <p className="muted small">
              已经按日期填了个例子，改成这次要记的事就行；不改动它，每次进来都会跟着换当天日期。
            </p>
            <div className="music-add">
              <button className="music-add-btn" onClick={() => setPicking(true)}>选已有定位文件</button>
              <button className="music-add-btn" onClick={() => importRef.current?.click()}>导入 .drloc / 旧 CSV</button>
            </div>
            <FilePickInput
              inputRef={importRef}
              accept=".drloc,application/x-dr-location,.csv,text/csv"
              onFiles={(files) => void importFile(files)}
            />

            <div className="loc-card">
              <div className="loc-card-head">
                <strong>位置修正</strong>
                <span className="muted small">原始点不动，只改偏移</span>
              </div>
              {refLat == null || !anchor ? (
                <p className="muted small">文件还没有点：先打点，再来修正位置（换算需要点位）。</p>
              ) : (
                <p className="muted small">
                  {offsetScope === 'seg'
                    ? selRow
                      ? `从第 ${selectedIdx! + 1} 个点起修正 · 当前生效 Δ${segEffective.lat.toFixed(6)}, Δ${segEffective.lng.toFixed(6)}`
                      : '先在地图或记录里选中一个点'
                    : `锚点（第 1 个点）${anchor.lat.toFixed(6)}, ${anchor.lng.toFixed(6)} · 当前 Δ${offset.lat.toFixed(6)}, Δ${offset.lng.toFixed(6)}`}
                  {` · 参考纬度 ${refLat.toFixed(4)}°`}
                </p>
              )}
              <div className="loc-scopes" role="group" aria-label="修正范围">
                <button
                  type="button"
                  className={offsetScope === 'file' ? 'loc-scope on' : 'loc-scope'}
                  aria-pressed={offsetScope === 'file'}
                  onClick={() => setOffsetScope('file')}
                  disabled={!fileId || refLat == null}
                >
                  整份文件
                </button>
                <button
                  type="button"
                  className={offsetScope === 'seg' ? 'loc-scope on' : 'loc-scope'}
                  aria-pressed={offsetScope === 'seg'}
                  onClick={() => setOffsetScope('seg')}
                  disabled={!fileId || refLat == null}
                >
                  从选中点起
                </button>
              </div>
              <div className="loc-modes" role="group" aria-label="修正方式">
                {OFFSET_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={offsetMode === m.key ? 'loc-mode on' : 'loc-mode'}
                    aria-pressed={offsetMode === m.key}
                    onClick={() => setOffsetMode(m.key)}
                    disabled={!fileId || refLat == null}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="muted small">
                {offsetScope === 'seg'
                  ? selectedIdx == null
                    ? '在「地图」点点，或在「记录」里点一行，选中要开始修正的那个点。'
                    : offsetMode === 'deg'
                      ? '直接填经纬度偏移（度）：从选中的点起、到下一个修正锚点前都按它平移。'
                      : offsetMode === 'target'
                        ? '把选中的点放到指定经纬度；两项都留空保存 = 从这里起不偏移。'
                        : `按南北 / 东西多少米填，保存时用平均纬度 ${refLat == null ? '—' : refLat.toFixed(4)}° 换算成度。`
                  : offsetMode === 'deg'
                    ? '直接填经纬度偏移（度）：正值向北 / 向东，文件里存的就是这两个数。'
                    : offsetMode === 'target'
                      ? '把第 1 个点（锚点）放到指定经纬度；两项都留空保存 = 不偏移。'
                      : refLat == null
                        ? '先打点，再按距离设置偏移（经度换算需要参考纬度）。'
                        : `按南北 / 东西多少米填，保存时用平均纬度 ${refLat.toFixed(4)}° 换算成度。`}
              </p>
              <div className="loc-offset">
                <label>
                  {offsetMode === 'deg'
                    ? '纬度偏移（度，正=向北）'
                    : offsetMode === 'target'
                      ? '目标纬度'
                      : '南北（米，正=向北）'}
                  <input
                    className="music-name-input"
                    inputMode="decimal"
                    value={offsetA}
                    onChange={(e) => setOffsetA(e.target.value)}
                    placeholder={offsetMode === 'target' ? '留空=不偏移' : '0'}
                    disabled={refLat == null || (offsetScope === 'seg' && selectedIdx == null)}
                  />
                </label>
                <label>
                  {offsetMode === 'deg'
                    ? '经度偏移（度，正=向东）'
                    : offsetMode === 'target'
                      ? '目标经度'
                      : '东西（米，正=向东）'}
                  <input
                    className="music-name-input"
                    inputMode="decimal"
                    value={offsetB}
                    onChange={(e) => setOffsetB(e.target.value)}
                    placeholder={offsetMode === 'target' ? '留空=不偏移' : '0'}
                    disabled={refLat == null || (offsetScope === 'seg' && selectedIdx == null)}
                  />
                </label>
              </div>
              <div className="music-add">
                <button
                  className="music-add-btn primary"
                  onClick={saveOffset}
                  disabled={
                    !fileId ||
                    refLat == null ||
                    la.saving === 'saving' ||
                    (offsetScope === 'seg' && selectedIdx == null)
                  }
                >
                  保存修正
                </button>
                {offsetScope === 'seg' ? (
                  <button
                    className="music-add-btn"
                    onClick={() => selectedIdx != null && void removeSeg(selectedIdx)}
                    disabled={!segIsAnchor}
                  >
                    删除这段
                  </button>
                ) : (
                  <button className="music-add-btn" onClick={clearOffset} disabled={!fileId}>
                    归零
                  </button>
                )}
              </div>
              {segments.length > 0 && (
                <div className="loc-segbox">
                  <div className="muted small">分段修正 {segments.length} 段 · 只影响列出的区间，原始点不动</div>
                  <ul className="loc-seg-list">
                    {segments.map((s) => {
                      const range = segmentRange(segments, s.fromIndex, rows.length);
                      return (
                        <li
                          key={s.fromIndex}
                          className={`loc-seg-row${s.fromIndex === selectedIdx ? ' on' : ''}`}
                        >
                          <span className="loc-seg-range">
                            {range ? `第 ${range.from}–${range.to} 个点` : `第 ${s.fromIndex + 1} 点起`}
                          </span>
                          <span className="loc-seg-delta">
                            Δ{s.lat.toFixed(6)}, Δ{s.lng.toFixed(6)}
                          </span>
                          <button
                            type="button"
                            className="loc-seg-btn"
                            onClick={() => {
                              setSelectedIdx(s.fromIndex);
                              setTab('map');
                            }}
                          >
                            定位
                          </button>
                          <button
                            type="button"
                            className="loc-seg-btn"
                            aria-label={`删除第 ${s.fromIndex + 1} 点起的修正`}
                            onClick={() => void removeSeg(s.fromIndex)}
                          >
                            删除
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------- 说明 ---------- */}
      <div className="loc-view" hidden={tab !== 'help'}>
        <div className="loc-card">
          <div className="loc-card-head">
            <strong>高德 Web key</strong>
            <span className="muted small">只存本机</span>
          </div>
          <div className="loc-row">
            <input
              type="password"
              className="music-name-input"
              value={amapKey}
              onChange={(e) => setAmapKeyState(e.target.value)}
              placeholder="高德 Web 服务 key"
            />
            <button className="music-add-btn" onClick={saveKey}>保存</button>
          </div>
          <p className="muted small">不填也能用：会退回浏览器原生定位，精度略低。</p>
        </div>

        <div className="loc-card">
          <strong>文件与偏移</strong>
          <p className="muted small">
            <code>.drloc</code> 是应用自己的定位格式（JSON），里面保存点的时间、经纬度、精度、备注，
            以及这个文件的修正量（单位：度，正值向北 / 向东）。面板提供三种填法：
            <strong>度数</strong>（直接填偏移角）、<strong>距离</strong>（填南北 / 东西多少米，按平均纬度换算）、
            <strong>目标</strong>（把锚点放到指定经纬度，留空 = 不偏移）。修正分两个范围：
            <strong>整份文件</strong>（锚点是第 1 个点，等价于从第 1 个点起修正）和
            <strong>从选中点起</strong>——选中哪个点就从哪个点开始生效，到下一个修正锚点前为止。
            例：100 个点，分别对第 5 / 20 / 60 个点填三段偏移，实际修正 5-19、20-59、60-100，
            第 1-4 个点不受影响。所有修正都只写偏移，<strong>原始点始终不动</strong>；
            旧版 CSV 可以通过「导入」转成 <code>.drloc</code>，原 CSV 不会被改写。
          </p>
          <p className="muted small">
            地图折线上带方向箭头，标明轨迹走向；选中最后一个点时，新打点会自动跟着选中（地图跟随）。
            记录页可以逐点删除，标了「修正起点」的点是分段修正的锚点；点很多时只先渲染最近 300 条，
            可继续「显示更早」。自动打点是后台服务：离开本页仍会按阈值继续记录，原地不动时最多 15 秒落一次盘。
          </p>
        </div>
      </div>
    </div>
  );
}
