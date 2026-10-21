// 图片 / 视频的缩放与拖动舞台。
//
// 手势：滚轮缩放（桌面）、双指捏合（手机）、单指拖动、双击在 1x / 2.5x 间切换。
// 1x 时强制居中（不允许把内容拖出视野）；放大后自由平移，随时可「复位」。
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

interface View {
  s: number;
  x: number;
  y: number;
}

export function ZoomPan({ children, className }: { children: ReactNode; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef<View>(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number; bx: number; by: number } | null>(null);
  const pinchRef = useRef<{ d: number; s: number; x: number; y: number; mx: number; my: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const apply = useCallback((next: View) => {
    const s = clampScale(next.s);
    // 回到 1x 就归位：否则缩小后内容会停在偏移位置，看起来像「跑丢了」
    const clean = s <= 1.001 ? { s: 1, x: 0, y: 0 } : { s, x: next.x, y: next.y };
    viewRef.current = clean;
    setView(clean);
  }, []);

  /** 客户端坐标 → 相对舞台中心的坐标（缩放锚点） */
  const local = (clientX: number, clientY: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  const zoomAt = useCallback(
    (factor: number, ax: number, ay: number) => {
      const { s, x, y } = viewRef.current;
      const ns = clampScale(s * factor);
      if (Math.abs(ns - s) < 0.001) return;
      const k = ns / s;
      // 让锚点下的内容在缩放前后保持不动
      apply({ s: ns, x: ax - (ax - x) * k, y: ay - (ay - y) * k });
    },
    [apply],
  );

  // wheel 必须用原生监听 + passive:false，React 的合成事件拦不住页面滚动
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(
        e.deltaY < 0 ? 1.12 : 1 / 1.12,
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      const { s, x, y } = viewRef.current;
      dragRef.current = { x: e.clientX, y: e.clientY, bx: x, by: y };
      pinchRef.current = null;
      if (s > 1) setGrabbing(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const { s, x, y } = viewRef.current;
      pinchRef.current = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s,
        x,
        y,
        mx: m.x,
        my: m.y,
      };
      dragRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const p = pinchRef.current;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ns = clampScale(p.s * (d / p.d));
      const k = ns / p.s;
      apply({ s: ns, x: m.x - (p.mx - p.x) * k, y: m.y - (p.my - p.y) * k });
      return;
    }

    if (pointers.current.size === 1 && dragRef.current) {
      const d = dragRef.current;
      apply({
        s: viewRef.current.s,
        x: d.bx + (e.clientX - d.x),
        y: d.by + (e.clientY - d.y),
      });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // 双指松开一根后，剩下那根继续当拖动用
      const p = [...pointers.current.values()][0];
      dragRef.current = { x: p.x, y: p.y, bx: viewRef.current.x, by: viewRef.current.y };
      pinchRef.current = null;
    } else if (pointers.current.size === 0) {
      dragRef.current = null;
      pinchRef.current = null;
      setGrabbing(false);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = local(e.clientX, e.clientY);
    if (viewRef.current.s > 1.05) apply({ s: 1, x: 0, y: 0 });
    else zoomAt(2.5, p.x, p.y);
  };

  return (
    <div
      ref={boxRef}
      className={['pv-stage', grabbing ? 'is-grabbing' : '', className ?? ''].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="pv-zoom-content"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})` }}
      >
        {children}
      </div>
      <div
        className="pv-zoom-bar"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => zoomAt(1 / 1.35, 0, 0)} aria-label="缩小">
          −
        </button>
        <span>{Math.round(view.s * 100)}%</span>
        <button type="button" onClick={() => zoomAt(1.35, 0, 0)} aria-label="放大">
          ＋
        </button>
        <button
          type="button"
          className="pv-zoom-reset"
          onClick={() => apply({ s: 1, x: 0, y: 0 })}
          disabled={view.s <= 1.001}
        >
          复位
        </button>
      </div>
    </div>
  );
}
