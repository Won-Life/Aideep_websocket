import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export interface ApiErrorResponseOptions {
  errorCode?: string;
  description?: string;
  data?: unknown;
}

export const ApiErrorResponse = (
  status: number,
  reason: string,
  options: ApiErrorResponseOptions = {}
) => {
  const errorCode = options.errorCode ?? `HTTP-${status}`;
  const data = options.data ?? '';

  const responseSchema: SchemaObject = {
    properties: {
      resultType: { type: 'string', example: 'FAIL' },
      error: {
        type: 'object',
        properties: {
          errorCode: { type: 'string', example: errorCode },
          reason: { type: 'string', example: reason },
          data: { example: data }
        },
        required: ['errorCode', 'reason', 'data']
      },
      success: { nullable: true, example: null }
    },
    required: ['resultType', 'error', 'success']
  };

  return applyDecorators(
    ApiResponse({
      status,
      description: options.description ?? reason,
      schema: responseSchema
    })
  );
};
