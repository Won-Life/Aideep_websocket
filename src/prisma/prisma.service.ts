import {
  Inject,
  Injectable,
  Logger,
  LoggerService,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { getRequestContext } from '../common/context/request.context';
import { SLOW_QUERY_MS, isProduction } from '../common/logging/logging.config';
import { formatPrismaLog } from '../common/logging/log-format';
import {
  transactionStorage,
  setTransactionRunner
} from './transaction.storage';

type QueryParams = {
  operation: string;
  model?: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly nestLogger = new Logger(PrismaService.name);

  private readonly prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: process.env.DATABASE_URL },
      { schema: process.env.DATABASE_SCHEMA } //FIX: 환경변수로 분리
    )
  }).$extends({
    query: {
      $allOperations: (params) => this.logQuery(params as QueryParams)
    }
  });

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly winstonLogger: LoggerService
  ) {}

  get client(): Prisma.TransactionClient {
    return (
      transactionStorage.getStore() ??
      (this.prisma as unknown as Prisma.TransactionClient)
    );
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (transactionStorage.getStore()) {
      return fn();
    }
    return this.prisma.$transaction((tx) =>
      transactionStorage.run(tx as unknown as Prisma.TransactionClient, fn)
    );
  }

  async onModuleInit() {
    setTransactionRunner(this.runInTransaction.bind(this));
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private async logQuery({ operation, model, args, query }: QueryParams) {
    const start = performance.now();
    const label = `${model ?? '?'}.${operation}`;
    const inTransaction = !!transactionStorage.getStore();
    const ctx = getRequestContext();
    const base = {
      label,
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      inTransaction
    };

    try {
      const result = await query(args);
      const ms = performance.now() - start;
      this.log('debug', formatPrismaLog('query', { ...base, ms }));
      if (ms > SLOW_QUERY_MS) {
        this.log('warn', formatPrismaLog('slow', { ...base, ms }));
      }
      return result;
    } catch (err) {
      const ms = performance.now() - start;
      const code =
        err instanceof Prisma.PrismaClientKnownRequestError
          ? err.code
          : err instanceof Error
            ? err.name
            : 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      this.log(
        'error',
        formatPrismaLog('error', { ...base, ms, code, message })
      );
      throw err;
    }
  }

  private log(level: 'debug' | 'warn' | 'error', message: string) {
    const logger = isProduction() ? this.winstonLogger : this.nestLogger;
    const context = PrismaService.name;
    if (level === 'debug') {
      logger.debug?.(message, context);
    } else if (level === 'warn') {
      logger.warn(message, context);
    } else {
      logger.error(message, undefined, context);
    }
  }
}
