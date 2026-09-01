import assert from 'node:assert/strict';
import test from 'node:test';

import { etfMonitoringCopy } from '../src/pages/TMTMargin/etfMonitorState.ts';


test('active session reports automatic monitoring', () => {
  assert.deepEqual(
    etfMonitoringCopy('morning_session', true, 'confirmed'),
    {
      label: '自动监控中',
      tone: 'success',
      detail: '',
    },
  );
});


test('lunch and close explain automatic pause', () => {
  assert.equal(
    etfMonitoringCopy('lunch_break', false, 'confirmed').label,
    '午休暂停',
  );
  assert.equal(
    etfMonitoringCopy('post_close', false, 'confirmed').label,
    '已收盘',
  );
});


test('calendar fallback is visible', () => {
  assert.equal(
    etfMonitoringCopy(
      'morning_session',
      true,
      'weekday_fallback',
    ).detail,
    '交易日日历降级为工作日判断',
  );
});


test('closed day and unknown state are explicit', () => {
  assert.equal(
    etfMonitoringCopy('closed_day', false, 'confirmed').label,
    '今日休市',
  );
  assert.equal(
    etfMonitoringCopy('unknown', false, 'unknown').label,
    '调度状态未知',
  );
});
