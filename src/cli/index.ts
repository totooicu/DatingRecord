#!/usr/bin/env node
/**
 * DatingRecord 命令行入口。
 *
 * 和 UI 是同一个应用的两副面孔：UI 给人点，CLI 给人和 AI 调。
 * 两条路最终都落到 src/core/tools 注册表里的同一个函数，不存在第二套实现。
 *
 * 用法：
 *   node dist-cli/cli.cjs tools                 # 列出全部工具
 *   node dist-cli/cli.cjs help person.create    # 某个工具的参数说明
 *   node dist-cli/cli.cjs person.list --keyword 张三
 *   node dist-cli/cli.cjs event.create --title "第一次吃饭" --kind meal --time 2024-05-01
 *   node dist-cli/cli.cjs snapshot.create --note "改之前留个底"
 *
 * 全局参数：
 *   --db <路径>       库文件位置，默认 ./dating-record.sqlite（也可用环境变量 DR_DB）
 *   --no-snapshot     写操作前不自动拍快照（默认会拍，误操作可 snapshot.restore 回退）
 *   --compact         输出单行 JSON（默认是缩进格式，人和脚本都能读）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import initSqlJs from 'sql.js';

import { openWith, setPersistSink, flushPersist, setMeta, suspendUndo } from '../core/db';
import { newId } from '../core/id';
import { overrideDeviceId } from '../core/db/device';
import { setBlobStore } from '../core/db/blob';
import { setSnapStore } from '../core/snapshots/store';
import { createSnapshot } from '../core/snapshots';
import { setHostFs } from '../core/tools/host';
import { callTool, findTool, TOOLS, toolCatalogText, GROUP_LABELS } from '../core/tools';
import type { ToolDef } from '../core/tools';
import { fileSnapStore } from './snapStore';
import { fileBlobStore } from './blobStore';

const VERSION = '0.1.0';

interface CliFlags {
  db: string;
  snapshot: boolean;
  compact: boolean;
}

interface Parsed {
  command: string;
  args: Record<string, unknown>;
  flags: CliFlags;
}

/** 把 `--k v` / `--k=v` / `--k`（布尔）解析成对象 */
function parseArgv(argv: string[]): Parsed {
  const flags: CliFlags = {
    db: process.env.DR_DB || './dating-record.sqlite',
    snapshot: true,
    compact: false,
  };
  const args: Record<string, unknown> = {};
  let command = '';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--db') {
      flags.db = argv[++i] ?? '';
      continue;
    }
    if (a === '--no-snapshot') {
      flags.snapshot = false;
      continue;
    }
    if (a === '--compact') {
      flags.compact = true;
      continue;
    }
    if (a === '-h' || a === '--help') {
      command = command || 'help';
      continue;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        args[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[body] = next;
        i += 1;
      } else {
        args[body] = true; // 没有跟值：布尔开关
      }
      continue;
    }
    if (!command) command = a;
    else args._positional = [...(Array.isArray(args._positional) ? (args._positional as string[]) : []), a];
  }
  return { command, args, flags };
}

function printTools(group?: string): void {
  const groups = group ? [group as keyof typeof GROUP_LABELS] : (Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]);
  for (const g of groups) {
    const list = TOOLS.filter((t) => t.group === g);
    if (!list.length) continue;
    process.stdout.write(`\n${GROUP_LABELS[g]}  ${g}.*\n`);
    for (const t of list) {
      const params = t.params.map((p) => `${p.name}${p.required ? '' : '?'}:${p.type}`).join('  ');
      process.stdout.write(`  ${t.name}${params ? `  ${params}` : ''}\n`);
      process.stdout.write(`      ${t.title}${t.mutating ? '  [写库]' : ''}\n`);
    }
  }
  process.stdout.write(`\n共 ${TOOLS.length} 个工具。单个工具的详细说明：help <工具名>\n`);
}

