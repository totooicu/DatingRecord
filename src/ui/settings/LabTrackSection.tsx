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
// 「自动校准」是在参数网格上真跑几遍，用评分挑一组（有里程时按覆盖率误差打分，
// 没有时按「红色像素召回 + 断口数」打分）——这就是页面上的 AI 调参，不是玄学。
//
// 全程本地：canvas + FileReader，图片不出浏览器，也不碰本库数据。
import { useCallback, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  DEFAULT_OPTIONS,
  extractTrack,
  toCsv,
  type ExtractOptions,
  type ExtractResult,
} from '../../core/tools/trackExtract';
import { LabHead } from './LabEdgeSection';

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

export function LabTrackSection() {
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  const [opts, setOpts] = useState<ExtractOptions>({ ...DEFAULT_OPTIONS });
  const [hasImage, setHasImage] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('就绪：选一张两步路截图');
  const [coord, setCoord] = useState('悬停右图看坐标');
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const [showAdv, setShowAdv] = useState(false);

  const patch = useCallback((p: Partial<ExtractOptions>) => {
    setOpts((prev) => ({ ...prev, ...p }));
  }, []);

  /* ---------------- 画结果 ---------------- */

  const drawResult = useCallback((r: ExtractResult) => {
    const rc = resultCanvasRef.current;
    if (!rc) return;
    const ctx = rc.getContext('2d');
    if (!ctx) return;
    const W = rc.width;
    const H = rc.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const line = cssVar('--primary', '#d9536b');
    const danger = cssVar('--danger', '#e04b4b');

    // 轨迹线：先描粗底再描细，视觉上更像一条路
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    r.segments.forEach((seg, si) => {
      if (seg.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(seg.points[0].x, seg.points[0].y);
      for (let i = 1; i < seg.points.length; i++) ctx.lineTo(seg.points[i].x, seg.points[i].y);
      ctx.strokeStyle = line;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 起点 / 终点标记
      const a = seg.points[0];
      const b = seg.points[seg.points.length - 1];
      ctx.fillStyle = danger;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (si === 0) ctx.fillText('起', a.x, a.y);
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 断口：两段之间用虚线连，说明这里没提取到（不冒充真实轨迹）
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = danger;
    ctx.lineWidth = 1;
    r.gaps.forEach((g) => {
      const s1 = r.segments[g.afterSegment];
      const s2 = r.segments[g.afterSegment + 1];
      if (!s1 || !s2) return;
      const a = s1.points[s1.points.length - 1];
      const b = s2.points[0];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }, []);

  /* ---------------- 提取 ---------------- */

  const runExtract = useCallback(
    (override?: Partial<ExtractOptions>, silent = false): ExtractResult | null => {
      const img = imageDataRef.current;
      if (!img) return null;
      const merged = { ...opts, ...override };
      const r = extractTrack(img.data, img.width, img.height, merged);
      if (!silent) {
        setResult(r);
        drawResult(r);
        const cal = r.calibration;
        const parts: string[] = [
          `${r.segments.length} 段 / ${r.stats.outPoints} 点`,
          `像素长 ${Math.round(cal.totalPx)}`,
        ];
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
    [opts, drawResult],
  );

  /** 自动校准：网格上真跑几遍，按评分挑最好的一组 */
  const autoCalibrate = useCallback(async () => {
    const img = imageDataRef.current;
    if (!img || busy) return;
    setBusy(true);
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
      drawResult(best.r);
      log.push(
        `已采用：饱和${best.patch.redSat} 明度${best.patch.redVal} 色相≤${best.patch.hueHi}° 红优势${best.patch.rDominance} 面积${best.patch.minArea} 断口${best.patch.gapPx}`,
      );
      setStatus(
        `自动校准完成：${best.r.segments.length} 段 · ${best.r.stats.outPoints} 点 · 得分 ${best.score.toFixed(3)}`,
      );
    }
    setAutoLog(log);
    setBusy(false);
  }, [busy, drawResult, opts, patch]);

  /* ---------------- 载入 / 导出 ---------------- */

  const loadFile = useCallback((file: File) => {
    setStatus(`正在加载: ${file.name}`);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const oc = origCanvasRef.current;
        const rc = resultCanvasRef.current;
        if (!oc || !rc) return;
        const octx = oc.getContext('2d');
        if (!octx) return;
        oc.width = img.width;
        oc.height = img.height;
        octx.drawImage(img, 0, 0);
        imageDataRef.current = octx.getImageData(0, 0, img.width, img.height);
        rc.width = img.width;
        rc.height = img.height;
        const rctx = rc.getContext('2d');
        if (rctx) {
          rctx.fillStyle = '#ffffff';
          rctx.fillRect(0, 0, img.width, img.height);
        }
        setHasImage(true);
        setResult(null);
        setAutoLog([]);
        setStatus(`已加载 ${img.width}×${img.height}，点「提取轨迹」或「自动校准」`);
      };
      img.onerror = () => setStatus('图片加载失败');
      img.src = e.target?.result as string;
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

  const onMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const rc = resultCanvasRef.current;
    if (!rc) return;
    const rect = rc.getBoundingClientRect();
    const sx = rc.width / rect.width;
    const sy = rc.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * sx);
    const y = Math.round((e.clientY - rect.top) * sy);
    const cal = result?.calibration;
    if (cal && cal.mPerPx > 0 && cal.source === 'scale') {
      setCoord(`坐标: (${x}, ${y}) ≈ (${(x * cal.mPerPx).toFixed(0)}m, ${(y * cal.mPerPx).toFixed(0)}m)`);
    } else {
      setCoord(`坐标: (${x}, ${y})`);
    }
  }, [result]);

  const cal = result?.calibration;
  const gapsInfo = result?.gaps.length ? `${result.gaps.length} 处断口（虚线）` : '无断口';

  return (
    <div className="lab-page">
      <LabHead title="轨迹提取" subKey="labTrack" />

      <p className="muted small lab-track-lead">
        把两步路 App 的截图拖进来：先按红色阈值 + 骨架形状校准筛出轨迹线，再把断开的段串成一条，
        最后沿弧长等距插值。填上截图里的比例尺或官方里程，还能换算成米并给出覆盖率。
        图片只在你浏览器里处理，不上传、不入库。
      </p>

      <div className="lab-track-bar">
        <label className="lab-track-file">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
            }}
          />
        </label>
        <button className="btn" disabled={!hasImage || busy} onClick={autoCalibrate}>
          {busy ? '校准中…' : '自动校准'}
        </button>
        <button className="btn btn-primary" disabled={!hasImage || busy} onClick={() => runExtract()}>
          提取轨迹
        </button>
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
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={opts.gapPx}
            onChange={(e) => patch({ gapPx: Number(e.target.value) })}
          />
          <span className="lab-track-val">{opts.gapPx}</span>
        </label>
        <label>
          插值间距
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={opts.resamplePx}
            onChange={(e) => patch({ resamplePx: Number(e.target.value) })}
          />
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
            <input
              type="range"
              min={30}
              max={150}
              value={opts.redSat}
              onChange={(e) => patch({ redSat: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.redSat}</span>
          </label>
          <label>
            明度下限
            <input
              type="range"
              min={20}
              max={120}
              value={opts.redVal}
              onChange={(e) => patch({ redVal: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.redVal}</span>
          </label>
          <label>
            色相上界
            <input
              type="range"
              min={6}
              max={24}
              value={opts.hueHi}
              onChange={(e) => patch({ hueHi: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.hueHi}°</span>
          </label>
          <label>
            红优势
            <input
              type="range"
              min={1}
              max={1.8}
              step={0.05}
              value={opts.rDominance}
              onChange={(e) => patch({ rDominance: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.rDominance.toFixed(2)}</span>
          </label>
          <label>
            最小面积
            <input
              type="range"
              min={100}
              max={4000}
              step={50}
              value={opts.minArea}
              onChange={(e) => patch({ minArea: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.minArea}</span>
          </label>
          <label>
            短碎片下限
            <input
              type="range"
              min={0}
              max={160}
              step={5}
              value={opts.minFinalPx}
              onChange={(e) => patch({ minFinalPx: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.minFinalPx}px</span>
          </label>
          <label>
            补断口
            <input
              type="range"
              min={0}
              max={4}
              value={opts.closeIter}
              onChange={(e) => patch({ closeIter: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.closeIter}</span>
          </label>
          <label>
            平滑窗口
            <input
              type="range"
              min={1}
              max={21}
              step={2}
              value={opts.smoothWin}
              onChange={(e) => patch({ smoothWin: Number(e.target.value) })}
            />
            <span className="lab-track-val">{opts.smoothWin}</span>
          </label>
          <label>
            骨架精度
            <select
              className="lab-track-num"
              value={opts.skeletonScale}
              onChange={(e) => patch({ skeletonScale: Number(e.target.value) })}
            >
              <option value={1}>1× 慢但准</option>
              <option value={2}>2× 均衡</option>
              <option value={3}>3× 快</option>
            </select>
          </label>
        </div>
      )}

      <div className="lab-track-panels">
        <div className="lab-track-panel">
          <h3>原图</h3>
          <canvas ref={origCanvasRef} className="lab-track-canvas" />
        </div>
        <div className="lab-track-panel">
          <h3>
            提取结果{' '}
            <span className="lab-track-count">
              {result ? `${result.stats.outPoints} 点 · ${gapsInfo}` : ''}
            </span>
          </h3>
          <canvas
            ref={resultCanvasRef}
            className="lab-track-canvas"
            onMouseMove={onMove}
          />
        </div>
      </div>

      <div className="lab-track-status">{status}</div>

      {cal && cal.mPerPx > 0 && (
        <div className="lab-track-calib">
          <div>
            <span className="lab-track-k">比例尺</span>
            <span className="lab-track-v">
              {cal.mPerPx.toFixed(3)} 米/像素
              {cal.source === 'scale' ? '（由截图比例尺定标）' : '（由官方里程反推）'}
            </span>
          </div>
          <div>
            <span className="lab-track-k">提取总长</span>
            <span className="lab-track-v">{(cal.totalM / 1000).toFixed(2)} 公里</span>
          </div>
          {cal.officialM > 0 && (
            <div>
              <span className="lab-track-k">官方里程</span>
              <span className="lab-track-v">{(cal.officialM / 1000).toFixed(2)} 公里</span>
            </div>
          )}
          {cal.coverage >= 0 && (
            <div>
              <span className="lab-track-k">覆盖率</span>
              <span
                className="lab-track-v"
                style={{ color: cal.coverage > 0.9 ? 'var(--primary)' : 'var(--danger)' }}
              >
                {(cal.coverage * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {autoLog.length > 0 && (
        <details className="lab-help" open>
          <summary>自动校准记录（在参数网格上真跑，按评分挑最好的一组）</summary>
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

      <details className="lab-help">
        <summary>它是怎么取的</summary>
        <p className="muted small">
          ① 红色判定：饱和度、明度都过线，色相落在 0~{opts.hueHi}° 或 {opts.hueLo}~180°，并且 R
          通道要明显压过 G/B——最后这条是为了不把橙黄色道路和蓝色水面当成轨迹。
          ② 闭运算补 1~3px 的细断口。③ 连通域之后做形状校准：轨迹是细长曲线，骨架长度一定
          超过包围盒对角线；红圈「终」、POI 图标是实心块或圆环，据此丢掉；左上角红色 ✕ 这类
          「十字/星形」图标则由「四条等长短臂」判据剔除。④ 每段骨架化后按分叉点切成若干简单
          链，每条支路都走一遍（不会在岔口抄近路画假直线）。⑤ 串联：最长段作种子，贪心把其余
          链接到两端，间距超过「断口阈值」的不接；残余短碎片（低于「短碎片下限」）按噪点丢掉。
          ⑥ 插值：沿弧长等距重采样 + 移动平均平滑，输出间距均匀的点列。
          ⑦ 校准：填「比例尺 500 米 = 200 像素」就能得到米制坐标与覆盖率；只填官方里程则以
          里程反推比例尺（此时覆盖率不显示，因为没有独立定标）。
        </p>
        <p className="muted small">
          CSV 列：<code>idx,x,y,x_m,y_m,cum_m,seg</code>。x/y 是截图像素坐标；x_m/y_m
          以每段首点为原点、y 轴翻转成向上为正；cum_m 是段内累计米数；seg 是断口分段号。
        </p>
      </details>
    </div>
  );
}
