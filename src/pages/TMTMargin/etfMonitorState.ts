export type EtfMarketPhase =
  | 'pre_open'
  | 'morning_session'
  | 'lunch_break'
  | 'afternoon_session'
  | 'post_close'
  | 'closed_day'
  | 'initializing'
  | 'unknown';

export type EtfCalendarQuality =
  | 'confirmed'
  | 'cached'
  | 'weekday_fallback'
  | 'unknown';

export interface EtfMonitoringCopy {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'default';
  detail: string;
}


export function etfMonitoringCopy(
  phase: EtfMarketPhase,
  monitoringActive: boolean,
  calendarQuality: EtfCalendarQuality,
): EtfMonitoringCopy {
  let state: Omit<EtfMonitoringCopy, 'detail'>;

  if (
    monitoringActive
    && (phase === 'morning_session' || phase === 'afternoon_session')
  ) {
    state = { label: '自动监控中', tone: 'success' };
  } else {
    switch (phase) {
      case 'morning_session':
      case 'afternoon_session':
        state = { label: '自动监控暂停', tone: 'error' };
        break;
      case 'pre_open':
        state = { label: '等待开盘', tone: 'default' };
        break;
      case 'lunch_break':
        state = { label: '午休暂停', tone: 'warning' };
        break;
      case 'post_close':
        state = { label: '已收盘', tone: 'default' };
        break;
      case 'closed_day':
        state = { label: '今日休市', tone: 'default' };
        break;
      case 'initializing':
        state = { label: '调度准备中', tone: 'default' };
        break;
      default:
        state = { label: '调度状态未知', tone: 'warning' };
    }
  }

  return {
    ...state,
    detail: calendarQuality === 'weekday_fallback'
      ? '交易日日历降级为工作日判断'
      : '',
  };
}
