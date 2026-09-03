import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import {
  ReferenceObject,
  SchemaObject
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

type DtoInput = Type<any> | SchemaObject;

export const ApiSuccessResponse = (
  dto: DtoInput,
  status = 200,
  description?: string
) => {
  const isClass = typeof dto === 'function';

  const successSchema: SchemaObject | ReferenceObject = isClass
    ? { $ref: getSchemaPath(dto) }
    : dto;

  const responseSchema: SchemaObject = {
    properties: {
      resultType: { type: 'string', example: 'SUCCESS' },
      error: { nullable: true, example: null },
      success: successSchema
    },
    required: ['resultType', 'error', 'success']
  };

  const decorators: (ClassDecorator | MethodDecorator | PropertyDecorator)[] = [
    ApiResponse({ status, description, schema: responseSchema })
  ];

  if (isClass) {
    decorators.unshift(ApiExtraModels(dto));
  }

  return applyDecorators(...decorators);
};
