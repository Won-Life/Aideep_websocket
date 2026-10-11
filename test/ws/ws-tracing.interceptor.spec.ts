import { AsyncLocalStorage } from 'node:async_hooks';
import { ExecutionContext } from '@nestjs/common';
import {
  defer,
  firstValueFrom,
  lastValueFrom,
  of,
  Subject,
  throwError
} from 'rxjs';
import * as tracing from '../../src/tracing';
import tracer from '../../src/tracing';
import { WsTracingInterceptor } from '@global/common/metrics/ws-tracing.interceptor';

jest.mock('../../src/tracing', () => ({
  __esModule: true,
  tracingEnabled: true,
  default: { startSpan: jest.fn(), scope: jest.fn() }
}));

describe('WsTracingInterceptor', () => {
  const interceptor = new WsTracingInterceptor();
  const storage = new AsyncLocalStorage<unknown>();
  let span: { setTag: jest.Mock; finish: jest.Mock };
  const context = {
    getType: () => 'ws',
    switchToWs: () => ({ getPattern: () => 'join_workspace' })
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    (tracing as { tracingEnabled: boolean }).tracingEnabled = true;
    span = { setTag: jest.fn(), finish: jest.fn() };
    (tracer.startSpan as jest.Mock).mockReturnValue(span);
    (tracer.scope as jest.Mock).mockReturnValue({
      activate: (active: unknown, fn: () => unknown) => storage.run(active, fn)
    });
  });

  it('keeps the event scope across asynchronous work and finishes on completion', async () => {
    let childScope: unknown;
    const output = interceptor.intercept(context, {
      handle: () =>
        defer(async () => {
          await Promise.resolve();
          childScope = storage.getStore();
          expect(span.finish).not.toHaveBeenCalled();
          return { ok: true };
        })
    });
    expect(tracer.startSpan).not.toHaveBeenCalled();
    await expect(lastValueFrom(output)).resolves.toEqual({ ok: true });
    expect(childScope).toBe(span);
    expect(span.finish).toHaveBeenCalledTimes(1);
    expect(tracer.startSpan).toHaveBeenCalledWith('websocket.event', {
      tags: {
        'resource.name': 'join_workspace',
        'span.kind': 'server',
        'span.type': 'web',
        'websocket.namespace': '/workspace'
      }
    });
  });

  it('marks failed responses without copying their potentially sensitive message', async () => {
    const value = { ok: false, error: 'private details' };
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: () => of(value) }))
    ).resolves.toBe(value);
    expect(span.setTag.mock.calls).toEqual([
      ['error', true],
      ['error.type', 'WebSocketResponseError']
    ]);
    expect(span.finish).toHaveBeenCalledTimes(1);
  });

  it('propagates observable errors and finishes once', async () => {
    const error = new Error('failed');
    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => error)
        })
      )
    ).rejects.toBe(error);
    expect(span.setTag).toHaveBeenCalledWith('error', error);
    expect(span.finish).toHaveBeenCalledTimes(1);
  });

  it('propagates synchronous handler errors and finishes once', async () => {
    const error = new Error('failed');
    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => {
            throw error;
          }
        })
      )
    ).rejects.toBe(error);
    expect(span.finish).toHaveBeenCalledTimes(1);
  });

  it('finishes when cancelled before completion', () => {
    const source = new Subject();
    const subscription = interceptor
      .intercept(context, { handle: () => source })
      .subscribe();
    expect(span.finish).not.toHaveBeenCalled();
    subscription.unsubscribe();
    expect(span.finish).toHaveBeenCalledTimes(1);
    expect(source.observed).toBe(false);
  });

  it('finishes once when the consumer unsubscribes after the first synchronous value', async () => {
    await firstValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) })
    );
    expect(span.finish).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'http'])('bypasses tracing for %s', async (mode) => {
    (tracing as { tracingEnabled: boolean }).tracingEnabled =
      mode !== 'disabled';
    const ctx =
      mode === 'http'
        ? ({ getType: () => 'http' } as ExecutionContext)
        : context;
    await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of('value') })
    );
    expect(tracer.startSpan).not.toHaveBeenCalled();
  });
});
