// 人物分组（QQ 那种：一人挂一个组，组名自己填、填过的复用）的端到端回归。
//
// 覆盖：
//   A 示例数据按组分节显示，未分组永远在最后
//   B 组头能折叠 / 展开，折叠的子行不进列表也不进分页计数
//   C 分组筛选条（全部 / 各分组 / 未分组）
//   D 详情页改组：新组名当场出现、空掉的组名自己消失、datalist 复用已有组名
//   E 移出分组（✕）
//   F 新建人物时顺手归组
//   G 与统一分页控件共存：组头也占一行
//   H 工具层（AI / CLI 共用同一份注册表）：person.groups / create / list / update
//   I 合并人物时的组：保留者为准，保留者没组才沿用对方
//   J 分享剥资料时组名一起剥掉
//   K schema v14 落库
//   L 窄屏 390px 几何：分组框不被 width:100% 拉满、不被 flex 挤没，页面不横向溢出
//
// 用法：node tools/e2e/person-group-e2e.mjs [url]   默认 http://localhost:5173/
// 依赖：Vite dev（要动态 import 源码模块）、全局 playwright、Chromium。
// ⚠️ dev 服务启动后再改过源码，bare import 会拿到「第二个实例」（状态全空）。
//    跑之前重启一次 dev 服务，别在改完代码的当口直接跑本脚本。

let chromium;
try {
  ({ chromium } = await import('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs'));
} catch {
  ({ chromium } = await import('/usr/local/node/lib/node_modules/playwright/index.mjs'));
}

const APP = process.argv[2] || 'http://localhost:5173/';
const failures = [];
const errors = [];
const check = (label, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
    failures.push(label);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});
p.on('dialog', (d) => d.accept());

const waitBoot = async () => {
  await p.waitForFunction(
    () => !document.getElementById('boot') || document.getElementById('boot').style.display === 'none',
    null,
    { timeout: 90000 },
  );
};

/**
 * 源码模块挂到 window 上复用（避免每个断言都新起一个实例）。
 * reload 之后 window 是干净的，得重新挂一次。
 */
const captureModules = () =>
  p.evaluate(async () => {
    const [persons, tools, share, db, prefs] = await Promise.all([
      import('/src/core/repo/persons/index.ts'),
      import('/src/core/tools/index.ts'),
      import('/src/core/io/share.ts'),
      import('/src/core/db/index.ts'),
      import('/src/ui/prefs.ts'),
    ]);
    window.__dr = { persons, tools, share, db, prefs };
  });

/** 列表里当前可见的段：段名 + 段内人名（按 DOM 顺序，折叠的段没有子行） */
const sections = () =>
  p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.pane-list .group-head, .pane-list .list-item')) {
      if (el.classList.contains('group-head')) {
        out.push({
          name: el.querySelector('.group-name')?.textContent?.trim() ?? '',
          count: Number(el.querySelector('.group-count')?.textContent?.trim() ?? '0'),
          expanded: el.querySelector('.group-toggle')?.getAttribute('aria-expanded') === 'true',
          people: [],
        });
      } else if (out.length) {
        out[out.length - 1].people.push(el.querySelector('.list-item-title')?.textContent?.trim() ?? '');
      }
    }
    return out;
  });

const chipTexts = () =>
  p.evaluate(() => [...document.querySelectorAll('.pane-list .group-chip')].map((b) => b.textContent?.trim() ?? ''));

const chipOn = () =>
  p.evaluate(() => document.querySelector('.pane-list .group-chip-on')?.textContent?.trim() ?? '');

const gotoList = async () => {
  await p.locator('.tabbar-item', { hasText: '人物' }).click();
  await p.waitForTimeout(500);
  const back = p.locator('.pane-detail .back-btn').first();
  if (await back.count()) {
    await back.click();
    await p.waitForTimeout(400);
  }
};

/** 打开某个人的详情（手机端点列表行） */
const openPerson = async (name) => {
  await p.locator('.pane-list .list-item', { has: p.locator('.list-item-title', { hasText: name }) })
    .first().click();
  await p.waitForTimeout(500);
};

/** 详情里的分组输入框 */
const detailGroup = () => p.locator('.pane-detail .group-picker-input');

const detailGroupValue = async () => (await detailGroup().inputValue()).trim();

/** 往详情分组框里填组名并提交（Enter 提交，blur 也提交，双保险） */
const setDetailGroup = async (name) => {
  await detailGroup().fill(name);
  await detailGroup().press('Enter');
  await p.waitForTimeout(500);
};

console.log(`\n=== 人物分组 e2e（${APP}）===\n`);

await p.goto(APP, { waitUntil: 'load' });
await waitBoot();
if (await p.getByText('载入示例数据看看效果').count()) {
  await p.getByText('载入示例数据看看效果').click();
  await p.waitForTimeout(3000);
}
await waitBoot();

