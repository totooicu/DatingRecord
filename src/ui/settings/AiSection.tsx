// AI 模型管理：别名 → 服务商 + 模型名 + 参数。
//
// 一个模型配一条「别名」，以后调用 AI 能力时选别名，不用记
// "Qwen/Qwen2.5-72B-Instruct" 这种长串；同一个模型也能起两个别名
// （「快速」temperature 0.2 / 「发散」temperature 1.0）。
//
// 密钥按服务商存一份（meta ai.key.<provider>），多条别名共用，不进备份。
import { useEffect, useMemo, useState } from 'react';
import { Section } from './Section';
import { bump } from '../../store';
import {
  AI_PROVIDERS,
  createModel,
  deleteModel,
  getApiKey,
  listModels,
  listRemoteModels,
  maskKey,
  providerOf,
  setApiKey,
  testModel,
  updateModel,
  type AiModel,
  type AiProvider,
} from '../../core/ai';

interface Draft {
  id: string | null;
  alias: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  note: string;
  temperature: string;
  maxTokens: string;
  isDefault: boolean;
}

const EMPTY: Draft = {
  id: null,
  alias: '',
  provider: 'siliconflow',
  baseUrl: '',
  model: '',
  note: '',
  temperature: '0.7',
  maxTokens: '1024',
  isDefault: false,
};

function draftOf(m: AiModel): Draft {
  return {
    id: m.id,
    alias: m.alias,
    provider: m.provider,
    baseUrl: m.baseUrl,
    model: m.model,
    note: m.note,
    temperature: String(m.temperature),
    maxTokens: String(m.maxTokens),
    isDefault: m.isDefault,
  };
}

