// 「功能体验」入口页。
//
// 这里只做一件事：把试验中的功能列成目录，点进去各占一页。
// 以前 AI 对话和边缘分割上下铺在同一页——聊天区被压到 44vh，边缘工具还要
// 先滚过一大段说明才看得见控件，两个功能互相挤占。
//
// 拆开之后每个子页都能独占整屏高度，目录这一页也就只剩几行，扫一眼就知道有哪些东西。
import { HubList, type HubEntry } from './HubList';
import type { SettingsKey } from './sections';
import { getDefaultModel, listModels } from '../../core/ai';

/** hint 里带上状态：灰色小字一行说清「现在能不能用」 */
type LabEntry = HubEntry;

export function LabSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  // 这些读数只在打开这一页时取一次：都是同步的本地查询，成本可以忽略
  const models = listModels();
  const def = getDefaultModel() ?? models[0];

  const entries: LabEntry[] = [
    {
      key: 'labAi',
      title: 'AI 对话',
      desc: '能思考、能动手的助手：查数据、建人物、记事件，每次写库前自动备份。',
      hint: `支持上传文件让它读 · ${def ? `模型：${def.alias}` : '还没配模型'}`,
    },
    {
      key: 'labEdge',
      title: '边缘分割',
      desc: '把一张图里的多个元素自动框出来并裁开，图片只在浏览器里处理。',
      hint: '自动框选 · 批量裁剪 · 图片不出浏览器',
    },
    {
      key: 'labDraft',
      title: '未完成的记录',
      desc: '还没提交的表单先在本地留一份草稿，刷新或误关页面之后回来接着填。',
      hint: '未完成 · 草稿自动留底',
    },
  ];
  return (
    <div className="settings-intro">
      <p className="muted small">新功能先在这里试用，用顺了会搬去该去的地方。</p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
