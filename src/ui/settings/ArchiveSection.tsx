// 归档数据统一处理：事件回收站、归档人物、归档事件集、归档属性。
//
// 这些记录都还在库里，只是平时不出现在列表中。集中在一页处理，
// 省得为了恢复一条记录去猜它藏在哪个功能里。
// 彻底删除一律需要二次确认——它是唯一不可撤销的操作。
import { useMemo } from 'react';
import { listDeletedEvents, purgeEvent, restoreEvent } from '../../core/repo/events';
import {
  deleteCollection,
  listArchivedCollections,
  restoreCollection,
} from '../../core/repo/collections';
import { listDefs, restoreDef } from '../../core/repo/persons';
import { ArchivedPersons } from '../merge';
import { ConfirmButton } from '../common';
import { useVersion, bump } from '../../store';
import { Section, fmtMeta } from './Section';

export function ArchiveSection() {
  const v = useVersion();
  const events = useMemo(() => listDeletedEvents(), [v]);
  const collections = useMemo(() => listArchivedCollections(), [v]);
  const defs = useMemo(() => listDefs(true).filter((d) => d.archived), [v]);

  return (
    <>
      <Section
        title="归档数据统一处理"
        desc="被删除或归档的数据仍然保存在库里（不占列表位置），都在这里集中恢复或彻底删除。彻底删除不可撤销，做之前建议先到「备份与恢复」导出 JSON。"
      >
        <div className="chip-group">
          <span className="chip">事件回收站 {events.length}</span>
          <span className="chip">归档事件集 {collections.length}</span>
          <span className="chip">归档属性 {defs.length}</span>
        </div>
      </Section>

      <Section
        title="事件回收站"
        desc="删除事件只是打上删除标记，正文、参与者和文件引用都还在；恢复后回到时间线原位置。"
      >
        {events.length === 0 ? (
          <p className="muted small">回收站是空的。</p>
        ) : (
          <ul className="merge-list">
            {events.map((e) => (
              <li key={e.id}>
                <span className="merge-rec">
                  <span className="merge-rec-main">{e.title || '（无标题）'}</span>
                  <span className="muted small">删除于 {fmtMeta(e.deletedAt)}</span>
                </span>
                <span className="member-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      restoreEvent(e.id);
                      bump();
                    }}
                  >
                    恢复
                  </button>
                  <ConfirmButton
                    text="彻底删除"
                    danger
                    confirmText={`彻底删除「${e.title || '（无标题）'}」？正文、参与者与文件引用会一并移除，不可撤销。`}
                    onConfirm={() => {
                      purgeEvent(e.id);
                      bump();
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="归档的人物"
        desc="手动归档的人物可原样恢复；合并重复人物时被并入的那条事件已转走，只能彻底清理。"
      >
        <ArchivedPersons />
      </Section>

      <Section
        title="归档的事件集"
        desc="归档只改了状态，集合里的成员和事件都还在。恢复后回到「进行中」；删除后集合会移出树，但事件本身不会被删除。"
      >
        {collections.length === 0 ? (
          <p className="muted small">没有归档的事件集。</p>
        ) : (
          <ul className="merge-list">
            {collections.map((c) => (
              <li key={c.id}>
                <span className="merge-rec">
                  <span className="merge-rec-main">{c.name}</span>
                  <span className="muted small">归档于 {fmtMeta(c.updatedAt)}</span>
                </span>
                <span className="member-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      restoreCollection(c.id);
                      bump();
                    }}
                  >
                    恢复
                  </button>
                  <ConfirmButton
                    text="删除"
                    danger
                    confirmText={`删除事件集「${c.name}」？只移除集合本身，集合里的成员事件不会被删除。`}
                    onConfirm={() => {
                      deleteCollection(c.id);
                      bump();
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="归档的属性"
        desc="属性定义从不物理删除，否则历史属性值会失去含义；归档后可以在这里恢复。"
      >
        {defs.length === 0 ? (
          <p className="muted small">没有归档的属性。</p>
        ) : (
          <ul className="merge-list">
            {defs.map((d) => (
              <li key={d.key}>
                <span className="merge-rec">
                  <span className="merge-rec-main">
                    {d.label} <span className="muted small">（{d.key}）</span>
                  </span>
                  <span className="muted small">类型 {d.type}</span>
                </span>
                <span className="member-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      restoreDef(d.key);
                      bump();
                    }}
                  >
                    恢复
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
