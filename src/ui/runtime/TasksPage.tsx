// 任务管理页：列出活动与最近的任务，显示状态与时间，点开跳来源页。

import { PageHead } from '../common';
import { markTaskRead, removeTask, useTasks, type TaskItem } from '../../core/runtime/store';
import { navigate } from '../../core/runtime/nav';

function fmtTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusLabel(t: TaskItem): string {
  if (t.status === 'running') return '进行中';
  if (t.status === 'success') return '已完成';
  return '失败';
}

function TaskRow({ t }: { t: TaskItem }) {
  const open = () => {
    navigate(t.target);
    if (t.status !== 'running') markTaskRead(t.kind);
  };
  return (
    <div className={`task-row ${t.status}`}>
      <div className="task-main">
        <div className="task-title">{t.title}</div>
        <div className="task-sub muted small">
          {statusLabel(t)} · {fmtTime(t.startedAt)}
          {t.finishedAt ? ` → ${fmtTime(t.finishedAt)}` : ''}
          {t.note ? ` · ${t.note}` : ''}
        </div>
      </div>
      <button className="task-open" onClick={open}>
        打开
      </button>
      {t.status !== 'running' && (
        <button className="task-clear" onClick={() => removeTask(t.id)} aria-label="清除">
          清除
        </button>
      )}
    </div>
  );
}

export function TasksPage({ onBack }: { onBack: () => void }) {
  const tasks = useTasks();
  // 进行中的排前面，其余按结束时间倒序
  const sorted = [...tasks].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt);
  });
  return (
    <div className="pane pane-solo">
      <PageHead title="任务" onBack={onBack} />
      <div className="task-list">
        {tasks.length === 0 && <p className="muted">还没有任务。AI 回复、后台工作会显示在这里。</p>}
        {sorted.map((t) => (
          <TaskRow key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}
