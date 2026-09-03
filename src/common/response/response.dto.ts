import { ApiProperty } from '@nestjs/swagger';

export interface ErrorResponse {
  resultType: 'FAIL';
  error: {
    errorCode: string;
    reason: string;
    data: string;
  };
  success: null;
}

export class ResponseHandler<T> {
  @ApiProperty({ example: 'SUCCESS' })
  readonly resultType: 'SUCCESS';

  @ApiProperty({ nullable: true, example: null, type: String })
  readonly error: null;

  @ApiProperty({ description: '실제 사용한 데이터' })
  readonly success: T;

  constructor(data: T) {
    this.resultType = 'SUCCESS';
    this.error = null;
    this.success = data;
  }
}

export const commonError = {
  unauthorized: {
    resultType: 'FAIL' as const,
    error: {
      errorCode: 'AUTH-401',
      reason: '인증되지 않은 요청입니다.',
      data: ''
    },
    success: null
  },
  forbidden: {
    resultType: 'FAIL' as const,
    error: {
      errorCode: 'AUTH-403',
      reason: '권한이 없습니다.',
      data: ''
    },
    success: null
  },
  notFound: {
    resultType: 'FAIL' as const,
    error: {
      errorCode: 'COMMON-404',
      reason: '리소스를 찾을 수 없습니다.',
      data: ''
    },
    success: null
  },
  internalServerError: {
    resultType: 'FAIL' as const,
    error: {
      errorCode: 'COMMON-500',
      reason: '서버 내부 오류가 발생했습니다.',
      data: ''
    },
    success: null
  }
};