export function AiSection() {
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [remote, setRemote] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'list' | 'test' | 'save'>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => setModels(listModels());
  const reset = () => {
    setMsg(null);
    setErr(null);
    setRemote([]);
  };

  const saveKey = (p: AiProvider, key: string) => {
    setApiKey(p, key);
    bump();
  };

  return (
    <>
      <Section
        title="AI 模型"
        desc="给模型起个别名，以后调用 AI 能力时按别名选。密钥只存在本机，不进备份、不上传云端。"
      >
        <div className="row-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              reset();
              setDraft({ ...EMPTY, isDefault: models.length === 0 });
            }}
          >
            添加模型
          </button>
          <span className="muted small">已配置 {models.length} 个</span>
        </div>

        {msg && <p className="sync-ok">{msg}</p>}
        {err && <p className="sync-err">{err}</p>}

        {models.length === 0 ? (
          <p className="muted small">还没有模型。点「添加模型」，填服务商、模型名和一个好记的别名。</p>
        ) : (
          <ul className="ai-list">
            {models.map((m) => (
              <li key={m.id} className="ai-row">
                <div className="ai-row-main">
                  <span className="ai-alias">{m.alias}</span>
                  {m.isDefault && <span className="ai-badge">默认</span>}
                  <span className="ai-model-name">
                    {providerOf(m.provider).label} · {m.model}
                  </span>
                </div>
                <div className="ai-row-meta muted small">
                  temperature {m.temperature} · 上限 {m.maxTokens} tokens
                  {m.note ? ` · ${m.note}` : ''}
                </div>
                <div className="row-actions">
                  <button
                    className="btn"
                    onClick={() => {
                      reset();
                      setDraft(draftOf(m));
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="btn"
                    disabled={m.isDefault}
                    onClick={() => {
                      updateModel(m.id, { isDefault: true });
                      bump();
                      reload();
                    }}
                  >
                    设为默认
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      deleteModel(m.id);
                      bump();
                      reload();
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft && (
        <ModelEditor
          draft={draft}
          setDraft={setDraft}
          remote={remote}
          setRemote={setRemote}
          busy={busy}
          setBusy={setBusy}
          onMsg={setMsg}
          onErr={setErr}
          saveKey={saveKey}
          onSaved={() => {
            reload();
            setDraft(null);
          }}
        />
      )}

      <KeySection models={models} saveKey={saveKey} />
    </>
  );
}

function ModelEditor({
  draft,
  setDraft,
  remote,
  setRemote,
  busy,
  setBusy,
  onMsg,
  onErr,
  saveKey,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  remote: string[];
  setRemote: (v: string[]) => void;
  busy: string;
  setBusy: (b: '' | 'list' | 'test' | 'save') => void;
  onMsg: (s: string | null) => void;
  onErr: (s: string | null) => void;
  saveKey: (p: AiProvider, k: string) => void;
  onSaved: () => void;
}) {
  const [keyInput, setKeyInput] = useState(() => getApiKey(draft.provider));
  const prov = providerOf(draft.provider);
  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });

  useEffect(() => {
    setKeyInput(getApiKey(draft.provider));
  }, [draft.provider]);

  const doList = async () => {
    setBusy('list');
    onErr(null);
    onMsg(null);
    try {
      saveKey(draft.provider, keyInput);
      const ids = await listRemoteModels({
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: keyInput,
      });
      setRemote(ids);
      onMsg(`读到 ${ids.length} 个模型，可直接从下拉里选`);
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const doTest = async () => {
    setBusy('test');
    onErr(null);
    onMsg(null);
    try {
      saveKey(draft.provider, keyInput);
      const r = await testModel(
        { provider: draft.provider, baseUrl: draft.baseUrl, model: draft.model },
        keyInput,
      );
      onMsg(`连通成功（${r.ms} ms）：${r.content.slice(0, 40) || '(空回复)'}`);
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const doSave = () => {
    setBusy('save');
    onErr(null);
    try {
      const input = {
        alias: draft.alias,
        provider: draft.provider,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        note: draft.note.trim(),
        temperature: clampNum(draft.temperature, 0, 2, 0.7),
        maxTokens: Math.round(clampNum(draft.maxTokens, 16, 32000, 1024)),
        isDefault: draft.isDefault,
      };
      if (!input.model) throw new Error('模型名不能为空（可点「读取模型列表」选）');
      saveKey(draft.provider, keyInput);
      if (draft.id) updateModel(draft.id, input);
      else createModel(input);
      bump();
      onSaved();
    } catch (e) {
      onErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const options = remote;

  return (
    <Section title={draft.id ? '编辑模型' : '添加模型'} desc="别名是这个模型在你嘴里的名字，调用时选它。">
      <label className="field">
        <span className="field-label">别名</span>
        <input
          value={draft.alias}
          placeholder="如：便宜好用的"
          onChange={(e) => patch({ alias: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">服务商</span>
        <select value={draft.provider} onChange={(e) => patch({ provider: e.target.value as AiProvider })}>
          {AI_PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{prov.hint}</p>

      {prov.needsKey && (
        <label className="field">
          <span className="field-label">API 密钥（{prov.label}）</span>
          <input
            type="password"
            value={keyInput}
            placeholder="sk-..."
            onChange={(e) => setKeyInput(e.target.value)}
          />
        </label>
      )}

      <label className="field">
        <span className="field-label">API 根地址（留空用默认 {prov.baseUrl || '需填'}）</span>
        <input
          value={draft.baseUrl}
          placeholder={prov.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">模型名</span>
        {options.length > 0 ? (
          <select value={draft.model} onChange={(e) => patch({ model: e.target.value })}>
            <option value="">（请选择）</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={draft.model}
            placeholder="如 Qwen/Qwen2.5-7B-Instruct"
            onChange={(e) => patch({ model: e.target.value })}
          />
        )}
      </label>

      <div className="row-actions">
        <button className="btn" disabled={busy !== ''} onClick={() => void doList()}>
          {busy === 'list' ? '读取中…' : '读取模型列表'}
        </button>
        <button
          className="btn"
          disabled={busy !== '' || !draft.model}
          onClick={() => void doTest()}
        >
          {busy === 'test' ? '测试中…' : '测试这个模型'}
        </button>
      </div>

      <label className="field">
        <span className="field-label">温度（0 严谨 — 2 发散）</span>
        <div className="range-row">
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={draft.temperature}
            onChange={(e) => patch({ temperature: e.target.value })}
          />
          <span className="range-value">{draft.temperature}</span>
        </div>
      </label>

      <label className="field">
        <span className="field-label">回复长度上限（tokens）</span>
        <input
          type="number"
          min="16"
          max="32000"
          value={draft.maxTokens}
          onChange={(e) => patch({ maxTokens: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">备注</span>
        <input value={draft.note} placeholder="给谁用、多少钱一千字…" onChange={(e) => patch({ note: e.target.value })} />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.isDefault}
          onChange={(e) => patch({ isDefault: e.target.checked })}
        />
        设为默认模型
      </label>

      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy !== ''} onClick={doSave}>
          保存
        </button>
        <button className="btn" onClick={onSaved}>
          取消
        </button>
      </div>
    </Section>
  );
}

function KeySection({
  models,
  saveKey,
}: {
  models: AiModel[];
  saveKey: (p: AiProvider, k: string) => void;
}) {
  const used = useMemo(() => {
    const set = new Set(models.map((m) => m.provider));
    if (set.size === 0) ['siliconflow'].forEach((p) => set.add(p as AiProvider));
    return AI_PROVIDERS.filter((p) => p.needsKey && (set.has(p.key) || p.key === 'siliconflow'));
  }, [models]);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const p of AI_PROVIDERS) o[p.key] = getApiKey(p.key);
    return o;
  });
  const [msg, setMsg] = useState('');

  return (
    <Section title="密钥" desc="按服务商各存一份，多条别名共用。只在本机，不进备份。">
      {used.map((p) => (
        <label className="field" key={p.key}>
          <span className="field-label">
            {p.label}
            {vals[p.key] ? `（已存：${maskKey(vals[p.key])}）` : '（未设置）'}
          </span>
          <div className="row-actions">
            <input
              type="password"
              value={vals[p.key] ?? ''}
              placeholder="sk-..."
              onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })}
            />
            <button
              className="btn"
              onClick={() => {
                saveKey(p.key, vals[p.key] ?? '');
                setMsg(`已保存 ${p.label} 的密钥`);
              }}
            >
              保存
            </button>
          </div>
        </label>
      ))}
      {msg && <p className="sync-ok">{msg}</p>}
    </Section>
  );
}

function clampNum(v: string, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
