// 属性字典表格：key 与 type 创建后不可改，删除一律归档
import { archiveDef, listDefs } from '../../core/repo/persons';
import { ATTRIBUTE_TYPES } from '../../core/types';
import { Section } from './Section';
import { bump } from '../../store';

export function DefTable({ onEdit, onNew }: { onEdit: (key: string) => void; onNew: () => void }) {
  return (
    <Section
      title="属性字典"
      desc="属性定义决定字段的类型、校验与显示方式。key 与 type 创建后不可修改（避免历史数据无法解释），删除一律为归档。"
    >
      <table className="def-table">
        <thead>
          <tr>
            <th>字段名</th>
            <th>key</th>
            <th>类型</th>
            <th>分组</th>
            <th>标记</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {listDefs(true).map((d) => (
            <tr key={d.key} className={d.archived ? 'row-off' : ''}>
              <td>
                <button className="link-btn" onClick={() => onEdit(d.key)}>
                  {d.label}
                </button>
              </td>
              <td>
                <code>{d.key}</code>
              </td>
              <td>{ATTRIBUTE_TYPES.find((t) => t.value === d.type)?.label ?? d.type}</td>
              <td>{d.group}</td>
              <td>
                {d.sensitive && <em className="badge">敏感</em>}
                {d.timeVarying && <em className="badge badge-2">随时间</em>}
                {d.archived && <em className="badge">已归档</em>}
              </td>
              <td>
                {!d.archived && (
                  <button
                    className="icon-btn"
                    title="归档（保留历史值）"
                    onClick={() => {
                      archiveDef(d.key);
                      bump();
                    }}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={onNew}>
          ＋ 新建属性
        </button>
      </div>
    </Section>
  );
}
