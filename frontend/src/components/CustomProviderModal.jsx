import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './OmniRouteModal.css';

const CustomModelIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </svg>
);

const CloseIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function parseHeadersText(rawText) {
  const headers = {};
  for (const line of (rawText || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (k && v) headers[k] = v;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function formatHeadersText(headersObj) {
  if (!headersObj || typeof headersObj !== 'object') return '';
  return Object.entries(headersObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function formatLabelBadge(format) {
  if (format === 'anthropic') return 'Anthropic';
  if (format === 'openai-responses') return 'OpenAI Responses';
  return 'OpenAI';
}

export default function CustomProviderModal({
  isOpen,
  onClose,
  onRefreshModels,
  onConnected,
}) {
  const [configuredProviders, setConfiguredProviders] = useState([]);
  const [configError, setConfigError] = useState(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(null);
  const [editingHasKey, setEditingHasKey] = useState(false);

  // Core 4-field Custom Model state
  const [format, setFormat] = useState('openai'); // 'openai' | 'anthropic'
  const [useResponsesApi, setUseResponsesApi] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');

  // Optional Advanced state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [contextWindow, setContextWindow] = useState(128000);
  const [maxTokens, setMaxTokens] = useState(16384);
  const [supportsThinking, setSupportsThinking] = useState(null);
  const [supportsVision, setSupportsVision] = useState(null);
  const [disableStrictTools, setDisableStrictTools] = useState(false);
  const [headersText, setHeadersText] = useState('');

  // Async action states
  const [fetchedModels, setFetchedModels] = useState([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testNotice, setTestNotice] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const resetForm = useCallback(() => {
    setEditingProviderId(null);
    setEditingHasKey(false);
    setFormat('openai');
    setUseResponsesApi(false);
    setDisplayName('');
    setBaseUrl('');
    setApiKey('');
    setModelId('');
    setShowAdvanced(false);
    setContextWindow(128000);
    setMaxTokens(16384);
    setSupportsThinking(null);
    setSupportsVision(null);
    setDisableStrictTools(false);
    setHeadersText('');
    setFetchedModels([]);
    setTestNotice(null);
    setErrorMsg(null);
  }, []);

  const fetchConfiguredProviders = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/models/custom-providers`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.providers) ? data.providers : [];
        setConfiguredProviders(list);
        setConfigError(data.configError || null);
        if (list.length === 0) {
          setIsFormVisible(true);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch custom providers:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setTestNotice(null);
      setFetchedModels([]);
      fetchConfiguredProviders();
    }
  }, [isOpen, fetchConfiguredProviders]);

  const handleStartAdd = () => {
    resetForm();
    setSuccessMsg(null);
    setIsFormVisible(true);
  };

  const handleEditProvider = (entry) => {
    const isAnthropic = entry.format === 'anthropic' || entry.api === 'anthropic-messages';
    const isResponses = entry.format === 'openai-responses' || entry.api === 'openai-responses';
    const primaryModel = Array.isArray(entry.models) && entry.models.length > 0 ? entry.models[0] : null;

    setEditingProviderId(entry.provider);
    setEditingHasKey(Boolean(entry.apiKeyPreview));
    setFormat(isAnthropic ? 'anthropic' : 'openai');
    setUseResponsesApi(isResponses);
    setDisplayName(entry.label || entry.provider);
    setBaseUrl(entry.baseUrl || '');
    setApiKey('');
    setModelId(primaryModel?.id || '');
    setContextWindow(primaryModel?.contextWindow || 128000);
    setMaxTokens(primaryModel?.maxTokens || 16384);
    setSupportsThinking(primaryModel?.reasoning ?? null);
    setSupportsVision(primaryModel?.supportsVision ?? null);
    setDisableStrictTools(Boolean(entry.disableStrictTools));
    setHeadersText(formatHeadersText(entry.headers));
    setFetchedModels(Array.isArray(entry.models) ? entry.models : []);
    setTestNotice(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowAdvanced(false);
    setIsFormVisible(true);
  };

  const handleRemoveProvider = async (targetId) => {
    if (!window.confirm(`Remove "${targetId}"?`)) return;
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/models/custom-providers/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to remove ${targetId}`);
      }
      setSuccessMsg(`Removed ${targetId}.`);
      await fetchConfiguredProviders();
      if (onRefreshModels) await onRefreshModels();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveFormat = format === 'anthropic' ? 'anthropic' : useResponsesApi ? 'openai-responses' : 'openai';

  const buildPayload = ({ testInference = false } = {}) => {
    const trimmedKey = apiKey.trim();
    const trimmedModelId = modelId.trim();
    const headers = parseHeadersText(headersText);

    const models = trimmedModelId
      ? [
          {
            id: trimmedModelId,
            name: trimmedModelId,
            contextWindow: Number(contextWindow) || 128000,
            maxTokens: Number(maxTokens) || 16384,
            ...(supportsThinking !== null ? { reasoning: Boolean(supportsThinking) } : {}),
            ...(supportsVision !== null ? { supportsVision: Boolean(supportsVision) } : {}),
          },
        ]
      : undefined;

    return {
      provider: editingProviderId || undefined,
      name: !editingProviderId ? displayName.trim() || undefined : undefined,
      baseUrl: baseUrl.trim(),
      format: effectiveFormat,
      auth: trimmedKey || (editingProviderId && editingHasKey) ? 'apiKey' : 'none',
      apiKey: trimmedKey || undefined,
      modelId: trimmedModelId || undefined,
      models,
      disableStrictTools: format === 'anthropic' ? true : disableStrictTools,
      headers,
      isEdit: Boolean(editingProviderId),
      testInference,
    };
  };

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      setErrorMsg('Enter Base URL first to fetch available models.');
      return;
    }
    setIsFetchingModels(true);
    setErrorMsg(null);
    setTestNotice(null);
    try {
      const payload = buildPayload({ testInference: false });
      const res = await fetch(`${API_BASE_URL}/api/models/custom-providers/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: payload.baseUrl,
          format: payload.format,
          apiKey: payload.apiKey,
          headers: payload.headers,
          discoveryType: 'openai-models-list',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Could not fetch models from endpoint.');
      }
      const list = Array.isArray(data.models) ? data.models : [];
      setFetchedModels(list);
      if (list.length > 0 && !modelId.trim()) {
        setModelId(list[0].id);
        if (list[0].contextWindow) setContextWindow(list[0].contextWindow);
      }
      setTestNotice({
        title: `Fetched ${list.length} ${list.length === 1 ? 'model' : 'models'} from ${data.baseUrl}`,
        warning: list.length === 0 ? 'Endpoint responded, but returned an empty list. Enter a Model ID manually.' : data.warning,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestModel = async () => {
    if (!baseUrl.trim()) {
      setErrorMsg('Base URL is required.');
      return;
    }
    setIsTesting(true);
    setErrorMsg(null);
    setTestNotice(null);
    try {
      const hasModelId = Boolean(modelId.trim());
      const payload = buildPayload({ testInference: hasModelId });
      const res = await fetch(`${API_BASE_URL}/api/models/custom-providers/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Connection test failed.');
      }
      if (Array.isArray(data.models) && data.models.length > 0) {
        setFetchedModels(data.models);
      }
      setTestNotice({
        title: data.inferenceTested
          ? `Model "${data.testedModel}" responded successfully`
          : `Connection OK · ${data.models?.length || 0} models found at ${data.baseUrl}`,
        warning: data.warning,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveProvider = async (e) => {
    e?.preventDefault();
    if (!baseUrl.trim()) {
      setErrorMsg('Base URL is required.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const payload = buildPayload({ testInference: false });
      const res = await fetch(`${API_BASE_URL}/api/models/custom-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to save custom model.');
      }
      setSuccessMsg(data.message || `Saved ${data.provider} (${data.modelCount} ready).`);
      setIsFormVisible(false);
      resetForm();
      await fetchConfiguredProviders();
      if (onRefreshModels) await onRefreshModels();
      if (onConnected) {
        onConnected({ id: data.provider, name: displayName.trim() || data.provider });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="omni-dialog-root">
      <DialogBackdrop transition className="omni-dialog-backdrop" />

      <div className="omni-dialog-wrapper">
        <DialogPanel transition className="omni-dialog-panel">
          <div className="omni-dialog-header">
            <div className="omni-dialog-header-left">
              <div className="omni-dialog-logo-badge">
                <CustomModelIcon size={18} />
              </div>
              <div className="omni-dialog-header-text">
                <DialogTitle className="omni-dialog-title">Custom Models</DialogTitle>
                <Description className="omni-dialog-description">
                  Connect any OpenAI- or Anthropic-compatible model, gateway, or self-hosted endpoint.
                </Description>
              </div>
            </div>
            <button type="button" className="omni-dialog-close" onClick={onClose} aria-label="Close">
              <CloseIcon size={14} />
            </button>
          </div>

          {configError && (
            <div className="omni-alert omni-alert-destructive">
              <span>models.yml notice: {configError}</span>
            </div>
          )}
          {errorMsg && (
            <div className="omni-alert omni-alert-destructive">
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="omni-alert omni-alert-success">
              <span>{successMsg}</span>
            </div>
          )}

          <div className="omni-dialog-body">
            {/* Saved Custom Endpoints */}
            {configuredProviders.length > 0 && (
              <div className="omni-providers-stack">
                <div className="omni-section-bar">
                  <span className="omni-models-heading">Saved Custom Endpoints ({configuredProviders.length})</span>
                  {!isFormVisible && (
                    <button type="button" className="omni-btn omni-btn-primary omni-btn-sm" onClick={handleStartAdd}>
                      + Add Custom Model
                    </button>
                  )}
                </div>

                {configuredProviders.map((entry) => (
                  <div key={entry.provider} className="omni-connected-card">
                    <div className="omni-connected-header">
                      <div className="omni-connected-title-row">
                        <span className="omni-connected-title">{entry.label || entry.provider}</span>
                        <span className="omni-badge omni-badge-success">
                          <span className="omni-status-dot" />
                          {entry.auth === 'none' ? 'No Key' : 'Key Saved'}
                        </span>
                        <span className="omni-badge omni-badge-secondary">{formatLabelBadge(entry.format)}</span>
                        <span className="omni-badge omni-badge-secondary">
                          {entry.modelCount} {entry.modelCount === 1 ? 'model' : 'models'}
                        </span>
                      </div>
                      <div className="omni-connected-actions">
                        <button
                          type="button"
                          className="omni-btn omni-btn-outline omni-btn-sm"
                          onClick={() => handleEditProvider(entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="omni-btn omni-btn-destructive omni-btn-sm"
                          onClick={() => handleRemoveProvider(entry.provider)}
                          disabled={isSaving}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {entry.baseUrl && (
                      <div className="omni-meta-box">
                        <span className="omni-meta-label">Base URL:</span>
                        <code className="omni-meta-code">{entry.baseUrl}</code>
                      </div>
                    )}

                    {entry.models && entry.models.length > 0 && (
                      <div className="omni-models-chip-grid">
                        {entry.models.slice(0, 10).map((m) => (
                          <code key={m.id} className="omni-model-chip" title={m.id}>
                            {m.id}
                          </code>
                        ))}
                        {entry.models.length > 10 && (
                          <code className="omni-model-chip">+{entry.models.length - 10} more</code>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Minimal 4-Field Custom Model Form */}
            {(isFormVisible || (!isLoadingList && configuredProviders.length === 0)) && (
              <form onSubmit={handleSaveProvider} className="omni-connect-form">
                <div className="omni-field">
                  <label className="omni-label">API Format</label>
                  <div className="omni-segmented">
                    <button
                      type="button"
                      className={`omni-seg-btn ${format === 'openai' ? 'active' : ''}`}
                      onClick={() => {
                        setFormat('openai');
                        setDisableStrictTools(false);
                      }}
                    >
                      OpenAI-Compatible
                    </button>
                    <button
                      type="button"
                      className={`omni-seg-btn ${format === 'anthropic' ? 'active' : ''}`}
                      onClick={() => {
                        setFormat('anthropic');
                        setUseResponsesApi(false);
                        setDisableStrictTools(true);
                      }}
                    >
                      Anthropic-Compatible
                    </button>
                  </div>
                </div>

                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">Name</label>
                    <span className="omni-field-hint">
                      {editingProviderId ? `Provider ID: ${editingProviderId}` : 'Optional (e.g. Work Proxy, Local vLLM)'}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="omni-input"
                    placeholder="My Custom Model"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={Boolean(editingProviderId)}
                  />
                </div>

                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">Base URL</label>
                    <span className="omni-field-hint">
                      {format === 'anthropic' ? 'e.g. https://proxy.example.com/anthropic' : 'e.g. https://api.example.com/v1'}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="omni-input"
                    placeholder={format === 'anthropic' ? 'https://proxy.example.com/anthropic' : 'https://api.example.com/v1'}
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    autoFocus={!editingProviderId}
                  />
                </div>

                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">API Key</label>
                    <span className="omni-field-hint">
                      {editingHasKey ? 'Leave blank to keep existing key' : 'Optional — leave blank if no key required'}
                    </span>
                  </div>
                  <input
                    type="password"
                    className="omni-input"
                    placeholder={editingHasKey ? 'Leave blank to keep existing key' : 'sk-... (optional)'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>

                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">Model ID</label>
                    <span className="omni-field-hint">Type an ID or click Fetch to auto-discover</span>
                  </div>
                  <div className="omni-input-with-action">
                    <input
                      type="text"
                      className="omni-input"
                      placeholder={
                        format === 'anthropic'
                          ? 'claude-sonnet-4-20250514'
                          : 'e.g. gpt-4o or Qwen/Qwen2.5-Coder-32B'
                      }
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="omni-btn omni-btn-outline"
                      onClick={handleFetchModels}
                      disabled={isFetchingModels || isSaving || !baseUrl.trim()}
                    >
                      {isFetchingModels ? 'Fetching...' : 'Fetch'}
                    </button>
                  </div>

                  {fetchedModels.length > 0 && (
                    <div className="omni-models-chip-grid">
                      {fetchedModels.slice(0, 16).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`omni-model-chip omni-model-chip-btn ${modelId.trim() === m.id ? 'active' : ''}`}
                          onClick={() => {
                            setModelId(m.id);
                            if (m.contextWindow) setContextWindow(m.contextWindow);
                          }}
                          title={`Select ${m.id}`}
                        >
                          {m.id}
                        </button>
                      ))}
                      {fetchedModels.length > 16 && (
                        <code className="omni-model-chip">+{fetchedModels.length - 16} more</code>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    className="omni-link-btn"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? 'Hide advanced options ▲' : 'Advanced options ▼'}
                  </button>
                </div>

                {showAdvanced && (
                  <div className="omni-manual-models">
                    <div className="omni-row-2">
                      <div className="omni-field">
                        <label className="omni-label">Context Window (tokens)</label>
                        <input
                          type="number"
                          className="omni-input"
                          value={contextWindow}
                          onChange={(e) => setContextWindow(Number(e.target.value))}
                        />
                      </div>
                      <div className="omni-field">
                        <label className="omni-label">Max Output Tokens</label>
                        <input
                          type="number"
                          className="omni-input"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="omni-checkbox-row">
                      <label className="omni-checkbox-pill">
                        <input
                          type="checkbox"
                          checked={supportsThinking}
                          onChange={(e) => setSupportsThinking(e.target.checked)}
                        />
                        Supports thinking / reasoning
                      </label>
                      <label className="omni-checkbox-pill">
                        <input
                          type="checkbox"
                          checked={supportsVision}
                          onChange={(e) => setSupportsVision(e.target.checked)}
                        />
                        Supports vision / images
                      </label>
                      {format === 'openai' && (
                        <label className="omni-checkbox-pill">
                          <input
                            type="checkbox"
                            checked={useResponsesApi}
                            onChange={(e) => setUseResponsesApi(e.target.checked)}
                          />
                          Use OpenAI Responses API (`/responses`)
                        </label>
                      )}
                      <label className="omni-checkbox-pill">
                        <input
                          type="checkbox"
                          checked={disableStrictTools}
                          onChange={(e) => setDisableStrictTools(e.target.checked)}
                        />
                        Disable strict tool schemas
                      </label>
                    </div>

                    <div className="omni-field">
                      <label className="omni-label">Custom Headers (optional, one `Header: Value` per line)</label>
                      <textarea
                        className="omni-textarea"
                        placeholder="X-Team: platform"
                        value={headersText}
                        onChange={(e) => setHeadersText(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {testNotice && (
                  <div className="omni-probe-box">
                    <span className="omni-models-heading">{testNotice.title}</span>
                    {testNotice.warning && <p className="omni-help-text">{testNotice.warning}</p>}
                  </div>
                )}

                <div className="omni-form-footer">
                  {configuredProviders.length > 0 && (
                    <button
                      type="button"
                      className="omni-btn omni-btn-outline"
                      onClick={() => {
                        setIsFormVisible(false);
                        resetForm();
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="omni-btn omni-btn-outline"
                    onClick={handleTestModel}
                    disabled={isTesting || isSaving || isFetchingModels || !baseUrl.trim()}
                  >
                    {isTesting ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    type="submit"
                    className="omni-btn omni-btn-primary"
                    disabled={isSaving || isTesting || !baseUrl.trim()}
                  >
                    {isSaving ? 'Saving...' : editingProviderId ? 'Save Changes' : 'Save'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
