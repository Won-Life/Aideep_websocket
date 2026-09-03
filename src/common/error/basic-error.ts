import { ApiProperty } from '@nestjs/swagger';

export class BasicError<T = string> extends Error {
  readonly status: number;
  readonly code: string;
  readonly description: T;

  constructor(status: number, code: string, message: string, description: T) {
    super(message);
    this.status = status;
    this.code = code;
    this.description = description;
    this.name = 'BasicError';
  }

  toJSON() {
    return {
      resultType: 'FAIL',
      error: {
        errorCode: this.code,
        reason: this.message,
        data: this.description,
      },
      success: null,
    };
  }
}
