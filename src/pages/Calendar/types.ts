export type CalendarTrack = 'macro' | 'earnings' | 'a-share';
export type CalendarEventStatus = 'scheduled' | 'estimated' | 'confirmed' | 'released' | 'cancelled';

export interface CalendarEvent {
  id: string;
  date: string;
  track: CalendarTrack;
  title: string;
  endDate?: string;
  startAt?: string;
  timezone?: string;
  time?: string;
  timing?: string;
  country?: string;
  code?: string;
  period?: string;
  category?: string;
  description?: string;
  source?: string;
  url?: string;
  importance: number;
  status?: CalendarEventStatus;
  important?: boolean;
  subsetHit?: boolean;
  subsets?: string[];
  previous?: string;
  forecast?: string;
  actual?: string;
  impact?: string;
  epsEstimate?: string;
  revenueEstimate?: string;
  currency?: string;
}

export interface CalendarTrackGroups {
  macro: CalendarEvent[];
  earnings: CalendarEvent[];
  'a-share': CalendarEvent[];
}
