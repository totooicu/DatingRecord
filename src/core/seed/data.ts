// 示例数据的「内容」部分：人物、事件集、事件、回忆录。
//
// 全放在这里刻意不含任何副作用——loadSampleData 负责把这份声明翻译成
// 数据库里的行。加一条示例事件只需要在 SAMPLE_EVENTS 里补一段。
//
// 时间的写法是「相对今天」，daysAgo 越大约早，这样示例永远落在过去一年内，
// 不会因为写死日期而变成「未来事件」。

import type { CollectionIcon, CollectionKind, SmartRule } from '../types';

export interface SamplePersonDef {
  key: string;
  name: string;
  tags: string[];
  /** QQ 式分组（v14）：一个人只挂一个组；不写 = 未分组 */
  group?: string;
  attrs: Record<string, unknown>;
}

export interface SampleCollectionDef {
  key: string;
  name: string;
  kind: CollectionKind;
  parent?: string;
  description?: string;
  rule?: SmartRule;
  icon?: CollectionIcon;
}

export interface SampleChatLine {
  /** 旁白：不带头像的一行，用来插时间或场景 */
  divider?: boolean;
  /** 说话的人；不给 = 事件里 role='self' 的「我」 */
  who?: string;
  body: string;
}

export interface SampleEventDef {
  key: string;
  title: string;
  kind: string;
  at: { daysAgo: number; hour: number; minute?: number };
  end?: { daysAgo: number; hour: number; minute?: number };
  /** 模糊时间的原文；给了就用 fuzzy，否则按 end 有无区分 instant / interval */
  fuzzy?: string;
  place: string;
  address?: string;
  geo?: { lat: number; lng: number };
  /** 参与者（人物 key）；role 一律 primary */
  people?: string[];
  /** 是否把「我」也写进参与者（role='self'） */
  self?: boolean;
  content?: string;
  tags?: string[];
  rating?: number;
  cost?: number;
  mood?: string;
  intimacy?: number;
  collections?: string[];
  /** images.ts 里的场景 key */
  image?: string;
  private?: boolean;
  viewMode?: 'chat';
  chat?: SampleChatLine[];
  /** 因果/顺序关联：这条之后发生了什么（事件 key） */
  followedBy?: string;
}

export interface SampleMemoirPageDef {
  eventKey: string;
  note?: string;
  excerpt?: string;
  hidden?: boolean;
  edited?: boolean;
}

export interface SampleMemoirDef {
  collection: string;
  title: string;
  subtitle: string;
  eventKeys: string[];
  /** 用哪一页的配图当封面 */
  coverFromEvent?: string;
  pages: SampleMemoirPageDef[];
}

// ---------------- 人物 ----------------

export const SAMPLE_PERSONS: SamplePersonDef[] = [
  {
    key: 'man',
    name: '林小满',
    tags: ['同事', '攀岩'],
    group: '同事',
    attrs: {
      birthday: '1998-06-12',
      occupation: '产品经理',
      height: 168,
      affinity: 5,
      phone: '13800001234',
      hobbies: ['攀岩', '爵士乐'],
      mbti: 'INFP',
      favorite_food: ['日料', '草莓'],
      city: '杭州',
    },
  },
  {
    key: 'xia',
    name: '许知夏',
    tags: ['朋友'],
    group: '朋友',
    attrs: { occupation: '摄影师', affinity: 3, hobbies: ['胶片', '骑行'], city: '杭州' },
  },
  {
    key: 'yu',
    name: '陈屿',
    tags: ['朋友介绍'],
    group: '朋友',
    attrs: { occupation: '建筑设计师', affinity: 2, hobbies: ['咖啡', '羽毛球'], mbti: 'INTJ', city: '杭州' },
  },
  {
    key: 'nian',
    name: '苏念',
    tags: ['大学同学'],
    group: '大学同学',
    attrs: { occupation: '高校老师', affinity: 3, hobbies: ['读书', '徒步'], city: '南京' },
  },
  {
    // 聊天形式里「右侧」需要一个真人物；也方便把「我」写进参与者
    key: 'me',
    name: '我',
    tags: ['自己'],
    attrs: { occupation: '交互设计', city: '杭州' },
  },
];

