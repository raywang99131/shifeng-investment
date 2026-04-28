const GANGTISE_ACCESS_KEY = import.meta.env.VITE_GANGTISE_ACCESS_KEY || '';
const GANGTISE_SECRET_KEY = import.meta.env.VITE_GANGTISE_SECRET_KEY || '';
const GANGTISE_ACCESS_TOKEN = import.meta.env.VITE_GANGTISE_ACCESS_TOKEN || '';

export const GANGTISE_CONFIG = {
  baseUrl: 'https://open.gangtise.com',
  accessKey: GANGTISE_ACCESS_KEY,
  secretKey: GANGTISE_SECRET_KEY,
  accessToken: GANGTISE_ACCESS_TOKEN,
};

export const API_ENDPOINTS = {
  summary: '/application/open-insight/summary/v2/getList',
  report: '/application/open-insight/report/v1/getList',
  announcement: '/application/open-insight/announcement/v1/getList',
  knowledgeBase: '/application/aiagent/knowledgeBase/v1/query',
};

export const MARKET_CONFIG = {
  aShares: 'aShares',
  hkStocks: 'hkStocks',
  usStocks: 'usStocks',
  usChinaConcept: 'usChinaConcept',
} as const;

export const CATEGORY_CONFIG = {
  earningsCall: 'earningsCall',
  strategyMeeting: 'strategyMeeting',
  fundRoadshow: 'fundRoadshow',
  shareholdersMeeting: 'shareholdersMeeting',
  maMeeting: 'maMeeting',
  specialMeeting: 'specialMeeting',
  companyAnalysis: 'companyAnalysis',
  industryAnalysis: 'industryAnalysis',
  other: 'other',
} as const;

export const SOURCE_CONFIG = {
  meetingPlatform: 1,
  companyAnnouncement: 2,
  networkPlatform: 3,
} as const;

export const SEARCH_TYPE = {
  title: 1,
  fullText: 2,
} as const;

export const RANK_TYPE = {
  comprehensive: 1,
  timeDesc: 2,
} as const;

export const PARTICIPANT_ROLE = {
  management: 'management',
  expert: 'expert',
} as const;