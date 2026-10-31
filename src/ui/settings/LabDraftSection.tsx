// 功能体验 → 未完成的记录。
//
// 解决的是一类不响的损失：向导选到第三步、事件写了一半、AI 对话框里打了一大段，
// 手一滑刷新或关掉页面，什么都没留下。这个开关打开后，这些「还没提交」的内容
// 会在本地留一份草稿——列表里能看、能删，也能点「继续」直接回到那件事上接着做。
//
// 只覆盖「还没提交的东西」，已经写进库的数据与草稿无关；草稿存在本机
// localStorage，不随备份走，也不会上传。关掉开关会把已有草稿一并删掉。
import { useState } from 'react';

import {
  clearAllDrafts,
  clearDraft,
  draftsEnabled,
  draftTimeLabel,
  listDrafts,
  setDraftsEnabled,
  type DraftEntry,
} from '../../core/drafts';
import { EventForm } from '../event';
import { ShareWizard } from '../share/ShareWizard';
import { ConfirmButton, Empty } from '../common';
import { Section, fmtMeta } from './Section';
import { LabHead } from './LabEdgeSection';
import type { SettingsKey } from './sections';

/** 哪些草稿能一键回到现场：分享向导与新建事件当场弹回来，AI 输入框切到那一页 */
function resumable(key: string): boolean {
  return key === 'share-wizard' || key === 'event-new' || key === 'ai-input';
}

export function LabDraftSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  const [on, setOn] = useState(draftsEnabled);
  const [list, setList] = useState<DraftEntry[]>(listDrafts);
  const [resume, setResume] = useState<'share' | 'event' | null>(null);

  const refresh = () => setList(listDrafts());

  const continueDraft = (d: DraftEntry) => {
    if (d.key === 'share-wizard') setResume('share');
    else if (d.key === 'event-new') setResume('event');
    else if (d.key === 'ai-input') onPick('labAi');
  };

  return (
    <div className="lab-page">
      <LabHead title="未完成的记录" subKey="labDraft" />

      <Section
        title="未完成"
        desc="还没提交的内容先在本地留一份草稿：刷新、切走、手滑关掉页面，回来还能接着做。"
      >
        <label className="switch">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => {
              setDraftsEnabled(e.target.checked);
              setOn(e.target.checked);
              refresh();
            }}
          />
          <span>{on ? '已开启' : '已关闭'}</span>
        </label>

        <p className="muted small">
          目前覆盖：分享向导的四步选择（事件集、挑掉的事件、人物、分享程度）、新建事件的表单、
          AI 对话输入框里还没发出去的文字。草稿只存在这台设备的浏览器里，不进库、不参与备份；
          导入别人的数据也不会带进来。它也不走库加密，开了加密之后草稿仍是本机明文条目——
          介意的话保持关闭。
        </p>

        <div className="draft-list-head">
          <span className="muted small">本地草稿 {list.length} 份</span>
          {list.length > 0 && (
            <ConfirmButton
              text="全部清空"
              danger
              confirmText="清掉所有未完成的草稿？正在填的表单不会关掉，但关掉之后就找不回来了。"
              onConfirm={() => {
                clearAllDrafts();
                refresh();
              }}
            />
          )}
        </div>

        {list.length === 0 ? (
          <Empty compact text="还没有草稿。关掉开关后不会再记录新的。" />
        ) : (
          <div className="draft-list">
            {list.map((d) => (
              <div className="draft-row" key={d.key}>
                <span className="draft-text">
                  <span className="draft-name">{d.label}</span>
                  <span className="muted small" title={fmtMeta(new Date(d.updatedAt).toISOString())}>
                    {draftTimeLabel(d.updatedAt)}
                  </span>
                </span>
                <span className="draft-actions">
                  {resumable(d.key) && (
                    <button className="btn btn-sm btn-primary" onClick={() => continueDraft(d)}>
                      继续
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      clearDraft(d.key);
                      refresh();
                    }}
                  >
                    删除
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="muted small">
          分享向导里点「取消」算明确放弃：那一次的选择会清掉，不会在下次打开时冒出来；
          新建事件关掉弹窗则保留草稿，下次打开还能接着写，弹窗顶部会给出「丢弃草稿」。
        </p>
      </Section>

      {/* 「继续」就在这一页把编辑器弹回来：草稿本来就在本地，直接接着做 */}
      {resume === 'share' && (
        <ShareWizard
          onClose={() => {
            setResume(null);
            refresh();
          }}
        />
      )}
      {resume === 'event' && (
        <EventForm
          onClose={() => {
            setResume(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
