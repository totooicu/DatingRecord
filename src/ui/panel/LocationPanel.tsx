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

import { useEffect, useMemo, useRef, useState } from 'react';
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
  metersFromOffset,
  offsetFromMeters,
  refLatOf,
  segmentRange,
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

type TabKey = 'map' | 'record' | 'file' | 'help';

/** 位置修正的三种填法：度数偏移 / 距离偏移 / 目标坐标 */
type OffsetMode = 'deg' | 'm' | 'target';

const OFFSET_MODES: { key: OffsetMode; label: string }[] = [
  { key: 'deg', label: '度数' },
  { key: 'm', label: '距离' },
  { key: 'target', label: '目标' },
];

/** 线宽 4 → 点直径 2×线粗 = 8；蓝/黄/红都同一尺寸，只靠颜色区分 */
const LINE_WEIGHT = 4;
const DOT_SIZE = LINE_WEIGHT * 2;
const COLOR_LINE = '#FFC107';
const COLOR_POINT = '#FFC107';
const COLOR_CURRENT = '#2196F3';
const COLOR_SELECTED = '#E53935';
/** 一条轨迹最多画多少个方向箭头：点很密时按段数均摊，别把地图糊满 */
const ARROW_MAX = 40;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function dotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="loc-pin" style="width:${DOT_SIZE}px;height:${DOT_SIZE}px;border-radius:50%;background:${color};box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
    iconSize: [DOT_SIZE, DOT_SIZE],
    iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
  });
}

