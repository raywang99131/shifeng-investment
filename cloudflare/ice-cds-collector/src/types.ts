export interface Env {
  DB: D1Database;
  CDS_COLLECTOR: DurableObjectNamespace;
  READ_TOKEN: string;
  WRITE_TOKEN: string;
  ENVIRONMENT: 'test' | 'staging' | 'production';
}
