import {
  Controller,
  Post,
  Param,
  UseGuards,
  Body,
  Request,
  Headers
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { ApiSuccessResponse } from 'src/common/response/api-success-response.decorator';
import { NodeContentService } from './node-content.service';
import {
  NodeContentOperationBody,
  NodeContentOperationResponse
} from './dto/nodeContentOperation.dto';

@ApiTags('Node')
@Controller('workspace/:workspaceId/node')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('jwt')
export class NodeContentController {
  constructor(private readonly nodeContentService: NodeContentService) {}

  @Post('/:nodeId/content-operations')
  @ApiOperation({
    summary: '노드 본문 operation 실행',
    description:
      'Agent의 Markdown append 명령을 서버 측 Lexical/Yjs 트랜잭션으로 적용하고 실시간 편집자에게 전파합니다.'
  })
  @ApiParam({ name: 'nodeId', description: '노드 아이디' })
  @ApiSuccessResponse(
    NodeContentOperationResponse,
    200,
    '노드 본문 operation 성공'
  )
  async executeContentOperation(
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: NodeContentOperationBody,
    @Param('nodeId') nodeId: string,
    @Param('workspaceId') workspaceId: string
  ): Promise<NodeContentOperationResponse> {
    return this.nodeContentService.executeContentOperation(
      req.user?.user_id,
      workspaceId,
      nodeId,
      idempotencyKey,
      body
    );
  }
}
