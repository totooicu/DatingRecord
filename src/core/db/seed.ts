// 首次建库时的默认数据：常用属性定义 + 根事件集

import type { Database } from 'sql.js';
import { newId } from '../id';
import { hlcNow } from '../time';
import { FIRST_ORDER_KEY } from '../order';
import { getDeviceId } from './device';

export function seedDefaults(d: Database): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  const defaults: [string, string, string, string, number?, number?, number?, number?][] = [
    // key, label, type, group, max, required, sensitive, timeVarying
    ['birthday', '生日', 'date', '基本信息', 0, 0, 0, 0],
    ['occupation', '职业', 'text', '基本信息', 0, 0, 0, 1],
    ['height', '身高', 'number', '外在', 0, 0, 0, 1],
    ['affinity', '好感度', 'rating', '关系', 5, 0, 1, 1],
    ['phone', '手机号', 'phone', '联系方式', 0, 0, 1, 0],
    ['hobbies', '爱好', 'tag', '喜好', 0, 0, 0, 0],
  ];
  let idx = 0;
  for (const [key, label, type, group, max, req, sens, tv] of defaults) {
    d.run(
      `INSERT OR IGNORE INTO attribute_defs
       (key, label, type, group_name, options_json, unit, max_value, required, sensitive, time_varying,
        archived, order_key, device_id, rev, hlc, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?,?)`,
      [
        key,
        label,
        type,
        group,
        '[]',
        type === 'number' ? 'cm' : null,
        max ?? null,
        req ?? 0,
        sens ?? 0,
        tv ?? 0,
        String(idx++),
        getDeviceId(),
        hlc,
        now,
        now,
      ],
    );
  }

  // 根集合
  const rootId = newId('c');
  d.run(
    `INSERT OR IGNORE INTO collections
     (id, name, kind, parent_id, order_key, description, status, is_root, time_range_auto,
      device_id, rev, hlc, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rootId, '全部', 'root', null, FIRST_ORDER_KEY, '', 'ongoing', 1, 1, getDeviceId(), 1, hlc, now, now],
  );
  d.run(
    'INSERT OR REPLACE INTO collection_closure (ancestor_id, descendant_id, depth) VALUES (?,?,0)',
    [rootId, rootId],
  );
}
