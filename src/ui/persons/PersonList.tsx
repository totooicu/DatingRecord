import { useMemo, useState } from 'react';
import { applyTemplate, createPerson, listPersons, listTemplates } from '../../core/repo/persons';
import { useVersion, bump } from '../../store';
import { relativeDays } from '../../core/time';
import { BUILD_TIME, fmtBuildTime } from '../../core/buildInfo';
import { Avatar } from './Avatar';

export function PersonList({
  selectedId,
  onSelect,
  keyword,
  onKeyword,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  keyword: string;
  onKeyword: (k: string) => void;
}) {
  const v = useVersion();
  const persons = useMemo(() => listPersons({ keyword }), [v, keyword]);
  const allPersons = useMemo(() => listPersons({ includeArchived: true }), [v]);
  const templates = useMemo(() => listTemplates(), [v]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  /** 新建时套哪个模板；空 = 不套 */
  const [tplId, setTplId] = useState('');
  /** 重名时拦一次：不是禁止（同名真实存在），而是让用户确认「是不是同一个人」 */
  const [dupWarn, setDupWarn] = useState<string | null>(null);

  const trimmed = name.trim();
  const existing = trimmed ? allPersons.find((p) => p.displayName.trim() === trimmed) : undefined;

  const close = () => {
    setName('');
    setTplId('');
    setCreating(false);
    setDupWarn(null);
  };

  const submit = (force = false) => {
    const n = trimmed;
    if (!n) return;
    // 已经有同名，且用户还没确认过 → 先把已有的那条拎出来给用户看
    if (existing && !force) {
      setDupWarn(existing.id);
      return;
    }
    const p = createPerson({ displayName: n });
    if (tplId) applyTemplate(tplId, p.id);
    bump();
    close();
    onSelect(p.id);
  };

  return (
    <div className="pane-body">
      {/* 构建时间放在「人物」标题上方：主页面一眼就能看到线上是不是最新版 */}
      <div className="pane-build-time muted small" title={BUILD_TIME}>
        最新版本 · {fmtBuildTime()}
      </div>
      <div className="pane-head home-head">
        <strong>人物</strong>
        <button className="icon-btn" onClick={() => setCreating(true)} title="新建人物">
          ＋
        </button>
      </div>
      {creating && (
        <div className="inline-create">
          <input
            autoFocus
            value={name}
            placeholder="姓名"
            onChange={(e) => {
              setName(e.target.value);
              setDupWarn(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') close();
            }}
          />
          {templates.length > 0 && (
            <select
              className="inline-create-tpl"
              value={tplId}
              onChange={(e) => setTplId(e.target.value)}
              aria-label="选择属性模板"
            >
              <option value="">不套模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.keys.length} 字段）
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => submit()}>
            创建
          </button>
        </div>
      )}
      {creating && existing && dupWarn && (
        <div className="dup-warn">
          <p>
            已经有「{existing.displayName}」了（{existing.stats.eventCount} 次事件）。要直接用它，还是确实要再建一个同名的人？
          </p>
          <div className="row-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const id = existing.id;
                close();
                onSelect(id);
              }}
            >
              用已有的
            </button>
            <button className="btn btn-sm" onClick={() => submit(true)}>
              仍要新建
            </button>
          </div>
        </div>
      )}
      <div className="list-search">
        <input
          type="search"
          value={keyword}
          placeholder="搜索姓名、标签、备注"
          onChange={(e) => onKeyword(e.target.value)}
        />
        {keyword && (
          <button className="icon-btn" onClick={() => onKeyword('')} aria-label="清除搜索">
            ✕
          </button>
        )}
      </div>
      {persons.length === 0 && <div className="muted pad">暂无人物</div>}
      {persons.map((p) => (
        <button
          key={p.id}
          className={p.id === selectedId ? 'list-item list-item-on' : 'list-item'}
          onClick={() => onSelect(p.id)}
        >
          <Avatar name={p.displayName} avatar={p.avatar} icon={p.icon} />
          <span className="list-item-main">
            <span className="list-item-title">
              {p.displayName}
              {p.isPrivate && <span className="privacy-badge">隐私</span>}
            </span>
            <span className="list-item-sub">
              {p.stats.eventCount} 次事件
              {p.stats.lastMeetTs ? ` · ${relativeDays(new Date(p.stats.lastMeetTs).toISOString())}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
