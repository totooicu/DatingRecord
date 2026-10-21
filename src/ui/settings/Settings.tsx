import { useState } from 'react';
import { DuplicatePersons } from '../merge';
import { Section } from './Section';
import { SettingsNav } from './SettingsNav';
import { BackupSection } from './BackupSection';
import { DefTable } from './DefTable';
import { DefFormModal } from './DefFormModal';
import { FilesSection } from '../files';
import { ArchiveSection } from './ArchiveSection';
import { OverviewSection } from './OverviewSection';
import { SampleSection } from './SampleSection';
import { DEFAULT_SETTINGS_KEY, type SettingsKey } from './sections';
import { bump } from '../../store';

/**
 * 设置页：目录（左栏 / 手机首页）+ 子页（右栏 / 手机内容页）。
 *
 * 手机端靠容器上的 data-sub 由 CSS 切「目录 / 子页」两态；≥1024px 两栏同屏、
 * 目录常驻。所以这里不需要 JS 判断宽度——sub 为 null 只表示「手机上还在目录页」，
 * 宽屏永远按 DEFAULT_SETTINGS_KEY 渲染右栏。
 */
export function Settings() {
  const [sub, setSub] = useState<SettingsKey | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<string | null>(null);
  const active = sub ?? DEFAULT_SETTINGS_KEY;

  return (
    <div className="settings-panes" data-sub={sub ?? ''}>
      <SettingsNav active={active} onPick={setSub} />

      <div className="settings-body">
        <button className="settings-back" onClick={() => setSub(null)}>
          ← 返回目录
        </button>

        {active === 'backup' && <BackupSection />}

        {active === 'attrs' && (
          <DefTable
            onEdit={(k) => {
              setEditingDef(k);
              setDefOpen(true);
            }}
            onNew={() => {
              setEditingDef(null);
              setDefOpen(true);
            }}
          />
        )}

        {active === 'people' && (
          <Section title="重复人物" desc="同名建了多次的记录，合并后事件关联会归到一起。">
            <DuplicatePersons />
          </Section>
        )}

        {active === 'archive' && <ArchiveSection />}

        {active === 'files' && (
          <Section
            title="文件"
            desc="单层文件库（不分子文件夹）。文件存在浏览器本地，正文里用「插图」按钮引用；引用只记 id，所以改名不会影响已有正文。"
          >
            <FilesSection />
          </Section>
        )}

        {active === 'overview' && <OverviewSection />}
        {active === 'sample' && <SampleSection />}
      </div>

      {defOpen && (
        <DefFormModal
          key={editingDef ?? 'new'}
          defKey={editingDef}
          onClose={() => {
            setDefOpen(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
