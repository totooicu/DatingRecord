// 人物写入：新建、更新、归档、恢复、彻底删除。
// 软删除是铁律——物理删除会让将来的同步把数据又推回来。

import { run, queryOne, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import type { AttributeValue, Person } from '../../types';
import { getPerson } from './read';

export function createPerson(input: { displayName: string; tags?: string[]; attrs?: Record<string, AttributeValue> }): Person {
  const id = newId('p');
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    run(
      `INSERT INTO persons
       (id,display_name,aliases_json,kind,status,tags_json,attrs_json,notes,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.displayName,
        '[]',
        'person',
        'active',
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.attrs ?? {}),
        '',
        getDeviceId(),
        1,
        hlc,
        now,
        now,
      ],
    );
    appendOplog('person', id, 'insert', { displayName: input.displayName });
  });
  return getPerson(id)!;
}

export function updatePerson(
  id: string,
  patch: Partial<Pick<Person, 'displayName' | 'aliases' | 'tags' | 'notes' | 'status' | 'avatar' | 'kind'>>,
): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    const p = getPerson(id);
    if (!p) return;
    run(
      `UPDATE persons SET display_name=?, aliases_json=?, tags_json=?, notes=?, status=?, avatar=?, kind=?,
       rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
      [
        patch.displayName ?? p.displayName,
        JSON.stringify(patch.aliases ?? p.aliases),
        JSON.stringify(patch.tags ?? p.tags),
        patch.notes ?? p.notes,
        patch.status ?? p.status,
        patch.avatar !== undefined ? patch.avatar : p.avatar,
        patch.kind ?? p.kind,
        hlc,
        now,
        id,
      ],
    );
    appendOplog('person', id, 'update', patch);
  });
}

/** 标记 / 取消隐私（隐私模式下的隐藏开关）。单独一个函数，避免污染 updatePerson 的字段清单 */
export function setPersonPrivate(id: string, on: boolean): void {
  const now = new Date().toISOString();
  // 值没变就别写（幂等）：否则重复点一下按钮也会多一条 oplog，
  // 撤销提示条里冒出一条什么都没改的「修改…」
  const cur = queryOne<{ is_private: number | null }>('SELECT is_private FROM persons WHERE id = ?', [id]);
  if (!cur || Number(cur.is_private ?? 0) === (on ? 1 : 0)) return;
  transact(() => {
    run('UPDATE persons SET is_private = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      on ? 1 : 0,
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('person', id, 'update', { isPrivate: on });
  });
}

/** 软删除（墓碑）：不做物理删除，否则同步时会把数据推回来 */
export function deletePerson(id: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE persons SET status = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      'archived',
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('person', id, 'delete', { id });
  });
}

export function hardDeletePerson(id: string): void {
  transact(() => {
    run('DELETE FROM persons WHERE id = ?', [id]);
    run('DELETE FROM event_participants WHERE person_id = ?', [id]);
    run('DELETE FROM person_attr_history WHERE person_id = ?', [id]);
    appendOplog('person', id, 'delete', { id, hard: true });
  });
}
