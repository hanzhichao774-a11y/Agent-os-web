import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Server, Database, Layers } from 'lucide-react';
import {
  fetchLLMSettings, saveLLMSettings, testLLMConnection,
  fetchEmbeddingSettings, saveEmbeddingSettings, testEmbeddingConnection,
  fetchRerankerSettings, saveRerankerSettings, testRerankerConnection,
} from '../services/api';
import type { LLMSettings, EmbeddingSettings, RerankerSettings } from '../services/api';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type TabId = 'llm' | 'embedding' | 'reranker';

const TABS: { id: TabId; label: string; icon: typeof Server }[] = [
  { id: 'llm', label: '聊天模型', icon: Server },
  { id: 'embedding', label: 'Embedding', icon: Database },
  { id: 'reranker', label: 'Reranker', icon: Layers },
];

const PROVIDER_LABELS: Record<string, string> = {
  kimi: 'Kimi (Moonshot)',
  openai: 'OpenAI',
  minimax: 'MiniMax',
  custom: '自定义 (千问/私有化部署)',
};

const PROVIDER_NEEDS_BASE_URL = new Set(['custom', 'minimax', 'kimi']);

function TestResultBanner({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm ${
      result.ok
        ? 'bg-success/10 text-success border border-success/20'
        : 'bg-danger/10 text-danger border border-danger/20'
    }`}>
      {result.ok
        ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
      }
      <span className="break-all">{result.message}</span>
    </div>
  );
}

function KeyInput({ value, onChange, placeholder = 'sk-...' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 pr-10 outline-none focus:border-primary text-text placeholder:text-text-muted font-mono"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function LabeledInput({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-text mb-1.5 block">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, mono }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text placeholder:text-text-muted ${mono ? 'font-mono' : ''}`}
    />
  );
}

// ─── LLM Tab ────────────────────────────────────────────────────────────────

