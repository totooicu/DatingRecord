// 通用取色面板：左边彩虹渐变，右边历史颜色，下面 HEX / RGB 输入。
//
// 三处取色都复用它：事件集/人物图标的前景色与背景色、自定义属性里的颜色、
// 设置 → 外观的主题色。
//
// 交互约定：
//   · 拖彩虹 = 色相（左右）+ 明度（上下），不透明度和饱和度交给精确输入；
//   · 右侧历史是全局的（`ui/color/history.ts`），任何取色入口用过的颜色都会进来；
//   · 拖动过程中默认实时回调（live），松手才记历史；主题色传 live=false，
//     因为主题色会被「太浅自动加深」，拖动时反复回写会跟手指打架。
import { useEffect, useRef, useState } from 'react';
import { hexToHsl, hexToRgb, hslToHex, normalizeHex, rgbToHex } from './color';
import { rememberColor, useRecentColors } from './history';

const FALLBACK = '#c9a227';

function fieldsOf(hex: string): { r: string; g: string; b: string } {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function ColorPicker({
  value,
  onChange,
  allowTransparent = false,
  compact = false,
  live = true,
}: {
  /** 当前颜色（`#rrggbb` 或 `transparent`） */
  value: string;
  onChange: (hex: string) => void;
  /** 允许选「透明」（图标背景需要） */
  allowTransparent?: boolean;
  /** 小一号：塞进弹窗里的配色行下方 */
  compact?: boolean;
  /** 拖动过程中是否实时回调；默认 true */
  live?: boolean;
}) {
  const [hex, setHex] = useState(() => normalizeHex(value) ?? FALLBACK);
  const [hexDraft, setHexDraft] = useState(hex);
  const [rgbDraft, setRgbDraft] = useState(() => fieldsOf(hex));
  const [transparent, setTransparent] = useState(value === 'transparent');
  const recents = useRecentColors();
  const rainbowRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hexRef = useRef(hex);
  hexRef.current = hex;

  // 外部值变化（换文件 / 主题自动加深）：面板跟着走
  useEffect(() => {
    if (value === 'transparent') {
      setTransparent(true);
      return;
    }
    const norm = normalizeHex(value);
    if (!norm) return;
    setTransparent(false);
    setHex(norm);
    setHexDraft(norm);
    setRgbDraft(fieldsOf(norm));
  }, [value]);

  const preview = (norm: string, syncRgb = true) => {
    setHex(norm);
    setHexDraft(norm);
    setTransparent(false);
    if (syncRgb) setRgbDraft(fieldsOf(norm));
  };

  /** 提交一个颜色：更新面板、记历史、通知父组件 */
  const emit = (norm: string, opts: { syncRgb?: boolean; remember?: boolean; quiet?: boolean } = {}) => {
    preview(norm, opts.syncRgb !== false);
    if (opts.remember !== false) rememberColor(norm);
    if (!opts.quiet) onChange(norm);
  };

  const pickAt = (clientX: number, clientY: number, quiet: boolean): string | null => {
    const el = rainbowRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    const next = hslToHex(Math.round(x * 360), 100, Math.round((1 - y) * 100));
    preview(next);
    if (!quiet) onChange(next);
    return next;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    pickAt(e.clientX, e.clientY, !live);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    pickAt(e.clientX, e.clientY, !live);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const norm = pickAt(e.clientX, e.clientY, true) ?? hexRef.current;
    rememberColor(norm);
    onChange(norm);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 16 : 4;
    const cur = hexToHsl(hex) ?? { h: 0, s: 100, l: 50 };
    let next: string | null = null;
    if (e.key === 'ArrowLeft') next = hslToHex(cur.h - step, 100, cur.l);
    else if (e.key === 'ArrowRight') next = hslToHex(cur.h + step, 100, cur.l);
    else if (e.key === 'ArrowUp') next = hslToHex(cur.h, 100, cur.l + step);
    else if (e.key === 'ArrowDown') next = hslToHex(cur.h, 100, cur.l - step);
    if (!next) return;
    e.preventDefault();
    emit(next);
  };

  const onHexChange = (raw: string) => {
    setHexDraft(raw);
    // 输到一半（#a8）不提交，凑齐 6 位再应用，免得每敲一个字符都闪一下
    if (/^#?[0-9a-f]{6}$/i.test(raw.trim())) {
      const norm = normalizeHex(raw);
      if (norm) emit(norm);
    }
  };

  const onHexBlur = () => {
    const norm = normalizeHex(hexDraft);
    if (norm) emit(norm);
    else setHexDraft(hex); // 认不出来就退回上一个有效值
  };

  const onRgbChange = (key: 'r' | 'g' | 'b', raw: string) => {
    const digits = raw.replace(/[^\d]/g, '').slice(0, 3);
    const next = { ...rgbDraft, [key]: digits };
    setRgbDraft(next);
    // 只更新面板预览，等失焦 / 回车再提交：
    // 主题色会把过浅的颜色压暗，逐位提交会让后一位基于被压暗的颜色算，数值自己跑掉。
    const nums = [next.r, next.g, next.b].map(Number);
    if (next.r !== '' && next.g !== '' && next.b !== '' && nums.every((n) => n <= 255)) {
      preview(rgbToHex({ r: nums[0], g: nums[1], b: nums[2] }), false);
    }
  };

  const commitRgb = () => {
    if (rgbDraft.r === '' || rgbDraft.g === '' || rgbDraft.b === '') return;
    const nums = [rgbDraft.r, rgbDraft.g, rgbDraft.b].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n > 255)) return;
    emit(rgbToHex({ r: nums[0], g: nums[1], b: nums[2] }), { syncRgb: false });
  };

  const hsl = hexToHsl(hex) ?? { h: 0, s: 100, l: 50 };
  const knob = {
    left: `${(hsl.h / 360) * 100}%`,
    top: `${(1 - hsl.l / 100) * 100}%`,
    background: hex,
  };

  return (
    <div className={compact ? 'cp cp-compact' : 'cp'}>
      <div className="cp-main">
        <div
          className="cp-rainbow"
          ref={rainbowRef}
          tabIndex={0}
          aria-label="彩虹取色：左右选色相，上下选明暗"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <span className="cp-knob" style={knob} />
        </div>

        <div className="cp-history">
          <span className="cp-history-title">历史</span>
          {recents.length === 0 ? (
            <span className="cp-history-empty">用过的颜色会留在这里</span>
          ) : (
            <div className="cp-history-grid">
              {recents.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={!transparent && c === hex ? 'cp-hist on' : 'cp-hist'}
                  style={{ background: c }}
                  title={c}
                  aria-label={`历史颜色 ${c}`}
                  onClick={() => emit(c)}
                />
              ))}
            </div>
          )}
          {allowTransparent && (
            <button
              type="button"
              className={transparent ? 'cp-trans on' : 'cp-trans'}
              onClick={() => {
                setTransparent(true);
                onChange('transparent');
              }}
            >
              透明
            </button>
          )}
        </div>
      </div>

      <div className="cp-inputs">
        <span
          className={transparent ? 'cp-preview cp-preview-empty' : 'cp-preview'}
          style={transparent ? undefined : { background: hex }}
          title={transparent ? '透明' : hex}
          aria-hidden
        />
        <label className="cp-field">
          16 进制
          <input
            className="cp-hex"
            value={hexDraft}
            spellCheck={false}
            autoComplete="off"
            aria-label="HEX 色值"
            onChange={(e) => onHexChange(e.target.value)}
            onBlur={onHexBlur}
          />
        </label>
        <div className="cp-field">
          RGB
          <div
            className="cp-rgb"
            onBlur={(e) => {
              // 三个框之间来回切换不算提交，焦点离开整组才提交
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitRgb();
            }}
          >
            <input
              inputMode="numeric"
              aria-label="红色通道"
              value={rgbDraft.r}
              onChange={(e) => onRgbChange('r', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <input
              inputMode="numeric"
              aria-label="绿色通道"
              value={rgbDraft.g}
              onChange={(e) => onRgbChange('g', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <input
              inputMode="numeric"
              aria-label="蓝色通道"
              value={rgbDraft.b}
              onChange={(e) => onRgbChange('b', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
