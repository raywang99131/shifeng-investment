import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';

export class CdsCollector extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return Response.json(
      { error: { code: 'NOT_IMPLEMENTED', message: 'Collector is not implemented' } },
      { status: 501 },
    );
  }

  async alarm(): Promise<void> {}
}

const worker: ExportedHandler<Env> = {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'ice-cds-collector' });
    }
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
  },
};

export default worker;
