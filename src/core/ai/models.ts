// AI 模型配置的读写 + 密钥保管。
//
// 表里只存「怎么调」，密钥存 meta（前缀 ai.key.<provider>）。
// 分开的理由：ai_models 会随备份/同步到处走，密钥不能跟着走；
// 而 meta 的 ai.key. 前缀在 snapshot.ts 的 SECRET_META_PREFIXES 里，
// 生成快照时会被剔除，所以云端永远拿不到密钥。
import { queryAll, queryOne, run, getMeta, setMeta, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import type { AiModel, AiProvider } from './types';

interface Row {
  id: string;
  alias: string;
  provider: string;
  base_url: string;
  model: string;
  note: string;
  temperature: number;
  max_tokens: number;
  is_default: number;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToModel(r: Row): AiModel {
  return {
    id: r.id,
    alias: r.alias,
    provider: (r.provider as AiProvider) ?? 'siliconflow',
    baseUrl: r.base_url ?? '',
    model: r.model,
    note: r.note ?? '',
    temperature: Number(r.temperature ?? 0.7),
    maxTokens: Number(r.max_tokens ?? 1024),
    isDefault: !!r.is_default,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

/** 全部模型，默认那个排最前 */
export function listModels(): AiModel[] {
  return queryAll<Row>(`SELECT * FROM ai_models WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at ASC`).map(
    rowToModel,
  );
}

export function getModel(id: string): AiModel | null {
  const r = queryOne<Row>(`SELECT * FROM ai_models WHERE id = ?`, [id]);
  return r ? rowToModel(r) : null;
}

/** 按别名查——「调用 AI 能力时选择模型」就是按别名选 */
export function findByAlias(alias: string): AiModel | null {
  const r = queryOne<Row>(`SELECT * FROM ai_models WHERE alias = ? AND deleted_at IS NULL LIMIT 1`, [alias]);
  return r ? rowToModel(r) : null;
}

export function getDefaultModel(): AiModel | null {
  return listModels()[0] ?? null;
}

export interface ModelInput {
  alias: string;
  provider: AiProvider;
  baseUrl?: string;
  model: string;
  note?: string;
  temperature?: number;
  maxTokens?: number;
  isDefault?: boolean;
}

function assertAlias(alias: string, selfId?: string): string {
  const a = alias.trim();
  if (!a) throw new Error('别名不能为空');
  const dup = queryOne<{ id: string }>(`SELECT id FROM ai_models WHERE alias = ? AND deleted_at IS NULL`, [a]);
  if (dup && dup.id !== selfId) throw new Error(`别名「${a}」已经用过了`);
  return a;
}

function clearDefault(): void {
  run(`UPDATE ai_models SET is_default = 0 WHERE is_default = 1`);
}

export function createModel(input: ModelInput): AiModel {
  const alias = assertAlias(input.alias);
  const now = new Date().toISOString();
  const id = newId('ai');
  if (input.isDefault) clearDefault();
  run(
    `INSERT INTO ai_models
     (id,alias,provider,base_url,model,note,temperature,max_tokens,is_default,device_id,rev,hlc,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      alias,
      input.provider,
      input.baseUrl ?? '',
      input.model.trim(),
      input.note ?? '',
      input.temperature ?? 0.7,
      input.maxTokens ?? 1024,
      input.isDefault ? 1 : 0,
      getDeviceId(),
      1,
      hlcNow(getDeviceId()),
      now,
      now,
    ],
  );
  return getModel(id)!;
}

export function updateModel(id: string, patch: Partial<ModelInput>): AiModel {
  const cur = getModel(id);
  if (!cur) throw new Error('模型不存在');
  const next = {
    alias: patch.alias !== undefined ? assertAlias(patch.alias, id) : cur.alias,
    provider: patch.provider ?? cur.provider,
    baseUrl: patch.baseUrl ?? cur.baseUrl,
    model: patch.model ?? cur.model,
    note: patch.note ?? cur.note,
    temperature: patch.temperature ?? cur.temperature,
    maxTokens: patch.maxTokens ?? cur.maxTokens,
    isDefault: patch.isDefault ?? cur.isDefault,
  };
  if (next.isDefault && !cur.isDefault) clearDefault();
  run(
    `UPDATE ai_models SET alias=?, provider=?, base_url=?, model=?, note=?, temperature=?, max_tokens=?,
       is_default=?, rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
    [
      next.alias,
      next.provider,
      next.baseUrl,
      next.model,
      next.note,
      next.temperature,
      next.maxTokens,
      next.isDefault ? 1 : 0,
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ],
  );
  return getModel(id)!;
}

export function deleteModel(id: string): void {
  const cur = getModel(id);
  if (!cur) return;
  run(`UPDATE ai_models SET deleted_at = ?, hlc = ?, rev = rev + 1 WHERE id = ?`, [
    new Date().toISOString(),
    hlcNow(getDeviceId()),
    id,
  ]);
  // 删掉默认的，换一个顶上，免得「默认模型」变成空指针
  if (cur.isDefault) {
    const next = listModels()[0];
    if (next) run(`UPDATE ai_models SET is_default = 1 WHERE id = ?`, [next.id]);
  }
}

// ---------------- 密钥 ----------------

const keyOf = (p: AiProvider) => `ai.key.${p}`;

export function getApiKey(p: AiProvider): string {
  return getMeta(keyOf(p)) ?? '';
}

export function setApiKey(p: AiProvider, key: string): void {
  setMeta(keyOf(p), key.trim());
}

/** 密钥是否已配置（只回布尔，不回内容） */
export function hasApiKey(p: AiProvider): boolean {
  return !!getApiKey(p);
}

/** 打码展示：sk-abcd…wxyz */
export function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 10) return `${k.slice(0, 2)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
