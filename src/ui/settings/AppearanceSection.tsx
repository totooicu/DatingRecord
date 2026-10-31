// 设置 → 外观：主题色 + 底色，选完立即生效。
//
// 没有「保存」按钮：这里调的是看的效果，多一步确认只会让人反复点。
// 每次改动都会写 localStorage，刷新/重开还在；恢复默认是唯一的回退。
import { useState } from 'react';
import { Section } from './Section';
import { ColorPicker } from '../color/ColorPicker';
import { Segmented } from '../common';
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
import { getGuide, setGuide, type GuideMode } from '../prefs';

export function AppearanceSection() {
  const [appearance, setAppearance] = useState<Appearance>(() => getAppearance());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [isDefault, setIsDefault] = useState(() => isDefaultAppearance(getAppearance()));
  const [guide, setGuideState] = useState<GuideMode>(() => getGuide());

  const commit = (patch: Partial<Appearance>) => {
    const res = applyAppearance({ ...appearance, ...patch });
    setAppearance(res.appearance);
    setIsDefault(isDefaultAppearance(res.appearance));
    setNote(
      res.adjusted
        ? `这个颜色太浅，白字看不清，已自动加深为 ${res.appearance.accent}`
        : '',
    );
  };

  const onReset = () => {
    const res = resetAppearance();
    setAppearance(res.appearance);
    setIsDefault(true);
    setNote('');
  };

  const ratio = contrastOnWhite(appearance.accent).toFixed(1);

  return (
    <div className="theme-page">
      <Section title="界面模式" desc="陪伴模式保留每一步的小字说明；专注模式只留控件，去掉解释性文字，界面更清爽。">
        <Segmented
          value={guide}
          onChange={(v) => {
            setGuide(v);
            setGuideState(v);
          }}
          options={[
            { value: 'companion', label: '陪伴模式' },
            { value: 'focus', label: '专注模式' },
          ]}
        />
      </Section>

      <Section title="外观模式" desc="深色模式的底色由主题色派生：选了湖蓝，夜景就偏蓝；选了朱砂，夜景就偏红。">
        <Segmented
          value={appearance.mode}
          onChange={(m) => commit({ mode: m })}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </Section>

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
          <button
            type="button"
            className="theme-color-label"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span className="theme-color-dot" style={{ background: appearance.accent }} />
            <span>{pickerOpen ? '收起调色板' : '自定义颜色'}</span>
          </button>
          <span className="muted small guide-only">彩虹取色 · 历史色 · HEX / RGB 输入</span>
        </div>

        {pickerOpen && (
          <div className="theme-picker">
            <ColorPicker
              value={appearance.accent}
              live={false}
              onChange={(hex) => commit({ accent: hex })}
            />
          </div>
        )}

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
        <span className="muted small guide-only">只影响这台设备，不写进备份。</span>
      </div>
    </div>
  );
}
