import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TierPanel, { type TierConfig } from '../components/aiConsole/TierPanel';

const CATALOG = [
  { id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'deepseek', cost_per_1k_input: 0.002, cost_per_1k_output: 0.008, max_tokens: 200000 },
  { id: 'claude-opus-4', display_name: 'Claude Opus 4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 200000 },
];

const SAMPLE: TierConfig = {
  description: 'Tier 1 description',
  default: 'claude-opus-4',
  retry_on_failure: true,
  max_retries: 2,
  fallback: 'claude-opus-4',
};

const TIER_0: TierConfig = { description: 'Deterministic', default: 'none' };

describe('TierPanel', () => {
  it('lets user edit description', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} catalog={CATALOG} />);
    fireEvent.change(screen.getByTestId('tier-1-description'), { target: { value: '新描述' } });
    expect(onChange).toHaveBeenCalledWith({ ...SAMPLE, description: '新描述' });
  });

  it('default dropdown shows catalog entries', () => {
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={() => {}} catalog={CATALOG} />);
    const sel = screen.getByTestId('tier-1-default') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['deepseek-v4-pro', 'claude-opus-4']));
  });

  it('default dropdown disabled when no catalog', () => {
    const onChange = vi.fn();
    render(
      <TierPanel
        tierName="tier_1"
        value={{ description: '', default: '' }}
        onChange={onChange}
        catalog={[]}
      />
    );
    const sel = screen.getByTestId('tier-1-default') as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
  });

  it('fallback dropdown has empty option for no fallback', () => {
    const onChange = vi.fn();
    render(
      <TierPanel
        tierName="tier_1"
        value={{ ...SAMPLE, fallback: null }}
        onChange={onChange}
        catalog={CATALOG}
      />
    );
    const sel = screen.getByTestId('tier-1-fallback') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toContain('');
  });

  it('tier_0 disables inputs and shows readonly note', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_0" value={TIER_0} onChange={onChange} catalog={CATALOG} readOnly />);
    const desc = screen.getByTestId('tier-0-description') as HTMLInputElement;
    expect(desc.disabled).toBe(true);
    expect(screen.getByTestId('tier-0-readonly-note')).toBeTruthy();
  });
});
