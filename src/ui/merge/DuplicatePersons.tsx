/**
 * 重复人物清理。
 *
 * 起因：createPerson 早期没有重名校验，用户以为没建成又建了一次，
 * 于是同一个人在库里出现两行 —— 事件参与者会同时列出两个同名 chip，
 * 设置页的「人物」计数（行数）也和眼睛数出来的人数对不上。
 */
import { useMemo, useState } from 'react';
import { findDuplicatePersons, type PersonWithStats } from '../../core/repo/persons';
import { Empty } from '../common';
import { useVersion } from '../../store';
import { recordLabel } from './format';
import { ChooseDropModal } from './ChooseDropModal';
import { MergeModal } from './MergeModal';

export function DuplicatePersons() {
  const v = useVersion();
  const dupes = useMemo(() => findDuplicatePersons(), [v]);
  const [pair, setPair] = useState<[string, string] | null>(null);
  /** 一组超过两条时，先让用户挑「把哪条并进来」 */
  const [choose, setChoose] = useState<[PersonWithStats, PersonWithStats[]] | null>(null);

  if (dupes.length === 0) return <Empty text="没有发现同名人物" />;

  return (
    <>
      <p className="muted">
        下面每组是同一个名字建了多次。合并会把事件关联归到保留的那条，另一条移出人物列表（仍在库中，见下方「归档的人物」）。
      </p>
      {dupes.map((group) => {
        const name = group[0].displayName;
        return (
          <div key={name} className="merge-group">
            <div className="merge-group-head">
              <strong>{name}</strong>
              <span className="muted">{group.length} 条重复</span>
            </div>
            <ul className="merge-list">
              {group.map((p, i) => (
                <li key={p.id}>
                  <span className="merge-idx">#{i + 1}</span>
                  <span className="merge-rec">
                    <span className="merge-rec-main">{p.displayName}</span>
                    <span className="muted small">{recordLabel(p)}</span>
                  </span>
                  {/* 每条只给一个按钮，点击时再选「合并哪几条进来」——
                      之前每条都列出 N-1 个按钮，3 条就有 6 个，根本分不清 */}
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const others = group.filter((o) => o.id !== p.id);
                      if (others.length === 1) setPair([p.id, others[0].id]);
                      else setChoose([p, others]);
                    }}
                  >
                    保留这条
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {choose && (
        <ChooseDropModal
          keep={choose[0]}
          others={choose[1]}
          onPick={(id) => {
            setChoose(null);
            setPair([choose[0].id, id]);
          }}
          onClose={() => setChoose(null)}
        />
      )}
      {pair && <MergeModal keepId={pair[0]} dropId={pair[1]} onClose={() => setPair(null)} />}
    </>
  );
}
