// 属性区：按字典分组渲染已填字段 + 「添加自定义字段」
import { useState } from 'react';
import { setAttribute } from '../../core/repo/persons';
import { AttributeField } from '../attr';
import { SensitiveMask } from '../attr/SensitiveValue';
import { bump } from '../../store';
import type { AttributeDef, Person } from '../../core/types';

export function PersonAttrs({ person, defs }: { person: Person; defs: AttributeDef[] }) {
  const [adding, setAdding] = useState(false);

  const groups = Array.from(new Set(defs.map((d) => d.group)));
  const usedKeys = Object.keys(person.attrs);
  const unusedDefs = defs.filter((d) => !usedKeys.includes(d.key));

  const setVal = (def: AttributeDef, value: unknown) => {
    setAttribute(person.id, def.key, value);
    bump();
  };

  return (
    <>
      {groups.map((g) => (
        <section key={g} className="card">
          <h4 className="card-title">{g || '未分组'}</h4>
          <div className="attr-grid">
            {defs
              .filter((d) => d.group === g)
              .map((d) => (
                <div key={d.key} className="attr-row">
                  <span className="attr-label">
                    {d.label}
                    {d.sensitive && <em className="badge">敏感</em>}
                    {d.timeVarying && <em className="badge badge-2">随时间</em>}
                  </span>
                  <div className="attr-control">
                    {d.sensitive ? (
                      <SensitiveMask value={person.attrs[d.key]?.v}>
                        <AttributeField def={d} value={person.attrs[d.key]?.v} onChange={(val) => setVal(d, val)} />
                      </SensitiveMask>
                    ) : (
                      <AttributeField def={d} value={person.attrs[d.key]?.v} onChange={(val) => setVal(d, val)} />
                    )}
                  </div>
                  {person.attrs[d.key]?.note && <span className="attr-note">{person.attrs[d.key].note}</span>}
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card-head">
          <h4 className="card-title">自定义字段</h4>
          {unusedDefs.length > 0 && (
            <button className="btn btn-sm" onClick={() => setAdding((s) => !s)}>
              {adding ? '取消' : '＋ 添加字段'}
            </button>
          )}
        </div>
        {adding && (
          <div className="chip-group">
            {unusedDefs.map((d) => (
              <button
                key={d.key}
                className="chip"
                onClick={() => {
                  setAttribute(person.id, d.key, d.type === 'boolean' ? false : '');
                  bump();
                  setAdding(false);
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {unusedDefs.length === 0 && (
          <p className="muted">所有已定义的字段都已添加。可在「设置 → 属性字典」新建字段。</p>
        )}
      </section>
    </>
  );
}
