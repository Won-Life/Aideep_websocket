jest.mock('dotenv/config', () => ({}));
jest.mock('dd-trace', () => ({
  __esModule: true,
  default: { init: jest.fn(), use: jest.fn() }
}));

describe('Datadog initialization', () => {
  const original = process.env.DD_TRACE_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.DD_TRACE_ENABLED;
    else process.env.DD_TRACE_ENABLED = original;
  });

  it.each([undefined, 'false', 'true'])(
    'initializes only when explicitly enabled: %s',
    (value) => {
      if (value === undefined) delete process.env.DD_TRACE_ENABLED;
      else process.env.DD_TRACE_ENABLED = value;
      jest.isolateModules(() => {
        const tracer = require('dd-trace').default;
        tracer.init.mockClear();
        tracer.use.mockClear();
        const module = require('../../src/tracing');
        expect(module.tracingEnabled).toBe(value === 'true');
        expect(tracer.init).toHaveBeenCalledTimes(value === 'true' ? 1 : 0);
        if (value === 'true') {
          const blocklist: RegExp[] = tracer.use.mock.calls[0][1].blocklist;
          expect(
            blocklist.some((pattern) => pattern.test('/metrics?x=1'))
          ).toBe(true);
          expect(blocklist.some((pattern) => pattern.test('/healthz'))).toBe(
            true
          );
          expect(
            blocklist.some((pattern) => pattern.test('/aideep/api/nodes'))
          ).toBe(false);
        }
      });
    }
  );
});
