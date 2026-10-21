// 事件集仓储入口。原 383 行的 collections.ts 拆成：
//   rows（行映射）· closure（闭包表）· read（读取）· write（写入）· members（成员）
// 这里原样转出，外部 import '../repo/collections' 的写法不用改。

export { collectionFromRow, type CollectionRow } from './rows';
export { rebuildClosure, ensureClosure } from './closure';
export { getRoot, getCollection, getTree, getBreadcrumb, listChildren, type TreeNode } from './read';
export { createCollection, updateCollection, moveCollection, deleteCollection } from './write';
export {
  listMembers,
  addMember,
  removeMember,
  moveMemberTo,
  collectionsOfEvent,
  descendantEventIds,
  type MemberItem,
} from './members';
export { FIRST_ORDER_KEY } from '../../order';
