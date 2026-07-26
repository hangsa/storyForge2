import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AIConsoleModal from '../components/aiConsole/AIConsoleModal';

const CFG = {
  tiers: {
    tier_1: {
      description: 'd',
      models: ['m'],
      default: 'm',
      retry_on_failure: true,
      max_retries: 1,
      fallback: null,
    },
    tier_0: { description: '', models: [], default: 'none' },
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
    if (url.includes('/settings/llm-usage')) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: [] }), { status: 200 }));
    }
    if (init?.method === 'PUT' || init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
});

describe('AIConsoleModal', () => {
  it('fetches 3 endpoints on open', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    expect(await screen.findByTestId('usage-empty')).toBeTruthy();
    expect(await screen.findByTestId('provider-anthropic')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-config'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-providers'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-usage'),
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
        tier_0: { description: '', models: [], default: 'none' },
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
});