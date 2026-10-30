// 批量示例数据的「语料库」：人名、地点、帖子体正文、聊天、歌名……
//
// 全部是杜撰的，模仿社交平台上常见的记录口吻，不照搬任何真实作品。
// 目的不是「读起来像文学」，而是让造出来的行在数据量和文本长度上都接近
// 真实使用的上界——尤其是长度，界面里很多卡顿只有长文本才暴露得出来。
//
// 这一层没有任何副作用，也不碰数据库。

/** 文本放大档位：0 正常 / 1 长 / 2 很长 / 3 极端 */
export type TextScale = 0 | 1 | 2 | 3;

export const TEXT_SCALE_LABEL: Record<TextScale, string> = {
  0: '正常',
  1: '长',
  2: '很长',
  3: '极端',
};

/** 各档位下「目标字符数」。数值本身也是压测的一部分，别随手往下调。 */
const LEN: Record<string, [number, number, number, number]> = {
  //              正常  长    很长   极端
  personName: [4, 12, 40, 120],
  eventTitle: [12, 36, 120, 420],
  content: [160, 700, 2800, 12000],
  placeName: [8, 24, 80, 260],
  address: [16, 50, 160, 520],
  fileName: [24, 60, 160, 420],
  collectionName: [8, 22, 70, 220],
  collectionDesc: [30, 90, 300, 1200],
  tag: [3, 6, 16, 44],
  note: [10, 30, 90, 300],
  chatLine: [12, 40, 140, 600],
  playlistName: [8, 20, 60, 180],
};

/**
 * 每个字段的「总字符预算」。
 *
 * 这是踩过坑才加的：长度如果只跟着档位一路涨，10000 条事件 × 12000 字正文
 * = 1.2 亿字符，库直接被撑爆，时间线和日历会卡死——那测出来的就不是应用的
 * 性能，而是我把数据造得不讲道理。所以长度由「预算 ÷ 条数」封顶：
 * 条数少的时候单条可以长到离谱（测单条渲染），条数多的时候自动收敛，
 * 保证总量始终在同一量级上。
 */
const BUDGET: Record<string, number> = {
  personName: 120_000,
  eventTitle: 500_000,
  content: 2_000_000,
  placeName: 250_000,
  address: 350_000,
  fileName: 120_000,
  collectionName: 60_000,
  collectionDesc: 300_000,
  tag: 0, // 标签数不参与分摊
  note: 400_000,
  chatLine: 250_000,
  playlistName: 30_000,
};

/**
 * 取某个字段的目标长度：档位定上限，总量预算定最终值。
 * n = 这个字段一共要造多少条。
 */
export function lenOf(field: string, scale: TextScale, n = 1): number {
  const row = (LEN as Record<string, [number, number, number, number]>)[field];
  if (!row) return 20;
  const base = row[scale];
  const budget = BUDGET[field];
  if (!budget) return base;
  const cap = Math.floor(budget / Math.max(1, n));
  return Math.max(Math.min(base, cap), Math.min(row[0], cap));
}

// ---------------- 确定性随机 ----------------

/**
 * 造数据用的伪随机：同一颗种子每次生成完全一致的结果，
 * 方便「同样的规模再来一次」对比性能，也让 bug 可复现。
 */
export function makeRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