// ---------------- 事件集 ----------------

export const SAMPLE_COLLECTIONS: SampleCollectionDef[] = [
  {
    key: 'y1',
    name: '和小满的一年',
    kind: 'arc',
    description: '从一杯冰美式开始，到现在刚好十个月。',
    icon: { type: 'text', text: '满', fg: '#ffffff', bg: '#e0658a' },
  },
  {
    key: 'first',
    name: '第一次系列',
    kind: 'arc',
    parent: 'y1',
    description: '所有「第一次」都记在这里。',
    icon: { type: 'text', text: '第', fg: '#ffffff', bg: '#d98a3d' },
  },
  {
    key: 'quarrel',
    name: '吵架与和好',
    kind: 'arc',
    parent: 'y1',
    description: '不高兴的时候也记一笔，回头看才知道吵的都是小事。',
    icon: { type: 'text', text: '和', fg: '#ffffff', bg: '#6b8f9c' },
  },
  {
    key: 'city',
    name: '城市漫游',
    kind: 'topic',
    description: '按地点攒：咖啡店、书店、美术馆、公园。',
    icon: { type: 'text', text: '城', fg: '#ffffff', bg: '#3f7f8f' },
  },
  {
    key: 'food',
    name: '吃饭地图',
    kind: 'topic',
    description: '两个人吃过的店，按好吃程度排。',
    icon: { type: 'text', text: '吃', fg: '#ffffff', bg: '#c2563a' },
  },
  {
    key: 'travel',
    name: '出行清单',
    kind: 'topic',
    description: '出城的都记这里：海边、山里、机场。',
    icon: { type: 'text', text: '行', fg: '#ffffff', bg: '#4a6f8c' },
  },
  {
    key: 'friends',
    name: '老朋友',
    kind: 'topic',
    description: '不只有恋爱：知夏、苏念、以及一次失败的相亲。',
    icon: { type: 'text', text: '友', fg: '#ffffff', bg: '#7d7a5f' },
  },
  {
    key: 'five',
    name: '五星时刻',
    kind: 'smart',
    rule: { minRating: 5 },
    description: '自动收集评分 5 的事件。',
    icon: { type: 'alpha', text: '★', fg: '#b8860b', bg: '#f7edc8' },
  },
  {
    key: 'recent',
    name: '最近三个月',
    kind: 'smart',
    rule: { withinDays: 90 },
    description: '只看近 90 天发生了什么。',
    icon: { type: 'text', text: '近', fg: '#ffffff', bg: '#5c6b73' },
  },
];

// ---------------- 事件 ----------------
//
// 地点刻意铺开：咖啡店 / 影院 / 面馆 / 江边 / 日料 / 美术馆 / 地铁口 /
// 书店 / 公园 / 火锅 / Livehouse / 体育馆 / 游乐园 / 家里 / 医院 / 海边 /
// 山里 / 机场 / 菜市场 / 母校 / 商场。

