import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsEnum,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export enum NodeContentOperation {
  APPEND_MARKDOWN = 'APPEND_MARKDOWN'
}

export class NodeContentOperationSourceDto {
  @ApiProperty({ enum: ['AGENT'] })
  @IsIn(['AGENT'])
  actorType: 'AGENT';

  @ApiProperty({ example: 'meeting-graph' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  actorId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  meetingId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  chunkId?: string;
}

export class NodeContentOperationBody {
  @ApiProperty({ enum: NodeContentOperation })
  @IsEnum(NodeContentOperation)
  operation: NodeContentOperation;

  @ApiProperty({ maxLength: 100_000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  markdown: string;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @ApiProperty({ type: NodeContentOperationSourceDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => NodeContentOperationSourceDto)
  source: NodeContentOperationSourceDto;
}

export class NodeContentOperationResponse {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  nodeId: string;

  @ApiProperty({ enum: NodeContentOperation })
  operation: NodeContentOperation;

  @ApiProperty()
  previousVersion: number;

  @ApiProperty()
  version: number;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  duplicate: boolean;
}
