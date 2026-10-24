// 「功能面板」入口页（设置 → 功能面板）。
//
// 和 AI / 备份与分享同一套结构：先选做哪件事，再进对应页。
// 后面加数据分析板时往 entries 里加一条即可。
import { HubList, type HubEntry } from './HubList';
import type { SettingsKey } from './sections';
import { listFiles } from '../../core/repo/files';

export function PanelHubSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  const audioCount = listFiles().filter((f) => f.mime.startsWith('audio/')).length;

  const entries: HubEntry[] = [
    {
      key: 'panelMusic',
      title: '音乐',
      desc: '背景音乐歌单：从本地选音频文件入库，支持播放 / 暂停 / 上一首下一首 / 列表循环 / 单曲循环。',
      hint: audioCount ? `已存 ${audioCount} 首` : '还没加音频',
    },
    {
      key: 'panelLocation',
      title: '定位记录',
      desc: '点一下拿当前经纬度，追加到 CSV，保存进文件库。',
      hint: 'CSV · 自定义文件名',
    },
    {
      key: 'panelMap',
      title: '定位地图',
      desc: '从文件库选一个定位 CSV，Canvas 画轨迹散点图。',
      hint: '离线 · 点查看详情',
    },
  ];

  return (
    <div className="settings-intro">
      <p className="muted small">独立的小组件空间：歌单、数据分析板等工具卡片住在这里。</p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
