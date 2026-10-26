// 「功能体验 → 轨迹提取」独立子页。
//
// 起点是一份外部「两步路轨迹提取器」：筛红色像素 → 连通域 → 4px 网格取点 → 导 CSV。
// 那份实现只在干净白底截图（理想情况）下能用，真截图会出三类问题：
//   ① 轨迹被底图打断 → 只取到一段，其余当噪点丢了；
//   ② 红圈「终」、红色 POI 图标、左上关闭按钮被当轨迹；
//   ③ 只输出散点，没有顺序，也没法换算成米。
//
// 这里换成 提取 → 校准 → 插值 三段（算法在 core/tools/trackExtract.ts）：
//   · 提取：HSV 双端色相 + R 通道优势 + 闭运算补断口 + 骨架形状校准；
//   · 校准：截图比例尺独立定标，官方里程验收覆盖率；没有比例尺时用里程反推；
//   · 插值：骨架 → 有序主路径 → 沿弧长等距重采样 → 移动平均平滑。
//
// 在它之上又加了三件事：
//   · AI 校准：再让视觉模型看一遍同一张图，给出它自己的轨迹与校准依据（trackAi.ts）。
//     两套结果叠在原图上对比，差异大的地方就是要人工看一眼的地方；
//   · 地图复现：用「锚点 + 米/像素 + 方位角」把像素轨迹落到真实地图上走一遍（trackGeo.ts）；
//   · 存进本库：选一个方案，直接存成 .drloc，和自动打点的记录同一套格式。
//
// 全程本地：canvas + FileReader，图片不出浏览器；只有点「AI 校准」时截图才会发给
// 用户自己配置的模型。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  DEFAULT_OPTIONS,
  extractTrack,
  toCsv,
  type ExtractOptions,
  type ExtractResult,
  type TrackPoint,
} from '../../core/tools/trackExtract';
import {
  applyEdits,
  pickVisionModel,
  prepareShot,
  refineTrack,
  type AiTrackResult,
  type EditMark,
} from '../../core/tools/trackAi';
import {
  compareTracks,
  flattenSegments,
  pathLengthPx,
  pxToGeo,
  toLocationPoints,
  type GeoAnchor,
} from '../../core/tools/trackGeo';
import { createLocation } from '../../core/location/locationFile';
import { locateMe } from '../../core/runtime/locationAuto';
import { listModels, type AiModel } from '../../core/ai';
import { bump } from '../../store';
import { LabHead } from './LabEdgeSection';
import { showToast } from '../toast';

/** 主题变量实时读取：canvas 没法用 CSS var，只能取计算后的值；随外观改主题也跟着变 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 自动校准的评分：选「留下的红像素多、断口少」的那组参数 */
function scoreOf(r: ExtractResult): number {
  const { calibration: cal, stats, gaps } = r;
  if (!r.segments.length) return -1e6;
  // 有独立比例尺校准 + 官方里程 → 直接按覆盖率误差评分（最硬的标准）
  if (cal.source === 'scale' && cal.officialM > 0) {
    const err = Math.abs(cal.coverage - 1);
    // 覆盖率超过 1 说明把图标/杂色也算进里程了（假里程），额外扣分——否则评分会
    // 被「多提取 = 覆盖率更接近 1」这种假象骗过去，专挑一堆噪点的参数。
    const over = cal.coverage > 1.03 ? 15 : 0;
    return -err * 100 - over - gaps.length * 0.5;
  }
  // 否则用代理指标：有效像素召回（占红色总量）+ 连续性
  const keptPx = r.segments.reduce((s, x) => s + x.skelPx, 0);
  const recall = stats.redPx > 0 ? Math.min(1, keptPx / (stats.redPx * 0.12)) : 0;
  const continuity = 1 / (1 + gaps.length * 0.6);
  return recall * 0.65 + continuity * 0.35;
}

