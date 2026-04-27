import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Server } from 'lucide-react';
import { fetchLLMSettings, saveLLMSettings, testLLMConnection } from '../services/api';
import type { LLMSettings } from '../services/api';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  kimi: 'Kimi (Moonshot)',
  openai: 'OpenAI',
  minimax: 'MiniMax',
  custom: '自定义 (千问/私有化部署)',
};

const PROVIDER_NEEDS_BASE_URL = new Set(['custom', 'minimax', 'kimi']);

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [provider, setProvider] = useState('kimi');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [providers, setProviders] = useState<string[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testLLMConnection({ provider, model_id: modelId, api_key: apiKey, base_url: baseUrl });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  if (!open) return null;

  const showBaseUrl = provider === 'custom' || PROVIDER_NEEDS_BASE_URL.has(provider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-border rounded-2xl shadow-xl w-[520px] max-h-[90vh] overflow-y-auto relative">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Server className="w-4 h-4 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-text">LLM 模型配置</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg rounded-lg transition-colors text-text-muted hover:text-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="ml-2 text-sm text-text-muted">加载配置中...</span>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {/* Provider */}
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">服务提供商</label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text appearance-none cursor-pointer"
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p] || p}
                  </option>
                ))}
              </select>
              {provider === 'custom' && (
                <p className="mt-1.5 text-xs text-text-muted">
                  适用于千问、DeepSeek 等兼容 OpenAI API 的私有化部署服务
                </p>
              )}
            </div>

            {/* Model ID */}
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">Model ID</label>
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder={defaultModels[provider] || '模型标识'}
                className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text placeholder:text-text-muted"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="text-sm font-medium text-text mb-1.5 block">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 pr-10 outline-none focus:border-primary text-text placeholder:text-text-muted font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Base URL */}
            {showBaseUrl && (
              <div>
                <label className="text-sm font-medium text-text mb-1.5 block">
                  Base URL
                  {provider === 'custom' && <span className="text-danger ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://your-host:8080/v1"
                  className="w-full text-sm bg-bg border border-border rounded-xl px-4 py-2.5 outline-none focus:border-primary text-text placeholder:text-text-muted font-mono"
                />
                {provider === 'custom' && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    私有化部署的服务地址，需包含 /v1 路径
                  </p>
                )}
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm ${
                testResult.ok
                  ? 'bg-success/10 text-success border border-success/20'
                  : 'bg-danger/10 text-danger border border-danger/20'
              }`}>
                {testResult.ok
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                }
                <span className="break-all">{testResult.message}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <button
              onClick={handleTest}
              disabled={testing || !apiKey}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  测试中...
                </>
              ) : (
                '连通测试'
              )}
            </button>

            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                className="px-5 py-2 text-sm text-text-secondary border border-border rounded-xl hover:bg-bg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || (provider === 'custom' && !baseUrl)}
                className="px-5 py-2 text-sm bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
