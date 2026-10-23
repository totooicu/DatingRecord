import { useState } from 'react';
import { Section } from './Section';
import { SettingsNav } from './SettingsNav';
import { BackupSection } from './BackupSection';
import { SyncSection } from './SyncSection';
import { AiSection } from './AiSection';
import { SecuritySection } from './SecuritySection';
import { PeopleSection } from './PeopleSection';
import { DataSection } from './DataSection';
import { LabSection } from './LabSection';
import { LabAiSection } from './LabAiSection';
import { LabEdgeSection } from './LabEdgeSection';
import { FilesPanel } from '../files';
import { ArchiveSection } from './ArchiveSection';
import { DEFAULT_SETTINGS_KEY, resolveSettingsKey, type SettingsKey } from './sections';
import { fmtBuildTime } from '../../core/buildInfo';

/** 功能体验那一组（入口页 + 子页）：它们内部自带返回，不再叠「返回目录」 */
function isLabKey(k: SettingsKey): boolean {
  return k === 'lab' || k === 'labAi' || k === 'labEdge';
}

/**
 * 设置页：目录（左栏 / 手机首页）+ 子页（右栏 / 手机内容页）。
 *
 * 手机端靠容器上的 data-sub 由 CSS 切「目录 / 子页」两态；≥1024px 两栏同屏、
 * 目录常驻。所以这里不需要 JS 判断宽度——sub 为 null 只表示「手机上还在目录页」，
 * 宽屏永远按 DEFAULT_SETTINGS_KEY 渲染右栏。
 *
 * 入口已经按「做一件事」合并过（见 sections.ts），所以子页只剩八种：
 * 备份与恢复 / 隐私与安全 / 人物与属性 / 归档与回收 / 文件 / 数据与统计。
 */
export function Settings({ initial }: { initial?: string | null }) {
  // initial 允许带旧 key（lock / enc / templates / overview / sample），
  // resolveSettingsKey 会把它换到合并后的那一页
  const [sub, setSub] = useState<SettingsKey | null>(() => resolveSettingsKey(initial ?? null));
  const active = sub ?? DEFAULT_SETTINGS_KEY;

  return (
    <div className="settings-panes" data-sub={sub ?? ''}>
      <SettingsNav active={active} onPick={setSub} />

      <div className="settings-body">
        {/* 构建时间只是排查用的元信息：放在目录首页一眼能看到就够，
            进了具体子页就别再占一行——这一行在手机上等于半个按钮的高度 */}
        {sub === null && <div className="settings-build-time muted small">最后构建：{fmtBuildTime()}</div>}

        {/* 功能体验系列有自己的一层「← 功能体验」，这时不再显示「← 返回目录」，
            两层返回按钮叠在一起既占高度又容易点错 */}
        {!isLabKey(active) && (
          <button className="settings-back" onClick={() => setSub(null)}>
            ← 返回目录
          </button>
        )}

        {active === 'backup' && <BackupSection />}

        {active === 'sync' && <SyncSection />}

        {active === 'ai' && <AiSection />}

        {active === 'security' && <SecuritySection />}

        {active === 'people' && <PeopleSection />}

        {active === 'archive' && <ArchiveSection />}

        {active === 'files' && (
          <Section
            title="文件"
            desc="单层文件库（不分子文件夹）。引用名是内容 hash，实际名随时可改，改名不影响已有正文。"
          >
            <FilesPanel />
          </Section>
        )}

        {active === 'data' && <DataSection />}

        {/* 功能体验：入口页只放目录，具体功能各占一页，互不挤占屏幕。
            lab 的返回目标就是「设置目录」，子页的返回目标是 lab——两级，不多不少 */}
        {active === 'lab' && <LabSection onPick={setSub} onBack={() => setSub(null)} />}

        {active === 'labAi' && <LabAiSection onBack={() => setSub('lab')} />}

        {active === 'labEdge' && <LabEdgeSection onBack={() => setSub('lab')} />}
      </div>
    </div>
  );
}
