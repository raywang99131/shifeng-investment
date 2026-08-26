import { describe, expect, it } from 'vitest';
import {
  completedUsBusinessDaysBetween,
  isCollectorStale,
  isUsFederalBusinessDay,
} from '../src/usBusinessDays';

describe('US federal business-day freshness', () => {
  it('excludes weekends and named 2026 federal holidays including observed days', () => {
    expect(isUsFederalBusinessDay('2026-07-02')).toBe(true);
    expect(isUsFederalBusinessDay('2026-07-03')).toBe(false);
    expect(isUsFederalBusinessDay('2026-07-04')).toBe(false);
    expect(isUsFederalBusinessDay('2026-07-05')).toBe(false);
    expect(isUsFederalBusinessDay('2026-07-06')).toBe(true);
    expect(isUsFederalBusinessDay('2026-11-26')).toBe(false);
    expect(isUsFederalBusinessDay('2026-11-27')).toBe(true);
  });

  it.each([
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-10-12',
    '2026-11-11',
    '2026-11-26',
    '2026-12-25',
  ])('treats %s as a 2026 federal non-business day', (holiday) => {
    expect(isUsFederalBusinessDay(holiday)).toBe(false);
  });

  it('becomes stale only after two completed New York business days', () => {
    const lastPublished = '2026-07-02';
    expect(completedUsBusinessDaysBetween(lastPublished, new Date('2026-07-07T16:00:00.000Z'))).toBe(1);
    expect(isCollectorStale(lastPublished, new Date('2026-07-07T16:00:00.000Z'))).toBe(false);

    expect(completedUsBusinessDaysBetween(lastPublished, new Date('2026-07-08T16:00:00.000Z'))).toBe(2);
    expect(isCollectorStale(lastPublished, new Date('2026-07-08T16:00:00.000Z'))).toBe(true);
  });

  it('uses America/New_York rather than UTC to exclude the in-progress local day', () => {
    expect(completedUsBusinessDaysBetween('2026-11-25', new Date('2026-11-27T03:00:00.000Z'))).toBe(0);
    expect(completedUsBusinessDaysBetween('2026-11-25', new Date('2026-11-28T05:00:00.000Z'))).toBe(1);
  });
});
