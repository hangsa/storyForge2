import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TierPanel, { type TierConfig } from '../components/aiConsole/TierPanel';

const SAMPLE: TierConfig = {
  description: 'Tier 1 description',
  models: [
    { id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 },
  ],
  default: 'claude-opus-4',
  retry_on_failure: true,
  max_retries: 2,
  fallback: 'claude-opus-4',
};

const TIER_0: TierConfig = { description: 'Deterministic', models: [], default: 'none' };

describe('TierPanel', () => {
  it('lets user edit description', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('tier-1-description'), { target: { value: '新描述' } });
    expect(onChange).toHaveBeenCalledWith({ ...SAMPLE, description: '新描述' });
  });

  it('adds a model when add-model is clicked', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={{ ...SAMPLE, models: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('tier-1-add-model'));
    expect(onChange.mock.calls[0][0].models).toHaveLength(1);
  });

  it('removes a model when remove-model is clicked', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('tier-1-model-0-remove'));
    expect(onChange.mock.calls[0][0].models).toHaveLength(0);
  });

  it('tier_0 hides add-model and model edit controls', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_0" value={TIER_0} onChange={onChange} readOnly />);
    expect(screen.queryByTestId('tier_0-add-model')).toBeNull();
    expect(screen.getByTestId('tier-0-readonly-note')).toBeTruthy();
  });
});
