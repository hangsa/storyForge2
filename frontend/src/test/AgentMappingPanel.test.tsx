import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AgentMappingPanel from '../components/aiConsole/AgentMappingPanel';
import type { ModelTiersConfig, AgentTaskMapping } from '../api/client';

const TIERS: ModelTiersConfig['tiers'] = {
  tier_1: {
    description: '',
    models: [
      { id: 'deepseek-v4-pro', provider: 'deepseek', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 8192 },
      { id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 8192 },
    ],
    default: 'deepseek-v4-pro',
  },
  tier_0: { description: '', models: [], default: 'none' },
};

const INITIAL: ModelTiersConfig['agent_mapping'] = {
  writer: {
    scene_writing: { tier: 'tier_1', model: 'deepseek-v4-pro', fallback: 'claude-opus-4' } satisfies AgentTaskMapping,
  },
};

describe('AgentMappingPanel', () => {
  it('changing tier resets model and fallback to default', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.change(screen.getByTestId('agent-writer-task-scene_writing-tier'), {
      target: { value: 'tier_0' },
    });
    const next = onChange.mock.calls[0][0];
    expect(next.writer.scene_writing).toEqual({ tier: 'tier_0' });
  });

  it('model dropdown enumerates tier\'s models plus "default"', () => {
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={() => {}}
        tiers={TIERS}
      />,
    );
    const sel = screen.getByTestId('agent-writer-task-scene_writing-model') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain('default');
    expect(values).toEqual(expect.arrayContaining(['deepseek-v4-pro', 'claude-opus-4']));
  });

  it('adds a task under an existing agent', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-add-task'));
    const next = onChange.mock.calls[0][0];
    expect(Object.keys(next.writer)).toHaveLength(2);
  });

  it('removes a task', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-task-scene_writing-remove'));
    const next = onChange.mock.calls[0][0];
    expect(next.writer).toEqual({});
  });

  it('rejects blank task name', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-add-task'));
    const input = screen.getByTestId('agent-writer-new-task-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('agent-writer-new-task-add-button'));
    expect(onChange).not.toHaveBeenCalled();
  });
});