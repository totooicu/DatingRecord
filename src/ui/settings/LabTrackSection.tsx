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
import type { MouseEvent, PointerEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  DEFAULT_OPTIONS,
  buildTrack,
  extractPoints,
  extractTrack,
  toCsv,
  type ExtractOptions,
  type ExtractPointsResult,
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
import {
  buildPointRouteGraph,
  manualStats,
  nearestNode,
  shortestPath,
  straightLine,
} from '../../core/tools/trackRoute';
import { clusterChains, clusterColor, type ClusterResult } from '../../core/tools/trackCluster';
import { createLocation } from '../../core/location/locationFile';
import { locateMe } from '../../core/runtime/locationAuto';
import { addLinePath, addStrokePoints, erasePoints } from '../../core/tools/trackEdit';
import { listModels, type AiModel } from '../../core/ai';
import { bump } from '../../store';
import { LabHead } from './LabEdgeSection';
import { showToast } from '../toast';
import { saveText } from '../../core/io/save';

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

/** 对比图里的图层：底图 / 提取的点 / 算法轨迹 / AI 优化 / 手动布线 */
interface Layers {
  img: boolean;
  pts: boolean;
  alg: boolean;
  ai: boolean;
  man: boolean;
}

type Scheme = 'alg' | 'ai' | 'man';

const COLOR_AI = '#2196F3';
const COLOR_ALG = '#d9536b';
const COLOR_MAN = '#F57C00';
/** 点云用青色：和原图红线、AI 蓝、手动橙都能分开 */
const COLOR_DOT = '#00897B';

/** 手动布线的一条腿：沿线走 or 两段不连通只能拉直线 */
interface ManualLeg {
  pts: TrackPoint[];
  straight: boolean;
}

/** 点选时离轨迹多远以内算「点在轨迹上」 */
const SNAP_PX = 18;
/** 手动布线的转角权重：直行不加钱，急转加价，路口就不会来回切 */
const TURN_K = 0.8;

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
  /** 第一步的产物：点云（还没连线） */
  const [dotRes, setDotRes] = useState<ExtractPointsResult | null>(null);
  const [ai, setAi] = useState<AiTrackResult | null>(null);
  const [aiPts, setAiPts] = useState<TrackPoint[]>([]);
  const [layers, setLayers] = useState<Layers>({ img: true, pts: true, alg: true, ai: true, man: true });
  const [busy, setBusy] = useState<'extract' | 'link' | 'auto' | 'ai' | null>(null);
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
  // 修点 / 画路径：A 是上一次点的位置，点 B 就自动从 A 走到 B
  const [mode, setMode] = useState<'browse' | 'manual' | 'erase' | 'line' | 'add'>('browse');
  const manualMode = mode === 'manual';
  const [manualLegs, setManualLegs] = useState<ManualLeg[]>([]);
  const [manualAnchor, setManualAnchor] = useState<{ idx: number | null; pt: TrackPoint } | null>(null);
  // 擦除半径 / 补线起点 / 点云历史（撤销用）
  const [brush, setBrush] = useState(20);
  const [lineStart, setLineStart] = useState<TrackPoint | null>(null);
  const [dotHistory, setDotHistory] = useState<ExtractPointsResult[]>([]);
  const [cursor, setCursor] = useState<TrackPoint | null>(null);
  // 画点：正在画的那一笔（只在渲染时用，真正的数据在 strokeRef）
  const [draft, setDraft] = useState<TrackPoint[] | null>(null);
  const strokeRef = useRef<TrackPoint[]>([]);
  const paintingRef = useRef(false);
  // 两个视图：图片（画路径）/ 地图（复现 + 保存）
  const [tab, setTab] = useState<'img' | 'map'>('img');
  const [drawer, setDrawer] = useState<'' | 'params' | 'layers'>('');
  // 缩放：'fit' = 适应窗口；数字 = 相对原图的倍数
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const viewRef = useRef<HTMLDivElement | null>(null);

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

  // 距离聚类：把第一步的点按「隔得够近」归成连通网络。第二步只在这些网络内部串链，
  // 网络之间绝不连——图上看得出是两片，画出来就不能硬接成一条。
  const clusters = useMemo<ClusterResult | null>(
    () => (dotRes?.chains.length ? clusterChains(dotRes.chains, opts.gapPx) : null),
    [dotRes, opts.gapPx],
  );

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

  /* ---------------- 手动布线：点 A → 点 B，沿点云走 ---------------- */

  // 节点是「提取出来的点」，不是画好的轨迹线：没画自动路径也能连，被自动路径当
  // 毛刺丢掉的支线也还能选中。簇内端点桥接（≤ gapPx），跨簇仍然不连。
  const graph = useMemo(
    () => (dotRes?.chains.length ? buildPointRouteGraph(dotRes.chains, opts.gapPx) : null),
    [dotRes, opts.gapPx],
  );
  const manualPts = useMemo(() => manualLegs.flatMap((l) => l.pts), [manualLegs]);
  const manStats = useMemo(() => {
    const st = manualStats(manualPts);
    return {
      ...st,
      along: manualLegs.filter((l) => !l.straight).length,
      line: manualLegs.filter((l) => l.straight).length,
    };
  }, [manualLegs, manualPts]);

  /** 点/连线一变，AI 层与手动路径都作废（下标和段号都指向旧结果） */
  const clearTrackLayers = useCallback(() => {
    setResult(null);
    setAi(null);
    setAiPts([]);
    setAiMarks([]);
    setAiCount({ add: 0, del: 0, move: 0 });
    setAiThink('');
    setAiLog('');
    setManualLegs([]);
    setManualAnchor(null);
    setCalibrated(false);
  }, []);

  /** 擦除 / 补线：改的是点云本身，先记一份历史，再清掉依赖点云的轨迹层 */
  const applyDot = useCallback(
    (next: ExtractPointsResult, why: string) => {
      if (dotRes) setDotHistory((h) => [...h.slice(-9), dotRes]);
      setDotRes(next);
      clearTrackLayers();
      setStatus(why);
    },
    [clearTrackLayers, dotRes],
  );

  const undoDot = useCallback(() => {
    const prev = dotHistory[dotHistory.length - 1];
    if (!prev) return;
    setDotHistory(dotHistory.slice(0, -1));
    setDotRes(prev);
    clearTrackLayers();
    setStatus(`已撤销：点云回到 ${prev.points.length} 点`);
  }, [clearTrackLayers, dotHistory]);

  /** 点在附近已有轨迹上就吸附过去，让补的线能和原轨迹接上 */
  const snapDot = useCallback(
    (x: number, y: number): TrackPoint => {
      let best: TrackPoint = { x, y };
      let bd = Math.max(12, brush);
      for (const p of dotRes?.points ?? []) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return { x: best.x, y: best.y };
    },
    [brush, dotRes],
  );

  const onCanvasClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const c = overlayRef.current;
      if (!c || !imgSize) return;
      if (mode === 'add') return; // 画点是按住拖，不走 click
      const rect = c.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (c.width / rect.width);
      const y = (e.clientY - rect.top) * (c.height / rect.height);

      // 擦除：点一下删掉画笔范围内的点，之后重新聚类/重连
      if (mode === 'erase') {
        if (!dotRes?.points.length) {
          showToast('先「提取点」，才有东西可擦', 2600);
          return;
        }
        const next = erasePoints(dotRes, x, y, brush);
        const gone = dotRes.points.length - next.points.length;
        applyDot(next, gone ? `擦掉 ${gone} 个点（剩 ${next.points.length} 点），点「自动画路径」重连` : '画笔范围内没有点');
        return;
      }

      // 补直线：点两下，把漏掉的一段直接补进点云
      if (mode === 'line') {
        if (!dotRes?.points.length) {
          showToast('先「提取点」，再补线', 2600);
          return;
        }
        const p = snapDot(x, y);
        if (!lineStart) {
          setLineStart(p);
          setStatus('补直线：已选起点，再点终点（这里漏提取的红线会被接上）');
          return;
        }
        const next = addLinePath(dotRes, lineStart, p);
        setLineStart(null);
        applyDot(next, `补了一条 ${Math.round(Math.hypot(p.x - lineStart.x, p.y - lineStart.y))}px 的直线，点「自动画路径」重连`);
        return;
      }

      if (mode !== 'manual') return;
      const hit = graph ? nearestNode(graph, x, y, SNAP_PX) : null;
      const target: TrackPoint = hit && graph ? graph.pts[hit.idx] : { x, y };

      if (!manualAnchor) {
        if (!hit) {
          showToast('起点请点在提取出来的点上（18px 内自动吸附）', 3200);
          return;
        }
        setManualAnchor({ idx: hit.idx, pt: target });
        setStatus('手动布线：起点 A 已选，再点一个点就自动沿着点云走过去');
        return;
      }

      const routed = graph && hit && manualAnchor.idx != null ? shortestPath(graph, manualAnchor.idx, hit.idx, TURN_K) : null;
      const leg = routed ?? straightLine(manualAnchor.pt, target);
      if (leg.length < 2) return;
      setManualLegs((prev) => [...prev, { pts: leg, straight: !routed }]);
      setManualAnchor({ idx: hit ? hit.idx : null, pt: target });
      const len = pathLengthPx(leg);
      setStatus(
        `手动布线：${routed ? '沿点云走过去' : '两点不在同一网络，直接拉直线'}（${Math.round(len)}px）`,
      );
    },
    [applyDot, brush, dotRes, graph, imgSize, lineStart, manualAnchor, mode, snapDot],
  );

  /* ---------------- 画点：按住拖出一条点列 ---------------- */

  /** 屏幕坐标 → 原图像素坐标（canvas 的 CSS 尺寸会随缩放变） */
  const toImageXY = useCallback((clientX: number, clientY: number): TrackPoint | null => {
    const c = overlayRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * (c.width / rect.width),
      y: (clientY - rect.top) * (c.height / rect.height),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (mode !== 'add' || !imgSize) return;
      if (!dotRes?.points.length) {
        showToast('先「提取点」，再往上补点', 2600);
        return;
      }
      const p = toImageXY(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      paintingRef.current = true;
      strokeRef.current = [p];
      setDraft([p]);
      setStatus('画点：按住拖动画一段点云，松手后生效');
    },
    [dotRes, imgSize, mode, toImageXY],
  );

  const onPointerUp = useCallback(() => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const pts = strokeRef.current;
    strokeRef.current = [];
    setDraft(null);
    if (!dotRes?.points.length || !pts.length) return;
    // 两个采样点之间可能隔着好几像素，按 2px 加密
    const next = addStrokePoints(dotRes, pts, 2);
    const added = next.points.length - dotRes.points.length;
    applyDot(next, added ? `加了 ${added} 个点，点「自动画路径」重连` : '这一笔没落下新点');
  }, [applyDot, dotRes]);

  /* ---------------- 放大 / 平移 ---------------- */

  const currentScale = useCallback(() => {
    const c = overlayRef.current;
    if (!c || !imgSize) return 1;
    const w = c.getBoundingClientRect().width;
    return w > 0 ? w / imgSize.w : 1;
  }, [imgSize]);

  /** 换缩放档位：保住视口中心对着的那个原图像素，不会一放大就跑到角落 */
  const applyZoom = useCallback(
    (next: number | 'fit') => {
      const view = viewRef.current;
      if (!imgSize) return;
      const cur = zoom === 'fit' ? currentScale() : zoom;
      let cx = 0.5;
      let cy = 0.5;
      if (view && cur > 0) {
        cx = (view.scrollLeft + view.clientWidth / 2) / (imgSize.w * cur);
        cy = (view.scrollTop + view.clientHeight / 2) / (imgSize.h * cur);
      }
      setZoom(next);
      if (view && next !== 'fit') {
        requestAnimationFrame(() => {
          view.scrollLeft = Math.max(0, cx * imgSize.w * next - view.clientWidth / 2);
          view.scrollTop = Math.max(0, cy * imgSize.h * next - view.clientHeight / 2);
        });
      }
    },
    [currentScale, imgSize, zoom],
  );

  const zoomBy = useCallback(
    (f: number) => {
      if (!imgSize) return;
      const cur = zoom === 'fit' ? currentScale() : zoom;
      applyZoom(Math.max(0.2, Math.min(6, Number((cur * f).toFixed(2)))));
    },
    [applyZoom, currentScale, imgSize, zoom],
  );

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

    // 第一步的点云：只说明「这里检出了红点」，没有顺序、也不连线。
    // 按连通簇上色：同一种颜色 = 一个能连起来的网络；颜色一变，中间就是断的
    if (layers.pts && dotRes?.chains.length) {
      const { chains } = dotRes;
      for (let i = 0; i < chains.length; i++) {
        ctx.fillStyle = clusterColor(clusters?.clusterOf[i] ?? 0);
        for (const p of chains[i].path) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
    }

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

    // 手动布线：沿线走实线，不连通拉直线用虚线；当前起点 A 画一个圆点
    if (layers.man && manualLegs.length) {
      for (const leg of manualLegs) {
        if (leg.pts.length > 1) stroke(leg.pts, COLOR_MAN, 3, leg.straight);
      }
      if (manualAnchor) {
        ctx.beginPath();
        ctx.arc(manualAnchor.pt.x, manualAnchor.pt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_MAN;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 擦除画笔：跟着鼠标画一个圈，让人知道这一下会擦掉多大范围
    if (mode === 'erase' && cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, brush, 0, Math.PI * 2);
      ctx.strokeStyle = cssVar('--danger', '#e04b4b');
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 画点：正在拖的这一笔 + 落点提示
    if (mode === 'add') {
      if (draft && draft.length) {
        for (const p of draft) {
          ctx.fillStyle = '#7E57C2';
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        }
        if (draft.length > 1) {
          ctx.beginPath();
          ctx.moveTo(draft[0].x, draft[0].y);
          for (let i = 1; i < draft.length; i += 1) ctx.lineTo(draft[i].x, draft[i].y);
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(126,87,194,0.6)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (cursor) {
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#7E57C2';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // 补直线的起点：先点一下的那个点
    if (mode === 'line' && lineStart) {
      ctx.beginPath();
      ctx.arc(lineStart.x, lineStart.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#7E57C2';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // AI 改过的地方标出来：新增绿点、移动蓝圈、删除红叉（画在原位置）
    if (layers.ai && aiMarks.length) {      for (const m of aiMarks) {
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
  }, [
    aiMarks,
    algPath,
    aiPts,
    brush,
    clusters,
    cursor,
    dotRes,
    layers,
    lineStart,
    manualAnchor,
    manualLegs,
    mode,
    result,
    draft,
  ]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // 点云一变（重新取点 / 擦除 / 补线），旧起点对应的节点下标就失效了
  useEffect(() => {
    setManualAnchor(null);
  }, [dotRes]);

  /* ---------------- 第一步：只提取点 ---------------- */

  const runPoints = useCallback(
    (override?: Partial<ExtractOptions>): ExtractPointsResult | null => {
      const img = imageDataRef.current;
      if (!img) return null;
      const r = extractPoints(img.data, img.width, img.height, { ...opts, ...override });
      const cl = r.chains.length
        ? clusterChains(r.chains, { ...opts, ...override }.gapPx).clusters.length
        : 0;
      setDotRes(r);
      // 点变了，之前的连线和手动路径都作废（点集不同，下标/图都不可复用）
      setResult(null);
      setAi(null);
      setAiPts([]);
      setAiMarks([]);
      setAiCount({ add: 0, del: 0, move: 0 });
      setAiThink('');
      setAiLog('');
      setManualLegs([]);
      setManualAnchor(null);
      setCalibrated(false);
      setDotHistory([]);
      setLineStart(null);
      setStatus(
        r.points.length
          ? `提取点完成：${r.points.length} 点 · ${r.chains.length} 条骨架链 · ${cl} 个连通簇（${r.stats.ms.toFixed(0)}ms）。下一步点「自动画路径」`
          : '没提取到点：把「红色阈值」调低、或把「最小面积」调小',
      );
      return r;
    },
    [opts],
  );

  /* ---------------- 第二步：把点连成轨迹 ---------------- */

  /** 自动连线：串链 → 平滑 → 等距重采样 → 定标，得到一条有序轨迹 */
  const autoLink = useCallback(
    async (
      override: Partial<ExtractOptions> = {},
      silent = false,
      src: ExtractPointsResult | null = dotRes,
    ): Promise<ExtractResult | null> => {
      const img = imageDataRef.current;
      if (!img || !src?.chains.length || busy) return null;
      setBusy('link');
      // 串链是 O(链数²) 的贪心，先让「连线中…」渲染出来再算
      await new Promise((res) => setTimeout(res, 0));
      const merged = { ...opts, ...override };
      // 先聚类，再串链：簇内才允许连接，所以「自动连线」出来的是每簇一段
      const cl = clusterChains(src.chains, merged.gapPx);
      const r = buildTrack(src.chains, merged, {
        redPx: src.stats.redPx,
        droppedBy: src.stats.droppedBy,
        droppedSegments: src.stats.droppedSegments,
        clusterOf: cl.clusterOf,
      });
      setBusy(null);
      if (!silent) {
        setResult(r);
        // 重新连线后点列变了，AI 层按下标存的修改全部失效
        setAi(null);
        setAiPts([]);
        setAiMarks([]);
        setAiCount({ add: 0, del: 0, move: 0 });
        setAiThink('');
        setAiLog('');
        const cal = r.calibration;
        const parts: string[] = [
          `${cl.clusters.length} 个连通簇 / ${r.segments.length} 段 / ${r.stats.outPoints} 点`,
          `像素长 ${Math.round(cal.totalPx)}`,
        ];
        if (cal.mPerPx > 0) parts.push(`约 ${(cal.totalM / 1000).toFixed(2)} 公里`);
        if (cal.coverage >= 0) parts.push(`覆盖率 ${(cal.coverage * 100).toFixed(0)}%`);
        setStatus(
          r.segments.length
            ? `画路径完成：${parts.join(' · ')}（${r.stats.ms.toFixed(0)}ms）`
            : '没画出路径：把「断口阈值」调大、或把「最小面积」调小',
        );
      }
      return r;
    },
    [busy, dotRes, opts],
  );

  /** 参数自动校准：网格上真跑几遍（内部会连一次线来评分），挑最好的一组；结果只留点云 */
  const autoCalibrate = useCallback(async (): Promise<{
    res: ExtractPointsResult;
    patch: Partial<ExtractOptions>;
  } | null> => {
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
    let out: { res: ExtractPointsResult; patch: Partial<ExtractOptions> } | null = null;
    if (best) {
      patch(best.patch);
      // 校准只负责「用什么阈值取点」，轨迹留给第二步
      const pr = extractPoints(img.data, img.width, img.height, { ...opts, ...best.patch });
      setDotRes(pr);
      setResult(null);
      setAi(null);
      setAiPts([]);
      setAiMarks([]);
      setAiCount({ add: 0, del: 0, move: 0 });
      setAiThink('');
      setAiLog('');
      setManualLegs([]);
      setManualAnchor(null);
      setCalibrated(true);
      log.push(
        `已采用：饱和${best.patch.redSat} 明度${best.patch.redVal} 色相≤${best.patch.hueHi}° 红优势${best.patch.rDominance} 面积${best.patch.minArea} 断口${best.patch.gapPx}`,
      );
      setStatus(
        `自动校准完成：采用得分 ${best.score.toFixed(3)} 的那组参数（${pr.points.length} 点、${pr.chains.length} 条骨架链、${
          clusterChains(pr.chains, { ...opts, ...best.patch }.gapPx).clusters.length
        } 个连通簇），下一步点「自动画路径」`,
      );
      out = { res: pr, patch: best.patch };
    }
    setAutoLog(log);
    setBusy(null);
    return out;
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
    if (!base?.segments.length) {
      // AI 只改「已有轨迹」：先确保点提取出来了，再自动连线
      let pr = dotRes;
      let extra: Partial<ExtractOptions> = {};
      if (!pr?.chains.length || !calibrated) {
        setStatus('先提取点并自动连线，AI 在连好的轨迹上优化…');
        const best = await autoCalibrate();
        if (best) {
          pr = best.res;
          extra = best.patch;
        }
      }
      base = await autoLink(extra, false, pr);
    }
    if (!base?.segments.length) {
      showToast('没有可优化的轨迹：先「提取点」，再「自动连线」', 3800);
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
    autoLink,
    busy,
    calibrated,
    dotRes,
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
        setDotRes(null);
        setAi(null);
        setAiPts([]);
        setAiMarks([]);
        setAiCount({ add: 0, del: 0, move: 0 });
        setAiThink('');
        setAutoLog([]);
        setAiLog('');
        setCalibrated(false);
        setManualLegs([]);
        setManualAnchor(null);
        setMode('browse');
        setDotHistory([]);
        setLineStart(null);
        setTab('img');
        setZoom('fit');
        // 流程是「导入图片 → 自动取点 → 修点 → 画路径 → 地图对齐」：
        // 取点这一步不用用户再点一次，导入完直接跑（几百毫秒），失败会自己报原因。
        setStatus(`已载入 ${img.width}×${img.height}，正在自动取点…`);
        setTimeout(() => {
          if (imageDataRef.current) runPoints();
        }, 0);
      };
      img.onerror = () => setStatus('图片加载失败');
      img.src = url;
    };
    reader.onerror = () => setStatus('文件读取失败');
    reader.readAsDataURL(file);
  }, [runPoints]);

  const downloadCSV = useCallback(() => {
    if (!result) return;
    // 壳里存进手机「下载」：<a download> 在 WebView 里是死的
    void saveText(toCsv(result), 'track_points.csv', 'text/csv;charset=utf-8').catch((e) =>
      showToast(e instanceof Error ? e.message : String(e), 2600),
    );
  }, [result]);

  const onMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const rc = overlayRef.current;
      if (!rc) return;
      const rect = rc.getBoundingClientRect();
      const sx = rc.width / rect.width;
      const sy = rc.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * sx);
      const y = Math.round((e.clientY - rect.top) * sy);
      if (mode === 'erase' || mode === 'line' || mode === 'add') setCursor({ x, y });
      setCoord(mPerPx > 0 ? `像素 (${x}, ${y}) ≈ (${(x * mPerPx).toFixed(0)}m, ${(y * mPerPx).toFixed(0)}m)` : `像素 (${x}, ${y})`);

      // 画点：按住时把轨迹攒起来（屏幕上一个点至少 2px，否则一笔会落几千个点）
      if (!paintingRef.current) return;
      const p = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
      const last = strokeRef.current[strokeRef.current.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      strokeRef.current = [...strokeRef.current, p];
      setDraft(strokeRef.current);
    },
    [mPerPx, mode],
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

  const pathOf = (s: Scheme) => (s === 'ai' ? aiPts : s === 'man' ? manualPts : algPath);
  const schemeColor = (s: Scheme) => (s === 'ai' ? COLOR_AI : s === 'man' ? COLOR_MAN : cssVar('--primary', COLOR_ALG));

  const schemePath = pathOf(scheme);

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
    L.polyline(geoLine, { color: schemeColor(scheme), weight: 4 }).addTo(layer);
    headRef.current = L.circleMarker(geoLine[0], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: schemeColor(scheme),
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
    const path = pathOf(saveScheme);
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

  const modeHint =
    mode === 'manual'
      ? manualAnchor
        ? '起点 A 已选：点下一个点，自动沿点云走过去'
        : '点提取出来的起点 A（18px 内自动吸附）'
      : mode === 'add'
        ? '按住拖动画一段点：漏掉的弯道自己描回去'
        : mode === 'erase'
          ? '点图上误检的红点/图标，擦掉后重新画路径'
          : mode === 'line'
            ? '点两下补一条漏掉的红线（端点会自动吸附到附近轨迹）'
            : '浏览：滚轮 / 双指缩放，拖动平移';

  // 流程指示：导入图片 → 自动取点 → 修点 → 画路径 → 地图对齐
  const stage: 1 | 2 | 3 | 4 | 5 = !imgSize
    ? 1
    : !dotRes
      ? 2
      : !(result || manualPts.length || aiPts.length)
        ? 3
        : tab === 'map'
          ? 5
          : 4;
  const steps: { n: 1 | 2 | 3 | 4 | 5; label: string }[] = [
    { n: 1, label: '导入图片' },
    { n: 2, label: '自动取点' },
    { n: 3, label: '修点' },
    { n: 4, label: '画路径' },
    { n: 5, label: '地图对齐' },
  ];

  return (
    <div className="lab-page lab-track">
      <LabHead title="轨迹提取" subKey="labTrack" />

      <div className="lab-track-status">{status}</div>

      <div className="lab-track-steps">
        {steps.map(({ n, label }) => (
          <button
            key={n}
            type="button"
            className={`lab-track-step${stage === n ? ' on' : ''}${n < stage ? ' done' : ''}`}
            aria-current={stage === n ? 'step' : undefined}
            disabled={
              (n === 2 && (!imgSize || !!busy)) ||
              ((n === 3 || n === 4) && !dotRes?.points.length) ||
              (n === 5 && !(result || manualPts.length))
            }
            onClick={() => {
              if (n === 1) {
                fileRef.current?.click();
                return;
              }
              if (n === 2) {
                runPoints();
                return;
              }
              if (n === 3) {
                setTab('img');
                if (mode === 'browse') setMode('add');
                setStatus('修点：画点 / 擦除点 / 补直线，改完点再画路径');
                return;
              }
              if (n === 4) {
                setTab('img');
                autoLink();
                return;
              }
              setTab('map');
              setTimeout(() => mapRef.current?.invalidateSize(), 80);
            }}
          >
            <i>{n}</i>
            {label}
          </button>
        ))}
      </div>

      <div className="lab-track-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === 'img' ? 'on' : undefined}
          aria-selected={tab === 'img'}
          onClick={() => setTab('img')}
        >
          图片 · 画路径
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'map' ? 'on' : undefined}
          aria-selected={tab === 'map'}
          onClick={() => {
            setTab('map');
            setTimeout(() => mapRef.current?.invalidateSize(), 80);
          }}
        >
          地图 · 复现与保存
        </button>
      </div>

      <div className={`lab-track-pane${tab === 'img' ? '' : ' is-off'}`}>
        {!imgSize ? (
          <div
            className={`lab-track-pick${dragging ? ' is-drag' : ''}`}
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
              <div className="lab-track-pickname">把两步路截图拖到这里，或点左边选一张</div>
              <div className="muted small">PNG / JPG · 图片不上传，只发给用户自己配置的模型</div>
            </div>
          </div>
        ) : (
          <div className="lab-track-filemeta muted small">
            <span className="lab-track-pickname">{fileName || '已载入截图'}</span>
            <span>
              {imgSize.w}×{imgSize.h} · 只在本机处理
            </span>
          </div>
        )}
        {/* 画布始终挂着：首次选图时 loadFile 要靠 overlayRef 写尺寸，卸掉就永远加载不进来 */}
        <div className={`lab-track-stage${imgSize ? '' : ' is-off'}`}>
          {/* 离屏画布：载入时把原图拍成像素，之后取点/取色都读它 */}
          <canvas ref={origCanvasRef} hidden />
          <div className="lab-track-view" ref={viewRef}>
            <canvas
              ref={overlayRef}
              className={`lab-track-canvas${mode !== 'browse' ? ' is-editing' : ''}`}
              onPointerMove={onMove}
              onPointerLeave={() => setCursor(null)}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={onCanvasClick}
              style={
                zoom === 'fit' || !imgSize
                  ? undefined
                  : { width: `${Math.round(imgSize.w * zoom)}px`, maxWidth: 'none' }
              }
            />
          </div>
          <div className="lab-track-zoombar">
            <button className="btn btn-ghost" onClick={() => zoomBy(1 / 1.5)} title="缩小">
              −
            </button>
            <span className="lab-track-val">{zoom === 'fit' ? '适应' : `${Math.round(zoom * 100)}%`}</span>
            <button className="btn btn-ghost" onClick={() => zoomBy(1.5)} title="放大">
              +
            </button>
            <button className="btn btn-ghost" onClick={() => applyZoom('fit')}>
              适应窗口
            </button>
            <button className="btn btn-ghost" onClick={() => applyZoom(1)}>
              1:1
            </button>
            <span className="lab-track-coord">{coord}</span>
          </div>
          {mode === 'erase' && (
            <label className="lab-track-brush">
              画笔
              <input
                type="range"
                min={8}
                max={60}
                step={2}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
              />
              <span className="lab-track-val">{brush}px</span>
            </label>
          )}
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

        <div className="lab-track-modes">
          <span className="lab-track-group">修点</span>
          <button
            type="button"
            className={mode === 'add' ? 'on' : undefined}
            aria-pressed={mode === 'add'}
            disabled={!imgSize || !dotRes?.points.length}
            onClick={() => {
              setMode(mode === 'add' ? 'browse' : 'add');
              setLineStart(null);
              setStatus(mode === 'add' ? '已结束画点' : '画点：按住拖动，把漏掉的弯道描回去');
            }}
          >
            画点
          </button>
          <button
            type="button"
            className={mode === 'erase' ? 'on' : undefined}
            aria-pressed={mode === 'erase'}
            disabled={!imgSize || !dotRes?.points.length}
            onClick={() => {
              setMode(mode === 'erase' ? 'browse' : 'erase');
              setLineStart(null);
              setStatus(
                mode === 'erase' ? '已结束擦除' : '擦除：点图上误检的红点/图标，擦完重新「自动画路径」',
              );
            }}
          >
            擦除点
          </button>
          <button
            type="button"
            className={mode === 'line' ? 'on' : undefined}
            aria-pressed={mode === 'line'}
            disabled={!imgSize || !dotRes?.points.length}
            onClick={() => {
              setMode(mode === 'line' ? 'browse' : 'line');
              setLineStart(null);
              setStatus(mode === 'line' ? '已结束补线' : '补直线：点两下，把漏提取的一段接上');
            }}
          >
            补直线
          </button>
          <span className="lab-track-group">画路径</span>
          <button
            type="button"
            className={mode === 'manual' ? 'on' : undefined}
            aria-pressed={mode === 'manual'}
            disabled={!imgSize}
            onClick={() => {
              setMode(mode === 'manual' ? 'browse' : 'manual');
              setManualAnchor(null);
              setLineStart(null);
              if (mode !== 'manual') setLayers((l) => ({ ...l, man: true }));
              setStatus(
                mode === 'manual'
                  ? '已结束手动布线'
                  : graph
                    ? '手动布线：点提取出来的起点 A，再点 B，系统沿点云导航过去'
                    : '手动布线：先「提取点」，之后点 A、点 B 就能沿点云走',
              );
            }}
          >
            {manualMode ? '结束布线' : '手动布线'}
          </button>
          {manualMode && (
            <>
              <button
                className="btn btn-ghost"
                disabled={!manualLegs.length}
                onClick={() => {
                  setManualLegs((prev) => {
                    const next = prev.slice(0, -1);
                    const last = next[next.length - 1];
                    if (!last) {
                      setManualAnchor(null);
                    } else {
                      const end = last.pts[last.pts.length - 1];
                      const hit = graph ? nearestNode(graph, end.x, end.y, SNAP_PX) : null;
                      setManualAnchor({ idx: hit ? hit.idx : null, pt: end });
                    }
                    return next;
                  });
                }}
              >
                撤销一段
              </button>
              <button
                className="btn btn-ghost"
                disabled={!manualLegs.length}
                onClick={() => {
                  setManualLegs([]);
                  setManualAnchor(null);
                  setStatus('手动路径已清空');
                }}
              >
                清空手动
              </button>
            </>
          )}
          {dotHistory.length > 0 && (
            <button className="btn btn-ghost" onClick={undoDot}>
              撤销修点
            </button>
          )}
          <span className="muted small lab-track-modehint">{modeHint}</span>
          {(manualMode || manualLegs.length > 0) && (
            <span className="lab-track-maninfo">
              {manualLegs.length
                ? `${manualLegs.length} 段（沿轨迹 ${manStats.along} · 直线 ${manStats.line}）· ${manualPts.length} 点 · ${fmtLen(
                    manStats.lenPx * mPerPx,
                  )}${manStats.dupPts ? ` · 重复经过 ${manStats.dupPts} 点` : ''}`
                : '手动路径是「A→B 沿轨迹导航」：同一条路可以反复经过，长度按走两遍算'}
            </span>
          )}
        </div>

        <div className="lab-track-actions">
          <button className="btn btn-primary" disabled={!imgSize || !!busy} onClick={() => runPoints()}>
            {busy === 'extract' ? '提取中…' : '提取点'}
          </button>
          <button
            className="btn btn-primary"
            disabled={!dotRes?.chains.length || !!busy}
            onClick={() => autoLink()}
            title="按连通簇在点图上找最长的一条路，短枝丢掉、长枝按往返"
          >
            {busy === 'link' ? '画路径中…' : '自动画路径'}
          </button>
          <button className="btn" disabled={!canAI} onClick={aiOptimize} title="让视觉模型对照原图增删改点">
            {busy === 'ai' ? 'AI 优化中…' : 'AI 优化'}
          </button>
          <button className="btn" disabled={!imgSize || !!busy} onClick={autoCalibrate}>
            {busy === 'auto' ? '校准中…' : '自动校准'}
          </button>
          {imgSize && (
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              换图
            </button>
          )}
        </div>

        <div className="muted small lab-track-pointsinfo">
          {dotRes
            ? `${dotRes.points.length} 点 · ${dotRes.chains.length} 条骨架链 · ${clusters?.clusters.length ?? 0} 个连通簇（最大 ${clusters?.clusters[0]?.points ?? 0} 点）· 红色像素 ${dotRes.stats.redPx} · 丢弃 ${dotRes.stats.droppedSegments} 个色块`
            : '还没有提取点：这一步只找红色轨迹上的像素，不连线'}
        </div>
        {clusters && clusters.clusters.length > 1 ? (
          <div className="muted small lab-track-clusterinfo">
            同色 = 一个连通网络（最近距离 ≤ {opts.gapPx}px）。共 {clusters.clusters.length} 个网络：
            {clusters.clusters.slice(0, 6).map((c, i) => (
              <span key={i} className="lab-track-clusterchip">
                <i style={{ background: clusterColor(i) }} />
                {c.points} 点
              </span>
            ))}
            {clusters.clusters.length > 6 ? ' …' : ''}
          </div>
        ) : null}
        <div className="muted small lab-track-gaps">
          {result ? `轨迹 ${result.segments.length} 段 · ${gapsInfo} · ${result.stats.outPoints} 点` : '还没有画路径'}
          {aiPts.length ? ' · AI 层虚线：绿点新增、蓝圈移动、红叉删除' : ''}
          {manualPts.length ? ` · 手动 ${manualLegs.length} 段（沿轨迹 ${manStats.along} · 直线 ${manStats.line}）· ${manualPts.length} 点` : ''}
          {manStats.dupPts ? ` · 重复经过 ${manStats.dupPts} 点` : ''}
        </div>

        <div className="lab-track-drawers">
          <button
            type="button"
            className={drawer === 'params' ? 'on' : undefined}
            onClick={() => setDrawer(drawer === 'params' ? '' : 'params')}
          >
            参数与校准
          </button>
          <button
            type="button"
            className={drawer === 'layers' ? 'on' : undefined}
            onClick={() => setDrawer(drawer === 'layers' ? '' : 'layers')}
          >
            图层与偏差
          </button>
        </div>

        {drawer === 'params' && (
          <>
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
                {showAdv ? '收起高级参数' : '高级参数'}
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

            {autoLog.length > 0 && (
              <details className="lab-help">
                <summary>参数自动校准记录（在参数网格上真跑，按评分挑最好的一组）</summary>
                <pre className="lab-track-log">{autoLog.join('\n')}</pre>
              </details>
            )}

            {dotRes && dotRes.stats.droppedSegments > 0 && (
              <div className="lab-track-dropped muted small">
                已丢弃 {dotRes.stats.droppedSegments} 个非轨迹色块：
                {Object.entries(dotRes.stats.droppedBy)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </div>
            )}
          </>
        )}

        {drawer === 'layers' && (
          <div className="lab-track-panel lab-track-compare">
            <div className="lab-track-layers">
              <label>
                <input type="checkbox" checked={layers.img} onChange={(e) => setLayers((l) => ({ ...l, img: e.target.checked }))} />
                原图
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={layers.pts}
                  disabled={!dotRes?.points.length}
                  onChange={(e) => setLayers((l) => ({ ...l, pts: e.target.checked }))}
                />
                <i className="lab-track-dot" style={{ background: COLOR_DOT }} />
                提取的点
                {dotRes ? <span className="lab-track-count"> {dotRes.points.length} 点</span> : null}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={layers.alg}
                  disabled={!result?.segments.length}
                  onChange={(e) => setLayers((l) => ({ ...l, alg: e.target.checked }))}
                />
                <i className="lab-track-dot" style={{ background: 'var(--primary)' }} />
                自动路径
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
              <label>
                <input
                  type="checkbox"
                  checked={layers.man}
                  disabled={!manualPts.length}
                  onChange={(e) => setLayers((l) => ({ ...l, man: e.target.checked }))}
                />
                <i className="lab-track-dot" style={{ background: COLOR_MAN }} />
                手动路径
                {manualPts.length ? <span className="lab-track-count"> {manualPts.length} 点</span> : null}
              </label>
              {diff && (
                <span className="lab-track-diff">
                  偏差 平均 {diff.meanPx.toFixed(1)}px · 最大 {diff.maxPx.toFixed(1)}px
                  {mPerPx > 0 ? `（约 ${(diff.meanPx * mPerPx).toFixed(0)}m）` : ''} · 长度 {diff.lenDiffPct >= 0 ? '+' : ''}
                  {diff.lenDiffPct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="lab-track-bar">
              <button className="btn btn-ghost" disabled={!result?.segments.length} onClick={downloadCSV}>
                下载 CSV
              </button>
              <span className="muted small">x,y 是截图像素，cum_m 是段内累计米数</span>
            </div>
            {models.length > 0 && (
              <label className="muted small">
                AI 模型
                <select className="lab-track-num" value={visionModel?.alias ?? ''} onChange={(e) => setAlias(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.alias} value={m.alias}>
                      {m.alias}
                      {m.capabilities.includes('image') ? '' : '（不支持图片）'}
                    </option>
                  ))}
                </select>
              </label>
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
            {ai && ai.edits.length > 60 && <p className="muted small">只列前 60 处，共 {ai.edits.length} 处。</p>}
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
      </div>

      <div className={`lab-track-pane${tab === 'map' ? '' : ' is-off'}`}>
        <div className="lab-track-panel lab-track-mapwrap">
          <div className="lab-track-bar lab-track-mapbar">
            <span className="lab-track-group">方案</span>
            <div className="loc-seg">
              <button className={scheme === 'alg' ? 'on' : undefined} onClick={() => setScheme('alg')} aria-pressed={scheme === 'alg'}>
                自动轨迹
              </button>
              <button
                className={scheme === 'ai' ? 'on' : undefined}
                disabled={!aiPts.length}
                onClick={() => setScheme('ai')}
                aria-pressed={scheme === 'ai'}
              >
                AI 轨迹
              </button>
              <button
                className={scheme === 'man' ? 'on' : undefined}
                disabled={!manualPts.length}
                onClick={() => setScheme('man')}
                aria-pressed={scheme === 'man'}
              >
                手动路径
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

        <div className="lab-track-bar">
          <span className="lab-track-group">存成本库定位</span>
          <div className="loc-seg">
            <button className={saveScheme === 'alg' ? 'on' : undefined} onClick={() => setSaveScheme('alg')} aria-pressed={saveScheme === 'alg'}>
              自动轨迹
            </button>
            <button
              className={saveScheme === 'ai' ? 'on' : undefined}
              disabled={!aiPts.length}
              onClick={() => setSaveScheme('ai')}
              aria-pressed={saveScheme === 'ai'}
            >
              AI 轨迹
            </button>
            <button
              className={saveScheme === 'man' ? 'on' : undefined}
              disabled={!manualPts.length}
              onClick={() => setSaveScheme('man')}
              aria-pressed={saveScheme === 'man'}
            >
              手动路径
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
          <span className="muted small">{pathOf(saveScheme).length} 点 · 按 1.2m/s 均匀配时间</span>
        </div>
      </div>

      <details className="lab-help">
        <summary>它是怎么取点的 / 路径是怎么画出来的</summary>
        <p className="muted small">
          <b>流程</b>：导入图片 → 自动取点 → 修点（画点 / 擦除点 / 补直线）→ 画路径（自动 / 手动 / AI）
          → 地图对齐。取点在导入后自动跑一次，改完参数可以点「自动取点」重来；修点改的是点云本身，
          所以修完要重新画路径。
        </p>
        <p className="muted small">
          <b>① 提取点</b>：红色判定（饱和度、明度过线，色相落在 0~{opts.hueHi}° 或 {opts.hueLo}~180°，
          且 R 通道明显压过 G/B）→ 闭运算补 1~3px 细断口 → 连通域 + 形状校准（骨架长 / 包围盒对角线
          &lt; 0.95 判为圆形图标，实心块直接丢）→ 骨架化后按分叉点切成简单链，摊成点云。
          点云按<b>距离聚类</b>上色：同色 = 一个能连起来的网络，颜色一变中间就是断的。
        </p>
        <p className="muted small">
          <b>② 自动画路径</b>：把点连成一张图（链内相邻、簇内端点桥接），从任一端点做两次最短路
          求出<b>最长测地线</b>当主干；主轴之外的短枝丢掉、长枝按「往返」写回点列，环线剩下的半圈在末尾
          接回去，所以整条路只画一遍、不会重复。之后沿弧长等距重采样 + 移动平均平滑。
        </p>
        <p className="muted small">
          <b>③ 手动布线</b>：点起点 A（18px 内吸附到<b>点云里的点</b>）再点 B，在点云图上跑带<b>转角惩罚</b>
          的最短路——直行不加钱、急转加价，所以路口不会来回切；跨连通簇找不到路时直接拉直线（橙色虚线）。
          因为图是拿点建的，还没自动画路径也能手动连，被自动路径当毛刺丢掉的支线也还能走。
          手动路径是<b>有序点列</b>，A→B→A 会把同一条路算两遍，统计里的「重复经过」就是它。
        </p>
        <p className="muted small">
          <b>画点 / 擦除点 / 补直线</b>：画点是按住拖出一条点列，把漏掉的弯道描回去；擦除是按画笔半径
          删掉点云里的一圈点（图标被误检时用）；补直线是把漏提取的一段直线接上。三者改的都是点云本身，
          之后重新聚类、重新画路径，结果才是自洽的；每一步都留了撤销。
        </p>
        <p className="muted small">
          <b>AI 优化</b>：只做「最小必要修改」——断口处 insert、误检 delete、整段偏了 move，附带 reasoning。
          模型不重画整条线：像素阈值已经把「红线在哪」做得很准，重画等于把正确的部分也重算一遍。
          图上绿点是新增、蓝圈是移动、红叉是删除，实线是算法结果、虚线是优化后的结果。
        </p>
        <p className="muted small">
          <b>地图复现</b>要三样东西：比例尺（米/像素）、起点（地图上点一下 / 当前位置 / AI 读到的坐标）、
          方位（截图正上方相对真北的角度）。「保存为定位文件」会把当前方案的像素点换成经纬度，
          写进文件库，和自动打点是同一个 <code>.drloc</code> 格式。
        </p>
        <p className="muted small">
          CSV 列：<code>idx,x,y,x_m,y_m,cum_m,seg</code>。x/y 是截图像素坐标；x_m/y_m 以每段首点为原点、
          y 轴翻转成向上为正；cum_m 是段内累计米数；seg 是断口分段号。
        </p>
      </details>
    </div>
  );
}
