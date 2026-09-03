import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '../generated/prisma/client';

export const transactionStorage =
  new AsyncLocalStorage<Prisma.TransactionClient>();

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;
let _runner: Runner | null = null;

export const setTransactionRunner = (runner: Runner) => {
  _runner = runner;
};

export function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (!_runner) {
    throw new Error('PrismaService가 아직 초기화되지 않았습니다.');
  }
  return _runner(fn);
}
