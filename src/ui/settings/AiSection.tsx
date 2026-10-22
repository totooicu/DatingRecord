// AI 模型管理：别名 → 服务商 + 模型名 + 参数 + 能力。
//
// 一个模型配一条「别名」，以后调用 AI 能力时选别名，不用记
// "Qwen/Qwen2.5-72B-Instruct" 这种长串；同一个模型也能起两个别名
// （「快速」temperature 0.2 / 「发散」temperature 1.0）。
//
// 服务商可自己选：硅基流动 / OpenAI 兼容 / 本地 Ollama / 自定义。已知服务商
// 的根地址自动填好、不给你改；只有「自定义」才让你填根地址。
// 密钥按当前所选服务商存一份（meta ai.key.<provider>），多条别名共用，不进备份。
import { useEffect, useMemo, useState } from 'react';
import { Section } from './Section';
import { bump } from '../../store';
import {
  AI_CAPABILITIES,
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
  type AiCapability,
  type AiModel,
  type AiProvider,
  type RemoteModel,
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
  capabilities: AiCapability[];
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
  capabilities: ['text'],
  isDefault: false,
};

function draftOf(m: AiModel): Draft {
  return {
    id: m.id,
    alias: m.alias,
    provider: m.provider === 'custom' ? 'openai' : m.provider,
    baseUrl: m.baseUrl,
    model: m.model,
    note: m.note,
    temperature: String(m.temperature),
    maxTokens: String(m.maxTokens),
    capabilities: m.capabilities.length ? m.capabilities : ['text'],
    isDefault: m.isDefault,
  };
}

function capLabels(caps: AiCapability[]): string {
  return caps.map((c) => AI_CAPABILITIES.find((x) => x.key === c)?.label ?? c).join('·') || '无标注';
}

