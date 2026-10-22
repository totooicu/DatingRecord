// 设置 → 人物与属性。
//
// 「属性字典」「属性模板」「重复人物合并」原来分散在三处，其实是同一件事：
// 人物长什么样。字段怎么定义 → 常用字段怎么打包 → 重复的人怎么收拢，
// 顺着这条线排下来，找东西不用猜在哪个入口。
//
// 三块原样复用：DefTable / TemplateSection / DuplicatePersons，
// 这里只负责排版和把字典的「编辑」弹窗接上。
import { useState } from 'react';
import { Section } from './Section';
import { DefTable } from './DefTable';
import { DefFormModal } from './DefFormModal';
import { TemplateSection } from './TemplateSection';
import { DuplicatePersons } from '../merge';
import { bump } from '../../store';

export function PeopleSection() {
  const [editingDef, setEditingDef] = useState<string | null>(null);
  const [defOpen, setDefOpen] = useState(false);

  return (
    <>
      <div className="settings-intro">
        <p className="muted small">
          这一页管「人长什么样」：下面的<strong>属性字典</strong>决定有哪些字段、各是什么类型；
          <strong>属性模板</strong>把常用字段打成一包，新建人物时一键套上；
          最后一节清理<strong>重复人物</strong>。
        </p>
      </div>

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

      <TemplateSection />

      <Section
        title="重复人物"
        desc="同名建了多次的记录，合并后事件关联会归到一起；被并掉的那条仍在库中，可到「归档与回收」里清理。"
      >
        <DuplicatePersons />
      </Section>

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
    </>
  );
}
