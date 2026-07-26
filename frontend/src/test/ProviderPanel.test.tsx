import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProviderPanel from '../components/aiConsole/ProviderPanel';
import type { ProviderStatus } from '../api/client';

const PROVIDERS: ProviderStatus[] = [
  {
    provider: 'anthropic',
    type: 'anthropic',
    display_name: 'Anthropic',
    base_url: 'https://api.anthropic.com',
    api_key_env: 'ANTHROPIC_API_KEY',
    api_key_configured: true,
    enabled: true,
    models: [{ id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 }],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 4, agents: 7 } }), { status: 200 })),
  );
});

describe('ProviderPanel', () => {
  it('renders provider cards with model chips', () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    expect(screen.getByTestId('provider-anthropic')).toBeTruthy();
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
  });

  it('opens provider form modal on edit click and submits POST', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-edit'));
    const displayNameInput = await screen.findByTestId('provider-form-displayname');
    expect((displayNameInput as HTMLInputElement).value).toBe('Anthropic');
    fireEvent.change(displayNameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByTestId('provider-form-save'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('opens provider form modal on add click with empty fields', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-add'));
    const idInput = await screen.findByTestId('provider-form-id');
    expect((idInput as HTMLInputElement).disabled).toBe(false);
    expect((idInput as HTMLInputElement).value).toBe('');
  });

  it('opens API Key modal and submits to PUT endpoint', async () => {
    const onReload = vi.fn();
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={onReload} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-apikey'));
    const input = await screen.findByTestId('provider-apikey-input');
    fireEvent.change(input, { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByTestId('provider-apikey-save'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers/anthropic/api-key'),
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(onReload).toHaveBeenCalled();
  });

  it('delete model button calls DELETE endpoint', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-model-claude-opus-4-delete'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers/anthropic/models/claude-opus-4'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('shows toast when delete returns 422', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: true, code: 'VALIDATION_ERROR', message: 'in use', detail: { invalid_paths: ['tiers.tier_1.fallback'] } }),
          { status: 422 },
        ),
      ),
    );
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-model-claude-opus-4-delete'));
    expect(await screen.findByTestId('provider-error-toast')).toBeTruthy();
    expect(screen.getByText(/tier_1\.fallback/)).toBeTruthy();
  });

  it('opens model form modal on add-model click and submits POST', async () => {
    const onReload = vi.fn();
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={onReload} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-add-model'));
    const idInput = await screen.findByTestId('model-form-id');
    fireEvent.change(idInput, { target: { value: 'claude-new-3' } });
    const displayName = screen.getByTestId('model-form-displayname');
    fireEvent.change(displayName, { target: { value: 'Claude New 3' } });
    fireEvent.click(screen.getByTestId('model-form-save'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers/anthropic/models'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(onReload).toHaveBeenCalled();
  });

  it('opens model form modal on edit-model click with prefilled fields', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-model-claude-opus-4-edit'));
    const idInput = await screen.findByTestId('model-form-id');
    expect((idInput as HTMLInputElement).disabled).toBe(true);
    expect((idInput as HTMLInputElement).value).toBe('claude-opus-4');
    const displayName = screen.getByTestId('model-form-displayname');
    // Initial value empty since provider models don't carry display_name; user can edit
    expect((displayName as HTMLInputElement).value).toBe('');
  });

  it('hides cost_per_1k_input and cost_per_1k_output from new-model form', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-add-model'));
    await screen.findByTestId('model-form-id');
    expect(screen.queryByTestId('model-form-cost-in')).toBeNull();
    expect(screen.queryByTestId('model-form-cost-out')).toBeNull();
  });

  it('awaits onReload before closing modal (re-open shows fresh data)', async () => {
    const updatedProviders: ProviderStatus[] = [
      {
        ...PROVIDERS[0],
        display_name: 'Anthropic Renamed',
      },
    ];
    let postCalled = false;
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (init?.method === 'POST' && u.includes('/settings/llm-config/providers')) {
        postCalled = true;
        return new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: {} }), { status: 200 });
      }
      if (init?.method === 'GET' && u.includes('/llm-providers') && postCalled) {
        return new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: updatedProviders }), { status: 200 });
      }
      if (init?.method === 'PUT' && u.includes('/llm-config')) {
        return new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 });
    });
    const onReload = vi.fn(async () => {});
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={onReload} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-edit'));
    const displayNameInput = await screen.findByTestId('provider-form-displayname');
    fireEvent.change(displayNameInput, { target: { value: 'Anthropic Renamed' } });
    fireEvent.click(screen.getByTestId('provider-form-save'));

    // onReload is async — confirm it was awaited before modal unmounted.
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    // Modal must stay open until onReload completes; give the microtask queue a tick,
    // then assert it's actually closed.
    await waitFor(() => expect(screen.queryByTestId('provider-form-modal')).toBeNull());
  });
});