/** 按米/像素把像素距离说成人话 */
function fmtLen(m: number): string {
  if (!(m > 0)) return '未定标';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} 公里` : `${Math.round(m)} 米`;
}

// 参数网格：色相窗口是主开关（实测 12° 最能把深红轨迹从卫星底图里捞全），
// 明度/红优势/最小面积只在收噪时微调。第 4 组即默认值。
const AUTO_GRID: Partial<ExtractOptions>[] = [
  { redSat: 70, redVal: 40, hueHi: 12, rDominance: 1.1, minArea: 200, gapPx: 60 },
  { redSat: 80, redVal: 45, hueHi: 13, rDominance: 1.2, minArea: 300, gapPx: 60 },
  { redSat: 90, redVal: 55, hueHi: 15, rDominance: 1.3, minArea: 500, gapPx: 80 },
  { redSat: 75, redVal: 45, hueHi: 12, rDominance: 1.15, minArea: 300, gapPx: 60 },
  { redSat: 85, redVal: 50, hueHi: 16, rDominance: 1.35, minArea: 400, gapPx: 100 },
  { redSat: 70, redVal: 35, hueHi: 11, rDominance: 1.05, minArea: 150, gapPx: 45 },
];

/** 对比图里的三层：底图 / 算法轨迹 / AI 轨迹 */
interface Layers {
  img: boolean;
  alg: boolean;
  ai: boolean;
}

type Scheme = 'alg' | 'ai';

const COLOR_AI = '#2196F3';
const COLOR_ALG = '#d9536b';

export function LabTrackSection() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const shotUrlRef = useRef<string>('');
  const imgElRef = useRef<HTMLImageElement | null>(null);

  const [opts, setOpts] = useState<ExtractOptions>({ ...DEFAULT_OPTIONS });
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [ai, setAi] = useState<AiTrackResult | null>(null);
  const [aiPts, setAiPts] = useState<TrackPoint[]>([]);
  const [layers, setLayers] = useState<Layers>({ img: true, alg: true, ai: true });
  const [busy, setBusy] = useState<'extract' | 'auto' | 'ai' | null>(null);
  const [status, setStatus] = useState('就绪：选一张两步路截图');
  const [coord, setCoord] = useState('悬停看像素坐标');
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const [aiLog, setAiLog] = useState<string>('');
  const [aiThink, setAiThink] = useState('');
  const [aiMarks, setAiMarks] = useState<EditMark[]>([]);
  const [aiCount, setAiCount] = useState({ add: 0, del: 0, move: 0 });
  /** 当前结果是不是「参数自动校准」出来的：AI 优化要在这个结果上做 */
  const [calibrated, setCalibrated] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  const [alias, setAlias] = useState('');

  const patch = useCallback((p: Partial<ExtractOptions>) => {
    setOpts((prev) => ({ ...prev, ...p }));
  }, []);

  const visionModel = useMemo(
    () => pickVisionModel(models, alias) ?? null,
    [models, alias],
  );

  useEffect(() => {
    const list = listModels();
    setModels(list);
    setAlias((prev) => prev || pickVisionModel(list)?.alias || '');
  }, []);

  /* ---------------- 图层：把三样东西叠在一张画布上 ---------------- */

  const algPath = useMemo<TrackPoint[]>(() => (result ? flattenSegments(result) : []), [result]);

  // 比例尺优先用提取结果里的定标值；还没点「提取」时直接用手填的比例尺，
  // 这样只填 500 米 = 200 像素也能马上落图、马上保存。
  const mPerPx = useMemo(() => {
    const fromOpts = opts.scaleMeter > 0 && opts.scalePx > 0 ? opts.scaleMeter / opts.scalePx : 0;
    return result?.calibration.mPerPx || fromOpts;
  }, [opts.scaleMeter, opts.scalePx, result]);

  const diff = useMemo(() => {
    if (algPath.length < 2 || aiPts.length < 2) return null;
    return compareTracks(algPath, aiPts);
  }, [algPath, aiPts]);

  const drawOverlay = useCallback(() => {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (layers.img && imgElRef.current) ctx.drawImage(imgElRef.current, 0, 0, W, H);

    const stroke = (pts: TrackPoint[], color: string, width: number, dashed = false) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // 算法轨迹：实线；AI 轨迹：虚线，两者叠起来一眼能看出分歧在哪
    if (layers.alg && algPath.length > 1) {
      stroke(algPath, cssVar('--primary', COLOR_ALG), 3);
      // 断口位置用红点标出来（那里没有提取到，是虚线连的）
      ctx.fillStyle = cssVar('--danger', '#e04b4b');
      for (const g of result?.gaps ?? []) {
        const a = result?.segments[g.afterSegment]?.points.slice(-1)[0];
        if (a) {
          ctx.beginPath();
          ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (layers.ai && aiPts.length > 1) stroke(aiPts, COLOR_AI, 2.5, true);

    // AI 改过的地方标出来：新增绿点、移动蓝圈、删除红叉（画在原位置）
    if (layers.ai && aiMarks.length) {
      for (const m of aiMarks) {
        ctx.beginPath();
        if (m.kind === 'del') {
          ctx.strokeStyle = cssVar('--danger', '#e04b4b');
          ctx.lineWidth = 2;
          ctx.moveTo(m.x - 4, m.y - 4);
          ctx.lineTo(m.x + 4, m.y + 4);
          ctx.moveTo(m.x + 4, m.y - 4);
          ctx.lineTo(m.x - 4, m.y + 4);
          ctx.stroke();
        } else if (m.kind === 'add') {
          ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#2E7D32';
          ctx.fill();
        } else {
          ctx.arc(m.x, m.y, 4.5, 0, Math.PI * 2);
          ctx.strokeStyle = COLOR_AI;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }, [aiMarks, algPath, aiPts, layers, result]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  /* ---------------- 提取 ---------------- */

  const runExtract = useCallback(
    (override?: Partial<ExtractOptions>, silent = false): ExtractResult | null => {
      const img = imageDataRef.current;
      if (!img) return null;
      const merged = { ...opts, ...override };
      const r = extractTrack(img.data, img.width, img.height, merged);
      if (!silent) {
        setResult(r);
        setCalibrated(false);
        const cal = r.calibration;
        const parts: string[] = [`${r.segments.length} 段 / ${r.stats.outPoints} 点`, `像素长 ${Math.round(cal.totalPx)}`];
        if (cal.mPerPx > 0) parts.push(`约 ${(cal.totalM / 1000).toFixed(2)} 公里`);
        if (cal.coverage >= 0) parts.push(`覆盖率 ${(cal.coverage * 100).toFixed(0)}%`);
        setStatus(
          r.segments.length
            ? `完成：${parts.join(' · ')}（${r.stats.ms.toFixed(0)}ms）`
            : '没提取到轨迹线：把「红色阈值」调低、或把「最小面积」调小',
        );
      }
      return r;
    },
    [opts],
  );

  /** 自动校准：网格上真跑几遍，按评分挑最好的一组；返回采用的那份结果（AI 优化要用） */
  const autoCalibrate = useCallback(async (): Promise<ExtractResult | null> => {
    const img = imageDataRef.current;
    if (!img || busy) return null;
    setBusy('auto');
    const log: string[] = [];
    let best: { score: number; patch: Partial<ExtractOptions>; r: ExtractResult } | null = null;
    for (let i = 0; i < AUTO_GRID.length; i++) {
      const patchTry = AUTO_GRID[i];
      const merged = { ...opts, ...patchTry };
      const r = extractTrack(img.data, img.width, img.height, merged);
      const sc = scoreOf(r);
      const segInfo = `${r.segments.length} 段/${Math.round(r.calibration.totalPx)}px`;
      log.push(
        `#${i + 1} 饱和${merged.redSat} 明度${merged.redVal} 色相≤${merged.hueHi}° 红优势${merged.rDominance} 面积${merged.minArea} 断口${merged.gapPx} → ${segInfo} 得分 ${sc.toFixed(3)}`,
      );
      if (!best || sc > best.score) best = { score: sc, patch: patchTry, r };
      // 让出主线程，别让页面卡死
      await new Promise((res) => setTimeout(res, 0));
    }
    if (best) {
      patch(best.patch);
      setResult(best.r);
      setCalibrated(true);
      log.push(
        `已采用：饱和${best.patch.redSat} 明度${best.patch.redVal} 色相≤${best.patch.hueHi}° 红优势${best.patch.rDominance} 面积${best.patch.minArea} 断口${best.patch.gapPx}`,
      );
      setStatus(
        `自动校准完成：${best.r.segments.length} 段 · ${best.r.stats.outPoints} 点 · 得分 ${best.score.toFixed(3)}`,
      );
    }
    setAutoLog(log);
    setBusy(null);
    return best ? best.r : null;
  }, [busy, opts, patch]);

  /**
   * AI 优化：先保证有「参数自动校准」的结果，再把这份点列连同一张截图交给视觉模型，
   * 只要它返回最小必要的增删改（edits）与思考过程；应用后重建 AI 层叠在原结果上对比。
   * 不重跑提取——edits 的下标就是按当前点列给的，重跑会错位。
   */
  const aiOptimize = useCallback(async () => {
    if (!shotUrlRef.current || busy) return;
    const model = visionModel;
    if (!model) {
      showToast('先在「设置 → AI → 模型」里配一个能看图的模型', 3600);
      return;
    }
    let base = result;
    if (!base?.segments.length || !calibrated) {
      setStatus('先做参数自动校准，AI 在它的结果上优化…');
      base = await autoCalibrate();
    }
    if (!base?.segments.length) {
      showToast('没提取到轨迹：先把「红色阈值」「最小面积」调低，或换一张图', 3800);
      return;
    }
    const W = imgSize?.w ?? 0;
    const H = imgSize?.h ?? 0;
    const basePts = flattenSegments(base);
    setBusy('ai');
    setStatus(`AI 优化中：${model.alias} 正对照原图检查 ${basePts.length} 个点…`);
    try {
      const shot = await prepareShot(shotUrlRef.current);
      const w = W || shot.width;
      const h = H || shot.height;
      const r = await refineTrack(model, {
        dataUrl: shot.dataUrl,
        width: shot.width,
        height: shot.height,
        imageW: w,
        imageH: h,
        points: basePts,
        mPerPx: base.calibration.mPerPx,
        mileageKm: base.calibration.officialM / 1000,
        segments: base.segments.length,
        gaps: base.gaps.length,
      });
      const applied = applyEdits(basePts, r.edits, w, h);
      setAi(r);
      setAiPts(applied.points);
      setAiMarks(applied.marks);
      setAiCount({ add: applied.added, del: applied.removed, move: applied.moved });
      setAiThink(r.thinking || r.notes);

      // 模型报的校准依据：只补空位，不动用户手填的
      const next: Partial<ExtractOptions> = {};
      if (r.scale && (!opts.scaleMeter || !opts.scalePx)) {
        next.scaleMeter = r.scale.meter;
        next.scalePx = r.scale.px;
      }
      if (r.mileageKm && !opts.mileageKm) next.mileageKm = r.mileageKm;
      if (r.northDeg != null) setBearing(r.northDeg);
      if (Object.keys(next).length) patch(next);

      const bits = [
        `模型 ${r.model}`,
        `增 ${applied.added} · 删 ${applied.removed} · 改 ${applied.moved}`,
        `${basePts.length} → ${applied.points.length} 点`,
        r.scale ? `比例尺 ${r.scale.meter}m=${r.scale.px}px` : '',
        r.mileageKm ? `里程 ${r.mileageKm} km` : '',
        r.startGeo ? `起点坐标 ${r.startGeo.lat.toFixed(4)},${r.startGeo.lng.toFixed(4)}` : '',
        r.northDeg != null ? `正北 ${r.northDeg}°` : '',
      ].filter(Boolean);
      setAiLog(`${bits.join(' · ')}${r.notes ? `\n${r.notes}` : ''}`);
      setStatus(
        r.edits.length
          ? `AI 优化完成：增 ${applied.added} / 删 ${applied.removed} / 改 ${applied.moved}，已叠在原结果上对比`
          : 'AI 优化完成：模型认为当前结果不需要改（没返回增删改）',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`AI 优化失败：${msg}`);
      showToast(`AI 优化失败：${msg}`, 4200);
    } finally {
      setBusy(null);
    }
  }, [
    autoCalibrate,
    busy,
    calibrated,
    imgSize,
    opts.mileageKm,
    opts.scaleMeter,
    opts.scalePx,
    patch,
    result,
    visionModel,
  ]);

  /* ---------------- 载入 / 导出 ---------------- */

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('只能选图片（PNG / JPG）', 2600);
      return;
    }
    setStatus(`正在加载：${file.name}`);
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const oc = origCanvasRef.current;
        const rc = overlayRef.current;
        if (!oc || !rc) return;
        const octx = oc.getContext('2d');
        if (!octx) return;
        oc.width = img.width;
        oc.height = img.height;
        octx.drawImage(img, 0, 0);
        imageDataRef.current = octx.getImageData(0, 0, img.width, img.height);
        imgElRef.current = img;
        shotUrlRef.current = url;
        rc.width = img.width;
        rc.height = img.height;
        setImgSize({ w: img.width, h: img.height });
        setFileName(file.name);
        setResult(null);
        setAi(null);
        setAiPts([]);
        setAiMarks([]);
        setAiCount({ add: 0, del: 0, move: 0 });
        setAiThink('');
        setAutoLog([]);
        setAiLog('');
        setCalibrated(false);
        setStatus(`已载入 ${img.width}×${img.height}，点「提取轨迹」或「AI 优化」`);
      };
      img.onerror = () => setStatus('图片加载失败');
      img.src = url;
    };
    reader.onerror = () => setStatus('文件读取失败');
    reader.readAsDataURL(file);
  }, []);

  const downloadCSV = useCallback(() => {
    if (!result) return;
    const blob = new Blob([toCsv(result)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'track_points.csv';
    a.click();
  }, [result]);

  const onMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const rc = overlayRef.current;
      if (!rc) return;
      const rect = rc.getBoundingClientRect();
      const sx = rc.width / rect.width;
      const sy = rc.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * sx);
      const y = Math.round((e.clientY - rect.top) * sy);
      setCoord(mPerPx > 0 ? `像素 (${x}, ${y}) ≈ (${(x * mPerPx).toFixed(0)}m, ${(y * mPerPx).toFixed(0)}m)` : `像素 (${x}, ${y})`);
    },
    [mPerPx],
  );

  /* ---------------- 地图复现 ---------------- */

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const headRef = useRef<L.CircleMarker | null>(null);
  const rafRef = useRef(0);
  const progRef = useRef(0);

  const [scheme, setScheme] = useState<Scheme>('alg');
  const [anchorGeo, setAnchorGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [bearing, setBearing] = useState(0);
  const [speed, setSpeed] = useState(20);
  const [replaying, setReplaying] = useState(false);
  const [pickingAnchor, setPickingAnchor] = useState(false);
  const [progM, setProgM] = useState(0);
  const [saveName, setSaveName] = useState('');
  const [saveScheme, setSaveScheme] = useState<Scheme>('alg');

  const schemePath = scheme === 'ai' ? aiPts : algPath;

  /** 锚点：像素原点取所选方案的首点，经纬度来自地图上点的那一下 */
  const anchor = useMemo<GeoAnchor | null>(() => {
    if (!anchorGeo || schemePath.length === 0 || !(mPerPx > 0)) return null;
    return { px: schemePath[0].x, py: schemePath[0].y, lat: anchorGeo.lat, lng: anchorGeo.lng, mPerPx, bearing };
  }, [anchorGeo, bearing, mPerPx, schemePath]);

  const geoLine = useMemo(() => {
    if (!anchor || schemePath.length < 2) return [];
    return schemePath.map((p) => {
      const g = pxToGeo(anchor, p.x, p.y);
      return L.latLng(g.lat, g.lng);
    });
  }, [anchor, schemePath]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current).setView([30.2741, 120.1551], 15);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      attribution: '© 高德地图',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      setAnchorGeo({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPickingAnchor(false);
      showToast('已把轨迹起点定在这里，可拖方位角对齐', 2600);
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      headRef.current = null;
    };
  }, []);

  // 轨迹/锚点变了就重画：整条淡色底 + 走过的实线 + 头部圆点
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    headRef.current = null;
    if (geoLine.length < 2) return;
    L.polyline(geoLine, { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(layer);
    L.polyline(geoLine, { color: scheme === 'ai' ? COLOR_AI : cssVar('--primary', COLOR_ALG), weight: 4 }).addTo(layer);
    headRef.current = L.circleMarker(geoLine[0], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: scheme === 'ai' ? COLOR_AI : cssVar('--primary', COLOR_ALG),
      fillOpacity: 1,
    }).addTo(layer);
    map.fitBounds(L.latLngBounds(geoLine).pad(0.25));
    progRef.current = 0;
    setProgM(0);
  }, [geoLine, scheme]);

  const geoLineRef = useRef(geoLine);
  useEffect(() => {
    geoLineRef.current = geoLine;
  }, [geoLine]);
  const geoLenM = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < geoLine.length; i++) sum += geoLine[i - 1].distanceTo(geoLine[i]);
    return sum;
  }, [geoLine]);

  const replayTick = useCallback(
    (now: number) => {
      if (!replaying) return;
      const line = geoLineRef.current;
      if (line.length < 2) return;
      const dt = Math.min(0.2, (now - (lastFrame.current || now)) / 1000);
      lastFrame.current = now;
      progRef.current += speed * dt;
      const total = geoLenM;
      const target = Math.min(total, progRef.current);
      // 找 target 处的坐标：沿折线累加
      let cum = 0;
      let at = line[line.length - 1];
      for (let i = 1; i < line.length; i++) {
        const step = line[i - 1].distanceTo(line[i]);
        if (cum + step >= target) {
          const t = step > 0 ? (target - cum) / step : 0;
          at = L.latLng(
            line[i - 1].lat + (line[i].lat - line[i - 1].lat) * t,
            line[i - 1].lng + (line[i].lng - line[i - 1].lng) * t,
          );
          break;
        }
        cum += step;
      }
      headRef.current?.setLatLng(at);
      if (at) mapRef.current?.panTo(at, { animate: false });
      setProgM(Math.round(target));
      if (target >= total) {
        setReplaying(false);
        setStatus(`复现完成：走了 ${fmtLen(geoLenM)}`);
        return;
      }
      rafRef.current = requestAnimationFrame(replayTick);
    },
    [replaying, speed, geoLenM],
  );

  const lastFrame = useRef(0);

  useEffect(() => {
    if (!replaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }
    lastFrame.current = 0;
    rafRef.current = requestAnimationFrame(replayTick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [replaying, replayTick]);

  const startReplay = () => {
    if (geoLine.length < 2) {
      showToast('先在地图上点一下轨迹起点（需要设好比例尺）', 3200);
      return;
    }
    if (!replaying) {
      progRef.current = 0;
      headRef.current?.setLatLng(geoLine[0]);
    }
    setReplaying(true);
  };

  const useMyLocation = async () => {
    const fix = await locateMe();
    if (!fix) {
      showToast('取不到当前位置，检查定位权限', 3200);
      return;
    }
    setAnchorGeo({ lat: fix.lat, lng: fix.lng });
    showToast('已用当前位置作为轨迹起点', 2400);
  };

  /* ---------------- 保存为 .drloc ---------------- */

  const saveAsLocation = async () => {
    const path = saveScheme === 'ai' ? aiPts : algPath;
    if (path.length < 2) {
      showToast('这个方案还没有轨迹', 2600);
      return;
    }
    if (!(mPerPx > 0)) {
      showToast('先填「比例尺」或「官方里程」，不然像素换算不出米', 3600);
      return;
    }
    const anchorPx = { px: path[0].x, py: path[0].y };
    const geo = anchorGeo ?? (await locateMe().then((f) => (f ? { lat: f.lat, lng: f.lng } : null)));
    if (!geo) {
      showToast('先在地图上点一下轨迹起点，或用当前位置', 3600);
      return;
    }
    const a: GeoAnchor = { ...anchorPx, lat: geo.lat, lng: geo.lng, mPerPx, bearing };
    const points = toLocationPoints(path, a, { note: '截图提取' });
    if (points.length < 2) {
      showToast('轨迹点太少，没法保存', 2600);
      return;
    }
    const name = (saveName.trim() || `截图轨迹 ${new Date().toLocaleDateString()}`).slice(0, 40);
    try {
      const f = await createLocation({ name, points });
      bump();
      showToast(`已存为定位文件：${f.name}（${points.length} 点）`, 3600);
      setStatus(`已保存「${f.name}」：${points.length} 点，可以在「功能面板 → 定位」里打开`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`保存失败：${msg}`, 3600);
    }
  };

  /* ---------------- 渲染 ---------------- */

  const cal = result?.calibration;
  const gapsInfo = result?.gaps.length ? `${result.gaps.length} 处断口（红点）` : '无断口';
  const canAI = !!imgSize && !busy;
  const aiGeoStart = ai?.startGeo ?? null;

  return (
    <div className="lab-page">
      <LabHead title="轨迹提取" subKey="labTrack" />

      <p className="muted small lab-track-lead">
        把两步路 App 的截图拖进来：先按红色阈值 + 骨架形状校准筛出轨迹线，再把断开的段串成一条，
        最后沿弧长等距插值。可以让视觉模型再独立提一遍做对比，也可以把选中的方案落到地图上走一遍，
        满意了直接存成本库的定位文件。图片只在你浏览器里处理。
      </p>

      {/* 选图：一个真正的按钮 + 拖拽区，别让人去点一个没有样式的原生控件 */}
      <div
        className={`lab-track-pick${dragging ? ' is-drag' : ''}${hasImageNow(imgSize) ? ' has-file' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
      >
        <button type="button" className="btn btn-primary lab-track-pickbtn" onClick={() => fileRef.current?.click()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2" />
            <circle cx="8.6" cy="9.6" r="1.6" />
            <path d="M4.4 17l4.8-4.6 3.6 3.4 2.8-2.6 4 3.8" />
          </svg>
          选择截图
        </button>
        <div className="lab-track-pickmeta">
          <div className="lab-track-pickname">{imgSize ? fileName || '已载入截图' : '把两步路截图拖到这里，或点左边选一张'}</div>
          <div className="muted small">
            {imgSize ? `${imgSize.w}×${imgSize.h} · 只在本机处理` : 'PNG / JPG · 图片不上传，只发给用户自己配置的模型'}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="lab-track-bar">
        <button className="btn btn-primary" disabled={!imgSize || !!busy} onClick={() => runExtract()}>
          {busy === 'extract' ? '提取中…' : '提取轨迹'}
        </button>
        <button className="btn" disabled={!imgSize || !!busy} onClick={autoCalibrate}>
          {busy === 'auto' ? '校准中…' : '参数自动校准'}
        </button>
        <button
          className="btn"
          disabled={!canAI}
          onClick={aiOptimize}
          title="先做参数自动校准，再让视觉模型对照原图增删改点"
        >
          {busy === 'ai' ? 'AI 优化中…' : 'AI 优化'}
        </button>
        {models.length > 1 && (
          <select className="lab-track-num" value={visionModel?.alias ?? ''} onChange={(e) => setAlias(e.target.value)} aria-label="AI 模型">
            {models.map((m) => (
              <option key={m.alias} value={m.alias}>
                {m.alias}
                {m.capabilities.includes('image') ? '' : '（不支持图片）'}
              </option>
            ))}
          </select>
        )}
        <button className="btn" disabled={!result?.segments.length} onClick={downloadCSV}>
          下载 CSV
        </button>
        <span className="lab-track-coord">{coord}</span>
      </div>

      {/* 校准：比例尺定标 + 官方里程验收 */}
      <div className="lab-track-bar">
        <span className="lab-track-group">校准</span>
        <label>
          比例尺
          <input
            className="lab-track-num"
            type="number"
            min={0}
            step={100}
            value={opts.scaleMeter}
            onChange={(e) => patch({ scaleMeter: Number(e.target.value) })}
          />
          米 =
          <input
            className="lab-track-num"
            type="number"
            min={0}
            step={1}
            value={opts.scalePx}
            onChange={(e) => patch({ scalePx: Number(e.target.value) })}
          />
          像素
        </label>
        <label>
          官方里程
          <input
            className="lab-track-num"
            type="number"
            min={0}
            step={0.01}
            value={opts.mileageKm}
            onChange={(e) => patch({ mileageKm: Number(e.target.value) })}
          />
          公里
        </label>
        <label>
          断口阈值
          <input type="range" min={10} max={200} step={5} value={opts.gapPx} onChange={(e) => patch({ gapPx: Number(e.target.value) })} />
          <span className="lab-track-val">{opts.gapPx}</span>
        </label>
        <label>
          插值间距
          <input type="range" min={1} max={12} step={0.5} value={opts.resamplePx} onChange={(e) => patch({ resamplePx: Number(e.target.value) })} />
          <span className="lab-track-val">{opts.resamplePx}px</span>
        </label>
        <button className="btn btn-ghost" onClick={() => setShowAdv((v) => !v)}>
          {showAdv ? '收起参数' : '算法参数'}
        </button>
      </div>

      {showAdv && (
        <div className="lab-track-bar lab-track-adv">
          <label>
            饱和下限
            <input type="range" min={30} max={150} value={opts.redSat} onChange={(e) => patch({ redSat: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.redSat}</span>
          </label>
          <label>
            明度下限
            <input type="range" min={20} max={120} value={opts.redVal} onChange={(e) => patch({ redVal: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.redVal}</span>
          </label>
          <label>
            色相上界
            <input type="range" min={6} max={24} value={opts.hueHi} onChange={(e) => patch({ hueHi: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.hueHi}°</span>
          </label>
          <label>
            红优势
            <input type="range" min={1} max={1.8} step={0.05} value={opts.rDominance} onChange={(e) => patch({ rDominance: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.rDominance.toFixed(2)}</span>
          </label>
          <label>
            最小面积
            <input type="range" min={100} max={4000} step={50} value={opts.minArea} onChange={(e) => patch({ minArea: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.minArea}</span>
          </label>
          <label>
            短碎片下限
            <input type="range" min={0} max={160} step={5} value={opts.minFinalPx} onChange={(e) => patch({ minFinalPx: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.minFinalPx}px</span>
          </label>
          <label>
            补断口
            <input type="range" min={0} max={4} value={opts.closeIter} onChange={(e) => patch({ closeIter: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.closeIter}</span>
          </label>
          <label>
            平滑窗口
            <input type="range" min={1} max={21} step={2} value={opts.smoothWin} onChange={(e) => patch({ smoothWin: Number(e.target.value) })} />
            <span className="lab-track-val">{opts.smoothWin}</span>
          </label>
          <label>
            骨架精度
            <select className="lab-track-num" value={opts.skeletonScale} onChange={(e) => patch({ skeletonScale: Number(e.target.value) })}>
              <option value={1}>1× 慢但准</option>
              <option value={2}>2× 均衡</option>
              <option value={3}>3× 快</option>
            </select>
          </label>
        </div>
      )}

      {/* 对比：三层叠在一张图上，勾选决定看哪几层 */}
      <div className="lab-track-panel lab-track-compare">
        <div className="lab-track-layers">
          <label>
            <input type="checkbox" checked={layers.img} onChange={(e) => setLayers((l) => ({ ...l, img: e.target.checked }))} />
            原图
          </label>
          <label>
            <input type="checkbox" checked={layers.alg} onChange={(e) => setLayers((l) => ({ ...l, alg: e.target.checked }))} />
            <i className="lab-track-dot" style={{ background: 'var(--primary)' }} />
            提取的轨迹
            {result ? <span className="lab-track-count"> {result.stats.outPoints} 点</span> : null}
          </label>
          <label>
            <input
              type="checkbox"
              checked={layers.ai}
              disabled={!aiPts.length}
              onChange={(e) => setLayers((l) => ({ ...l, ai: e.target.checked }))}
            />
            <i className="lab-track-dot" style={{ background: COLOR_AI }} />
            AI 优化后的轨迹
            {aiPts.length ? <span className="lab-track-count"> {aiPts.length} 点</span> : null}
          </label>
          {diff && (
            <span className="lab-track-diff">
              偏差 平均 {diff.meanPx.toFixed(1)}px · 最大 {diff.maxPx.toFixed(1)}px
              {mPerPx > 0 ? `（约 ${(diff.meanPx * mPerPx).toFixed(0)}m）` : ''} · 长度 {diff.lenDiffPct >= 0 ? '+' : ''}
              {diff.lenDiffPct.toFixed(1)}%
            </span>
          )}
        </div>
        <canvas ref={overlayRef} className="lab-track-canvas" onMouseMove={onMove} />
        <canvas ref={origCanvasRef} hidden />
        <div className="muted small lab-track-gaps">
          {result ? `${result.segments.length} 段 · ${gapsInfo}` : '还没有提取结果'}
          {aiPts.length ? ' · AI 层虚线：绿点新增、蓝圈移动、红叉删除' : ' · AI 层还没有结果'}
        </div>
      </div>

      <div className="lab-track-status">{status}</div>

      {mPerPx > 0 && (
        <div className="lab-track-calib">
          <div>
            <span className="lab-track-k">比例尺</span>
            <span className="lab-track-v">
              {mPerPx.toFixed(3)} 米/像素
              {cal?.source === 'scale' ? '（由截图比例尺定标）' : cal?.source === 'mileage' ? '（由官方里程反推）' : '（手填）'}
            </span>
          </div>
          <div>
            <span className="lab-track-k">提取总长</span>
            <span className="lab-track-v">{fmtLen(pathLengthPx(algPath) * mPerPx)}</span>
          </div>
          {cal && cal.officialM > 0 && (
            <div>
              <span className="lab-track-k">官方里程</span>
              <span className="lab-track-v">{fmtLen(cal.officialM)}</span>
            </div>
          )}
          {cal && cal.coverage >= 0 && (
            <div>
              <span className="lab-track-k">覆盖率</span>
              <span className="lab-track-v" style={{ color: cal.coverage > 0.9 ? 'var(--primary)' : 'var(--danger)' }}>
                {(cal.coverage * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {aiThink && (
        <details className="lab-help lab-track-think" open>
          <summary>AI 的思考过程（它看图和看当前点列后的判断）</summary>
          <pre className="lab-track-log lab-track-reason">{aiThink}</pre>
          {ai && ai.edits.length > 0 && (
            <ul className="lab-track-edits">
              {ai.edits.slice(0, 60).map((e, i) => (
                <li key={`${e.op}-${e.index}-${i}`} className={`is-${e.op}`}>
                  <span className="lab-track-eop">{e.op === 'move' ? '移动' : e.op === 'delete' ? '删除' : '新增'}</span>
                  <span className="lab-track-eidx">#{e.index}</span>
                  {e.op !== 'delete' && e.x != null && e.y != null && (
                    <span className="lab-track-eat">
                      → ({e.x.toFixed(3)}, {e.y.toFixed(3)})
                    </span>
                  )}
                  <span className="lab-track-ereason">{e.reason || '模型没给理由'}</span>
                </li>
              ))}
            </ul>
          )}
          {ai && ai.edits.length > 60 && (
            <p className="muted small">只列前 60 处，共 {ai.edits.length} 处。</p>
          )}
        </details>
      )}

      {aiLog && (
        <details className="lab-help">
          <summary>
            AI 优化记录（增 {aiCount.add} · 删 {aiCount.del} · 改 {aiCount.move}）
          </summary>
          <pre className="lab-track-log">{aiLog}</pre>
        </details>
      )}

      {autoLog.length > 0 && (
        <details className="lab-help">
          <summary>参数自动校准记录（在参数网格上真跑，按评分挑最好的一组）</summary>
          <pre className="lab-track-log">{autoLog.join('\n')}</pre>
        </details>
      )}

      {result && result.stats.droppedSegments > 0 && (
        <div className="lab-track-dropped muted small">
          已丢弃 {result.stats.droppedSegments} 个非轨迹色块：
          {Object.entries(result.stats.droppedBy)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </div>
      )}

      {/* 地图复现：像素轨迹落到真实地图上走一遍 */}
      <div className="lab-track-panel lab-track-mapwrap">
        <h3>地图复现</h3>
        <div className="lab-track-bar lab-track-mapbar">
          <span className="lab-track-group">方案</span>
          <div className="loc-seg">
            <button className={scheme === 'alg' ? 'on' : undefined} onClick={() => setScheme('alg')} aria-pressed={scheme === 'alg'}>
              提取的轨迹
            </button>
            <button
              className={scheme === 'ai' ? 'on' : undefined}
              disabled={!aiPts.length}
              onClick={() => setScheme('ai')}
              aria-pressed={scheme === 'ai'}
            >
              AI 轨迹
            </button>
          </div>
          <button className={`btn${pickingAnchor ? ' btn-primary' : ''}`} onClick={() => setPickingAnchor(true)}>
            {pickingAnchor ? '点地图选起点…' : '在地图上点起点'}
          </button>
          <button className="btn" onClick={useMyLocation}>
            用当前位置
          </button>
          {aiGeoStart && (
            <button className="btn" onClick={() => setAnchorGeo(aiGeoStart)} title="模型从截图里读出的起点坐标">
              用 AI 读到的起点
            </button>
          )}
          <label>
            方位
            <input type="range" min={0} max={359} value={bearing} onChange={(e) => setBearing(Number(e.target.value))} />
            <span className="lab-track-val">{bearing}°</span>
          </label>
          <label>
            复现速度
            <input type="range" min={2} max={60} step={2} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            <span className="lab-track-val">{speed}m/s</span>
          </label>
          <button className="btn btn-primary" disabled={!geoLine.length} onClick={() => (replaying ? setReplaying(false) : startReplay())}>
            {replaying ? '⏹ 停止' : '▶ 复现'}
          </button>
          <span className="muted small">
            {anchor
              ? `${fmtLen(geoLenM)} · 已走 ${progM}m`
              : mPerPx > 0
                ? '在地图上点一下起点（或用当前位置）'
                : '先定标（比例尺 / 官方里程），再选一个起点'}
          </span>
        </div>
        <div ref={mapEl} className="map-leaflet lab-track-map" />
      </div>

      {/* 保存：选一个方案，直接存成 .drloc */}
      <div className="lab-track-bar">
        <span className="lab-track-group">存成本库定位</span>
        <div className="loc-seg">
          <button className={saveScheme === 'alg' ? 'on' : undefined} onClick={() => setSaveScheme('alg')} aria-pressed={saveScheme === 'alg'}>
            提取的轨迹
          </button>
          <button
            className={saveScheme === 'ai' ? 'on' : undefined}
            disabled={!aiPts.length}
            onClick={() => setSaveScheme('ai')}
            aria-pressed={saveScheme === 'ai'}
          >
            AI 轨迹
          </button>
        </div>
        <input
          className="lab-track-num lab-track-name"
          placeholder="文件名（默认按日期）"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button className="btn btn-primary" onClick={saveAsLocation}>
          保存为定位文件
        </button>
        <span className="muted small">
          {(saveScheme === 'ai' ? aiPts : algPath).length} 点 · 按 1.2m/s 均匀配时间
        </span>
      </div>

      <details className="lab-help">
        <summary>它是怎么取的 / 两套结果的差别</summary>
        <p className="muted small">
          ① 红色判定：饱和度、明度都过线，色相落在 0~{opts.hueHi}° 或 {opts.hueLo}~180°，并且 R
          通道要明显压过 G/B——最后这条是为了不把橙黄色道路和蓝色水面当成轨迹。
          ② 闭运算补 1~3px 的细断口。③ 连通域之后做形状校准：轨迹是细长曲线，骨架长度一定
          超过包围盒对角线；红圈「终」、POI 图标是实心块或圆环，据此丢掉。④ 每段骨架化后按分叉点
          切成若干简单链，每条支路都走一遍（不会在岔口抄近路画假直线）。⑤ 串联：最长段作种子，
          贪心把其余链接到两端，间距超过「断口阈值」的不接。⑥ 插值：沿弧长等距重采样 + 移动平均平滑。
          ⑦ 校准：填「比例尺 500 米 = 200 像素」就能得到米制坐标与覆盖率；只填官方里程则以里程反推比例尺。
        </p>
        <p className="muted small">
          AI 优化走的是「在原结果上改」而不是「重画一条」：点它时会先跑参数自动校准（拿分最高的那组参数），
          再把当前点列（抽样到 160 个，带原始下标）和截图（长边缩到 1400px）一起发给能看图的模型。
          模型只返回最小必要的三类修改——断口处 insert、把图标当轨迹的 delete、整段偏了的 move，
          外带一段 reasoning 说明它为什么这么改。页面按下标把这些修改应用回完整点列，所以「AI 优化后」
          和「提取的轨迹」点一一对应，偏差也还是按弧长对齐逐点算。图上绿点是新增、蓝圈是移动、红叉是删除
          （叉画在原位置），实线是算法结果、虚线是优化后的结果，红色小圆点是算法断口。
        </p>
        <p className="muted small">
          为什么不让模型直接描一条：像素阈值法已经把「红线在哪」做得很准，它的错误集中在断口、图标和整段平移；
          从零描线等于把正确的部分也重算一遍，偏差更大，也说不清改了什么。
        </p>
        <p className="muted small">
          地图复现要三样东西：比例尺（米/像素）、一个起点（地图上点一下 / 当前位置 / AI 读到的坐标）、
          以及「方位」——截图正上方相对真北的角度，截图上指北针朝哪就调多少。最后「保存为定位文件」会把
          当前方案的像素点按这些参数换成经纬度，写进文件库，和自动打点是同一个 <code>.drloc</code> 格式。
        </p>
        <p className="muted small">
          CSV 列：<code>idx,x,y,x_m,y_m,cum_m,seg</code>。x/y 是截图像素坐标；x_m/y_m 以每段首点为原点、
          y 轴翻转成向上为正；cum_m 是段内累计米数；seg 是断口分段号。
        </p>
      </details>
    </div>
  );
}

/** 只是让 className 表达式短一点：有图就点亮选图卡 */
function hasImageNow(size: { w: number; h: number } | null): boolean {
  return !!size;
}
