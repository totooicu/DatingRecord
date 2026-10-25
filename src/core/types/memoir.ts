// 回忆录：事件集里的一次「回顾」。
//
// 核心约定：回忆录不复制事件内容。每一页只记「指向哪个事件 + 选哪张图 +
// 摘哪句 + 写什么导语」，标题、时间、地点、正文永远从事件实时取。
// 事件改了，回忆录跟着对；删了事件，页面显示为缺失而不是留一份旧拷贝。
//
// 范围是**冻结**的：scope.eventIds 是创建那一刻拍下来的快照。之后往集合里
// 加事件不会自动长进回忆录——那会把用户排好的顺序挤乱。要收新事件，走
// 「重新扫描」，由用户确认后再并入。

export interface MemoirPage {
  /** 页 id：只在本回忆录里唯一，用来稳定 React key 与排序 */
  id: string;
  /** 来源事件。页面显示、点回原文、取图取文都靠它 */
  eventId: string;
  /** 摘句 / 选段；空 = 自动取正文首段 */
  excerpt?: string;
  /** 这一页的导语（手写或 AI 生成）；空 = 不显示 */
  note?: string;
  /** 这一页的图（附件 id）；空 = 事件正文里的第一张图 */
  coverFileId?: string;
  /** 先隐藏、不删除：留着以后放回来 */
  hidden?: boolean;
  /** 手工改过（标题/摘句/导语/配图）：AI 重新生成时不覆盖 */
  edited?: boolean;
}

/** 冻结的选择范围 */
export interface MemoirScope {
  /** 创建时拍下的事件 id 快照 */
  eventIds: string[];
  /** 选择时用的时间范围（ISO 日期，含端点）；只为「重新扫描」保留线索 */
  from: string | null;
  to: string | null;
  /** 拍快照的时刻 */
  frozenAt: string;
}

export interface Memoir {
  id: string;
  collectionId: string;
  title: string;
  subtitle: string;
  /** 封面（附件 id）；空 = 用第一页的图 */
  coverFileId: string | null;
  /** 背景歌单（文件库里的 .drpl 文件 id）；空 = 不播放 */
  playlistId: string | null;
  scope: MemoirScope;
  /** 页面顺序即数组顺序 */
  pages: MemoirPage[];
  /** 最近一次内容的来源：手工 / AI 草稿 */
  source: 'manual' | 'ai';
  /** AI 生成用的模型别名，留痕用；手工为空 */
  aiModel: string | null;
  deviceId: string;
  rev: number;
  hlc: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
