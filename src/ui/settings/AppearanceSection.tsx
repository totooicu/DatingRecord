// 设置 → 外观：主题色 + 底色，选完立即生效。
//
// 没有「保存」按钮：这里调的是看的效果，多一步确认只会让人反复点。
// 每次改动都会写 localStorage，刷新/重开还在；恢复默认是唯一的回退。
import { useState } from 'react';
import { Section } from './Section';
import {
  ACCENT_PRESETS,
  BASE_TONES,
  applyAppearance,
  contrastOnWhite,
  getAppearance,
  isDefaultAppearance,
  resetAppearance,
  type Appearance,
} from '../theme';

export function AppearanceSection() {
  const [appearance, setAppearance] = useState<Appearance>(() => getAppearance());
  const [hexDraft, setHexDraft] = useState(() => getAppearance().accent);
  const [note, setNote] = useState('');
  const [isDefault, setIsDefault] = useState(() => isDefaultAppearance(getAppearance()));

  const commit = (patch: Partial<Appearance>) => {
    const res = applyAppearance({ ...appearance, ...patch });
    setAppearance(res.appearance);
    setHexDraft(res.appearance.accent);
    setIsDefault(isDefaultAppearance(res.appearance));
    setNote(
      res.adjusted
        ? `这个颜色太浅，白字看不清，已自动加深为 ${res.appearance.accent}`
        : '',
    );
  };

  // 输入框允许打到一半（#a8 之类），只有凑齐 6 位才应用，不打断输入；
  // 3 位简写等失焦时再展开，否则刚打完 #abc 就被替换成 #aabbcc。
  const onHex = (raw: string) => {
    setHexDraft(raw);
    if (/^#?[0-9a-f]{6}$/i.test(raw.trim())) commit({ accent: raw });
  };

  const onHexBlur = () => {
    if (/^#?[0-9a-f]{3}$/i.test(hexDraft.trim())) commit({ accent: hexDraft });
    else setHexDraft(appearance.accent);
  };

  const onReset = () => {
    const res = resetAppearance();
    setAppearance(res.appearance);
    setHexDraft(res.appearance.accent);
    setIsDefault(true);
    setNote('');
  };

  const ratio = contrastOnWhite(appearance.accent).toFixed(1);

  return (
    <div className="theme-page">
      <Section
        title="主题色"
        desc="按钮、链接、选中态都会换成这个颜色。颜色太浅时会自动加深，保证白字看得清。"
      >
        <div className="theme-swatches">
          {ACCENT_PRESETS.map((p) => {
            const on = appearance.accent === p.color;
            return (
              <button
                key={p.color}
                type="button"
                className={on ? 'theme-swatch theme-swatch-on' : 'theme-swatch'}
                aria-pressed={on}
                onClick={() => commit({ accent: p.color })}
              >
                <span className="theme-swatch-dot" style={{ background: p.color }} />
                <span className="theme-swatch-name">{p.name}</span>
              </button>
            );
          })}
        </div>

        <div className="theme-custom">
          <label className="theme-color-label">
            <input
              type="color"
              className="theme-color-input"
              value={appearance.accent}
              aria-label="自定义主题色"
              onChange={(e) => commit({ accent: e.target.value })}
            />
            <span>自定义</span>
          </label>
          <input
            className="theme-hex"
            value={hexDraft}
            spellCheck={false}
            autoComplete="off"
            aria-label="主题色色值"
            onChange={(e) => onHex(e.target.value)}
            onBlur={onHexBlur}
          />
        </div>

        <p className="theme-meter muted small">
          <span className="theme-meter-dot" style={{ background: appearance.accent }} />
          白字对比度 {ratio}:1
          {note && <span className="theme-note"> · {note}</span>}
        </p>
      </Section>

      <Section
        title="底色"
        desc="底色决定整体的冷暖与明暗，卡片、侧栏、分割线会一起跟着变。"
      >
        <div className="tone-grid">
          {BASE_TONES.map((b) => {
            const on = appearance.base === b.key;
            return (
              <button
                key={b.key}
                type="button"
                className={on ? 'tone-item tone-item-on' : 'tone-item'}
                aria-pressed={on}
                onClick={() => commit({ base: b.key })}
              >
                <span
                  className="tone-mini"
                  style={{ background: b.vars.bg, borderColor: b.vars.border }}
                >
                  <span
                    className="tone-mini-card"
                    style={{ background: b.vars.panel, borderColor: b.vars.border }}
                  >
                    <span className="tone-mini-line" style={{ background: b.vars.text }} />
                    <span
                      className="tone-mini-line tone-mini-line-short"
                      style={{ background: b.vars.muted }}
                    />
                    <span className="tone-mini-dot" style={{ background: appearance.accent }} />
                  </span>
                </span>
                <span className="tone-name">{b.name}</span>
                <span className="tone-hint">{b.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="预览" desc="下面这块用的就是应用里的真实样式，不必退出去看。">
        <div className="theme-preview">
          <div className="theme-preview-head">
            <strong>人物</strong>
            <span className="pill pill-on">已选中</span>
          </div>
          <div className="theme-preview-row">
            <span className="theme-preview-avatar">朝</span>
            <span className="theme-preview-text">
              <span className="theme-preview-name">示例人物</span>
              <span className="theme-preview-sub">一句话说明当前配色</span>
            </span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary btn-sm">
              主要按钮
            </button>
            <button type="button" className="btn btn-sm">
              次要按钮
            </button>
            <button type="button" className="link-btn">
              文字链接
            </button>
          </div>
        </div>
      </Section>

      <div className="theme-reset-row">
        <button type="button" className="btn btn-sm" disabled={isDefault} onClick={onReset}>
          恢复默认
        </button>
        <span className="muted small">只影响这台设备，不写进备份。</span>
      </div>
    </div>
  );
}
