// 操作日志：同步 / 撤销 / 审计的核心资产。
// 所有写操作必须与业务变更在同一个事务里追加，否则同步会丢变更。

import { run } from './query';
import { getDeviceId } from './device';
import { hlcNow } from '../time';

export function appendOplog(
  entity: string,
  entityId: string,
  op: 'insert' | 'update' | 'delete',
  payload?: unknown,
): void {
  run(
    `INSERT INTO oplog (hlc, device_id, entity, entity_id, op, payload, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      hlcNow(getDeviceId()),
      getDeviceId(),
      entity,
      entityId,
      op,
      payload === undefined ? null : JSON.stringify(payload),
      new Date().toISOString(),
    ],
  );
}
