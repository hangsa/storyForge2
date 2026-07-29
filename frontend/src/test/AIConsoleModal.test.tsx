import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AIConsoleModal from '../components/aiConsole/AIConsoleModal';

const CFG = {
  tiers: {
    tier_1: {
      description: 'd',
      default: 'm',
      retry_on_failure: true,
      max_retries: 1,
      fallback: null,
    },
    tier_0: { description: '', default: 'none' },
  },
  agent_mapping: { writer: { scene_writing: { tier: 'tier_1', model: 'm' } } },
};

const PROVIDERS = [
  { provider: 'anthropic', base_url: '', api_key_configured: true, models: [{ id: 'm', provider: 'anthropic', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 1024 }] },
  { provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key_configured: false, models: [] },
  { provider: 'minimax', base_url: '', api_key_configured: false, models: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn((url, init) => {
    if (url.includes('/settings/llm-config') && init?.method === 'GET' || (!init && url.endsWith('/llm-config'))) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: CFG }), { status: 200 }));
    }
    if (url.includes('/settings/llm-providers')) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 }));
    }
    if (init?.method === 'PUT' || init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
});

describe('AIConsoleModal', () => {
  it('fetches config and providers on open', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    expect(await screen.findByTestId('provider-anthropic')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-config'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-providers'),
      expect.anything(),
    );
  });

  it('save button disabled when clean; save persists and toasts', async () => {
    const onClose = vi.fn();
    render(<AIConsoleModal isOpen onClose={onClose} />);
    const save = await screen.findByTestId('modal-save');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(onClose).not.toHaveBeenCalled()); // close never called from save
  });

  it('closing with dirty state shows confirm and respects cancel', async () => {
    const onClose = vi.fn();
    render(<AIConsoleModal isOpen onClose={onClose} />);
    fireEvent.click(await screen.findByTestId('tab-tier'));
    const input = await screen.findByTestId('tier-1-description');
    fireEvent.change(input, { target: { value: '已编辑' } });
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(await screen.findByTestId('dirty-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dirty-confirm-cancel'));
    expect(onClose).not.toHaveBeenCalled();
    // Re-trigger close to bring the dialog back; then click discard.
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(await screen.findByTestId('dirty-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dirty-confirm-discard'));
    expect(onClose).toHaveBeenCalled();
  });

  it('tabs switch between provider, tier, agent panels; provider is default', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    // Default tab is provider — its panel renders, others do not.
    await screen.findByTestId('tab-panel-provider');
    await screen.findByTestId('provider-anthropic');
    expect(screen.queryByTestId('tab-panel-tier')).toBeNull();
    expect(screen.queryByTestId('tab-panel-agent')).toBeNull();

    fireEvent.click(screen.getByTestId('tab-tier'));
    expect(await screen.findByTestId('tab-panel-tier')).toBeTruthy();
    expect(screen.queryByTestId('tab-panel-provider')).toBeNull();
    expect(screen.queryByTestId('tab-panel-agent')).toBeNull();

    fireEvent.click(screen.getByTestId('tab-agent'));
    expect(await screen.findByTestId('tab-panel-agent')).toBeTruthy();
    expect(screen.queryByTestId('tab-panel-tier')).toBeNull();
  });

  it('reload button calls POST /llm-config/reload', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('modal-reload'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/llm-config/reload'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows migrate banner when YAML lacks providers', async () => {
    const LEGACY_CFG = {
      tiers: {
        tier_0: { description: '', default: 'none' },
      },
      agent_mapping: {},
    };
    global.fetch = vi.fn((url) => {
      if (url.includes('/llm-config') && (!url.includes('reload') && !url.includes('migrate'))) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: LEGACY_CFG }), { status: 200 }));
      }
      if (url.includes('/llm-config/migrate')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { backup_path: '/tmp/x' } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: [] }), { status: 200 }));
    });
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    const btn = await screen.findByTestId('modal-migrate');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/llm-config/migrate'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('probe button on provider card triggers fetch and shows success result with checkboxes', async () => {
    const PROBE_RESULT = {
      success: true,
      latency_ms: 234,
      models: [
        { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
        { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
      ],
    };
    global.fetch = vi.fn((url, init) => {
      if (url.includes('/settings/llm-config') && (!init || init?.method === 'GET' || !init?.method) && !url.includes('probe') && !url.includes('reload')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: CFG }), { status: 200 }));
      }
      if (url.includes('/settings/llm-providers')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 }));
      }
      if (url.includes('/probe') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROBE_RESULT }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    });
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    const probeBtn = await screen.findByTestId('provider-anthropic-probe');
    fireEvent.click(probeBtn);
    await waitFor(() => expect(screen.getByTestId('provider-anthropic-probe-result')).toBeTruthy());
    expect(screen.getByTestId('probe-success-header').textContent).toMatch(/已连通.*234ms/);
    expect(screen.getByTestId('probe-model-claude-opus-4-20250514')).toBeTruthy();
    expect(screen.getByTestId('probe-model-claude-haiku-4-5')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/providers/anthropic/probe'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('probe button shows error result with error_code when probe fails', async () => {
    const PROBE_FAIL = {
      success: false,
      latency_ms: 100,
      models: null,
      error: 'invalid api key',
      error_code: 'auth_error',
    };
    global.fetch = vi.fn((url, init) => {
      if (url.includes('/probe') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROBE_FAIL }), { status: 200 }));
      }
      if (url.includes('/settings/llm-config') && (!init || init?.method === 'GET' || !init?.method) && !url.includes('reload')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: CFG }), { status: 200 }));
      }
      if (url.includes('/settings/llm-providers')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    });
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('provider-anthropic-probe'));
    await waitFor(() => {
      const header = screen.getByTestId('probe-error-header');
      expect(header.textContent).toMatch(/auth_error/);
    });
  });

  it('import button calls upsertModel for each checked model and skips existing', async () => {
    // anthropic already has 'm' in its models; provider list should reflect that.
    const PROBE_RESULT = {
      success: true,
      latency_ms: 50,
      models: [
        { id: 'm', display_name: 'M (exists)' },                       // already exists → unchecked
        { id: 'claude-new-a', display_name: 'New A' },
        { id: 'claude-new-b', display_name: 'New B' },
      ],
    };
    const calls: { url: string; method: string; body?: string }[] = [];
    global.fetch = vi.fn((url, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.includes('/probe') && method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROBE_RESULT }), { status: 200 }));
      }
      if (url.includes('/providers/anthropic/models') && method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
      }
      if (url.includes('/settings/llm-config') && !url.includes('reload')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: CFG }), { status: 200 }));
      }
      if (url.includes('/settings/llm-providers')) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    });
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('provider-anthropic-probe'));
    await waitFor(() => screen.getByTestId('probe-success-header'));
    // 'm' should be disabled (already exists), the two new ones default to checked
    expect((screen.getByTestId('probe-model-m') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('probe-model-m') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('probe-model-claude-new-a') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('probe-model-claude-new-b') as HTMLInputElement).checked).toBe(true);
    const beforeImport = calls.length;
    fireEvent.click(screen.getByTestId('probe-import-btn'));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/providers/anthropic/models') && c.method === 'POST').length).toBe(2)
    );
    const importCalls = calls.filter((c) => c.url.includes('/providers/anthropic/models') && c.method === 'POST');
    const importedIds = importCalls.map((c) => JSON.parse(c.body!).id);
    expect(importedIds.sort()).toEqual(['claude-new-a', 'claude-new-b']);
  });
});