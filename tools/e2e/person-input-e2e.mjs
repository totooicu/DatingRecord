// Requires Vite dev server and global Playwright/Chromium; uses isolated browser data.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT || '/usr/local/node/lib/node_modules/playwright/index.mjs');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://localhost:5174/');
  await page.waitForFunction(() => document.querySelector('.app, .welcome'));
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const repo = await import('/src/core/repo/persons/index.ts');
    const { PersonHead } = await import('/src/ui/persons/PersonHead.tsx');
    const { PersonAttrs } = await import('/src/ui/persons/PersonAttrs.tsx');
    for (const key of ['test_a', 'test_b', 'test_c']) repo.upsertDef({ key, label: key, type: 'text', group: '测试' });
    const defs = repo.listDefs().filter(d => d.key.startsWith('test_'));
    window.testDefs = defs.map(d => d.key);
    const { useVersion } = await import('/src/store.ts');
    const person = repo.createPerson({ displayName: 'ABCDE' });
    window.testPersonId = person.id;
    const host = document.createElement('div');
    host.id = 'input-test';
    host.style = 'position:fixed;inset:0;background:white;z-index:99999';
    document.body.append(host);
    function Test() {
      useVersion();
      return React.createElement(React.Fragment, null,
        React.createElement(PersonHead, { person: repo.getPerson(person.id), onNewEvent() {} }),
        React.createElement(PersonAttrs, { person: repo.getPerson(person.id), defs }));
    }
    ReactDOM.createRoot(host).render(React.createElement(Test));
  });
  const input = page.locator('#input-test .title-input');
  await input.fill('ABCDE');
  await input.press('End');
  await input.press('Backspace');
  await input.press('Backspace');
  assert.equal(await input.inputValue(), 'ABC');
  await input.press('Home');
  await input.press('ArrowRight');
  await input.pressSequentially('XY');
  assert.equal(await input.inputValue(), 'AXYBC');
  await input.press('Enter');
  const saved = () => page.evaluate(async () => (await import('/src/core/repo/persons/index.ts')).getPerson(window.testPersonId).displayName);
  assert.equal(await saved(), 'AXYBC');
  await input.fill('');
  await input.press('Tab');
  assert.equal(await input.inputValue(), 'AXYBC');
  assert.equal(await saved(), 'AXYBC');
  await input.fill('中文姓名');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(await saved(), 'AXYBC');
  await input.press('Tab');
  assert.equal(await saved(), '中文姓名');
  const attr = page.locator('#input-test .attr-row').last().locator('input').first();
  await attr.focus();
  const label = await attr.evaluate(el => el.closest('.attr-row').querySelector('.attr-label').textContent);
  const before = await attr.boundingBox();
  await page.keyboard.insertText('粘贴的资料');
  const active = page.locator('#input-test input:focus');
  assert.equal(await active.inputValue(), '粘贴的资料');
  assert.equal(await active.evaluate(el => el.closest('.attr-row').querySelector('.attr-label').textContent), label);
  assert.equal((await active.boundingBox()).y, before.y);
  await page.keyboard.insertText('继续修改');
  assert.equal(await active.inputValue(), '粘贴的资料继续修改');
  await page.reload();
  console.log('PASS name editing, IME guard and paste field position');
} finally { await browser.close(); }
