// Microsoft 365 Copilot / Azure OpenAI Provider — raw fetch, no SDK
//
// Two modes:
//   1. Azure OpenAI (recommended): set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_KEY + AZURE_OPENAI_DEPLOYMENT
//   2. Microsoft Graph Copilot Chat API (preview): set COPILOT_TENANT_ID + COPILOT_CLIENT_ID + COPILOT_CLIENT_SECRET
//
// Reference: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/copilot-apis-overview

import { LLMProvider } from './provider.mjs';

// ── OAuth2 token cache ───────────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getGraphToken(tenantId, clientId, clientSecret) {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Entra ID token request failed ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _tokenCache.token;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export class CopilotProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'copilot';

    // Azure OpenAI mode
    this.azureEndpoint = config.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT || null;
    this.azureKey = config.azureKey || process.env.AZURE_OPENAI_KEY || null;
    this.azureDeployment = config.azureDeployment || process.env.AZURE_OPENAI_DEPLOYMENT || null;
    this.azureApiVersion = config.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';

    // Microsoft Graph Copilot Chat API mode
    this.tenantId = config.tenantId || process.env.COPILOT_TENANT_ID || null;
    this.clientId = config.clientId || process.env.COPILOT_CLIENT_ID || null;
    this.clientSecret = config.clientSecret || process.env.COPILOT_CLIENT_SECRET || null;

    this.model = config.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    // Determine which backend to use
    this._useAzure = !!(this.azureEndpoint && this.azureKey && this.azureDeployment);
    this._useGraph = !!(this.tenantId && this.clientId && this.clientSecret);
  }

  get isConfigured() {
    return this._useAzure || this._useGraph;
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    if (this._useAzure) return this._completeAzure(systemPrompt, userMessage, opts);
    if (this._useGraph) return this._completeGraph(systemPrompt, userMessage, opts);
    throw new Error('Copilot provider: missing Azure OpenAI or Graph credentials');
  }

  // ── Azure OpenAI ────────────────────────────────────────────────────────
  async _completeAzure(systemPrompt, userMessage, opts) {
    const endpoint = this.azureEndpoint.replace(/\/+$/, '');
    const url = `${endpoint}/openai/deployments/${this.azureDeployment}/chat/completions?api-version=${this.azureApiVersion}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.azureKey,
      },
      body: JSON.stringify({
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(opts.timeout || 60_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Azure OpenAI ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }

  // ── Microsoft Graph Copilot Chat API (preview) ─────────────────────────
  async _completeGraph(systemPrompt, userMessage, opts) {
    const token = await getGraphToken(this.tenantId, this.clientId, this.clientSecret);

    const res = await fetch('https://graph.microsoft.com/beta/copilot/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 90_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Microsoft Graph Copilot ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || data.value || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: 'microsoft-365-copilot',
    };
  }
}