/** a→b 的方位角（度）：0 = 正北，90 = 正东；箭头图标默认尖朝北，照这个角旋转 */
function bearingDeg(a: LocationPoint, b: LocationPoint): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** 沿线放方向箭头：不引插件，每隔几段在段中点放一个旋转三角（不拦点击） */
function addArrows(layer: L.LayerGroup, pts: LocationPoint[]): void {
  const segCount = pts.length - 1;
  if (segCount < 1) return;
  const step = Math.max(1, Math.ceil(segCount / ARROW_MAX));
  for (let i = 0; i < segCount; i += step) {
    const a = pts[i];
    const b = pts[i + 1];
    const icon = L.divIcon({
      className: '',
      html: `<div class="loc-arrow" style="transform: rotate(${bearingDeg(a, b).toFixed(1)}deg)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { icon, interactive: false }).addTo(layer);
  }
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'map', label: '地图' },
  { key: 'record', label: '记录' },
  { key: 'file', label: '文件' },
  { key: 'help', label: '说明' },
];

export function LocationPanel() {
  const la = useLocationAuto();
  const { fileId, fileName, rows, offset, offsets: segments, current, threshold, strategy, streak, running: auto, native, busy } = la;

  const [tab, setTab] = useState<TabKey>('map');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  /** 位置修正是「三选一」的填法，输入框含义随模式变化 */
  const [offsetMode, setOffsetMode] = useState<OffsetMode>('m');
  /** 修正范围：整份文件（锚点=第 1 个点）/ 从选中点起（写一段分段修正） */
  const [offsetScope, setOffsetScope] = useState<'file' | 'seg'>('file');
  const [offsetA, setOffsetA] = useState('0');
  const [offsetB, setOffsetB] = useState('0');
  const [amapKey, setAmapKeyState] = useState(getAmapKey);
  /** 记录页一次渲染多少条：点可能上万，全量 DOM 会卡 */
  const [listLimit, setListLimit] = useState(300);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  /** 轨迹图层（线 + 历史点）；蓝点单独一层，避免每秒定位重画整条轨迹 */
  const trackRef = useRef<L.LayerGroup | null>(null);
  const pointMarkers = useRef<L.Marker[]>([]);
  const currentMarker = useRef<L.Marker | null>(null);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedIdx;
  /** 已经对哪个文件做过 fitBounds：自动打点持续加点时不再反复缩放 */
  const fittedFile = useRef<string | null>(null);
  /** 选中点追踪最新：记上一帧的点数，发现追加且选中在末尾就跟着走 */
  const prevRowsLen = useRef(rows.length);

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
    const map = L.map(containerRef.current).setView([30.2741, 120.1551], 12);
    mapRef.current = map;
    L.control.scale({ imperial: false, metric: true }).addTo(map);
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '© 高德地图' },
    ).addTo(map);
    trackRef.current = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapRef.current = null;
      trackRef.current = null;
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
    if (pts.length > 1) {
      L.polyline(
        pts.map((r) => [r.lat, r.lng] as [number, number]),
        { color: COLOR_LINE, weight: LINE_WEIGHT, opacity: 0.75 },
      ).addTo(layer);
      // 折线上的方向箭头：按段中点放旋转三角，点密时均摊数量
      addArrows(layer, pts);
    }

    const sel = selectedRef.current;
    pts.forEach((r, i) => {
      const marker = L.marker([r.lat, r.lng], {
        icon: dotIcon(i === sel ? COLOR_SELECTED : COLOR_POINT),
        zIndexOffset: i === sel ? 1000 : 0,
      })
        .on('click', () => setSelectedIdx(i))
        .bindPopup(
          `<div><strong>${esc(fmtTime(r.ts))}</strong><br/>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}` +
            `${r.accuracy ? `<br/>±${Math.round(r.accuracy)}m` : ''}${r.note ? `<br/>${esc(r.note)}` : ''}</div>`,
        );
      marker.addTo(layer);
      pointMarkers.current.push(marker);
    });

    if (pts.length > 0 && fittedFile.current !== fileId) {
      fittedFile.current = fileId;
      map.fitBounds(L.latLngBounds(pts.map((r) => [r.lat, r.lng] as [number, number])).pad(0.2));
    }
    // rows / offset 是这条 effect 的数据源；用 rev + 偏移值当依赖，避免每秒重画
  }, [la.rev, offset.lat, offset.lng, fileId, segments]);

  // 选中只换图标，不重建整层
  useEffect(() => {
    pointMarkers.current.forEach((m, i) => {
      m.setIcon(dotIcon(i === selectedIdx ? COLOR_SELECTED : COLOR_POINT));
      m.setZIndexOffset(i === selectedIdx ? 1000 : 0);
    });
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
      const f = await createLocation({ name: newName.trim() || '定位记录' });
      const doc = await readLocation(f);
      openLocationFile(f.id, f.name, doc);
      setNewName('');
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
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_POINT }} />文件记录</span>
          <span className="loc-legend-item"><i className="loc-dot" style={{ background: COLOR_SELECTED }} />选中</span>
          <span className="muted small">{rows.length} 个点</span>
        </div>
        <div ref={containerRef} className="map-leaflet loc-map" />
        <div className="music-add">
          <button className="music-add-btn" onClick={locateMe}>定位到我的位置</button>
          <button className="music-add-btn" onClick={() => setTab('record')}>去记录</button>
        </div>
        {selected ? (
          <div className="loc-card">
            <div className="loc-card-head">
              <strong>选中的点</strong>
              <span className="muted small">{fmtTime(selected.ts)}</span>
            </div>
            <div className="loc-coord">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</div>
            <div className="muted small">
              {selected.accuracy ? `±${Math.round(selected.accuracy)}m` : '精度未知'}
              {selected.note ? ` · ${selected.note}` : ''}
            </div>
            {fileId && rows.length > 1 && (
              <button className="music-add-btn" onClick={() => { setOffsetScope('seg'); setTab('file'); }}>
                从这点起修正
              </button>
            )}
          </div>
        ) : (
          <p className="muted small">点地图上的黄点可查看坐标；红点表示当前选中。</p>
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

            <ul className="music-list loc-list">
              {rows.length === 0 && <li className="muted small">打点会出现在地图上。</li>}
              {shownRows.map(({ p: r, idx }) => {
                const isSel = idx === selectedIdx;
                const isAnchor = segments.some((s) => s.fromIndex === idx);
                return (
                  <li
                    key={`${r.ts}-${idx}`}
                    className={`music-row${isSel ? ' on' : ''}`}
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
                  <button
                    type="button"
                    className="music-add-btn"
                    onClick={() => setListLimit((n) => n + 300)}
                  >
                    显示更早的 300 个（还有 {rows.length - listLimit} 个）
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
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新文件名（默认 定位记录）"
              />
              <button className="music-add-btn primary" onClick={createNew}>新建</button>
            </div>
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
                <div className="loc-seg">
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
