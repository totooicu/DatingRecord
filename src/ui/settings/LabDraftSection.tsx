// 功能体验 → 未完成的记录。
//
// 解决的是一类不响的损失：向导选到第三步、事件写了一半，手一滑刷新或
// 关掉了页面，什么都没留下。这个开关打开后，分享向导的选择和新建事件的
// 表单会在本地留一份草稿，重新打开时原样恢复。
//
// 只覆盖「还没提交的东西」，已经写进库的数据与草稿无关；草稿存在本机
// localStorage，不随备份走，也不会上传。关掉开关会把已有草稿一并删掉。
import { useState } from 'react';

import {
  clearAllDrafts,
  clearDraft,
  draftsEnabled,
  listDrafts,
  setDraftsEnabled,
  type DraftEntry,
} from '../../core/drafts';
import { ConfirmButton } from '../common';
import { Section, fmtMeta } from './Section';
import { LabHead } from './LabEdgeSection';

/** 草稿时间：一小时以内给分钟，超过就按天说，别让人换算 */
function agoLabel(ts: number): string {
  if (!ts) return '时间未知';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
}

export function LabDraftSection() {
  const [on, setOn] = useState(draftsEnabled);
  const [list, setList] = useState<DraftEntry[]>(listDrafts);

  const refresh = () => setList(listDrafts());

  return (
    <div className="lab-page">
      <LabHead title="未完成的记录" subKey="labDraft" />

      <Section
        title="未完成"
        desc="还没提交的表单先在本地留一份草稿：刷新、切走、手滑关掉页面，回来还能接着填。"
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
          目前覆盖：分享向导的四步选择（事件集、挑掉的事件、人物、分享程度）、新建事件的表单。
          草稿只存在这台设备的浏览器里，不进库、不参与备份；导入别人的数据也不会带进来。
          它也不走库加密，开了加密之后草稿仍是本机明文条目——介意的话保持关闭。
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
          <p className="muted small">还没有草稿。关掉开关后不会再记录新的。</p>
        ) : (
          <div className="draft-list">
            {list.map((d) => (
              <div className="draft-row" key={d.key}>
                <span className="draft-name">{d.label}</span>
                <span className="muted small" title={fmtMeta(new Date(d.updatedAt).toISOString())}>
                  {agoLabel(d.updatedAt)}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    clearDraft(d.key);
                    refresh();
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="muted small">
          分享向导里点「取消」算明确放弃：那一次的选择会清掉，不会在下次打开时冒出来；
          新建事件关掉弹窗则保留草稿，下次打开还能接着写，弹窗顶部会给出「丢弃草稿」。
        </p>
      </Section>
    </div>
  );
}
