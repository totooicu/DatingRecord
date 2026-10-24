// 多变种假 OpenAI 服务：按用户消息里的关键词，走不同的「AI 操作流」。
//
// 用来在 review-matrix-e2e.mjs 里对每个场景核对三个时间点的数据变化：
//   T1 AI 动手前 → T2 跑完暂存（待执行） → T3 点「执行」之后。
//
// 关键词 → 流程（阶段机，靠「已出现过的工具名」推进，跟 fake-ai-flow.mjs 同构）：
//   「新增」    先读列表，再 person.create + event.create + collection.create 各一
//   「修改」    先读列表，再 person.update(改备注) + event.update(改标题正文)
//   「删除」    先读列表，再 event.delete(软删) + person.archive(归档)
//   「建了又删」collection.create 之后紧接着 collection.delete（净变化为零）
//   「混合」    新增 + 修改 + 删除 + 建了又删 一锅端
//   其他        直接回文本，不调任何工具（验证「没改动不出成果」）
//
// 用法：PORT=8794 node tools/e2e/fake-ai-matrix.mjs
// 依赖：无（纯 node:http）。

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8794);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-gpt', object: 'model' }] }));
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        /* ignore */
      }
      const msgs = body.messages ?? [];
      const tools = msgs
        .filter((m) => m.role === 'tool')
        .map((m) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return {};
          }
        });
      const names = tools.map((t) => t.name);
      const dataOf = (n) => tools.find((t) => t.name === n)?.data;
      const allOf = (n) => tools.filter((t) => t.name === n).map((t) => t.data);
      const userText = String(
        msgs.filter((m) => m.role === 'user').map((m) => m.content ?? '').join(' '),
      );

      // 慢响应场景（runtime-e2e 用）：含「慢慢」时每个回合都拖 1.2s，
      // 让 AI 真正「进行中」一段时间，方便测「离开页面仍运行 + head 出图标」。
      const SLOW = userText.includes('慢慢');
      const nap = () => (SLOW ? new Promise((r) => setTimeout(r, 1200)) : Promise.resolve());
      await nap();

      const send = (payload) => {
        res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const reply = (content) =>
        send({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'fake-gpt',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      const calls = (tcs) =>
        send({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'fake-gpt',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: null, tool_calls: tcs },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      const call = (name, args) => ({
        id: `call_${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      });
      const readPhase = () => {
        if (!names.includes('person.list')) return calls([call('person.list', {}), call('event.list', {})]);
        return null;
      };

      // ---------- 场景：纯新增 ----------
      if (userText.includes('新增')) {
        if (!names.includes('person.list')) {
          console.log('[matrix] 新增 → 读列表');
          return calls([call('person.list', {}), call('event.list', {})]);
        }
        if (!names.includes('person.create')) {
          console.log('[matrix] 新增 → 建 M-新人物 / M-新事件 / M-新事件集');
          return calls([
            call('person.create', { displayName: 'M-新人物', tags: ['矩阵', '新增'] }),
            call('event.create', { title: 'M-新事件', kind: 'note', content: '矩阵新增场景的事件正文' }),
            call('collection.create', { name: 'M-新事件集', kind: 'topic' }),
          ]);
        }
        console.log('[matrix] 新增 → 收尾');
        return reply('建好了：人物「M-新人物」、事件「M-新事件」、事件集「M-新事件集」。');
      }

      // ---------- 场景：纯修改 ----------
      if (userText.includes('修改')) {
        if (!names.includes('person.list')) {
          console.log('[matrix] 修改 → 读列表');
          return calls([call('person.list', {}), call('event.list', {})]);
        }
        const persons = dataOf('person.list') ?? [];
        const events = dataOf('event.list')?.events ?? [];
        const p1 = persons[0]?.id ?? '';
        const e1 = events[0]?.id ?? '';
        if (!names.includes('person.update')) {
          console.log('[matrix] 修改 → 改备注 + 改事件标题正文');
          return calls([
            call('person.update', { id: p1, notes: '矩阵修改场景写入的新备注' }),
            call('event.update', { id: e1, title: '日料晚餐（矩阵改过）', content: '矩阵修改场景写入的新正文' }),
          ]);
        }
        console.log('[matrix] 修改 → 收尾');
        return reply('改好了：给第一个人补了备注，事件的标题和正文也更新了。');
      }

      // ---------- 场景：纯删除 ----------
      if (userText.includes('删除')) {
        if (!names.includes('person.list')) {
          console.log('[matrix] 删除 → 读列表');
          return calls([call('person.list', {}), call('event.list', {})]);
        }
        const persons = dataOf('person.list') ?? [];
        const events = dataOf('event.list')?.events ?? [];
        const e1 = events[0]?.id ?? '';
        const p2 = persons[1]?.id ?? persons[0]?.id ?? '';
        if (!names.includes('event.delete')) {
          console.log('[matrix] 删除 → 软删事件 + 归档人物');
          return calls([call('event.delete', { id: e1 }), call('person.archive', { id: p2 })]);
        }
        console.log('[matrix] 删除 → 收尾');
        return reply('删好了：一个事件进了回收站，一个人物归档了。');
      }

      // ---------- 场景：建了又删（净变化为零） ----------
      if (userText.includes('建了又删')) {
        if (!names.includes('collection.create')) {
          console.log('[matrix] 建了又删 → 先建');
          return calls([call('collection.create', { name: 'M-临时事件集', kind: 'topic' })]);
        }
        const c = dataOf('collection.create');
        if (!names.includes('collection.delete')) {
          console.log('[matrix] 建了又删 → 再删');
          return calls([call('collection.delete', { id: c?.id ?? '' })]);
        }
        console.log('[matrix] 建了又删 → 收尾');
        return reply('建了个事件集又删掉了，库里应该看不出变化。');
      }

      // ---------- 场景：混合 ----------
      if (userText.includes('混合')) {
        if (!names.includes('person.list')) {
          console.log('[matrix] 混合 → 读列表');
          return calls([call('person.list', {}), call('event.list', {})]);
        }
        const persons = dataOf('person.list') ?? [];
        const events = dataOf('event.list')?.events ?? [];
        const e1 = events[0]?.id ?? '';
        const eLast = events[events.length - 1]?.id ?? e1;
        const p1 = persons[0]?.id ?? '';
        if (!names.includes('collection.create')) {
          console.log('[matrix] 混合 → 新增一批');
          return calls([
            call('person.create', { displayName: 'M-混合人物', tags: ['矩阵'] }),
            call('event.create', { title: 'M-混合事件', kind: 'note', content: '混合场景新增' }),
            call('collection.create', { name: 'M-混合事件集', kind: 'topic' }),
          ]);
        }
        if (!names.includes('event.update')) {
          console.log('[matrix] 混合 → 改一个 + 删一个');
          return calls([
            call('event.update', { id: e1, title: '第一次一起看电影（矩阵改过）' }),
            call('event.delete', { id: eLast }),
          ]);
        }
        if (!names.includes('person.update')) {
          console.log('[matrix] 混合 → 改人物备注 + 归档第二个人');
          const p2 = persons[1]?.id ?? p1;
          return calls([
            call('person.update', { id: p1, notes: '混合场景的新备注' }),
            call('person.archive', { id: p2 }),
          ]);
        }
        // 阶段 2 已经建过一个事件集，这里要按「调用次数」判断，不能按名字——
        // 按名字的话这一步永远不触发，后面会把正式的事件集当成临时的删掉
        if (allOf('collection.create').length < 2) {
          console.log('[matrix] 混合 → 建一个临时的再删掉（净零）');
          return calls([call('collection.create', { name: 'M-混合临时集', kind: 'topic' })]);
        }
        const tmp = allOf('collection.create');
        const tmpId = tmp[tmp.length - 1]?.id ?? '';
        if (!names.includes('collection.delete')) {
          console.log('[matrix] 混合 → 删掉临时的');
          return calls([call('collection.delete', { id: tmpId })]);
        }
        console.log('[matrix] 混合 → 收尾');
        return reply(
          '混合做完了：新增了人物/事件/事件集各一，改了一个事件标题和一个人物备注，删了一个事件、归档了一个人物，还建了又删了一个临时事件集。',
        );
      }

      // ---------- 默认：不调工具，纯文本 ----------
      console.log('[matrix] 默认 → 纯文本（无写库）');
      return reply('你好，这一轮只是打个招呼，没有动库里的数据。');
    });
  })
  .listen(PORT, () => console.log(`[matrix] 监听 http://localhost:${PORT}`));
