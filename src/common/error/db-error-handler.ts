import { Prisma } from '../../generated/prisma/client';
import { BasicError } from './basic-error';

export class DatabaseUniqueConstraintError extends BasicError {
  constructor(description = '') {
    super(409, 'DB-P2002', '이미 존재하는 데이터입니다.', description);
    this.name = 'DatabaseUniqueConstraintError';
  }
}

export class DatabaseForeignKeyError extends BasicError {
  constructor(description = '') {
    super(400, 'DB-P2003', '참조하는 데이터가 존재하지 않습니다.', description);
    this.name = 'DatabaseForeignKeyError';
  }
}

export class DatabaseRecordNotFoundError extends BasicError {
  constructor(description = '') {
    super(404, 'DB-P2025', '요청한 데이터를 찾을 수 없습니다.', description);
    this.name = 'DatabaseRecordNotFoundError';
  }
}

export function handleDbError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(', ')
      : String(error.meta?.target ?? '');

    switch (error.code) {
      case 'P2002':
        throw new DatabaseUniqueConstraintError(
          `유니크 제약 조건 위반: ${target}`,
        );
      case 'P2003':
        throw new DatabaseForeignKeyError(
          `외래키 제약 조건 위반: ${target}`,
        );
      case 'P2025':
        throw new DatabaseRecordNotFoundError(
          `레코드를 찾을 수 없습니다.`,
        );
      default:
        throw new BasicError(
          500,
          `DB-${error.code}`,
          '데이터베이스 오류가 발생했습니다.',
          error.message,
        );
    }
  }

  throw error;
}
