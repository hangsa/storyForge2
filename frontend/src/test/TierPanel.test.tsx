import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TierPanel, { type TierConfig } from '../components/aiConsole/TierPanel';

const CATALOG = [
  { id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'deepseek', cost_per_1k_input: 0.002, cost_per_1k_output: 0.008, max_tokens: 8192 },
  { id: 'claude-opus-4', display_name: 'Claude Opus 4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 },
];

const SAMPLE: TierConfig = {
  description: 'Tier 1 description',
  models: ['claude-opus-4'],
  default: 'claude-opus-4',
  retry_on_failure: true,
  max_retries: 2,
  fallback: 'claude-opus-4',
};

const TIER_0: TierConfig = { description: 'Deterministic', models: [], default: 'none' };

describe('TierPanel', () => {
  it('lets user edit description', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} catalog={CATALOG} />);
    fireEvent.change(screen.getByTestId('tier-1-description'), { target: { value: '新描述' } });
    expect(onChange).toHaveBeenCalledWith({ ...SAMPLE, description: '新描述' });
  });

  it('default dropdown shows catalog entries plus whitelist items', () => {
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={() => {}} catalog={CATALOG} />);
    const sel = screen.getByTestId('tier-1-default') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['deepseek-v4-pro', 'claude-opus-4']));
  });

  it('adding a model picks from catalog', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={{ ...SAMPLE, models: [] }} onChange={onChange} catalog={CATALOG} />);
    const sel = screen.getByTestId('tier-1-new-model-select') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.click(screen.getByTestId('tier-1-new-model-add'));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.models).toContain('deepseek-v4-pro');
  });

  it('removing a model emits updated whitelist', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} catalog={CATALOG} />);
    fireEvent.click(screen.getByTestId('tier-1-model-0-remove'));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.models).toEqual([]);
  });

  it('tier_0 hides add-model', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_0" value={TIER_0} onChange={onChange} catalog={CATALOG} readOnly />);
    expect(screen.queryByTestId('tier-0-add-model')).toBeNull();
    expect(screen.getByTestId('tier-0-readonly-note')).toBeTruthy();
  });
});