// 「备份与分享」入口页。
//
// 三件事都是「把数据搬出去或搬进来」，但担子完全不同：
//   · 数据备份：整库，一份文件，能原样还原；
//   · 坚果云备份：整库，增量分片，随时两边对齐；
//   · 分享：一段故事，给别人看，人物资料要按等级裁剪。
// 混在一屏会互相挤占，所以这里只做目录，各自一页。
import { getMeta } from '../../core/db';
import { getSyncStatus } from '../../core/sync';
import { useVersion } from '../../store';
import { HubList, type HubEntry } from './HubList';
import { fmtMeta } from './Section';
import type { SettingsKey } from './sections';

export function BackupHubSection({ onPick }: { onPick: (k: SettingsKey) => void }) {
  // 版本号变化时重算：导完一次备份、同步完一次，回到目录能看到新时间
  useVersion();
  const sync = getSyncStatus();

  const entries: HubEntry[] = [
    {
      key: 'backupData',
      title: '数据备份',
      desc: '整库导出成 .drp.zip，附件可一起打包；导入时合并或整体替换。',
      hint: `上次导入：${fmtMeta(getMeta('last_import_at'))}`,
    },
    {
      key: 'sync',
      title: '坚果云备份',
      desc: '只把变化的分片传到坚果云，换设备时按分片拉回，不重传整库。',
      hint: sync.hasBaseline ? `上次同步：${fmtMeta(sync.lastAt)}` : '还没连过',
    },
    {
      key: 'share',
      title: '分享',
      desc: '用四步向导挑事件集、人物和分享程度，导出 .drshare.zip。',
      hint: '导出前选程度 · 导入前先预览',
    },
  ];

  return (
    <div className="settings-intro">
      <p className="muted small">
        备份是给自己留后路，分享是给别人看一段。前者要完整，后者要克制。
      </p>
      <HubList entries={entries} onPick={onPick} />
    </div>
  );
}
