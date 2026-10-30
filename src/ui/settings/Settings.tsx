import { lazy, Suspense } from 'react';
import { Section } from './Section';
import { SettingsNav } from './SettingsNav';
import { HeadStatus } from '../runtime/HeadStatus';
import { BackupHubSection } from './BackupHubSection';
import { BackupSection } from './BackupSection';
import { SyncSection } from './SyncSection';
import { ShareSection } from './ShareSection';
import { RemoteSection } from './RemoteSection';
import { AppearanceSection } from './AppearanceSection';
import { SecuritySection } from './SecuritySection';
import { PeopleSection } from './PeopleSection';
import { DataSection } from './DataSection';
import { AiHubSection } from './AiHubSection';
import { AiSection } from './AiSection';
import { PanelHubSection } from './PanelHubSection';
import { MusicPanel } from '../panel/MusicPanel';
import { LocationPanel } from '../panel/LocationPanel';
import { FilesPanel } from '../files';
import { ArchiveSection } from './ArchiveSection';
import { PageHead } from '../common';
import {
  DEFAULT_SETTINGS_KEY,
  SETTINGS_ENTRIES,
  parentOf,
  type SettingsKey,
} from './sections';
import { fmtBuildTime } from '../../core/buildInfo';

/* 「功能体验」这一组是实验 / 测试页：多数人从头到尾都不会点开，却要跟着首屏一起下载。
   改成动态 import 之后，各组自己独立成一个 chunk，点进去才去拉对应的那一个 js——
   也就是「需要用例时再访问用例资源下载」，首屏只留用得上的代码。 */
const LabSection = lazy(() => import('./LabSection').then((m) => ({ default: m.LabSection })));
const LabAiSection = lazy(() => import('./LabAiSection').then((m) => ({ default: m.LabAiSection })));
const LabEdgeSection = lazy(() =>
  import('./LabEdgeSection').then((m) => ({ default: m.LabEdgeSection })),
);
const LabExtractSection = lazy(() =>
  import('./LabExtractSection').then((m) => ({ default: m.LabExtractSection })),
);
const LabDraftSection = lazy(() =>
  import('./LabDraftSection').then((m) => ({ default: m.LabDraftSection })),
);
const LabCompatSection = lazy(() =>
  import('./LabCompatSection').then((m) => ({ default: m.LabCompatSection })),
);
const LabTrackSection = lazy(() =>
  import('./LabTrackSection').then((m) => ({ default: m.LabTrackSection })),
);

/**
 * 设置页：目录（左栏 / 手机首页）+ 子页（右栏 / 手机内容页）。
 *
 * 手机端靠容器上的 data-sub 由 CSS 切「目录 / 子页」两态；≥1024px 两栏同屏、
 * 目录常驻。所以这里不需要 JS 判断宽度——sub 为 null 只表示「手机上还在目录页」，
 * 宽屏永远按 DEFAULT_SETTINGS_KEY 渲染右栏。
 *
 * 入口已经按「做一件事」合并过（见 sections.ts），带子页的入口有四个：
 * 备份与分享（备份 / 同步 / 分享 / 跨设备）、功能体验（边缘分割 / 软件适配测试 /
 * 未完成的记录）、功能面板（音乐 / 定位）、AI（AI 对话 / 聊天提取 / 模型）；
 * 目录上各占一行，点进去才是二级目录。
 */
export function Settings({ sub, onSub }: { sub: SettingsKey | null; onSub: (k: SettingsKey | null) => void }) {
  // sub 由 App 控制：head 上的状态图标、服务/任务页都能直接跳到某个设置子页
  // （如 AI 对话）。带着「从成果详情跳出来看过对象」的来路进来时，App 会把 sub 设为 'labAi'。
  const active = sub ?? DEFAULT_SETTINGS_KEY;
  // 子页标题就是该设置项的名字；返回目标优先父入口（功能体验 → 它的子页），否则回目录
  const entry = SETTINGS_ENTRIES.find((e) => e.key === active);
  const backTo = sub === null ? null : (parentOf(active) ?? null);

  // 子页切换/返回统一走这里（AI 对话正忙也已放开：执行态在单例里，离开页面照跑）
  const go = (k: SettingsKey | null) => {
    onSub(k);
  };

  return (
    <div className="settings-panes" data-sub={sub ?? ''}>
      {/* 顶部条跟着状态走：目录页写「设置与数据」，子页换成本项名字并把返回键放进条里，
          这样返回键吸在顶部，不随内容滚动 */}
      <PageHead
        title={sub === null ? '设置与数据' : (entry?.title ?? '设置')}
        onBack={sub === null ? undefined : () => go(backTo)}
        right={<HeadStatus />}
      />
      <SettingsNav active={active} onPick={go} />

      <Suspense fallback={<div className="muted small" style={{ padding: '14px 16px' }}>载入中…</div>}>
      <div className={active === 'labAi' ? 'settings-body settings-body-tight' : 'settings-body'}>
        {/* 构建时间只是排查用的元信息：放在目录首页一眼能看到就够，
            进了具体子页就别再占一行——这一行在手机上等于半个按钮的高度 */}
        {sub === null && <div className="settings-build-time muted small">最后构建：{fmtBuildTime()}</div>}

        {/* 备份与分享：入口页只放三个子页的目录，各自一页。
            三件事都是搬数据，但「整库后路 / 增量同步 / 给别人看」的取舍完全不同，
            挤在一屏会让每一块都想省一半说明 */}
        {active === 'backup' && <BackupHubSection onPick={go} />}

        {active === 'backupData' && <BackupSection />}

        {active === 'sync' && <SyncSection />}

        {active === 'share' && <ShareSection />}

        {active === 'remote' && <RemoteSection />}

        {active === 'appearance' && <AppearanceSection />}

        {active === 'security' && <SecuritySection />}

        {active === 'people' && <PeopleSection />}

        {active === 'archive' && <ArchiveSection />}

        {active === 'files' && (
          <Section>
            <FilesPanel />
          </Section>
        )}

        {active === 'data' && <DataSection />}

        {/* 入口页只放目录，具体功能各占一页，互不挤占屏幕。
            AI / lab 的返回目标就是「设置目录」，子页的返回目标是各自的入口页——两级，不多不少 */}
        {active === 'ai' && <AiHubSection onPick={go} />}

        {active === 'lab' && <LabSection onPick={go} />}

        {active === 'labAi' && <LabAiSection />}

        {active === 'labEdge' && <LabEdgeSection />}

        {active === 'labChat' && <LabExtractSection />}

        {active === 'labCompat' && <LabCompatSection />}

        {active === 'labTrack' && <LabTrackSection />}

        {/* 模型配置从「AI 对话 → 模型」标签抽成独立子页：配密钥是低频动作，
            不该占着聊天页的一排标签位置 */}
        {active === 'aiModel' && <AiSection />}

        {active === 'panel' && <PanelHubSection onPick={go} />}

        {active === 'panelMusic' && <MusicPanel />}

        {active === 'panelLocation' && <LocationPanel />}

        {active === 'labDraft' && <LabDraftSection onPick={go} />}
      </div>
      </Suspense>
    </div>
  );
}
