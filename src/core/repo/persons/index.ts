// 人物仓储入口。原本是 571 行的 persons.ts，按职责拆成：
//   rows（行映射）· attrs（属性字典）· read（读取）· write（写入）
//   merge（重复检测与合并）· values（属性值）· history（变更历史）
// 这里原样转出，外部 import '../repo/persons' 的写法不用改。

export { defFromRow, personFromRow } from './rows';
export type { DefRow, PersonRow } from './rows';
export { listDefs, getDef, upsertDef, archiveDef, restoreDef } from './attrs';
export {
  listPersons,
  listArchivedPersons,
  getPerson,
  statsOf,
  unarchivePerson,
  type PersonStats,
  type PersonWithStats,
  type ArchivedPerson,
} from './read';
export { createPerson, updatePerson, deletePerson, hardDeletePerson } from './write';
export {
  findDuplicatePersons,
  previewMerge,
  mergePersons,
  type MergeAttrChoice,
  type MergePreview,
} from './merge';
export { setAttribute, countAttrValues, retuneAttrValues, type RetuneResult } from './values';
export { listAttrHistory, type AttrHistoryRow } from './history';
export { FIRST_ORDER_KEY } from '../../order';
