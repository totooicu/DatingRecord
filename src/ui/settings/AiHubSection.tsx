// 「AI」入口页（设置 → AI）。
//
// 和「功能体验」「备份与分享」同一套结构：先选做哪件事，再进对应页。
// 设置目录上只露一行「AI」，对话 / 聊天提取 / 模型三页住在这里的二级目录，
// 不再各占一行把首页拉长。
import { HubList, type HubEntry } from './HubList';
import type { SettingsKey } from './sections';
import { getDefaultModel, listModels } from '../../core/ai';

export function AiHubSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  // 打开这一页时取一次：都是同步的本地查询，成本可以忽略
  const models = listModels();
  const def = getDefaultModel() ?? models[0];

  const entries: HubEntry[] = [
    {
      key: 'labAi',
      title: 'AI 对话',
      desc: '能思考、能动手的助手：查数据、建人物、记事件，每次写库前自动备份。',
      hint: `支持上传文件让它读 · ${def ? `模型：${def.alias}` : '还没配模型'}`,
    },
    {
      key: 'labChat',
      title: '聊天提取',
      desc: '上传聊天截图和提示词，AI 把文字和图片整理成一条聊天事件，图片自动抠出来存进文件库。',
      hint: '截图 → 聊天事件 · 图片自动裁剪',
    },
    {
      key: 'aiModel',
      title: '模型',
      desc: '给模型起别名：服务商、模型名、能力、温度与长度；密钥只存本机，不进备份。',
      hint: models.length ? `已配置 ${models.length} 个模型` : '还没配模型',
    },
  ];

  return (
    <div className="settings-intro">
      <p className="muted small">聊天、从截图提取对话、配模型，都在这三页里。</p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