export const SAMPLE_EVENTS: SampleEventDef[] = [
  {
    key: 'first-cafe',
    title: '在公司楼下的咖啡店碰到',
    kind: 'milestone',
    at: { daysAgo: 300, hour: 15, minute: 10 },
    place: '米仓咖啡',
    address: '文一西路 88 号 1 层',
    geo: { lat: 30.2812, lng: 120.0285 },
    people: ['man'],
    content:
      '店里只剩一张高脚桌。她在改一份提案，我把充电线借给她，聊了半小时才发现我们同一栋楼上班。\n\n她说她只喝冰美式，冬天也是。',
    tags: ['第一次', '咖啡', '公司附近'],
    rating: 5,
    cost: 42,
    mood: '开心',
    collections: ['y1', 'first', 'city'],
    image: 'cafe',
    followedBy: 'movie-first',
  },
  {
    key: 'movie-first',
    title: '第一次一起看电影',
    kind: 'movie',
    at: { daysAgo: 285, hour: 19, minute: 20 },
    end: { daysAgo: 285, hour: 22, minute: 10 },
    place: '万象城影城',
    address: '富春路 701 号 4 层',
    geo: { lat: 30.2605, lng: 120.21 },
    people: ['man'],
    content: '看了《你想活出怎样的人生》。散场后在江边走了很久，聊到各自的家庭。\n\n她说下次想去海边。',
    tags: ['电影', '第一次'],
    rating: 5,
    cost: 128.5,
    mood: '开心',
    intimacy: 1,
    collections: ['first', 'city'],
    image: 'movie',
  },
  {
    key: 'late-noodle',
    title: '加班后的两碗拌川',
    kind: 'meal',
    at: { daysAgo: 270, hour: 21, minute: 0 },
    place: '巷口面馆',
    address: '建国北路 222 号',
    people: ['man'],
    content: '她十点才下班，说饿。两碗拌川，加了两份辣子鸡。\n\n她说这家店比楼下的日料好吃十倍。',
    tags: ['夜宵', '吃饭'],
    rating: 4,
    cost: 46,
    mood: '放松',
    collections: ['food'],
  },
  {
    key: 'riverside',
    title: '沿江走到桥下',
    kind: 'date',
    at: { daysAgo: 250, hour: 20, minute: 0 },
    place: '江边步道',
    address: '钱江三桥北侧',
    geo: { lat: 30.24, lng: 120.221 },
    people: ['man'],
    content: '风很大，她把外套帽子扣上，说这样像抢银行。\n\n走到桥下的时候她说：今天不想回去。',
    tags: ['散步', '第一次'],
    rating: 5,
    cost: 0,
    mood: '平静',
    collections: ['y1', 'first', 'city'],
    image: 'riverside',
  },
  {
    key: 'japanese',
    title: '她升职了',
    kind: 'meal',
    at: { daysAgo: 240, hour: 18, minute: 30 },
    place: '鲸岚日料',
    address: '湖滨银泰 B 区 3 层',
    people: ['man'],
    content: '她说要请客，结果还是我付的。聊到她想去日本，说想住在能看见海的小城市。',
    tags: ['吃饭', '升职'],
    rating: 4,
    cost: 320,
    mood: '开心',
    collections: ['food', 'y1'],
  },
  {
    key: 'gallery',
    title: '看了一个关于光影的展',
    kind: 'date',
    at: { daysAgo: 215, hour: 14, minute: 0 },
    place: '浙江美术馆',
    address: '南山路 138 号',
    geo: { lat: 30.2323, lng: 120.156 },
    people: ['man'],
    self: true,
    content: '她在每幅画前都站很久，尤其是一间只有一束光的展厅。\n\n出来的时候下雨了，我们在一棵树下等雨停。',
    tags: ['看展', '下雨'],
    rating: 5,
    cost: 60,
    mood: '平静',
    collections: ['city', 'y1'],
    image: 'gallery',
  },
  {
    key: 'fight',
    title: '临时改时间，她生气了',
    kind: 'conflict',
    at: { daysAgo: 200, hour: 21, minute: 0 },
    place: '地铁口',
    address: '龙翔桥站 B 口',
    geo: { lat: 30.2541, lng: 120.1621 },
    people: ['man'],
    content: '我临时改了时间，到的时候她已经在风口站了二十分钟。\n\n她说不是生气迟到，是生气我没提前说。',
    tags: ['矛盾', '迟到'],
    rating: 2,
    cost: 0,
    mood: '低落',
    intimacy: -1,
    collections: ['quarrel', 'y1'],
    followedBy: 'makeup-chat',
  },
  {
    key: 'makeup-chat',
    title: '和好的那天晚上',
    kind: 'chat',
    at: { daysAgo: 199, hour: 22, minute: 40 },
    place: '微信',
    people: ['man'],
    self: true,
    viewMode: 'chat',
    tags: ['和好', '聊天'],
    rating: 4,
    mood: '释然',
    collections: ['quarrel', 'y1'],
    chat: [
      { divider: true, body: '—— 晚上 11 点' },
      { who: 'man', body: '睡了吗' },
      { body: '没有' },
      { who: 'man', body: '今天是我不好，我不该在地铁口那样说你' },
      { body: '我也有问题，临时改时间没提前说' },
      { who: 'man', body: '以后你要是改，提前一天告诉我，我就不用在那儿傻站了' },
      { body: '好，记住了' },
      { who: 'man', body: '那明天一起吃面？上次那家' },
      { body: '行，我请你' },
      { divider: true, body: '—— 第二天中午，她真的来了' },
    ],
  },
  {
    key: 'bookstore',
    title: '在书店各看各的',
    kind: 'date',
    at: { daysAgo: 180, hour: 16, minute: 0 },
    place: '单向空间',
    address: '乐堤港 2 层',
    people: ['man'],
    content: '她蹲在诗歌区看了很久，最后买了两本；我买了一本讲城市规划的。\n\n结账时她说：下次我们别买书了，买不起。',
    tags: ['书店', '买书'],
    rating: 4,
    cost: 156,
    mood: '放松',
    collections: ['city'],
  },
  {
    key: 'picnic',
    title: '樱花期的野餐',
    kind: 'date',
    at: { daysAgo: 165, hour: 11, minute: 0 },
    end: { daysAgo: 165, hour: 16, minute: 0 },
    place: '太子湾公园',
    address: '南山路 5-1 号',
    geo: { lat: 30.2271, lng: 120.1489 },
    people: ['man'],
    self: true,
    content: '带了毯子和一整盒草莓。风把一次性桌布吹起来三次。\n\n她躺在毯子上说：以后每年都要来。',
    tags: ['野餐', '春天'],
    rating: 5,
    cost: 88,
    mood: '开心',
    collections: ['city', 'y1'],
    image: 'picnic',
  },
  {
    key: 'hotpot',
    title: '知夏组的火锅局',
    kind: 'meal',
    at: { daysAgo: 150, hour: 19, minute: 0 },
    place: '九宫格老火锅',
    address: '河东路 55 号',
    people: ['man', 'xia'],
    content: '知夏一直拿我们开玩笑，说她早就看出来了。\n\n最后三盘毛肚都是小满吃的。',
    tags: ['火锅', '朋友'],
    rating: 4,
    cost: 268,
    mood: '热闹',
    collections: ['food', 'friends'],
  },
  {
    key: 'livehouse',
    title: '第一次一起听现场',
    kind: 'date',
    at: { daysAgo: 135, hour: 20, minute: 30 },
    place: 'MAO Livehouse',
    address: '中山南路 77 号',
    people: ['man'],
    content: '她在我旁边跟着唱，跑调跑得很开心。\n\n散场后耳朵嗡嗡的，她说话我全靠看嘴型。',
    tags: ['音乐', '现场'],
    rating: 5,
    cost: 320,
    mood: '兴奋',
    intimacy: 1,
    collections: ['city', 'y1'],
  },
  {
    key: 'badminton',
    title: '被虐了 21:9',
    kind: 'date',
    at: { daysAgo: 120, hour: 19, minute: 0 },
    place: '城北体育馆',
    address: '绍兴路 168 号',
    people: ['man'],
    content: '她说下次让我三个球，我说不用，她说那就让五个。',
    tags: ['运动', '羽毛球'],
    rating: 3,
    cost: 60,
    mood: '累',
    collections: ['y1'],
  },
  {
    key: 'ferris',
    title: '从过山车到摩天轮',
    kind: 'date',
    at: { daysAgo: 100, hour: 15, minute: 0 },
    end: { daysAgo: 100, hour: 19, minute: 0 },
    place: '杭州乐园',
    address: '风情大道 2555 号',
    geo: { lat: 30.1669, lng: 120.241 },
    people: ['man'],
    content: '过山车排队 40 分钟，她在最高点闭着眼喊我名字。\n\n摩天轮到顶的时候天刚好黑，她把手伸过来让我暖。',
    tags: ['游乐园', '过山车'],
    rating: 5,
    cost: 260,
    mood: '兴奋',
    collections: ['city', 'y1'],
    image: 'ferris',
  },
  {
    key: 'call-long',
    title: '出差第三天的电话',
    kind: 'call',
    at: { daysAgo: 90, hour: 22, minute: 0 },
    place: '电话',
    people: ['man'],
    content: '聊了一个小时，大部分时间在说各自的晚饭。挂之前她说了两遍「早点睡」。',
    tags: ['通话', '异地'],
    rating: 3,
    cost: 0,
    mood: '想念',
    collections: ['y1'],
  },
  {
    key: 'scarf',
    title: '那条看了三次的围巾',
    kind: 'gift',
    at: { daysAgo: 80, hour: 15, minute: 0 },
    place: '湖滨银泰',
    address: '延安路 551 号',
    geo: { lat: 30.2559, lng: 120.1637 },
    people: ['man'],
    content: '她路过三次都停下看，第三次拉着我走，说太贵了。\n\n我第二天自己去买了。她收到的时候没说话，先去照镜子。',
    tags: ['礼物', '围巾'],
    rating: 5,
    cost: 680,
    mood: '开心',
    collections: ['y1'],
  },
  {
    key: 'hospital',
    title: '陪她做体检',
    kind: 'note',
    at: { daysAgo: 70, hour: 8, minute: 0 },
    place: '市一医院',
    address: '浣纱路 261 号',
    geo: { lat: 30.2496, lng: 120.1676 },
    people: ['man'],
    content: '抽血的时候她转过头不看，抓着我袖子。\n\n报告要等三天，她一路上都在查那几个指标是什么意思。',
    tags: ['医院', '体检'],
    rating: 3,
    cost: 0,
    mood: '担心',
    collections: ['y1'],
  },
  {
    key: 'sea-trip',
    title: '在石浦住了两晚',
    kind: 'trip',
    at: { daysAgo: 55, hour: 9, minute: 0 },
    end: { daysAgo: 53, hour: 18, minute: 0 },
    place: '象山石浦',
    address: '石浦渔港古城',
    geo: { lat: 29.2053, lng: 121.9485 },
    people: ['man'],
    self: true,
    content:
      '开了四个小时的车，到的时候正好退潮。\n\n第二天早上去码头，她跟卖鱼的大姐聊了半小时，学会了一句本地话。\n\n她说：如果每年都能来一次，就够了。',
    tags: ['旅行', '海边', '自驾'],
    rating: 5,
    cost: 2360,
    mood: '开心',
    intimacy: 1,
    collections: ['travel', 'city'],
    image: 'sea',
  },
  {
    key: 'cabin',
    title: '山里没有信号的两天',
    kind: 'trip',
    at: { daysAgo: 40, hour: 10, minute: 0 },
    end: { daysAgo: 39, hour: 15, minute: 0 },
    place: '莫干山民宿',
    address: '德清县劳岭村',
    geo: { lat: 30.5993, lng: 119.8693 },
    people: ['man'],
    content: '山里没有信号，我们把话都说完了。\n\n晚上在院子里生火，柴有点湿，烟熏得直流眼泪。',
    tags: ['旅行', '山', '民宿'],
    rating: 5,
    cost: 1280,
    mood: '放松',
    collections: ['travel'],
    image: 'mountain',
  },
  {
    key: 'home-cook',
    title: '第一次在我家做饭',
    kind: 'meal',
    at: { daysAgo: 30, hour: 18, minute: 0 },
    place: '我家',
    address: '拱墅区某小区',
    people: ['man'],
    content: '厨房很小，两个人转身都要碰一下。\n\n番茄炒蛋太咸了，她全吃完了，说咸的下饭。',
    tags: ['做饭', '家里'],
    rating: 4,
    cost: 92,
    mood: '安静',
    collections: ['y1', 'food'],
  },
  {
    key: 'airport',
    title: '送她去出差',
    kind: 'trip',
    at: { daysAgo: 25, hour: 7, minute: 0 },
    place: '萧山机场 T4',
    address: '萧山区迎宾大道',
    geo: { lat: 30.2295, lng: 120.4342 },
    people: ['man'],
    content: '安检口她回头挥了两次手。回来路上我在高速上开错了一个口。',
    tags: ['机场', '送别'],
    rating: 3,
    cost: 0,
    mood: '舍不得',
    collections: ['y1', 'travel'],
  },
  {
    key: 'market',
    title: '周末去菜场',
    kind: 'meal',
    at: { daysAgo: 18, hour: 9, minute: 30 },
    place: '茅廊巷菜场',
    address: '光复路 121 号',
    geo: { lat: 30.2446, lng: 120.1691 },
    people: ['man'],
    content: '她挑虾要一只一只看，摊主都笑了，说你们年轻人真讲究。\n\n最后买了虾、春笋和一把小葱。',
    tags: ['菜市场', '周末'],
    rating: 4,
    cost: 68,
    mood: '日常',
    collections: ['food', 'city'],
  },
  {
    key: 'alumni',
    title: '和苏念回了一趟学校',
    kind: 'milestone',
    at: { daysAgo: 12, hour: 15, minute: 0 },
    place: '浙大玉泉校区',
    address: '浙大路 38 号',
    geo: { lat: 30.2636, lng: 120.1255 },
    people: ['nian'],
    content: '图书馆前面的梧桐还在。我们当年刻字的那棵树被围起来了，挂了块「古树名木」的牌子。\n\n她说：那你现在这棵树算不算也是古树了。',
    tags: ['母校', '老同学'],
    rating: 4,
    cost: 0,
    mood: '怀念',
    collections: ['friends'],
  },
  {
    key: 'yu-coffee',
    title: '和陈屿的第一次见面',
    kind: 'date',
    at: { daysAgo: 7, hour: 15, minute: 0 },
    place: '%Arabica 咖啡',
    address: '天目里 11 号楼',
    geo: { lat: 30.2731, lng: 120.1069 },
    people: ['yu'],
    content: '朋友介绍的第一次见面。聊了工作、房子和猫，礼貌地结束了。\n\n她走的时候说：你人挺好的，但我们好像都在说正确的话。',
    tags: ['相亲', '第一次'],
    rating: 3,
    cost: 78,
    mood: '平淡',
    collections: ['friends'],
    private: true,
  },
  {
    key: 'xia-bike',
    title: '和知夏骑车去湿地',
    kind: 'trip',
    at: { daysAgo: 5, hour: 9, minute: 0 },
    end: { daysAgo: 5, hour: 17, minute: 0 },
    place: '西溪湿地',
    address: '天目山路 518 号',
    geo: { lat: 30.2672, lng: 120.0722 },
    people: ['xia'],
    content: '骑了 32 公里。拍了一卷胶片，还没洗出来。\n\n知夏说下次带小满一起，我说她骑不了这么远，她说那就慢慢骑。',
    tags: ['骑行', '摄影'],
    rating: 4,
    cost: 86,
    mood: '放松',
    collections: ['friends', 'city'],
  },
];

