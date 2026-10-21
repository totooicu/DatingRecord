import { useState } from 'react';
import { ArchivedPersons, DuplicatePersons } from '../merge';
import { Section } from './Section';
import { BackupSection } from './BackupSection';
import { DefTable } from './DefTable';
import { DefFormModal } from './DefFormModal';
import { FilesSection } from './FilesSection';
import { OverviewSection } from './OverviewSection';
import { SampleSection } from './SampleSection';
import { bump } from '../../store';

export function Settings() {
  const [defOpen, setDefOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<string | null>(null);

  return (
    <div className="detail">
      <BackupSection />

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

      <Section title="重复人物" desc="同名建了多次的记录，合并后事件关联会归到一起。">
        <DuplicatePersons />
      </Section>

      <Section
        title="归档的人物"
        desc="不在人物列表里、但仍保存在库中的记录——库概览里「+N 归档」的 N 就等于这里的条数。手动归档的可原样恢复；合并重复人物时被并入的那条也列在这里（事件已转到对方名下，只能彻底清理）。"
      >
        <ArchivedPersons />
      </Section>

      <Section
        title="文件"
        desc="单层文件库（不分子文件夹）。文件存在浏览器本地，正文里用「插图」按钮引用；导出备份时会一并打包。"
      >
        <FilesSection />
      </Section>

      <OverviewSection />
      <SampleSection />

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
