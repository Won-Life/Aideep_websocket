import { utilities } from 'nest-winston';
import * as winston from 'winston';

export function createWinstonConsoleTransport() {
  const isProd = process.env.NODE_ENV === 'production';
  return new winston.transports.Console({
    level: isProd ? 'info' : 'silly',
    format: isProd
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      : winston.format.combine(
          winston.format.timestamp(),
          utilities.format.nestLike('AIdeep', { prettyPrint: true })
        )
  });
}