function LLMTab({ onTestResult }: { onTestResult: (r: { ok: boolean; message: string } | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [provider, setProvider] = useState('kimi');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [providers, setProviders] = useState<string[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    setTestResult(null);
    fetchLLMSettings()
      .then((data: LLMSettings) => {
        setProvider(data.provider || 'kimi');
        setModelId(data.model_id || '');
        setApiKey(data.api_key || '');
        setBaseUrl(data.base_url || '');
        setProviders(data.providers || Object.keys(PROVIDER_LABELS));
        setDefaultModels(data.default_models || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { onTestResult(testResult); }, [testResult]);

  const handleProviderChange = (p: string) => {
    setProvider(p);
    setModelId(defaultModels[p] || '');
    setBaseUrl('');
    setTestResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveLLMSettings({ provider, model_id: modelId, api_key: apiKey, base_url: baseUrl });
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testLLMConnection({ provider, model_id: modelId, api_key: apiKey, base_url: baseUrl });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally { setTesting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-text-muted">加载配置中...</span>
      </div>
    );
  }

  const showBaseUrl = provider === 'custom' || PROVIDER_NEEDS_BASE_URL.has(provider);

  return (
    <>
      <div className="space-y-5">
        <LabeledInput label="服务提供商">
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text appearance-none cursor-pointer"
          >
            {providers.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
            ))}
          </select>
          {provider === 'custom' && (
            <p className="mt-1.5 text-xs text-text-muted">适用于千问、DeepSeek 等兼容 OpenAI API 的私有化部署服务</p>
          )}
        </LabeledInput>
        <LabeledInput label="Model ID">
          <TextInput value={modelId} onChange={setModelId} placeholder={defaultModels[provider] || '模型标识'} />
        </LabeledInput>
        <LabeledInput label="API Key">
          <KeyInput value={apiKey} onChange={setApiKey} />
        </LabeledInput>
        {showBaseUrl && (
          <LabeledInput label="Base URL" required={provider === 'custom'}>
            <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="http://your-host:8080/v1" mono />
            {provider === 'custom' && (
              <p className="mt-1.5 text-xs text-text-muted">私有化部署的服务地址，需包含 /v1 路径</p>
            )}
          </LabeledInput>
        )}
        <TestResultBanner result={testResult} />
      </div>
      <TabFooter
        onTest={handleTest}
        onSave={handleSave}
        testing={testing}
        saving={saving}
        testDisabled={!apiKey}
        saveDisabled={provider === 'custom' && !baseUrl}
      />
    </>
  );
}

// ─── Embedding Tab ──────────────────────────────────────────────────────────

function EmbeddingTab({ onTestResult }: { onTestResult: (r: { ok: boolean; message: string } | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [mode, setMode] = useState<'local' | 'api'>('local');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [dimensions, setDimensions] = useState(1024);

  useEffect(() => {
    setLoading(true);
    setTestResult(null);
    fetchEmbeddingSettings()
      .then((data: EmbeddingSettings) => {
        setMode((data.mode as 'local' | 'api') || 'local');
        setModelId(data.model_id || '');
        setApiKey(data.api_key || '');
        setBaseUrl(data.base_url || '');
        setDimensions(data.dimensions || 1024);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { onTestResult(testResult); }, [testResult]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveEmbeddingSettings({ mode, model_id: modelId, api_key: apiKey, base_url: baseUrl, dimensions });
      if (res.warning) {
        setTestResult({ ok: true, message: res.warning });
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testEmbeddingConnection({ mode, model_id: modelId, api_key: apiKey, base_url: baseUrl, dimensions });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally { setTesting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-text-muted">加载配置中...</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <LabeledInput label="模式">
          <div className="flex gap-3">
            {[
              { value: 'local' as const, label: '本地 (FastEmbed)', desc: '使用本地 BAAI/bge-small-zh 模型' },
              { value: 'api' as const, label: '远程 API', desc: '使用 OpenAI 兼容的 Embedding 服务' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`flex-1 px-4 py-3 rounded-xl border text-left transition-colors ${
                  mode === opt.value
                    ? 'border-primary bg-primary/5 text-text'
                    : 'border-border bg-bg text-text-muted hover:border-primary/30'
                }`}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs mt-0.5 opacity-70">{opt.desc}</div>
              </button>
            ))}
          </div>
        </LabeledInput>

        {mode === 'api' && (
          <>
            <LabeledInput label="Model ID" required>
              <TextInput value={modelId} onChange={setModelId} placeholder="qw3-em-8b" />
            </LabeledInput>
            <LabeledInput label="API Key">
              <KeyInput value={apiKey} onChange={setApiKey} />
            </LabeledInput>
            <LabeledInput label="Base URL" required>
              <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="http://your-host:8080/v1" mono />
            </LabeledInput>
            <LabeledInput label="向量维度">
              <input
                type="number"
                value={dimensions}
                onChange={(e) => setDimensions(parseInt(e.target.value) || 1024)}
                className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text"
              />
              <p className="mt-1.5 text-xs text-text-muted">需与模型输出维度一致，常见值: 512 / 768 / 1024 / 1536</p>
            </LabeledInput>
          </>
        )}

        {mode === 'local' && (
          <div className="px-4 py-3 rounded-xl bg-bg border border-border text-sm text-text-muted">
            当前使用本地 <span className="font-mono text-text">BAAI/bge-small-zh-v1.5</span> 模型（512 维），无需网络连接。
          </div>
        )}

        <TestResultBanner result={testResult} />
      </div>
      <TabFooter
        onTest={handleTest}
        onSave={handleSave}
        testing={testing}
        saving={saving}
        testDisabled={mode === 'local'}
        saveDisabled={mode === 'api' && (!modelId || !baseUrl)}
      />
    </>
  );
}

// ─── Reranker Tab ───────────────────────────────────────────────────────────

function RerankerTab({ onTestResult }: { onTestResult: (r: { ok: boolean; message: string } | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [topN, setTopN] = useState(5);

  useEffect(() => {
    setLoading(true);
    setTestResult(null);
    fetchRerankerSettings()
      .then((data: RerankerSettings) => {
        setEnabled(data.enabled ?? false);
        setModelId(data.model_id || '');
        setApiKey(data.api_key || '');
        setBaseUrl(data.base_url || '');
        setTopN(data.top_n ?? 5);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { onTestResult(testResult); }, [testResult]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRerankerSettings({ enabled, model_id: modelId, api_key: apiKey, base_url: baseUrl, top_n: topN });
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testRerankerConnection({ enabled, model_id: modelId, api_key: apiKey, base_url: baseUrl, top_n: topN });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally { setTesting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-text-muted">加载配置中...</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">启用 Reranker</div>
            <div className="text-xs text-text-muted mt-0.5">开启后，知识库检索结果将经过 Reranker 二次排序</div>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {enabled && (
          <>
            <LabeledInput label="Model ID" required>
              <TextInput value={modelId} onChange={setModelId} placeholder="qw3-reranke-8b" />
            </LabeledInput>
            <LabeledInput label="API Key">
              <KeyInput value={apiKey} onChange={setApiKey} />
            </LabeledInput>
            <LabeledInput label="Base URL" required>
              <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="http://your-host:8080" mono />
              <p className="mt-1.5 text-xs text-text-muted">
                自动兼容 /v1/rerank (Jina/Cohere) 和 /rerank (TEI) 两种接口格式
              </p>
            </LabeledInput>
            <LabeledInput label="Top N">
              <input
                type="number"
                value={topN}
                onChange={(e) => setTopN(parseInt(e.target.value) || 5)}
                min={1}
                max={50}
                className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text"
              />
              <p className="mt-1.5 text-xs text-text-muted">Reranker 返回的最大结果数量</p>
            </LabeledInput>
          </>
        )}

        {!enabled && (
          <div className="px-4 py-3 rounded-xl bg-bg border border-border text-sm text-text-muted">
            Reranker 未启用，知识库检索将仅使用向量相似度排序。
          </div>
        )}

        <TestResultBanner result={testResult} />
      </div>
      <TabFooter
        onTest={handleTest}
        onSave={handleSave}
        testing={testing}
        saving={saving}
        testDisabled={!enabled}
        saveDisabled={enabled && (!modelId || !baseUrl)}
      />
    </>
  );
}

// ─── Shared Footer ──────────────────────────────────────────────────────────

function TabFooter({ onTest, onSave, testing, saving, testDisabled, saveDisabled }: {
  onTest: () => void;
  onSave: () => void;
  testing: boolean;
  saving: boolean;
  testDisabled?: boolean;
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border mt-5">
      <button
        onClick={onTest}
        disabled={testing || testDisabled}
        className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {testing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            测试中...
          </>
        ) : '连通测试'}
      </button>
      <button
        onClick={onSave}
        disabled={saving || saveDisabled}
        className="px-5 py-2 text-sm bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────────────────

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('llm');
  const [, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab('llm');
      setTestResult(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-border rounded-2xl shadow-xl w-[560px] max-h-[90vh] overflow-hidden flex flex-col relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Server className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-text">模型配置</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg rounded-lg transition-colors text-text-muted hover:text-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text hover:border-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {activeTab === 'llm' && <LLMTab onTestResult={setTestResult} />}
          {activeTab === 'embedding' && <EmbeddingTab onTestResult={setTestResult} />}
          {activeTab === 'reranker' && <RerankerTab onTestResult={setTestResult} />}
        </div>
      </div>
    </div>
  );
}
