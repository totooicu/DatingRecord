// AI 模型配置的导入出行映射（.drp.json ↔ ai_models 行）
//
// 只映射「怎么调」，不碰密钥——密钥在 meta（ai.key.），永远是本机的，
// 不随备份、不同步（见 sync/snapshot.ts 的 SECRET_META_PREFIXES）。

import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { AiCapability, AiModel, AiProvider } from '../../ai/types';
import type { Row } from './types';

const ALL_CAPS: AiCapability[] = ['text', 'image', 'video', 'audio', 'file'];

export function rowToAiModel(r: Row): AiModel {
  const raw = (r.capabilities as string) ?? '';
  const caps = raw
    ? raw
        .split(',')
        .map((x) => x.trim())
        .filter((x): x is AiCapability => (ALL_CAPS as string[]).includes(x))
    : [];
  return {
    id: r.id as string,
    alias: (r.alias as string) ?? '',
    provider: ((r.provider as string) ?? 'siliconflow') as AiProvider,
    baseUrl: (r.base_url as string) ?? '',
    model: (r.model as string) ?? '',
    note: (r.note as string) ?? '',
    temperature: Number(r.temperature ?? 0.7),
    maxTokens: Number(r.max_tokens ?? 1024),
    capabilities: caps,
    isDefault: !!r.is_default,
    deviceId: (r.device_id as string) ?? '',
    rev: Number(r.rev ?? 1),
    hlc: (r.hlc as string) ?? '',
    deletedAt: (r.deleted_at as string) ?? null,
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  };
}

export function aiModelToRow(m: AiModel): Record<string, unknown> {
  return {
    id: m.id,
    alias: m.alias,
    provider: m.provider,
    base_url: m.baseUrl ?? '',
    model: m.model,
    note: m.note ?? '',
    temperature: m.temperature,
    max_tokens: m.maxTokens,
    capabilities: (m.capabilities ?? []).join(','),
    is_default: m.isDefault ? 1 : 0,
    device_id: m.deviceId || getDeviceId(),
    rev: m.rev || 1,
    hlc: m.hlc || hlcNow(getDeviceId()),
    deleted_at: m.deletedAt ?? null,
    created_at: m.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