export function AiSection() {
  const [models, setModels] = useState<AiModel[]>(() => listModels());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [remote, setRemote] = useState<RemoteModel[]>([]);
  const [busy, setBusy] = useState<'' | 'list' | 'test' | 'save'>('');
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => setModels(listModels());
  const reset = () => {
    setMsg(null);
    setRemote([]);
  };

  const saveKey = (p: AiProvider, key: string) => {
    setApiKey(p, key);
    bump();
  };

  const activeProvider: AiProvider = draft?.provider ?? models[0]?.provider ?? 'siliconflow';

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
              setRemote([]);
              setDraft({ ...EMPTY, isDefault: models.length === 0 });
            }}
          >
            添加模型
          </button>
          <span className="muted small">已配置 {models.length} 个</span>
        </div>

        {msg && <p className="sync-ok">{msg}</p>}

        {models.length === 0 ? (
          <p className="muted small">还没有模型。点「添加模型」，选服务商、填模型名和一个好记的别名。</p>
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
                  能力 {capLabels(m.capabilities)} · temperature {m.temperature} · 上限 {m.maxTokens} tokens
                  {m.note ? ` · ${m.note}` : ''}
                </div>
                <div className="row-actions">
                  <button
                    className="btn"
                    onClick={() => {
                      reset();
                      setRemote([]);
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
          saveKey={saveKey}
          onSaved={() => {
            reload();
            setDraft(null);
          }}
        />
      )}

      <KeySection models={models} activeProvider={activeProvider} saveKey={saveKey} onSaved={() => setMsg('已保存密钥')} />
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
  saveKey,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  remote: RemoteModel[];
  setRemote: (v: RemoteModel[]) => void;
  busy: string;
  setBusy: (b: '' | 'list' | 'test' | 'save') => void;
  saveKey: (p: AiProvider, k: string) => void;
  onSaved: () => void;
}) {
  const [keyInput, setKeyInput] = useState(() => getApiKey(draft.provider));
  const [fb, setFb] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const prov = providerOf(draft.provider);
  const showBase = prov.baseEditable;
  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });

  useEffect(() => {
    setKeyInput(getApiKey(draft.provider));
  }, [draft.provider]);

  const doList = async () => {
    setBusy('list');
    setFb(null);
    try {
      saveKey(draft.provider, keyInput);
      const list = await listRemoteModels({
        provider: draft.provider,
        baseUrl: showBase ? draft.baseUrl : undefined,
        apiKey: keyInput,
      });
      setRemote(list);
      const withCaps = list.filter((r) => r.capabilities.length > 0).length;
      setFb({
        kind: 'ok',
        text: list.length
          ? withCaps
            ? `读到 ${list.length} 个模型，其中 ${withCaps} 个已自动识别能力，从下拉里选即可`
            : `读到 ${list.length} 个模型，从下拉里选。该服务不返回能力信息，可手动勾选`
          : '连上了，但这个服务商没返回模型列表（可能该账号下暂无可用模型）',
      });
    } catch (e) {
      setFb({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const doTest = async () => {
    setBusy('test');
    setFb(null);
    try {
      saveKey(draft.provider, keyInput);
      const r = await testModel(
        { provider: draft.provider, baseUrl: showBase ? draft.baseUrl : '', model: draft.model },
        keyInput,
      );
      setFb({ kind: 'ok', text: `连通成功（${r.ms} ms）：${r.content.slice(0, 40) || '(空回复)'}` });
    } catch (e) {
      setFb({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const doSave = () => {
    setBusy('save');
    setFb(null);
    try {
      const input = {
        alias: draft.alias,
        provider: draft.provider,
        baseUrl: showBase ? draft.baseUrl.trim() : '',
        model: draft.model.trim(),
        note: draft.note.trim(),
        temperature: clampNum(draft.temperature, 0, 2, 0.7),
        maxTokens: Math.round(clampNum(draft.maxTokens, 16, 32000, 1024)),
        capabilities: draft.capabilities,
        isDefault: draft.isDefault,
      };
      if (!input.model) throw new Error('模型名不能为空（可点「读取模型列表」选，或手动填）');
      saveKey(draft.provider, keyInput);
      if (draft.id) updateModel(draft.id, input);
      else createModel(input);
      bump();
      onSaved();
    } catch (e) {
      setFb({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      // 必须复位：成功分支里 onSaved() 会卸载本编辑器，但父级 busy 仍要清掉，
      // 否则下次再打开编辑器时会继承 'save' 而让所有按钮变成禁用态。
      setBusy('');
    }
  };

  const options = remote;
  // 选中的模型若带回能力，展示一下，让用户知道已自动识别
  const picked = remote.find((r) => r.id === draft.model);

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
        <select
          value={draft.provider}
          onChange={(e) => {
            const p = e.target.value as AiProvider;
            const meta = providerOf(p);
            // 切换服务商时，根地址重置为该服务商的默认值（硅基流动固定、其余各自默认，用户可再改）
            patch({
              provider: p,
              baseUrl: meta.baseEditable ? meta.baseUrl : '',
            });
          }}
        >
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

      {showBase ? (
        <label className="field">
          <span className="field-label">API 根地址</span>
          <input
            value={draft.baseUrl}
            placeholder={prov.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
          <span className="muted small">默认 {prov.baseUrl}（如用 DeepSeek / Moonshot / 自建网关，改成对应地址）</span>
        </label>
      ) : (
        <p className="muted small">API 根地址：{prov.baseUrl}（{prov.label} 固定，自动使用，无需填写）</p>
      )}

      <label className="field">
        <span className="field-label">模型名</span>
        {options.length > 0 ? (
          <select
            value={draft.model}
            onChange={(e) => {
              const id = e.target.value;
              const rm = remote.find((r) => r.id === id);
              // 选中带能力的模型时，自动把能力填上；没带能力的（通用 OpenAI 兼容）保留手选
              patch(rm && rm.capabilities.length ? { model: id, capabilities: rm.capabilities } : { model: id });
            }}
          >
            <option value="">（请选择）</option>
            {options.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.id}
                {rm.capabilities.length ? ` · ${capLabels(rm.capabilities)}` : ''}
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
      {picked && picked.capabilities.length > 0 && (
        <p className="muted small">该模型已自动识别能力：{capLabels(picked.capabilities)}（可手动增减）</p>
      )}

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
      {fb && (
        <p className={fb.kind === 'ok' ? 'sync-ok' : 'sync-err'}>{fb.text}</p>
      )}

      <div className="field">
        <span className="field-label">能力（这个模型能处理什么）</span>
        <div className="chip-row">
          {AI_CAPABILITIES.map((c) => {
            const on = draft.capabilities.includes(c.key);
            return (
              <label key={c.key} className={`chip ${on ? 'chip-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.capabilities, c.key]
                      : draft.capabilities.filter((x) => x !== c.key);
                    patch({ capabilities: next });
                  }}
                />
                {c.label}
              </label>
            );
          })}
        </div>
        <p className="muted small">不同功能会按能力挑模型（例如看图要「图片」、转写要「音频」）。可多选。</p>
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
  activeProvider,
  saveKey,
  onSaved,
}: {
  models: AiModel[];
  activeProvider: AiProvider;
  saveKey: (p: AiProvider, k: string) => void;
  onSaved: () => void;
}) {
  const used = useMemo(() => {
    const set = new Set(models.map((m) => m.provider));
    return AI_PROVIDERS.filter((p) => p.needsKey && (set.has(p.key) || p.key === activeProvider));
  }, [models, activeProvider]);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const p of AI_PROVIDERS) o[p.key] = getApiKey(p.key);
    return o;
  });

  if (used.length === 0) {
    return (
      <Section title="密钥" desc="按服务商各存一份，多条别名共用。只在本机，不进备份。">
        <p className="muted small">
          当前选择的服务商（{providerOf(activeProvider).label}）不需要密钥。要存密钥，先选硅基流动 / OpenAI 兼容 / 自定义。
        </p>
      </Section>
    );
  }

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
                onSaved();
              }}
            >
              保存
            </button>
          </div>
        </label>
      ))}
    </Section>
  );
}

function clampNum(v: string, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
