// 假 OpenAI 服务：喂一条「操作流」给 agent，让它连续做很多写操作。
//
// 用来验证成果的聚集与净变化展示，流程照着真实场景写：
//   1) 先读：person.list / event.list（拿到已存在的 P2 / P3 / E2 的 id）
//   2) 写：person.create(P1) · collection.create(Es1) · event.create(E1)
//   3) 写：event.update(E1) · event.delete(E2) · person.delete(P2)
//   4) 写：collection.update(Es1) · event.create(E3)
//   5) 写：event.delete(E3) · person.update(P3)
//   6) 文本收尾
// 关键点：E3 建了又删，净变化为零；整条流只能生成 1 条成果。
//
// 用法：node tools/e2e/fake-ai-flow.mjs（默认 8791 端口，PORT 环境变量可改）
// 依赖：无（纯 node:http）。配合 tools/e2e/snap-flow-e2e.mjs 使用。

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8791);
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
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        /* ignore */
      }
      const msgs = body.messages ?? [];
      // wire 上的 tool 消息只有 role/tool_call_id/content，工具名在 content 的 JSON 里
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

      // 阶段 1：先看看库里有什么，拿到待删/待改对象的 id
      if (!names.includes('person.list')) {
        console.log('[fake-ai] 阶段1 → 读列表');
        return calls([call('person.list', {}), call('event.list', {})]);
      }

      const persons = dataOf('person.list') ?? [];
      const events = dataOf('event.list') ?? [];
      const p2 = persons[0]?.id ?? '';
      const p3 = persons[1]?.id ?? persons[0]?.id ?? '';
      const e2 = (events.events ?? events)[0]?.id ?? '';

      // 阶段 2：建三个
      if (!names.includes('person.create')) {
        console.log('[fake-ai] 阶段2 → 建 P1 / Es1 / E1');
        return calls([
          call('person.create', { displayName: 'P1' }),
          call('collection.create', { name: 'Es1' }),
          call('event.create', { title: 'E1', kind: 'note', content: 'E1 正文' }),
        ]);
      }

      const p1 = dataOf('person.create')?.id ?? '';
      const es1 = dataOf('collection.create')?.id ?? '';
      const e1 = allOf('event.create')[0]?.id ?? '';

      // 阶段 3：改 E1、删 E2、删 P2
      if (!names.includes('event.update')) {
        console.log('[fake-ai] 阶段3 → 改 E1 / 归档 E2 所属人物 P2');
        return calls([
          call('event.update', { id: e1, title: 'E1（改过）' }),
          call('event.delete', { id: e2 }),
          call('person.archive', { id: p2 }),
        ]);
      }

      // 阶段 4：改 Es1、建 E3
      if (!names.includes('collection.update')) {
        console.log('[fake-ai] 阶段4 → 改 Es1 / 建 E3');
        return calls([
          call('collection.update', { id: es1, name: 'Es1（改过）' }),
          call('event.create', { title: 'E3', kind: 'note', content: '建了又删' }),
        ]);
      }

      const created = allOf('event.create');
      const e3 = created[created.length - 1]?.id ?? '';

      // 阶段 5：删 E3、改 P3
      if (!names.includes('person.update')) {
        console.log('[fake-ai] 阶段5 → 删 E3 / 改 P3');
        return calls([
          call('event.delete', { id: e3 }),
          call('person.update', { id: p3, displayName: 'P3（改过）' }),
        ]);
      }

      console.log('[fake-ai] 收尾 → 文本');
      return reply(
        `都做完了：新建人物 P1、事件集 Es1、事件 E1；改了事件 E1 与事件集 Es1；` +
          `删除了事件 E2 和人物 P2；事件 E3 建完又删掉了；人物 P3 改名。`,
      );
    });
  })
  .listen(PORT, () => console.log(`[fake-ai] 监听 http://localhost:${PORT}`));
