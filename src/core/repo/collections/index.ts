// 事件集仓储入口。原 383 行的 collections.ts 拆成：
//   rows（行映射）· closure（闭包表）· read（读取）· write（写入）· members（成员）
// 这里原样转出，外部 import '../repo/collections' 的写法不用改。

export { collectionFromRow, type CollectionRow } from './rows';
export { flattenTree, type FlatNode } from './flatten';
export { rebuildClosure, ensureClosure, normalizeCollectionTree } from './closure';
export {
  getRoot,
  getCollection,
  getTree,
  getBreadcrumb,
  listChildren,
  listArchivedCollections,
  descendantIdsOf,
  collectionTotalCost,
  type TreeNode,
} from './read';
export {
  isSmart,
  isEmptyRule,
  emptyRule,
  ruleToFilter,
  listSmartEvents,
  smartEventCount,
  describeRule,
} from './smart';
export {
  createCollection,
  updateCollection,
  restoreCollection,
  moveCollection,
  deleteCollection,
  setCollectionPrivate,
  setCollectionIcon,
  setCollectionTemplate,
} from './write';
export {
  listMembers,
  addMember,
  removeMember,
  moveMemberTo,
  collectionsOfEvent,
  descendantEventIds,
  type MemberItem,
} from './members';
export { eventTableRows, type EventTableRow } from './table';
export { FIRST_ORDER_KEY } from '../../order';
