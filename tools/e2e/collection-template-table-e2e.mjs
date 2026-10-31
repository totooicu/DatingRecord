// 事件集模板事件 + 表格阅览（F-C09 / F-C10）回归。
// 依赖：vite dev server；全局 playwright + /usr/bin/chromium。
//   npx vite --port 5199 --host 127.0.0.1
//   node tools/e2e/collection-template-table-e2e.mjs http://127.0.0.1:5199/
const { chromium } = await import(
  process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs'
);
const BASE = process.argv[2] || 'http://127.0.0.1:5199/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector('.app, .welcome'));
  if (await page.locator('.welcome').count()) {
    await page.getByRole('button', { name: '直接开始创建' }).click();
  }
  await page.waitForSelector('.app:not(.at-welcome)');
  // 「直接开始创建」会顺手弹出新建事件框；先关掉，别挡住后面的点击
  if (await page.locator('.modal').count()) {
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }

  // ---- 造数据：一个事件集、一条模板事件、两条普通成员、一个人物 ----
  const seeded = await page.evaluate(async () => {
    const col = await import('/src/core/repo/collections/index.ts');
    const ev = await import('/src/core/repo/events/index.ts');
    const pe = await import('/src/core/repo/persons/index.ts');
    const person = pe.createPerson({ displayName: '小林' });
    const c = col.createCollection({ name: '模板与表格测试集' });
    const mk = (title, start, cost) =>
      ev.createEvent({
        title,
        kind: 'meal',
        time: { kind: 'instant', start, precision: 'minute' },
        content: `# ${title} 正文`,
        tags: ['日常'],
        metrics: { cost },
        participants: [{ personId: person.id, role: 'primary' }],
      });
    const e1 = mk('拉面', '2026-10-01T01:00:00.000Z', 12);
    const e2 = mk('烤肉', '2026-10-05T01:00:00.000Z', 30);
    const tpl = ev.createEvent({
      title: '咖啡模板',
      kind: 'meal',
      time: { kind: 'instant', start: '2026-10-10T01:00:00.000Z', precision: 'minute' },
      content: '# 模板正文：按这个格式记',
      tags: ['日常', '记录模板'],
      place: { name: '老地方', address: '某某路 1 号' },
      metrics: { cost: 28, rating: 4, mood: '轻松' },
      participants: [{ personId: person.id, role: 'primary' }],
      viewMode: 'doc',
    });
    col.addMember(c.id, 'event', e1.id);
    col.addMember(c.id, 'event', e2.id);
    col.setCollectionTemplate(c.id, tpl.id);
    return { collectionId: c.id, templateId: tpl.id, personId: person.id };
  });

  const colId = seeded.collectionId;
  const tplId = seeded.templateId;

  // label 同时包着控件，getByLabel 会把选项文字也算进可访问名；按字段名精确找 label
  const field = (name) =>
    page
      .locator('label.field')
      .filter({ has: page.locator('.field-label').filter({ hasText: new RegExp(`^${name}$`) }) })
      .first();

  const openDetail = async () => {
    await page.evaluate(async (id) => {
      const { openCollection } = await import('/src/ui/openCollection.ts');
      openCollection(id);
    }, colId);
    await page.waitForSelector('.detail-head');
  };
  await openDetail();
  await page.waitForSelector('.collect-template-hint');
  const hint = await page.locator('.collect-template-hint').innerText();
  check('事件集详情显示模板提示', hint.includes('咖啡模板'), hint);

  // ---- 表格阅览 ----
  await page.getByRole('button', { name: '表格', exact: true }).click();
  await page.waitForSelector('.ev-table');
  check('表格有 8 列', (await page.locator('.ev-table thead th').count()) === 8);
  check('表格只列直接成员（2 条）', (await page.locator('.ev-table tbody tr').count()) === 2);
  const firstTitle = await page.locator('.ev-table tbody tr').first().locator('.ev-table-title').innerText();
  check('默认按时间倒序', firstTitle === '烤肉', firstTitle);
  const foot = await page.locator('.ev-table tfoot').innerText();
  check('页脚合计金额', foot.includes('¥42'), foot.replace(/\s+/g, ' '));
  await page.locator('.ev-table thead button', { hasText: '花费' }).click();
  const firstByCost = await page.locator('.ev-table tbody tr').first().locator('.ev-table-title').innerText();
  check('点表头按金额排序', firstByCost === '烤肉', firstByCost);
  await page.locator('.ev-table thead button', { hasText: '花费' }).click();
  const secondByCost = await page.locator('.ev-table tbody tr').first().locator('.ev-table-title').innerText();
  check('再点一次反向排序', secondByCost === '拉面', secondByCost);

  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('dr.prefs.v1') || '{}'));
  check('表格选择写进本机偏好', pref.collectionView === 'table', JSON.stringify(pref));

  const toolResult = await page.evaluate(async (id) => {
    const { findTool } = await import('/src/core/tools/registry.ts');
    const t = findTool('collection.table');
    const r = t.run({ id, limit: 10 });
    const setT = findTool('collection.setTemplate');
    const db = await import('/src/core/db/index.ts');
    const cols = db.queryAll('PRAGMA table_info(collections)');
    return {
      rows: r.rows.map((x) => x.title),
      hasTemplateTool: !!setT,
      hasColumn: cols.some((c) => c.name === 'template_event_id'),
    };
  }, colId);
  check('AI 工具 collection.table 返回同样的行', toolResult.rows.length === 2, toolResult.rows.join(','));
  check('AI 工具 collection.setTemplate 已登记', toolResult.hasTemplateTool);
  check('老库迁移补出 template_event_id 列', toolResult.hasColumn);

  // 刷新后偏好仍在：表格还是选中的那个。等 500ms 落盘再 reload（读的是 IndexedDB）
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.app:not(.at-welcome)');
  await openDetail();
  const pressed = await page.getByRole('button', { name: '表格', exact: true }).getAttribute('aria-pressed');
  check('刷新后仍停留在表格视图', pressed === 'true', String(pressed));
  await page.waitForSelector('.ev-table');

  // ---- 新建事件套模板 ----
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建事件' }).click();
  await page.waitForSelector('.modal');
  const applied = await page.locator('.template-applied').innerText();
  check('新建表单提示已套用模板', applied.includes('咖啡模板'), applied);
  const kind = await field('类型').locator('select').inputValue();
  const place = await page.getByLabel('地点文本').inputValue();
  const cost = await field('花费').locator('input').first().inputValue();
  const content = await page.locator('.md-editor textarea.md-input').inputValue();
  const title = await field('标题').locator('input').first().inputValue();
  check('模板带入类型', kind === 'meal', kind);
  check('模板带入地点', place === '老地方', place);
  check('模板带入花费', cost === '28', cost);
  check('模板带入正文', content.includes('模板正文'), content);
  check('标题不复制', title === '', title);
  check('模板带入评分', (await page.locator('.star.star-on').count()) === 4);
  const chips = await page.locator('.tag-input .chip').allInnerTexts();
  check('模板带入标签', chips.some((t) => t.includes('记录模板')), chips.join('/'));

  await field('标题').locator('input').first().fill('模板套用测试');
  // 新建事件的时间默认是空的：先点「获取当前时间」，否则保存会被时间校验拦下
  await page.getByRole('button', { name: '获取当前时间', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(async (id) => {
    const ev = await import('/src/core/repo/events/index.ts');
    const col = await import('/src/core/repo/collections/index.ts');
    const list = ev.listEvents({ keyword: '模板套用测试' });
    const e = list[0];
    return e
      ? {
          id: e.id,
          kind: e.kind,
          place: e.place.name,
          cost: e.metrics.cost,
          rating: e.metrics.rating,
          content: e.content,
          tags: e.tags,
          participants: e.participants.map((p) => p.personId),
          inCollection: col.collectionsOfEvent(e.id).some((c) => c.id === id),
        }
      : null;
  }, colId);
  check('保存后字段全部继承模板', !!saved && saved.kind === 'meal' && saved.place === '老地方' && saved.cost === 28 && saved.rating === 4 && saved.tags.includes('记录模板'), JSON.stringify(saved));
  check('新事件自动挂在事件集下', !!saved?.inCollection);
  check('模板参与者被带入', !!saved?.participants.length, JSON.stringify(saved?.participants));

  await page.getByRole('button', { name: '取消', exact: true }).click();

  // ---- 清除模板 ----
  await page.getByRole('button', { name: '模板', exact: true }).click();
  await page.waitForSelector('.template-pick-list');
  await page.getByRole('button', { name: /不使用模板/ }).click();
  await page.waitForTimeout(200);
  check('清除后模板提示消失', (await page.locator('.collect-template-hint').count()) === 0);
  const cleared = await page.evaluate(async (id) => {
    const col = await import('/src/core/repo/collections/index.ts');
    return col.getCollection(id)?.templateEventId ?? null;
  }, colId);
  check('库里 templateEventId 已清空', cleared === null, String(cleared));

  await page.getByRole('button', { name: '＋ 新建事件' }).click();
  const kindAfter = await field('类型').locator('select').inputValue();
  const costAfter = await field('花费').locator('input').first().inputValue();
  check('无模板时回到表单默认值', kindAfter === 'date' && costAfter === '', `${kindAfter}/${costAfter}`);
  await page.getByRole('button', { name: '取消', exact: true }).click();

  // ---- 模板事件被删后的降级：引用保留，但不填充、提示不可用 ----
  await page.evaluate(async ({ colId: cid, tplId: tid }) => {
    const col = await import('/src/core/repo/collections/index.ts');
    col.setCollectionTemplate(cid, tid);
  }, { colId, tplId });
  await page.evaluate(async (tid) => {
    const ev = await import('/src/core/repo/events/index.ts');
    ev.deleteEvent(tid);
  }, tplId);
  // 等 500ms 落盘：reload 读的是 IndexedDB，不是内存
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.app:not(.at-welcome)');
  await openDetail();
  const dangling = await page.locator('.collect-template-hint').innerText();
  check('模板事件删除后提示不可用', dangling.includes('不可用'), dangling);
  const stillRef = await page.evaluate(async (id) => {
    const col = await import('/src/core/repo/collections/index.ts');
    return col.getCollection(id)?.templateEventId ?? null;
  }, colId);
  check('软删除时保留引用（恢复后自动生效）', stillRef === tplId, String(stillRef));
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建事件' }).click();
  check('模板事件删除后不再填充', (await page.locator('.template-applied').count()) === 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? '❌ 失败' : '✅ 全部通过'}（${checks.length - failed.length}/${checks.length}）`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
}