export function int(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

// ---------------- 语料 ----------------

const SURNAMES = [
  '林', '陈', '许', '苏', '周', '沈', '顾', '江', '梁', '唐', '叶', '程',
  '余', '孟', '白', '宋', '罗', '韩', '曾', '邓', '谢', '钟', '邱', '骆',
] as const;

const GIVEN_NAMES = [
  '小满', '知夏', '屿', '念', '望舒', '清和', '砚', '一鸣', '见微', '舟',
  '归禾', '未晞', '向晚', '子聿', '拾一', '南乔', '照野', '云深', '鸣珂', '扶苏',
  '青梧', '既明', '斯年', '何以', '安然', '长宁', '疏影', '洛', '阿七', '小舟',
] as const;

const CITIES = [
  '杭州', '上海', '成都', '南京', '广州', '武汉', '西安', '长沙', '苏州', '厦门',
  '重庆', '北京', '深圳', '青岛', '昆明', '大理', '沈阳', '福州', '天津', '合肥',
] as const;

const DISTRICTS = [
  '西湖区', '拱墅区', '滨江区', '余杭区', '上城区', '下城区', '江干区', '萧山区',
  '天目里', '万象城', '湖滨银泰', '嘉里中心', '来福士', '大悦城', '西溪印象城',
] as const;

const VENUE_PREFIX = [
  '米仓', '拾光', '半山', '南枝', '无名', '野岛', '白塔', '三叶', '慢作', '致橡树',
  '浮生', '一叶', '木叶', '旧街', '青苔', '晚风', '小满', '雾山', '石泉', '寻野',
] as const;

const VENUE_KIND = [
  '咖啡', '面馆', '火锅店', '书店', 'Livehouse', '美术馆', '公园', '菜市场',
  '烧烤摊', '甜品店', '日料店', '小酒馆', '体育馆', '影院', '茶馆', '花店',
  '旧书店', '唱片店', '洗衣店', '便利店',
] as const;

const STREETS = [
  '文一西路', '南山路', '延安路', '庆春路', '教工路', '古墩路', '天目山路',
  '湖滨路', '中山中路', '凤起路', '秋涛北路', '玉古路', '求是路', '跑马场路',
] as const;

/** 帖子体正文的句子模板：{who} {where} {what} 会被替换 */
const POST_SENTENCES = [
  '和{who}约在{where}，进门先被冷气吹了个激灵，后来才知道那台空调正对着门口。',
  '{who}迟到十二分钟，理由是地铁口那家{venue}的队伍拐了两个弯。',
  '点了杯冰美式，{who}说这家豆子比上次那家酸一点，我喝不太出来。',
  '窗边那桌一直在聊房子的事情，声音不大但句句都是数字。',
  '出门的时候下雨了，两个人挤在一把伞下面，走到{street}才发现方向反了。',
  '{who}把伞往我这边偏，自己半边肩膀湿透，到店门口才说「没事，反正要洗」。',
  '服务生来添了两次水，第二次的时候我们正好聊到一半，都停下来看了他一眼。',
  '桌上的小票被风吹到地上，捡起来发现背面被人用铅笔写了个电话号码。',
  '回来路上{who}说下次想去另一家，我说行，但要先查一下营业时间。',
  '照片是{who}拍的，逆光，人脸全黑，但她说这样才有氛围感。',
  '这家{venue}的歌单很怪，前脚还在放爵士，后脚就切到了动画片主题曲。',
  '结账的时候才发现忘带会员卡，店员说手机号也能积分，就报了一串数字。',
  '{where}门口那只猫还在，比上次胖了一圈，趴在台阶上谁也不理。',
  '我们聊到很晚，直到店员开始拖地才意识到该走了。',
  '{who}说我最近话少，我说没有，只是最近事情多，说完自己都觉得像借口。',
  '回来地铁上人很少，我们坐在门口那一节，风从缝里灌进来，有点凉。',
  '第二天{who}发消息说那家的可颂其实一般，我说是，但咖啡还行。',
  '后来又去过一次，{venue}换了菜单，价格涨了两块，杯子也换了。',
  '那天下雨，{where}的屋檐滴水，我们在下面站了一会儿才走。',
  '{who}记错了日子，说好的周三变成了周四，好在人不多。',
] as const;

const CHAT_LINES = [
  '在路上了',
  '你到了吗',
  '我这边还有两站',
  '门口等你',
  '今天人好多',
  '要不要换个地方',
  '算了就这家吧',
  '我点了杯美式',
  '给我也来一杯',
  '刚刚那首歌叫什么',
  '不知道，我识曲也没识出来',
  '晚上吃什么',
  '随便，你定',
  '那火锅？',
  '行',
  '拍张照',
  '拍了，发你',
  '这张好看',
  '我到了，你在哪',
  '回头',
] as const;

const TAGS = [
  '咖啡', '电影', '散步', '雨天', '夜宵', '音乐', '展览', '书店', '爬山', '海边',
  '出差', '生病', '生日', '吵架', '和好', '面试', '搬家', '通宵', '赶车', '迷路',
  '第一次', '很久以前', '值得再去的', '不想再去', '有点贵', '很便宜', '排队久',
  '意外', '计划之外', '临时起意', '一个人', '很多人', '两个人', '通电话', '失联',
] as const;

/** 歌名：杜撰，模仿流媒体歌单里常见的命名 */
const SONG_WORDS_A = [
  '晚风', '旧巷', '第七天', '雨', '蓝', '未寄出的', '凌晨三点', '南方', '汽水',
  '回程', '长夜', '白噪', '一场', '慢速', '无人', '纸飞机', '海边', '深蓝',
] as const;

const SONG_WORDS_B = [
  '告白', '公路', '信号灯', '备忘录', '快照', '回声', '练习曲', '日记', '碎片',
  '漫游', '序曲', '独白', '切片', '副本', '手稿', '草稿', '剪辑', '旁白',
] as const;

const ARTISTS = [
  '夜航西飞', '今日供货', '慢车道', '无风带', '南岛电台', '午后三点半',
  '铁皮罐头', '低空飞行', '月亮邮局', '第七号室', '备用频道', '静音练习',
] as const;

const MOODS = ['平静', '愉快', '疲惫', '烦躁', '感动', '低落', '兴奋', '复杂'] as const;
const EVENT_KINDS = ['note', 'date', 'chat', 'trip', 'meal', 'movie', 'work'] as const;

// ---------------- 文本生成 ----------------

/**
 * 把一段骨架文本「灌」到目标长度：循环套用句子模板，直到够长为止。
 * 不做语义连贯——压测要的是长度和体积，不是可读性。
 */
function grow(target: number, build: (i: number) => string): string {
  if (target <= 0) return '';
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  while (total < target) {
    const s = build(i++);
    parts.push(s);
    total += s.length;
    if (i > 4000) break; // 兜底：别为了一个极端长度把页面卡死
  }
  const out = parts.join('');
  return out.length > target ? out.slice(0, target) : out;
}

export interface CorpusCtx {
  rnd: () => number;
  scale: TextScale;
  /** 这个字段一共要造多少条——用来把总字符预算摊到每条上 */
  n: number;
}

/** 换一个条数（同一份 ctx 要造不同数量的字段时用） */
export function withN(c: CorpusCtx, n: number): CorpusCtx {
  return { ...c, n };
}

export function personName(c: CorpusCtx, i: number): string {
  const base = `${pick(c.rnd, SURNAMES)}${pick(c.rnd, GIVEN_NAMES)}`;
  const target = lenOf('personName', c.scale, c.n);
  return grow(target, (k) => (k === 0 ? base : `${pick(c.rnd, SURNAMES)}${pick(c.rnd, GIVEN_NAMES)}·${i}${k}、`));
}

export function placeName(c: CorpusCtx): string {
  const base = `${pick(c.rnd, VENUE_PREFIX)}${pick(c.rnd, VENUE_KIND)}`;
  const target = lenOf('placeName', c.scale, c.n);
  return grow(target, (k) =>
    k === 0 ? base : `${pick(c.rnd, VENUE_PREFIX)}${pick(c.rnd, VENUE_KIND)}·${pick(c.rnd, DISTRICTS)}分店、`,
  );
}

export function addressOf(c: CorpusCtx): string {
  const base = `${pick(c.rnd, CITIES)}${pick(c.rnd, DISTRICTS)}${pick(c.rnd, STREETS)}${int(c.rnd, 1, 999)}号`;
  const target = lenOf('address', c.scale, c.n);
  return grow(target, (k) =>
    k === 0 ? base : `${pick(c.rnd, DISTRICTS)}${pick(c.rnd, STREETS)}${int(c.rnd, 1, 999)}号近${pick(c.rnd, VENUE_KIND)}、`,
  );
}

export function eventTitle(c: CorpusCtx, i: number, who: string, place: string): string {
  const base = `${who} · ${place}`;
  const target = lenOf('eventTitle', c.scale, c.n);
  // 极端档位下标题会变成一大串「无空格长串」：这类内容最容易把 UI 顶宽
  return grow(target, (k) =>
    k === 0 ? base : `第${i}次${pick(c.rnd, VENUE_KIND)}与${pick(c.rnd, GIVEN_NAMES)}在${place}的${pick(c.rnd, TAGS)}记录_`,
  );
}

export function contentOf(c: CorpusCtx, who: string, place: string): string {
  const target = lenOf('content', c.scale, c.n);
  const rnd = c.rnd;
  return grow(target, () => {
    let s: string = pick(rnd, POST_SENTENCES);
    s = s.replace('{who}', who).replace('{where}', place);
    s = s.replace('{venue}', pick(rnd, VENUE_KIND)).replace('{street}', pick(rnd, STREETS));
    return `　　${s}\n\n`;
  });
}

export function tagList(c: CorpusCtx): string[] {
  const n = lenOf('tag', c.scale, c.n);
  const out = new Set<string>();
  let guard = 0;
  while (out.size < n && guard++ < n * 8) out.add(pick(c.rnd, TAGS));
  return [...out];
}

export function chatLine(c: CorpusCtx, i: number, who: string): string {
  const base = pick(c.rnd, CHAT_LINES);
  const target = lenOf('chatLine', c.scale, c.n);
  return grow(target, (k) =>
    k === 0 ? base : `（${i}-${k}）${pick(c.rnd, CHAT_LINES)}，${who}${pick(c.rnd, CHAT_LINES)}`,
  );
}

export function noteOf(c: CorpusCtx, i: number): string {
  const target = lenOf('note', c.scale, c.n);
  return grow(target, (k) =>
    k === 0
      ? `路过${pick(c.rnd, VENUE_KIND)}`
      : `第${i}批${pick(c.rnd, VENUE_PREFIX)}${pick(c.rnd, VENUE_KIND)}门口停留${int(c.rnd, 1, 40)}分钟、`,
  );
}

/** 文件名：刻意在极端档位生成「无空格、无标点」的超长串，用来试 UI 撑宽 */
export function fileName(c: CorpusCtx, i: number, ext: string): string {
  const target = lenOf('fileName', c.scale, c.n);
  const stamp = new Date(Date.now() - i * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  const base = `IMG_${stamp}_${pick(c.rnd, VENUE_PREFIX)}${pick(c.rnd, VENUE_KIND)}`;
  const body = grow(Math.max(0, target - base.length - ext.length - 8), (k) =>
    k === 0 ? '原图未压缩备份最终确认版' : `${pick(c.rnd, VENUE_PREFIX)}${pick(c.rnd, VENUE_KIND)}合集第${i}批`,
  );
  return `${base}${body}_${i}${ext}`;
}

export function collectionName(c: CorpusCtx, i: number): string {
  const target = lenOf('collectionName', c.scale, c.n);
  const base = `${pick(c.rnd, GIVEN_NAMES)}的${pick(c.rnd, VENUE_KIND)}合集`;
  return grow(target, (k) =>
    k === 0 ? base : `与${pick(c.rnd, GIVEN_NAMES)}的第${i}个${pick(c.rnd, TAGS)}`,
  );
}

export function collectionDesc(c: CorpusCtx): string {
  const target = lenOf('collectionDesc', c.scale, c.n);
  return grow(target, () => `${pick(c.rnd, POST_SENTENCES).replace(/\{[^}]+\}/g, pick(c.rnd, VENUE_KIND))}\n`);
}

export function playlistName(c: CorpusCtx, i: number): string {
  const target = lenOf('playlistName', c.scale, c.n);
  const base = `${pick(c.rnd, SONG_WORDS_A)}·${pick(c.rnd, TAGS)}`;
  return grow(target, (k) => (k === 0 ? base : `${pick(c.rnd, SONG_WORDS_A)}与${pick(c.rnd, SONG_WORDS_B)}_${i}${k}`));
}

export function songName(c: CorpusCtx): string {
  return `${pick(c.rnd, SONG_WORDS_A)}${pick(c.rnd, SONG_WORDS_B)}（${pick(c.rnd, ARTISTS)}）`;
}

export function artistOf(c: CorpusCtx): string {
  return pick(c.rnd, ARTISTS);
}

export function moodOf(c: CorpusCtx): string {
  return pick(c.rnd, MOODS);
}

export function eventKindOf(c: CorpusCtx): string {
  return pick(c.rnd, EVENT_KINDS);
}

export function cityOf(c: CorpusCtx): string {
  return pick(c.rnd, CITIES);
}

/** 地理坐标：绕着几个城市中心做随机游走，看起来像真的轨迹 */
export function geoOf(c: CorpusCtx, i: number): { lat: number; lng: number } {
  const center = [
    { lat: 30.2741, lng: 120.1551 },
    { lat: 31.2304, lng: 121.4737 },
    { lat: 30.5728, lng: 104.0668 },
    { lat: 32.0603, lng: 118.7969 },
  ][i % 4];
  return {
    lat: center.lat + (c.rnd() - 0.5) * 0.4,
    lng: center.lng + (c.rnd() - 0.5) * 0.4,
  };
}
