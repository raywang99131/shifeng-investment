import { describe, expect, it } from 'vitest';
import { CDS_SOURCE_COPY, mapCdsCollectionState } from './viewModel';

describe('mapCdsCollectionState', () => {
  it('maps durable collection health to the compact state line without calling model-derived data official', () => {
    expect(mapCdsCollectionState({
      state: 'partial', lastPublishedDate: '2026-08-24', lastCollectedAt: '2026-08-25T00:30:00.000Z', nextAlarmAt: '2026-08-25T01:00:00.000Z',
      partialDates: [{ clearingDate: '2026-08-25', missingCompanies: ['Meta', 'Oracle'] }],
    })).toEqual({
      color: 'warning', label: '部分发布', lastPublishedDate: '2026-08-24', lastCollectedAt: '2026-08-25T00:30:00.000Z', nextAlarmAt: '2026-08-25T01:00:00.000Z',
      missingCompanies: ['Meta', 'Oracle'],
    });
    expect(mapCdsCollectionState({ state: 'healthy' })!.label).toBe('云端每日记录正常');
    expect(mapCdsCollectionState({ state: 'stale' })!.color).toBe('error');
    expect(mapCdsCollectionState({ state: 'source-error' })!.color).toBe('error');
  });

  it('hides the cloud health line for a local-only dashboard and allows clean cloud Excel exports', () => {
    expect(mapCdsCollectionState(undefined)).toBeNull();
  });

  it('uses the fixed source copy instead of legacy snapshot labels', () => {
    expect(CDS_SOURCE_COPY).toBe('截图历史回填 + ICE EOD Price · 模型换算');
  });
});
