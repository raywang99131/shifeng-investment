import { DurableObject } from 'cloudflare:workers';
import { COLLECTOR_OBJECT_NAME, collectOnce, importManualInput } from './collector';
import { parseManualImport } from './manualImport';
import { readBoundedJson } from './body';
import { CollectorRepository } from './repository';
import { handleApiRequest } from './api';
import type { Env } from './types';

const REGULAR_INTERVAL_MS = 30 * 60 * 1000;
const FAILURE_INTERVAL_MS = 5 * 60 * 1000;

export class CdsCollector extends DurableObject<Env> {
  private fetchImpl: typeof fetch = fetch;
  private workflowTail: Promise<void> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.handleFetch(request));
  }

  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.origin !== 'https://collector.internal') {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    }
    const now = new Date();
    if (url.pathname === '/ensure-alarm') {
      const nextAlarmAt = await this.ensureAlarm(now);
      await new CollectorRepository(this.env.DB).setNextAlarm(nextAlarmAt, now.toISOString());
      return Response.json({ ok: true, nextAlarmAt });
    }
    if (url.pathname === '/collect-now') {
      const nextAlarmAt = await this.ensureAlarm(now);
      const result = await collectOnce({
        env: this.env,
        triggerKind: 'manual',
        now,
        fetchImpl: this.fetchImpl,
        nextAlarmAt,
        scheduleRetry: () => this.scheduleAlarm(now, FAILURE_INTERVAL_MS),
      });
      return Response.json(result);
    }
    if (url.pathname === '/import') {
      let payload: unknown;
      try { payload = await readBoundedJson(request); } catch {
        return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } }, { status: 400 });
      }
      let manual;
      try { manual = await parseManualImport(payload, now); } catch {
        return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } }, { status: 400 });
      }
      const nextAlarmAt = await this.ensureAlarm(now);
      await new CollectorRepository(this.env.DB).setNextAlarm(nextAlarmAt, now.toISOString());
      const result = await importManualInput({
        env: this.env,
        manual,
        now,
        nextAlarmAt,
        scheduleRetry: () => this.scheduleAlarm(now, FAILURE_INTERVAL_MS),
      });
      return Response.json(result);
    }
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
  }

  async alarm(): Promise<void> {
    return this.enqueue(() => this.runAlarm());
  }

  private async runAlarm(): Promise<void> {
    const now = new Date();
    const nextAlarmAt = await this.scheduleAlarm(now, REGULAR_INTERVAL_MS);
    await collectOnce({
      env: this.env,
      triggerKind: 'alarm',
      now,
      fetchImpl: this.fetchImpl,
      nextAlarmAt,
      scheduleRetry: () => this.scheduleAlarm(now, FAILURE_INTERVAL_MS),
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.workflowTail;
    let release!: () => void;
    this.workflowTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async ensureAlarm(now: Date, delayMs = REGULAR_INTERVAL_MS): Promise<string> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > now.getTime()) return new Date(existing).toISOString();
    return this.scheduleAlarm(now, delayMs);
  }

  private async scheduleAlarm(now: Date, delayMs: number): Promise<string> {
    const next = new Date(now.getTime() + delayMs);
    await this.ctx.storage.setAlarm(next.getTime());
    return next.toISOString();
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    return handleApiRequest(request, env);
  },
  async scheduled(_controller, env, ctx) {
    const id = env.CDS_COLLECTOR.idFromName(COLLECTOR_OBJECT_NAME);
    const stub = env.CDS_COLLECTOR.get(id);
    ctx.waitUntil(stub.fetch('https://collector.internal/ensure-alarm', { method: 'POST' }));
  },
};

export default worker;