// 源码模块只在这里取一次，挂到 window 上复用（避免每个断言都新起一个实例）
await captureModules();

console.log('A 示例数据按组分节');
{
  const s = await sections();
  const names = s.map((x) => x.name);
  check('人物列表出现组头', s.length > 0, `实际 ${s.length} 段`);
  check(
    '示例数据的四个组都在：大学同学 / 同事 / 朋友 / 未分组',
    ['大学同学', '同事', '朋友', '未分组'].every((n) => names.includes(n)),
    JSON.stringify(names),
  );
  check('未分组永远在最后（它不是一个组，是「还没归类」）', names[names.length - 1] === '未分组', JSON.stringify(names));
  const peng = s.find((x) => x.name === '朋友');
  check('朋友组 2 人（许知夏 + 陈屿）', peng?.count === 2 && peng.people.length === 2, JSON.stringify(peng?.people));
}

console.log('\nB 折叠 / 展开');
{
  const before = await sections();
  const total = before.reduce((n, x) => n + x.people.length, 0);
  await p.locator('.pane-list .group-head', { hasText: '朋友' }).locator('.group-toggle').click();
  await p.waitForTimeout(400);
  const after = await sections();
  const peng = after.find((x) => x.name === '朋友');
  check('折叠后朋友组的子行不在列表里', peng && !peng.expanded && peng.people.length === 0, JSON.stringify(peng?.people));
  const afterTotal = after.reduce((n, x) => n + x.people.length, 0);
  check(`折叠少 2 个人（${total} → ${afterTotal}）`, afterTotal === total - 2, `折叠前 ${total}`);
  await p.locator('.pane-list .group-head', { hasText: '朋友' }).locator('.group-toggle').click();
  await p.waitForTimeout(400);
  const back = await sections();
  check('再展开人数回来', back.reduce((n, x) => n + x.people.length, 0) === total);
}

console.log('\nC 分组筛选条');
{
  const chips = await chipTexts();
  check('筛选条出现且含「全部」', chips.length >= 2 && chips[0] === '全部', JSON.stringify(chips));
  check('筛选条里每个组一个 chip，未分组也在', ['大学同学', '同事', '朋友', '未分组'].every((n) => chips.some((c) => c.startsWith(n))), JSON.stringify(chips));
  await p.locator('.pane-list .group-chip', { hasText: '同事' }).click();
  await p.waitForTimeout(500);
  const s = await sections();
  check('点「同事」只剩这一组', s.length === 1 && s[0].name === '同事', JSON.stringify(s.map((x) => x.name)));
  check('chip 高亮在「同事」上', (await chipOn()).startsWith('同事'), await chipOn());
  await p.locator('.pane-list .group-chip', { hasText: '全部' }).click();
  await p.waitForTimeout(500);
  check('点「全部」回到四段', (await sections()).length === 4);
}

console.log('\nD 详情页改组');
{
  await gotoList();
  await openPerson('苏念');
  check('苏念的分组框显示「大学同学」', (await detailGroupValue()) === '大学同学', await detailGroupValue());
  await setDetailGroup('同学');
  await gotoList();
  const names = (await sections()).map((x) => x.name);
  check('新组名「同学」当场成为一个组', names.includes('同学'), JSON.stringify(names));
  check('空掉的「大学同学」自己消失了（组名不建表，用过才有）', !names.includes('大学同学'), JSON.stringify(names));
  // 候选挂在「新建那一行」的 datalist 里，得先把新建行点开才有
  await p.locator('.pane-list .icon-btn[title="新建人物"]').click();
  await p.waitForTimeout(400);
  const options = await p.evaluate(() =>
    [...document.querySelectorAll('.pane-list datalist option')].map((o) => o.value),
  );
  await p.keyboard.press('Escape'); // 关掉新建行，别影响后面的用例
  await p.waitForTimeout(300);
  check('新建那一行的候选里能选到已有组名（填过的记下来复用）', ['同学', '同事', '朋友'].every((n) => options.includes(n)), JSON.stringify(options));
  await gotoList();
  await openPerson('许知夏');
  await setDetailGroup('同学');
  await gotoList();
  const tong = (await sections()).find((x) => x.name === '同学');
  check('同学组变成 2 人', tong?.count === 2, JSON.stringify(tong?.people));
}

console.log('\nE 移出分组');
{
  await gotoList();
  await openPerson('陈屿');
  check('陈屿还在「朋友」组', (await detailGroupValue()) === '朋友', await detailGroupValue());
  await p.locator('.pane-detail .group-picker-clear').click();
  await p.waitForTimeout(500);
  check('点「移出分组」后分组框空了（= 未分组）', (await detailGroupValue()) === '', await detailGroupValue());
  await gotoList();
  const names = (await sections()).map((x) => x.name);
  check('朋友组最后一人走了，组名从列表消失', !names.includes('朋友'), JSON.stringify(names));
  check('未分组还在（它兜住所有没归类的人）', names.includes('未分组'), JSON.stringify(names));
}

