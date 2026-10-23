// 文件迁移：把老数据搬到内容寻址上（手动触发，不自动跑）。
//
// 三种模式对应三种「敢动多少数据」：
//   names  只改引用名（最保守，不动任何文件内容）
//   dedupe 合并完全相同的（同 hash 同大小 + 逐字节通过）
//   shrink 先删「无引用的重复副本」，再合并（省空间最多）
//
// 执行前强制提示先备份——迁移会改正文和头像，没有回头路。
import { useMemo, useState } from 'react';
import { auditFiles, planMigration, planSummary, runMigration, type MigrateMode, type MigratePlan } from '../../core/files';
import { useVersion, bump } from '../../store';
import { fmtSize } from './fileFormat';

const MODES: { key: MigrateMode; title: string; desc: string }[] = [
  {
    key: 'names',
    title: '只整理引用名',
    desc: '给每个文件算出 hash，并把正文里的旧引用改成 hash 名。不合并、不删除任何文件。',
  },
  {
    key: 'dedupe',
    title: '合并完全相同的文件',
    desc: '同 hash 且大小相同、逐字节核对一致的文件合并为一个，其余删除。大小不同的组会跳过。',
  },
  {
    key: 'shrink',
    title: '合并并清理无用副本',
    desc: '在「合并」的基础上，额外删掉「没有任何事件和头像引用」的重复副本，省空间最多。',
  },
];

function PlanPreview({ plan }: { plan: MigratePlan }) {
  const mergeEvents = plan.merges.reduce((n, p) => n + p.events.length, 0);
  const mergeFiles = plan.merges.reduce((n, p) => n + p.sources.length, 0);
  return (
    <ul className="mig-plan">
      {plan.noHash > 0 && <li>{plan.noHash} 个文件还没有 hash，执行时会先计算</li>}
      {plan.renames.length > 0 && <li>{plan.renames.length} 个文件要换成 hash 引用名（正文会同步改）</li>}
      {mergeFiles > 0 && (
        <li>
          {plan.merges.length} 组重复可合并：涉及 {mergeFiles} 个文件、{mergeEvents} 个事件
        </li>
      )}
      {plan.drops.length > 0 && <li>{plan.drops.length} 个无引用的重复副本将被删除</li>}
      {plan.noHash === 0 && plan.renames.length === 0 && mergeFiles === 0 && plan.drops.length === 0 && (
        <li>没有需要处理的文件</li>
      )}
    </ul>
  );
}

export function MigrateSection() {
  const v = useVersion();
  const audit = useMemo(() => auditFiles(), [v]);
  const [mode, setMode] = useState<MigrateMode>('names');
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const scan = () => {
    setErr(null);
    setMsg(null);
    setPlan(planMigration(mode));
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await runMigration(plan, (m) => setMsg(m));
      setPlan(null);
      setMsg(
        `完成：补 hash ${r.hashed} 个，改名 ${r.renamed} 个，合并 ${r.mergedGroups} 组（${r.mergedFiles} 个文件）` +
          (r.dropped ? `，删除无用副本 ${r.dropped} 个` : ''),
      );
      bump();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '迁移失败');
    } finally {
      setBusy(false);
    }
  };

  const dupSize = audit.groups.reduce((n, g) => n + g.files.slice(1).reduce((s, f) => s + f.size, 0), 0);

  return (
    <div className="mig">
      <p className="muted small">
        当前 {audit.total} 个文件：{audit.noHash} 个未算 hash，{audit.legacyNames} 个引用名还是旧的随机 id。
        {audit.groups.length > 0
          ? `发现 ${audit.groups.length} 组内容相同的文件，去除重复可省约 ${fmtSize(dupSize)}。`
          : '没有发现内容重复的文件。'}
      </p>

      <div className="mig-modes">
        {MODES.map((m) => (
          <label key={m.key} className={mode === m.key ? 'mig-mode mig-mode-on' : 'mig-mode'}>
            <input
              type="radio"
              name="mig-mode"
              checked={mode === m.key}
              onChange={() => {
                setMode(m.key);
                setPlan(null);
              }}
            />
            <span className="mig-mode-title">{m.title}</span>
            <span className="muted small">{m.desc}</span>
          </label>
        ))}
      </div>

      {audit.groups.length > 0 && (
        <details className="mig-groups">
          <summary>查看 {audit.groups.length} 组重复文件</summary>
          <ul>
            {audit.groups.slice(0, 20).map((g) => (
              <li key={g.sha256}>
                <code>{g.sha256.slice(0, 12)}</code> · {g.files.length} 个 · {g.files[0].name}
                <span className="muted small">
                  {' '}
                  （{g.refEvents} 个事件
                  {g.avatarPersons.length
                    ? `、头像 ${g.avatarPersons.map((p) => p.displayName).join('、')}`
                    : ''}
                  {g.sameSize ? '' : '，大小不一，不会自动合并'}）
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="row-actions">
        <button className="btn btn-sm" onClick={scan} disabled={busy}>
          预览影响
        </button>
        {msg && <span className="muted small">{msg}</span>}
      </div>

      {plan && (
        <div className="mig-preview">
          <p>
            <strong>{planSummary(plan)}</strong>
          </p>
          <PlanPreview plan={plan} />
          <p className="muted small">迁移会改写事件正文与人物头像，建议先在「设置 → 备份与分享 → 数据备份」里导出一份。</p>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy}>
              {busy ? '执行中…' : '确认执行'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPlan(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}
      {err && <p className="form-err">{err}</p>}
    </div>
  );
}
