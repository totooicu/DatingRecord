// 示例数据：方便第一次打开时看到效果（可在设置页一键清除）

import { createPerson, setAttribute, upsertDef } from './repo/persons';
import { createEvent } from './repo/events';
import { createCollection, addMember } from './repo/collections';
import { queryOne } from './db';

function daysAgo(n: number, hour = 19, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function loadSampleData(): { persons: number; events: number; collections: number } {
  // 补充示例属性
  upsertDef({ key: 'mbti', label: 'MBTI', type: 'enum', group: '喜好', options: ['INFP', 'ENFP', 'INTJ', '其他'] });
  upsertDef({ key: 'favorite_food', label: '爱吃', type: 'tag', group: '喜好' });

  const p1 = createPerson({ displayName: '林小满', tags: ['同事', '攀岩'] });
  setAttribute(p1.id, 'birthday', '1998-06-12');
  setAttribute(p1.id, 'occupation', '产品经理');
  setAttribute(p1.id, 'height', 168);
  setAttribute(p1.id, 'affinity', 4);
  setAttribute(p1.id, 'hobbies', ['攀岩', '爵士乐']);
  setAttribute(p1.id, 'mbti', 'INFP');
  setAttribute(p1.id, 'favorite_food', ['日料', '草莓']);

  const p2 = createPerson({ displayName: '许知夏', tags: ['朋友'] });
  setAttribute(p2.id, 'occupation', '摄影师');
  setAttribute(p2.id, 'affinity', 3);
  setAttribute(p2.id, 'hobbies', ['胶片', '骑行']);

  const arc = createCollection({ name: '和小满的春天', kind: 'arc', description: '从认识开始的记录' });
  const sub = createCollection({ name: '第一次系列', parentId: arc.id });
  const topic = createCollection({ name: '吃饭地图', kind: 'topic' });

  const mk = (input: Parameters<typeof createEvent>[0]) => {
    const e = createEvent(input);
    return e;
  };

  const e1 = mk({
    title: '第一次一起看电影',
    kind: 'movie',
    time: { kind: 'interval', start: daysAgo(60, 19, 20), end: daysAgo(60, 22, 10), precision: 'minute' },
    place: { name: '万象城影城' },
    participants: [{ personId: p1.id, role: 'primary', note: '她迟到了 10 分钟，说地铁限流' }],
    content: '看了《你想活出怎样的人生》。散场后在江边走了很久，聊到各自的家庭。\n\n她说下次想去海边。',
    tags: ['电影', '第一次'],
    metrics: { rating: 5, cost: 128.5, currency: 'CNY', mood: '开心', intimacyDelta: 1 },
  });
  addMember(sub.id, 'event', e1.id);
  addMember(arc.id, 'event', e1.id);

  const e2 = mk({
    title: '日料晚餐',
    kind: 'meal',
    time: { kind: 'instant', start: daysAgo(45, 18, 30), precision: 'minute' },
    place: { name: '鲸岚日料' },
    participants: [{ personId: p1.id, role: 'primary' }],
    content: '她升职了，说要请客结果还是我付的。聊到她想去日本。',
    tags: ['吃饭'],
    metrics: { rating: 4, cost: 320, currency: 'CNY', mood: '开心' },
  });
  addMember(topic.id, 'event', e2.id);
  addMember(arc.id, 'event', e2.id);

  const e3 = mk({
    title: '大雨里的争吵',
    kind: 'conflict',
    time: { kind: 'instant', start: daysAgo(20, 21, 0), precision: 'hour' },
    place: { name: '地铁口' },
    participants: [{ personId: p1.id, role: 'primary', note: '她不喜欢被临时放鸽子' }],
    content: '我临时改了时间，她很不高兴。以后至少要提前一天说。',
    tags: ['矛盾'],
    metrics: { rating: 2, cost: 0, currency: 'CNY', mood: '低落', intimacyDelta: -1 },
  });
  addMember(arc.id, 'event', e3.id);

  const e4 = mk({
    title: '和知夏骑车去湿地',
    kind: 'trip',
    time: { kind: 'interval', start: daysAgo(7, 9, 0), end: daysAgo(7, 17, 0), precision: 'hour' },
    place: { name: '西溪湿地' },
    participants: [{ personId: p2.id, role: 'primary' }],
    content: '拍了一卷胶片，还没洗出来。',
    tags: ['出行', '摄影'],
    metrics: { rating: 4, cost: 86, currency: 'CNY', mood: '放松' },
  });
  addMember(topic.id, 'event', e4.id);

  const e5 = mk({
    title: '认识的那天',
    kind: 'milestone',
    time: { kind: 'fuzzy', start: daysAgo(90, 15, 0), precision: 'day', raw: '大概是三月底' },
    participants: [{ personId: p1.id, role: 'primary' }],
    content: '在公司楼下的咖啡店碰到。',
    tags: ['第一次'],
    metrics: { rating: 5 },
  });
  addMember(sub.id, 'event', e5.id);

  setAttribute(p1.id, 'affinity', 5);

  return { persons: 2, events: 5, collections: 3 };
}

export function hasAnyPerson(): boolean {
  const row = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM persons WHERE deleted_at IS NULL');
  return (row?.c ?? 0) > 0;
}
