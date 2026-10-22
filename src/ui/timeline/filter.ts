// 时间线筛选条件：全部为字符串空值表示「不限」
//
// fromTs / toTs 是日历专用的精确区间（点某一天时由日历传进来）：
// 它和 withinDays（最近 N 天）语义互斥，设置了一个就清掉另一个。

export interface TimelineFilter {
  keyword: string;
  personId: string;
  kind: string;
  tag: string;
  minRating: string;
  withinDays: string;
  collectionId: string;
  /** 精确起止（毫秒）；日历「看这一天」用 */
  fromTs?: number;
  toTs?: number;
  /** 区间的人话说明（'2026-10-22' → 时间线上显示「只看 2026-10-22」） */
  dayLabel?: string;
}

export const defaultFilter: TimelineFilter = {
  keyword: '',
  personId: '',
  kind: '',
  tag: '',
  minRating: '',
  withinDays: '',
  collectionId: '',
};
