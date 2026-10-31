// 「修点 / 画路径」两组模式按钮。
//
// 这块原来是组件体里 117 行的一段 JSX：每个按钮点了都要同时动 mode、status、lineStart、
// manualAnchor、layers，散在父组件里父组件就永远瘦不下来。现在整块连逻辑一起搬进来，
// 父组件只把状态和 setter 递进来——按钮文案、禁用条件、切换时的提示语都跟按钮写在一起，
// 改一个按钮不用在 1800 行里上下翻。

import type { Dispatch, SetStateAction } from 'react';
import { nearestNode } from '../../../core/tools/trackRoute';
import { SNAP_PX, fmtLen, type Layers, type ManualLeg } from './model';

export type TrackMode = 'browse' | 'manual' | 'erase' | 'line' | 'add';

export interface TrackModeBarProps {
  mode: TrackMode;
  setMode: (m: TrackMode) => void;
  setStatus: (s: string) => void;
  setLineStart: (p: null) => void;
  setManualAnchor: (a: { idx: number | null; pt: { x: number; y: number } } | null) => void;
  setLayers: Dispatch<SetStateAction<Layers>>;
  setManualLegs: Dispatch<SetStateAction<ManualLeg[]>>;
  /** 点云图：手动布线撤销一段时要重新吸附到最近的节点 */
  graph: ReturnType<typeof import('../../../core/tools/trackRoute').buildPointRouteGraph> | null;
  hasImage: boolean;
  hasDots: boolean;
  manualMode: boolean;
  manualLegs: ManualLeg[];
  manualPtsLen: number;
  manStats: { along: number; line: number; lenPx: number; dupPts: number };
  mPerPx: number;
  modeHint: string;
  canUndoDots: boolean;
  onUndoDots: () => void;
}

export function TrackModeBar({
  mode,
  setMode,
  setStatus,
  setLineStart,
  setManualAnchor,
  setLayers,
  setManualLegs,
  graph,
  hasImage,
  hasDots,
  manualMode,
  manualLegs,
  manualPtsLen,
  manStats,
  mPerPx,
  modeHint,
  canUndoDots,
  onUndoDots,
}: TrackModeBarProps) {
  return (
    <div className="lab-track-modes">
      <span className="lab-track-group">修点</span>
      <button
        type="button"
        className={mode === 'add' ? 'on' : undefined}
        aria-pressed={mode === 'add'}
        disabled={!hasImage || !hasDots}
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
        disabled={!hasImage || !hasDots}
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
        disabled={!hasImage || !hasDots}
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
        disabled={!hasImage}
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
      {canUndoDots && (
        <button className="btn btn-ghost" onClick={onUndoDots}>
          撤销修点
        </button>
      )}
      <span className="muted small lab-track-modehint">{modeHint}</span>
      {(manualMode || manualLegs.length > 0) && (
        <span className="lab-track-maninfo">
          {manualLegs.length
            ? `${manualLegs.length} 段（沿轨迹 ${manStats.along} · 直线 ${manStats.line}）· ${manualPtsLen} 点 · ${fmtLen(
                manStats.lenPx * mPerPx,
              )}${manStats.dupPts ? ` · 重复经过 ${manStats.dupPts} 点` : ''}`
            : '手动路径是「A→B 沿轨迹导航」：同一条路可以反复经过，长度按走两遍算'}
        </span>
      )}
    </div>
  );
}
