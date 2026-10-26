// 「功能体验」入口页。
//
// 这里只做一件事：把试验中的功能列成目录，点进去各占一页。
// 以前 AI 对话和边缘分割上下铺在同一页——聊天区被压到 44vh，边缘工具还要
// 先滚过一大段说明才看得见控件，两个功能互相挤占。
//
// 2026-10-24：AI 对话、聊天提取连同模型配置一起搬到设置的「AI」组，
// 这一页只剩还没毕业的试验功能（边缘分割、未完成的记录）。
import { HubList, type HubEntry } from './HubList';
import type { SettingsKey } from './sections';

/** hint 里带上状态：灰色小字一行说清「现在能不能用」 */
type LabEntry = HubEntry;

export function LabSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  const entries: LabEntry[] = [
    {
      key: 'labEdge',
      title: '边缘分割',
      desc: '把一张图里的多个元素自动框出来并裁开，图片只在浏览器里处理。',
      hint: '自动框选 · 批量裁剪 · 图片不出浏览器',
    },
    {
      key: 'labCompat',
      title: '软件适配测试',
      desc: '换机器 / 换壳之后先跑一遍：内核与安全上下文、原生桥、本软件依赖的 WebAssembly 等能力逐项自检。',
      hint: '引擎 · 原生桥 · 麦克风 / 定位 / 蓝牙 / 文件 / 录屏',
    },
    {
      key: 'labDraft',
      title: '未完成的记录',
      desc: '还没提交的表单先在本地留一份草稿，刷新或误关页面之后回来接着填。',
      hint: '未完成 · 草稿自动留底',
    },
    {
      key: 'labTrack',
      title: '轨迹提取',
      desc: '上传两步路 App 的截图：先只提取点（红色阈值 + 骨架形状校准，不连线），再按距离把点聚成连通网络——自动画路径只在一个网络内找最长的一条路，也可以擦掉误检点、补一段漏提的直线，或让视觉模型对照原图增删改点（附思考过程），或放大后手动点 A、点 B 让系统沿轨迹导航补路；最后落到地图上复现并存成本库的定位文件。图片只在浏览器里处理。',
      hint: '提取点 + 聚类 → 画路径（自动/手动/擦除/补线/AI）· 地图复现 · 存为 .drloc',
    },
  ];
  return (
    <div className="settings-intro">
      <p className="muted small">
        新功能先在这里试用，用顺了会搬去该去的地方。AI 对话、聊天提取与模型配置已经搬到「AI」。
      </p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
