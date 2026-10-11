// Load before NestJS, Winston, pg and Redis so their modules can be patched.
import 'dotenv/config';
import tracer from 'dd-trace';

export const tracingEnabled = process.env.DD_TRACE_ENABLED === 'true';

if (tracingEnabled) {
  tracer.init({
    service: process.env.DD_SERVICE || 'aideep-websocket',
    logInjection: true
  });
  tracer.use('http', {
    blocklist: [/^\/metrics(?:\?|$)/, /^\/healthz(?:\?|$)/]
  });
}

export default tracer;