function printToolHelp(tool: ToolDef): void {
  process.stdout.write(`\n${tool.name} — ${tool.title}${tool.mutating ? '（会修改数据）' : ''}\n\n${tool.desc}\n\n参数：\n`);
  if (!tool.params.length) {
    process.stdout.write('  （无）\n');
    return;
  }
  for (const p of tool.params) {
    const req = p.required ? '必填' : `可选，默认 ${JSON.stringify(p.default ?? null)}`;
    const en = p.enum ? `，可选值 ${p.enum.join(' / ')}` : '';
    process.stdout.write(`  --${p.name} <${p.type}>  ${p.desc}（${req}${en}）\n`);
  }
  process.stdout.write('\n');
}

function emit(value: unknown, compact: boolean): void {
  process.stdout.write(`${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgv(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const first = Array.isArray(args._positional) ? (args._positional as string[])[0] : undefined;
    if (first) {
      const t = findTool(first);
      if (t) printToolHelp(t);
      else process.stdout.write(`没有叫 ${first} 的工具\n`);
      return;
    }
    process.stdout.write(
      `DatingRecord CLI v${VERSION}\n\n` +
        '用法：cli.cjs <工具名> [--参数 值 ...]\n' +
        '      cli.cjs tools [--group person]   列出全部工具\n' +
        '      cli.cjs help <工具名>            参数说明\n\n' +
        '全局参数：--db <路径>  --no-snapshot  --compact\n\n' +
        toolCatalogText(),
    );
    return;
  }

  if (command === 'tools') {
    printTools(typeof args.group === 'string' ? args.group : undefined);
    return;
  }
  if (command === 'version' || command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const tool = findTool(command);
  if (!tool) {
    process.stderr.write(`未知命令：${command}\n可用命令：tools / help / version，或 ${TOOLS.length} 个工具之一\n`);
    process.exitCode = 2;
    return;
  }

  // ---------------- 开库 ----------------
  const dbPath = path.resolve(flags.db);
  // sql.js 的 wasm 就在它自己的 dist 目录里，按 require.resolve 反推最稳
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(path.dirname(require.resolve('sql.js')), file),
  });

  let bytes: Uint8Array | null = fs.existsSync(dbPath) ? new Uint8Array(fs.readFileSync(dbPath)) : null;

  // 设备 id 必须跨进程稳定：否则同一台机器上跑两次 CLI，同步时会被当成两个设备
  let deviceId: string | null = null;
  if (bytes) {
    const probe = new SQL.Database(bytes);
    try {
      const r = probe.exec("SELECT value FROM meta WHERE key = 'cli_device_id'");
      deviceId = (r[0]?.values[0]?.[0] as string | undefined) ?? null;
    } catch {
      /* 老库里可能没有 meta 表，忽略 */
    }
    probe.close();
  }
  if (!deviceId) deviceId = newId('d');
  overrideDeviceId(deviceId);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  openWith(SQL, bytes);
  setMeta('cli_device_id', deviceId);

  // ---------------- 注入各环境后端 ----------------
  setPersistSink((out) => {
    const tmp = `${dbPath}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, dbPath); // 断电/崩溃不会留下半个库
  });
  setSnapStore(fileSnapStore(dbPath));
  setBlobStore(fileBlobStore(dbPath));
  setHostFs({
    readText: (p) => fs.readFileSync(p, 'utf8'),
    writeText: (p, text) => fs.writeFileSync(p, text),
    readBytes: (p) => new Uint8Array(fs.readFileSync(p)),
    writeBytes: (p, bytes) => fs.writeFileSync(p, bytes),
    exists: (p) => fs.existsSync(p),
  });
  // CLI 是一次性进程，内存里的撤销栈没有意义（刷新即失效那套在这里等于进程退出即失效），
  // 关掉还能省掉每次写都整库拷贝的开销。要回退用快照，那个是落盘的。
  suspendUndo();

  // ---------------- 执行 ----------------
  let snapshotId: string | null = null;
  if (tool.mutating && flags.snapshot) {
    const m = await createSnapshot('cli', `CLI ${tool.name} 前自动备份`);
    snapshotId = m?.id ?? null;
  }

  const outcome = await callTool(command, args);
  if (snapshotId) (outcome as Record<string, unknown>)._snapshot = snapshotId;

  if (!outcome.ok) {
    process.stderr.write(`${outcome.error}\n`);
    process.exitCode = 1;
  } else {
    emit(outcome.data, flags.compact);
  }

  await flushPersist();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