// ---------------- 回忆录 ----------------

export const SAMPLE_MEMOIRS: SampleMemoirDef[] = [
  {
    collection: 'y1',
    title: '春天回来的那天',
    subtitle: '从一杯冰美式开始的十个月',
    eventKeys: ['first-cafe', 'movie-first', 'riverside', 'gallery', 'sea-trip', 'cabin', 'home-cook'],
    coverFromEvent: 'sea-trip',
    pages: [
      {
        eventKey: 'first-cafe',
        note: '故事从一张没抢到的靠窗桌子开始。',
        excerpt: '她说她只喝冰美式，冬天也是。',
        edited: true,
      },
      {
        eventKey: 'movie-first',
        note: '那天她把爆米花桶抱在怀里，像抱着一个暖水袋。',
      },
      {
        eventKey: 'riverside',
        note: '桥下的风很大，谁也没提回去。',
        excerpt: '走到桥下的时候她说：今天不想回去。',
      },
      {
        eventKey: 'gallery',
        note: '一间只有一束光的展厅，她在里面站了很久。',
        excerpt: '出来的时候下雨了，我们在一棵树下等雨停。',
      },
      {
        eventKey: 'sea-trip',
        note: '四小时车程，正好赶上退潮。',
        excerpt: '她说：如果每年都能来一次，就够了。',
      },
      {
        eventKey: 'cabin',
        note: '山里没有信号，我们把话都说完了。',
      },
      {
        eventKey: 'home-cook',
        note: '厨房很小，两个人转身都要碰一下。',
        excerpt: '番茄炒蛋太咸了，她全吃完了。',
      },
    ],
  },
];