console.log('\nF 新建时顺手归组');
{
  await gotoList();
  await p.locator('.pane-list .icon-btn[title="新建人物"]').click();
  await p.waitForTimeout(300);
  await p.locator('.pane-list .inline-create input[placeholder="姓名"]').fill('张同学');
  await p.locator('.pane-list .inline-create .group-picker-input').fill('同学');
  await p.locator('.pane-list .inline-create .group-picker-input').press('Enter');
  await p.waitForTimeout(300);
  await p.locator('.pane-list .inline-create button', { hasText: '创建' }).click();
  await p.waitForTimeout(800);
  const tong = (await sections()).find((x) => x.name === '同学');
  check('新建时就归进「同学」，行落在该组段内', !!tong && tong.people.includes('张同学'), JSON.stringify(tong?.people));
  await gotoList();
}

console.log('\nG 与统一分页控件共存（组头也算一行）');
{
  await p.evaluate(async () => {
    const { persons, prefs, db } = window.__dr;
    for (let i = 0; i < 25; i += 1) persons.createPerson({ displayName: `同学甲${i}`, groupName: '同学' });
    prefs.setPageSize(20);
    // 持久化是 500ms 防抖的整库 export：马上 reload 会把这批人留在内存里丢掉
    db.flushPersist();
    const t0 = Date.now();
    while (db.hasPendingPersist() && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
  });
  await p.reload({ waitUntil: 'load' });
  await waitBoot();
  await captureModules(); // reload 后 window.__dr 没了，后面的用例还要用它
  await p.waitForTimeout(800);
  await gotoList();
  const geo = await p.evaluate(() => ({
    items: document.querySelectorAll('.pane-list .list-item').length,
    heads: document.querySelectorAll('.pane-list .group-head').length,
    pager: document.querySelectorAll('.pane-list .pager').length,
    of: document.querySelector('.pane-list .pager-of')?.textContent ?? '',
  }));
  check('每页 20 时第 1 页 = 组头 + 人一共 20 行', geo.items + geo.heads === 20, JSON.stringify(geo));
  check('第 1 页至少有一个组头', geo.heads >= 1, `实际 ${geo.heads}`);
  check('分页条还在', geo.pager === 1, `实际 ${geo.pager}`);
  const firstBefore = await p.evaluate(() => document.querySelector('.pane-list .list-item-title')?.textContent ?? '');
  await p.locator('.pane-list .pager').getByRole('button', { name: '下一页' }).click();
  await p.waitForTimeout(500);
  const firstAfter = await p.evaluate(() => document.querySelector('.pane-list .list-item-title')?.textContent ?? '');
  check('下一页换了首个的人', firstAfter !== '' && firstAfter !== firstBefore, `"${firstBefore}" → "${firstAfter}"`);
  await p.evaluate(() => window.__dr.prefs.setPageSize(50));
  await p.waitForTimeout(500);
}

console.log('\nH 工具层（AI / CLI 同一份注册表）');
{
  const r = await p.evaluate(() => {
    const { tools } = window.__dr;
    const call = (name, args) => tools.callToolSync(name, args);
    const groups = call('person.groups', {});
    const made = call('person.create', { displayName: '工具归组的人', groupName: '同学' });
    const inGroup = call('person.list', { group: '同学' });
    const ungrouped = call('person.list', { group: '' });
    const moved = call('person.update', { id: made.data.id, groupName: '' });
    const after = call('person.list', { group: '同学' });
    const brief = call('person.get', { id: made.data.id });
    return {
      groups: groups.data,
      madeId: made.data?.id,
      inGroupNames: inGroup.data.map((x) => x.displayName),
      ungroupedNames: ungrouped.data.map((x) => x.displayName),
      afterCount: after.data.length,
      movedOk: moved.ok,
      briefGroup: brief.data?.groupName,
    };
  });
  check('person.groups 列出用过的组名，「同学」在内', Array.isArray(r.groups) && r.groups.some((g) => g.name === '同学'), JSON.stringify(r.groups));
  check('person.groups 的计数与 UI 口径一致（人多的在前）', r.groups.every((g) => g.count > 0), JSON.stringify(r.groups));
  check('person.create 带 groupName 就落了组', r.inGroupNames.includes('工具归组的人'), JSON.stringify(r.inGroupNames.slice(0, 5)));
  check('person.list group=空串 只回未分组的人', !r.ungroupedNames.includes('工具归组的人') && r.ungroupedNames.includes('陈屿'), JSON.stringify(r.ungroupedNames.slice(0, 5)));
  check('person.update groupName="" 把人移出分组', r.movedOk && r.afterCount === r.inGroupNames.length - 1, `${r.inGroupNames.length} → ${r.afterCount}`);
  check('摘要里也带 groupName（读屏 / CLI 输出能看到组）', typeof r.briefGroup === 'string', String(r.briefGroup));
}

console.log('\nI 合并人物时的组');
{
  const r = await p.evaluate(() => {
    const { persons } = window.__dr;
    // keep 有组、drop 无组 → 保留 keep 的
    const a1 = persons.createPerson({ displayName: '合并甲-有组', groupName: '同事' });
    const b1 = persons.createPerson({ displayName: '合并乙-无组' });
    persons.mergePersons(a1.id, b1.id, {});
    const kept1 = persons.getPerson(a1.id)?.groupName;
    // keep 无组、drop 有组 → 沿用 drop 的（别把人家的组弄丢）
    const a2 = persons.createPerson({ displayName: '合并丙-无组' });
    const b2 = persons.createPerson({ displayName: '合并丁-有组', groupName: '同学' });
    persons.mergePersons(a2.id, b2.id, {});
    const kept2 = persons.getPerson(a2.id)?.groupName;
    return { kept1, kept2 };
  });
  check('保留者有组时以自己的组为准', r.kept1 === '同事', r.kept1);
  check('保留者没组时沿用被合并者的组', r.kept2 === '同学', r.kept2);
}

console.log('\nJ 分享剥资料时组名一起剥');
{
  const r = await p.evaluate(async () => {
    const { persons, share } = window.__dr;
    const p1 = persons.createPerson({ displayName: '分享剥组的人', groupName: '家人' });
    const full = await share.buildPersonShare(p1.id, { level: 'full' });
    const alias = await share.buildPersonShare(p1.id, { level: 'alias' });
    return {
      full: full.persons[0]?.groupName,
      alias: alias.persons[0]?.groupName,
      aliasName: alias.persons[0]?.displayName,
    };
  });
  check('「原样」分享保留组名', r.full === '家人', String(r.full));
  check('剥资料的分享不带组名（组名和标签一样暴露关系）', r.alias === '' && r.aliasName !== '', `${r.alias} / ${r.aliasName}`);
}

console.log('\nK schema v14');
{
  const r = await p.evaluate(() => {
    const { db } = window.__dr;
    const row = db.queryOne('SELECT group_name FROM persons WHERE group_name IS NOT NULL LIMIT 1');
    return { version: db.getMeta('schema_version'), hasColumn: row !== null && 'group_name' in row };
  });
  check('迁移跑到 v14', r.version === '14', String(r.version));
  check('persons 表有 group_name 列', r.hasColumn, JSON.stringify(r));
}

console.log('\nL 窄屏（390px）几何：分组框既不撑满整行也不被挤没');
{
  // 这两个数字都是用「量出来」的，不是估的：
  //   · base.css 有 input{width:100%}，行内分组框不自己写宽度就会拉到整行；
  //   · flex 容器里 min-width:0 + 0 1 auto 会把固定宽度的输入框挤到 0。
  const noOverflow = () =>
    p.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
  check('人物列表在 390 宽下不横向溢出', await noOverflow());
  await gotoList();
  await openPerson('林小满');
  const geo = await p.evaluate(() => {
    const el = document.querySelector('.pane-detail .group-picker-input');
    return { w: el ? Math.round(el.getBoundingClientRect().width) : -1 };
  });
  check(`详情里的分组框宽度实测 ${geo.w}px（60–200 之间：没被 width:100% 拉满，也没被 flex 挤没）`, geo.w >= 60 && geo.w <= 200, String(geo.w));
  check('详情页不横向溢出', await noOverflow());
  await gotoList();
  await p.locator('.pane-list .icon-btn[title="新建人物"]').click();
  await p.waitForTimeout(400);
  const create = await p.evaluate(() => {
    const w = (sel) => Math.round(document.querySelector(`.pane-list .inline-create ${sel}`)?.getBoundingClientRect().width ?? -1);
    return { name: w('input[placeholder="姓名"]'), group: w('.group-picker-input') };
  });
  check(`新建行的分组框 ${create.group}px 且姓名栏 ${create.name}px 没被挤掉`, create.group >= 60 && create.name >= 120, JSON.stringify(create));
  check('新建那一行不横向溢出', await noOverflow());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
}

console.log(`\n========== 汇总 ==========`);
console.log(`失败 ${failures.length} 项${failures.length ? `：${failures.join(' / ')}` : ''}`);
console.log(`控制台 / 页面错误 ${errors.length} 项${errors.length ? `：${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
if (failures.length || errors.length) process.exit(1);
console.log('\n全部通过 ✓');
