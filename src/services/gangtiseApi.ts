import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { GANGTISE_CONFIG, API_ENDPOINTS } from '../config/gangtise';

class GangtiseApi {
  private client: AxiosInstance;
  private token: string;

  constructor() {
    this.token = GANGTISE_CONFIG.accessToken;
    this.client = axios.create({
      baseURL: GANGTISE_CONFIG.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        config.headers.Authorization = `Bearer ${this.token}`;
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response.data,
      (error) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
  }

  async getSummaryList(params: SummaryQueryParams): Promise<SummaryResponse> {
    const config: AxiosRequestConfig = {
      url: API_ENDPOINTS.summary,
      method: 'POST',
      data: params,
    };
    return this.client.request(config);
  }

  async getReportList(params: ReportQueryParams): Promise<ReportResponse> {
    const config: AxiosRequestConfig = {
      url: API_ENDPOINTS.report,
      method: 'POST',
      data: params,
    };
    return this.client.request(config);
  }

  async getAnnouncementList(params: AnnouncementQueryParams): Promise<AnnouncementResponse> {
    const config: AxiosRequestConfig = {
      url: API_ENDPOINTS.announcement,
      method: 'POST',
      data: params,
    };
    return this.client.request(config);
  }

  async queryKnowledgeBase(params: KnowledgeBaseQueryParams): Promise<KnowledgeBaseResponse> {
    const config: AxiosRequestConfig = {
      url: API_ENDPOINTS.knowledgeBase,
      method: 'POST',
      data: params,
    };
    return this.client.request(config);
  }
}

export interface SummaryQueryParams {
  from?: number;
  size?: number;
  startTime?: string;
  endTime?: string;
  searchType?: number;
  rankType?: number;
  keyword?: string;
  sourceList?: number[];
  researchAreaList?: string[];
  securityList?: string[];
  institutionList?: string[];
  categoryList?: string[];
  marketList?: string[];
  participantRoleList?: string[];
}

export interface SummaryResponse {
  code: string;
  msg: string;
  status: boolean;
  data: {
    total: number;
    list: SummaryItem[];
  };
}

export interface SummaryItem {
  summaryId: string;
  title: string;
  translatedTitle?: string;
  brief: string;
  translatedBrief?: string;
  summaryTime: string;
  publishTime: string;
  source: number;
  categoryList: string[];
  institutionList: Institution[];
  securityList: Security[];
  researchAreaList: ResearchArea[];
  conceptList: Concept[];
  marketList: string[];
  guest: string;
  participantRoleList: string[];
}

export interface Institution {
  institutionId: string;
  institutionName: string;
}

export interface Security {
  securityCode: string;
  securityName: string;
}

export interface ResearchArea {
  researchAreaId: string;
  researchAreaName: string;
}

export interface Concept {
  conceptId: string;
  conceptName: string;
}

export interface ReportQueryParams {
  from?: number;
  size?: number;
  startTime?: string;
  endTime?: string;
  searchType?: number;
  rankType?: number;
  keyword?: string;
  sourceList?: number[];
  researchAreaList?: string[];
  securityList?: string[];
  institutionList?: string[];
  reportTypeList?: string[];
  marketList?: string[];
}

export interface ReportResponse {
  code: string;
  msg: string;
  status: boolean;
  data: {
    total: number;
    list: ReportItem[];
  };
}

export interface ReportItem {
  reportId: string;
  title: string;
  translatedTitle?: string;
  brief: string;
  translatedBrief?: string;
  reportTime: string;
  publishTime: string;
  source: number;
  reportType: string;
  institutionList: Institution[];
  securityList: Security[];
  researchAreaList: ResearchArea[];
  conceptList: Concept[];
  marketList: string[];
  author: string;
}

export interface AnnouncementQueryParams {
  from?: number;
  size?: number;
  startTime?: string;
  endTime?: string;
  keyword?: string;
  securityList?: string[];
  categoryList?: string[];
  marketList?: string[];
}

export interface AnnouncementResponse {
  code: string;
  msg: string;
  status: boolean;
  data: {
    total: number;
    list: AnnouncementItem[];
  };
}

export interface AnnouncementItem {
  announcementId: string;
  title: string;
  brief: string;
  announcementTime: string;
  publishTime: string;
  security: Security;
  category: string;
  marketList: string[];
}

export interface KnowledgeBaseQueryParams {
  query: string;
  topK?: number;
  filters?: Record<string, unknown>;
}

export interface KnowledgeBaseResponse {
  code: string;
  msg: string;
  status: boolean;
  data: {
    results: KnowledgeBaseItem[];
  };
}

export interface KnowledgeBaseItem {
  content: string;
  source: string;
  score: number;
}

export const gangtiseApi = new GangtiseApi();
export default gangtiseApi;