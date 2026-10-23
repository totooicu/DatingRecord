// 「分享」页：导出 / 导入两个方向。
//
// 导出只有一个入口：点「开始分享」走向导——选事件集 → 选人物 → 选程度 → 预览，
// 最后生成 .drshare.zip。人物那一步只决定「带谁的资料」，事件范围由事件集决定。
import { useState } from 'react';
import { Section } from './Section';
import { ShareImportButton } from '../collections';
import { ShareWizard } from '../share/ShareWizard';

export function ShareSection() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Section
        title="导出分享"
        desc="把一段故事打包给对方：事件、聊天、正文引用的附件，以及事件涉及的人物。向导里可以随时退回改选择。"
      >
        <div className="row-actions share-export-row">
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            开始分享
          </button>
          <span className="muted small">生成 .drshare.zip 压缩包</span>
        </div>
      </Section>

      <Section
        title="导入分享"
        desc="收到别人的 .drshare.zip，先预览里面有什么、人物怎么关联、事件集落在哪，确认后才写库。"
      >
        <div className="row-actions share-entry">
          <span className="muted small">
            同名人物会自动关联，也可以手动改成自己库里的人；事件集可以新建，也可以并进已有的一个。
          </span>
          <ShareImportButton text="选择分享文件" />
        </div>
      </Section>

      {open && <ShareWizard onClose={() => setOpen(false)} />}
    </>
  );
}
