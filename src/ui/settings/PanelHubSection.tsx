// 「功能面板」入口页（设置 → 功能面板）。
//
// 和 AI / 备份与分享同一套结构：先选做哪件事，再进对应页。
// 后面加数据分析板时往 entries 里加一条即可。
import { HubList, type HubEntry } from './HubList';
import type { SettingsKey } from './sections';
import { listFiles } from '../../core/repo/files';
import { listPlaylists } from '../../core/music/playlistFile';
import { listLocations } from '../../core/location/locationFile';
import { listOrders, listPurchases } from '../../core/pay/store';

export function PanelHubSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  const audioCount = listFiles().filter((f) => f.mime.startsWith('audio/')).length;
  const playlistCount = listPlaylists().length;
  const locationCount = listLocations().length;
  // 测试线：订单只在本机库里，入口上先把「有没有没付完的单」露出来，
  // 不然用户付到一半退出去，回来根本想不起自己还欠着一张单
  const pendingCount = listOrders().filter((o) => o.status === 'pending').length;
  const purchaseCount = listPurchases().length;

  const entries: HubEntry[] = [
    {
      key: 'panelMusic',
      title: '音乐',
      desc: '背景音乐歌单：新建 / 导入 / 编辑 .drpl 歌单（保存在文件库），支持播放 / 暂停 / 上一首下一首 / 列表循环 / 单曲循环。',
      hint: playlistCount
        ? `${playlistCount} 个歌单 · ${audioCount} 首音频`
        : audioCount ? `已存 ${audioCount} 首音频` : '还没加音频',
    },
    {
      key: 'panelLocation',
      title: '定位',
      desc: '新建 / 导入 .drloc 定位文件，地图打点、自动记录；经度纬度偏移也保存在文件里。',
      hint: locationCount ? `${locationCount} 个定位文件` : 'GPS 打点 · 高德地图轨迹',
    },
    {
      key: 'panelPay',
      title: '服务购买（测试）',
      desc: '一次性服务：下单 → 跳支付宝 / 微信（壳里真跳 app，浏览器里走网页收银台）→ 查单到账。钱由壳那台局域网服务器模拟，没有真商户号，也不会扣真钱。',
      hint: pendingCount
        ? `${pendingCount} 张待支付 · 已购 ${purchaseCount} 条`
        : purchaseCount
          ? `已购 ${purchaseCount} 条`
          : '测试线 · 壳模拟收费',
    },
  ];

  return (
    <div className="settings-intro">
      <p className="muted small">独立的小组件空间：歌单、数据分析板等工具卡片住在这里。</p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
