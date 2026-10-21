// 时间线筛选条件：全部为字符串空值表示「不限」

export interface TimelineFilter {
  keyword: string;
  personId: string;
  kind: string;
  tag: string;
  minRating: string;
  withinDays: string;
  collectionId: string;
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
