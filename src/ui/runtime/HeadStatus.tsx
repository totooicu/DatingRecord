// 主页 head 右侧的状态区：服务 / 任务 入口 + 活动任务的实时图标。
//
// · 进行中 / 刚结束的任务会在 head 上出现一个小图标（如 AI 聊天）：
//   运行中蓝色脉冲，完成变绿、失败变红；点图标跳到来源页——
//   已完成的点了通知消失，进行中的点了只跳、图标不消失。
// · 运行中的服务（如背景音乐）也有常驻图标，点它进服务页。
// · 「服务」「任务」两个文字按钮打开各自的管理页。
//
// 文字标题在左、本组件在右，＋ 按钮由调用方放在最右。

import { markTaskRead, useServices, useTasks, type NavTarget } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';

function AiGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="7" width="16" height="11" rx="3" />
      <path d="M12 7V4M9 12h.01M15 12h.01M9 15h6" />
    </svg>
  );
}
function MusicGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V6l9-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="15.5" cy="16" r="2.5" />
    </svg>
  );
}

export function HeadStatus() {
  const tasks = useTasks();
  const services = useServices();
  // 只显示「还在跑」或「刚结束还没看」的任务，避免 head 堆图标
  const liveTasks = tasks.filter((t) => t.status === 'running' || t.unread);

  const clickTask = (t: { kind: string; target: NavTarget; status: string }) => {
    navigate(t.target);
    // 已完成的任务：点图标即视为已读，通知消失；进行中的只跳、不消
    if (t.status !== 'running') markTaskRead(t.kind);
  };

  const clickService = (s: { target: NavTarget }) => navigate(s.target);

  return (
    <div className="head-status">
      {liveTasks.map((t) => (
        <button
          key={t.id}
          className={`hs-icon hs-task ${t.status}`}
          title={t.note ? `${t.title}：${t.note}` : t.title}
          onClick={() => clickTask(t)}
          aria-label={t.title}
        >
          <AiGlyph />
          {t.status !== 'running' && t.unread && <span className="hs-dot" />}
        </button>
      ))}

      {services
        .filter((s) => s.running)
        .map((s) => (
          <button
            key={s.id}
            className={`hs-icon hs-svc ${s.running ? 'running' : ''}`}
            title={[s.title, s.detail, s.note].filter(Boolean).join(' · ')}
            onClick={() => clickService(s)}
            aria-label={s.title}
          >
            <MusicGlyph />
            {s.note && <span className="hs-dot warn" />}
          </button>
        ))}

      <button className="hs-text" onClick={() => navigate({ type: 'page', key: 'services' })}>
        服务
      </button>
      <button className="hs-text" onClick={() => navigate({ type: 'page', key: 'tasks' })}>
        任务
        {tasks.some((t) => t.unread && t.status !== 'running') && <span className="hs-badge" />}
      </button>
    </div>
  );
}
