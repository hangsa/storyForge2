import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import UsageRecentTable, { type UsageRecord } from '../components/aiConsole/UsageRecentTable';

const SAMPLE: UsageRecord[] = [
  {
    timestamp: '2026-07-26T10:00:00Z',
    agent: 'writer',
    task: 'scene_writing',
    tier: 'tier_1',
    model: 'deepseek-v4-pro',
    tokens_in: 1000,
    tokens_out: 500,
    cost: 0.012,
  },
];

describe('UsageRecentTable', () => {
  it('renders empty state when no records', () => {
    render(<UsageRecentTable records={[]} />);
    expect(screen.getByTestId('usage-empty')).toBeTruthy();
  });

  it('renders one row per record', () => {
    render(<UsageRecentTable records={SAMPLE} />);
    expect(screen.getAllByTestId('usage-row')).toHaveLength(1);
    expect(screen.getByText('writer · scene_writing')).toBeTruthy();
    expect(screen.getByText('tier_1 / deepseek-v4-pro')).toBeTruthy();
  });
});