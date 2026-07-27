import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import UsagePanel from '../components/aiConsole/UsagePanel';
import * as llmConsoleModule from '../api/llmConsole';

vi.mock('../api/llmConsole', () => ({
  llmConsole: {
    getLLMUsage: vi.fn(),
  },
}));

const SAMPLE = [
  {
    timestamp: '2026-07-27T13:42:11.000000',
    agent: 'writer',
    task: 'scene_writing',
    tier: 'tier_2',
    model: 'MiniMax-M3',
    tokens_in: 4218,
    tokens_out: 1056,
    cost: 0.32,
  },
  {
    timestamp: '2026-07-27T13:41:55.000000',
    agent: 'planner',
    task: 'world_generation',
    tier: 'tier_1',
    model: 'deepseek-v4-pro',
    tokens_in: 532,
    tokens_out: 2630,
    cost: 0.022,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UsagePanel', () => {
  it('renders summary stats and table rows from fetched data', async () => {
    (llmConsoleModule.llmConsole.getLLMUsage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE);

    render(<UsagePanel refreshSignal={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('usage-stat-calls')).toHaveTextContent('2');
    });
    // totalTokens = 4218+1056+532+2630 = 8436 → fmtTokens shows "8.4k"
    expect(screen.getByTestId('usage-stat-tokens')).toHaveTextContent('8.4k');
    // totalCost = 0.32 + 0.022 = 0.342 → fmtCost uses 4 decimals
    expect(screen.getByTestId('usage-stat-cost').textContent).toMatch(/0\.342|0\.3/);
    const rows = screen.getAllByTestId('usage-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('writer');
    expect(rows[0]).toHaveTextContent('scene_writing');
  });

  it('shows empty state when there are no records', async () => {
    (llmConsoleModule.llmConsole.getLLMUsage as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    render(<UsagePanel refreshSignal={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('usage-empty')).toBeTruthy();
    });
    expect(screen.queryByTestId('usage-row')).toBeNull();
  });

  it('shows error message when fetch fails', async () => {
    (llmConsoleModule.llmConsole.getLLMUsage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );

    render(<UsagePanel refreshSignal={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('usage-error')).toHaveTextContent('boom');
    });
  });

  it('refresh button re-fetches data', async () => {
    const fn = llmConsoleModule.llmConsole.getLLMUsage as ReturnType<typeof vi.fn>;
    fn.mockResolvedValueOnce(SAMPLE).mockResolvedValueOnce(SAMPLE);

    render(<UsagePanel refreshSignal={0} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('usage-row')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId('usage-refresh'));

    await waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  it('reloads when refreshSignal changes', async () => {
    const fn = llmConsoleModule.llmConsole.getLLMUsage as ReturnType<typeof vi.fn>;
    fn.mockResolvedValue(SAMPLE);

    const { rerender } = render(<UsagePanel refreshSignal={0} />);
    await waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    rerender(<UsagePanel refreshSignal={1} />);
    await waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});