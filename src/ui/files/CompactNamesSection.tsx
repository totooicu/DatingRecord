import { useState } from 'react';
import { applyCompactNames, planCompactNames, type CompactChange } from '../../core/files/compact';
import { bump } from '../../store';

export function CompactNamesSection() {
  const [plan, setPlan] = useState<CompactChange[] | null>(null);
  const [message, setMessage] = useState('');
  const preview = () => {
    setPlan(planCompactNames());
    setMessage('');
  };
  const apply = () => {
    if (!plan) return;
    try {
      const count = applyCompactNames(plan);
      setPlan(null);
      setMessage(`已紧密编号 ${count} 个文件引用名`);
      bump();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '处理失败');
      setPlan(null);
    }
  };
  return <section className="files-advanced compact-names">
    <h4>hash 紧密编号</h4>
    <p className="muted small">同一 hash 引用名、同扩展名按原编号排序为 X、X_2、X_3…；不存在 X 时，最小编号提升为 X。只整理 sha- 引用名，不合并、不删除，不改变文件内容或 ID。</p>
    <p className="muted small">会同步修改库内正文、聊天、头像和图标等引用。外部已复制的旧链接无法同步，请先备份。歌单里的文件 ID 不变，仍可定位原文件。</p>
    <button className="btn btn-sm" onClick={preview}>预览紧密编号</button>
    {plan && <>
      <p>{plan.length ? `将修改 ${plan.length} 个引用名` : '引用名已连续，无需修改'}</p>
      {plan.map(p => <div className="dup-group" key={p.id} style={{ overflowWrap: 'anywhere' }}>
        <strong>{p.name}</strong><div><code>{p.from}</code> → <code>{p.to}</code></div>
      </div>)}
      {plan.length > 0 && <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={apply}>确认紧密编号</button>
        <button className="btn btn-sm" onClick={() => setPlan(null)}>取消</button>
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
