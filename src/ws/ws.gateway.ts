import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Namespace, Socket } from 'socket.io';
import { instrument } from '@socket.io/admin-ui';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { PresenceStateEvent, WsEvent } from './ws.event';
import { YjsDocManager } from '../yjs/yjs-doc-manager';
import { YjsWsAwarenessService } from '../yjs/yjs-ws-awareness.service';
import { MembershipRepository } from '../membership/membership.repository';
import { PresenceService } from './presence.service';
import { WsMetricsService } from '../common/metrics';
import {
  YJS_EVENT,
  YJS_WS_EVENT,
  yjsRoom,
  yjsWsRoom
} from '../yjs/yjs.constants';

const userRoom = (userId: string) => `user:${userId}`;

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/workspace'
})
export class WsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WsGateway.name);

  @WebSocketServer()
  server: Server;

  /** socketId → 참여 중인 yjs nodeId 집합 */
  private readonly yjsRooms = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly yjsDocManager: YjsDocManager,
    private readonly yjsWsAwareness: YjsWsAwarenessService,
    private readonly membershipRepository: MembershipRepository,
    private readonly presenceService: PresenceService,
    private readonly wsMetrics: WsMetricsService
  ) {}

  // ── 초기화 ────────────────────────────────────────────────────

  afterInit(server: Namespace) {
    // admin-ui는 인증 없이 열리므로 명시적으로 켠 환경에서만 붙인다
    if (process.env.REALTIME_ADMIN_UI !== 'true') return;
    instrument(server.server, {
      auth: false,
      mode: 'development'
    });
  }

  // ── 연결 / 해제 ───────────────────────────────────────────────

  async handleConnection(client: Socket) {
    const token =
      client.handshake.auth?.token ??
      (client.handshake.query?.token as string) ??
      null;

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const userId =
        payload && typeof payload.user_id === 'string' ? payload.user_id : null;

      if (!userId) {
        client.disconnect();
        return;
      }
      client.data.userId = userId;
      client.join(userRoom(userId));
      this.wsMetrics.increment();
    } catch (err) {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (client.data?.userId) {
      this.wsMetrics.decrement();
    }
    const workspaceId = client.data?.workspaceId;
    const userId = client.data?.userId;
    if (workspaceId) {
      client.to(workspaceId).emit('cursor_leave', { userId });

      if (userId) {
        await this.presenceService.removePresence(workspaceId, userId);
        await this.broadcastPresence(workspaceId);
      }
    }

    // Yjs cleanup: 모든 참여 중인 doc에서 제거
    const nodeIds = this.yjsRooms.get(client.id);
    if (nodeIds) {
      for (const nodeId of nodeIds) {
        this.yjsDocManager.removeClient(nodeId, client.id);
      }
      this.yjsRooms.delete(client.id);
    }
  }

  private async broadcastPresence(workspaceId: string): Promise<void> {
    const members = await this.presenceService.listPresence(workspaceId);
    const event: PresenceStateEvent = { workspaceId, members };
    this.server.to(workspaceId).emit('presence_state', event);
  }

  // ── 기존 이벤트 (변경 없음) ───────────────────────────────────

  @SubscribeMessage('join_workspace')
  async handleJoin(
    @MessageBody()
    payload: {
      workspaceId: string;
      userName: string;
      color: string;
      profile?: string | null;
    },
    @ConnectedSocket() client: Socket
  ) {
    this.logger.debug('조인완료');
    const { workspaceId, userName, color, profile = null } = payload;
    const userId = client.data.userId;

    if (!userId) {
      return { ok: false, error: '로그인이 필요합니다.' };
    }

    const membership = await this.membershipRepository.checkWorkspace(
      userId,
      workspaceId
    );

    if (!membership) {
      return { ok: false, error: '워크스페이스 멤버가 아닙니다' };
    }

    client.join(workspaceId);
    client.data.workspaceId = workspaceId;

    // 워크스페이스 awareness 룸 참가
    client.join(yjsWsRoom(workspaceId));

    // Late joiner: 캐싱된 awareness 상태 전송
    const cached = await this.yjsWsAwareness.getCachedAwareness(workspaceId);
    if (cached) {
      client.emit(YJS_WS_EVENT.AWARENESS, {
        workspaceId,
        data: Array.from(new Uint8Array(cached))
      });
    }

    await this.presenceService.upsertPresence(workspaceId, {
      userId,
      userName,
      color,
      profile
    });
    await this.broadcastPresence(workspaceId);

    return { ok: true };
  }

  @SubscribeMessage('node_position_live')
  handleLivePosition(
    @MessageBody()
    payload: { workspaceId: string; nodeId: string; x: number; y: number },
    @ConnectedSocket() client: Socket
  ) {
    client.to(payload.workspaceId).emit('node_position_live', payload);
  }

  @SubscribeMessage('cursor_move')
  handleCursorMove(
    @MessageBody()
    payload: {
      workspaceId: string;
      x: number;
      y: number;
      userName: string;
      color: string;
    },
    @ConnectedSocket() client: Socket
  ) {
    client.to(payload.workspaceId).emit('cursor_move', {
      userId: client.data.userId,
      ...payload
    });
  }

  // ── Yjs CRDT 이벤트 ──────────────────────────────────────────

  @SubscribeMessage(YJS_EVENT.JOIN)
  async handleYjsJoin(
    @MessageBody() payload: { nodeId: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.userId;
    const workspaceId = client.data.workspaceId;

    this.logger.debug(workspaceId);

    if (!userId || !workspaceId) {
      return { ok: false, error: 'join_workspace 먼저 호출하세요' };
    }

    // 권한 확인 (소켓당 캐시 - 동일 연결에서 반복 DB 조회 방지)
    let membership = client.data.membershipCache?.[workspaceId];
    if (membership === undefined) {
      membership = await this.membershipRepository.checkWorkspace(
        userId,
        workspaceId
      );
      client.data.membershipCache = client.data.membershipCache ?? {};
      client.data.membershipCache[workspaceId] = membership ?? null;
    }
    if (!membership) {
      return { ok: false, error: '워크스페이스 멤버가 아닙니다' };
    }

    const readOnly = membership.role === 'VIEWER';
    const { nodeId } = payload;

    // Doc 로드/생성
    const doc = await this.yjsDocManager.getOrCreateDoc(nodeId, workspaceId);

    // Room join + 클라이언트 등록
    client.join(yjsRoom(nodeId));
    this.yjsDocManager.addClient(nodeId, client.id);

    // 소켓별 yjs room 추적
    if (!this.yjsRooms.has(client.id)) {
      this.yjsRooms.set(client.id, new Set());
    }
    this.yjsRooms.get(client.id)!.add(nodeId);

    // nodeId별 readOnly 상태 저장
    client.data.yjsReadOnly = client.data.yjsReadOnly ?? {};
    client.data.yjsReadOnly[nodeId] = readOnly;

    // SyncStep1만 전송: 클라이언트가 자신의 SyncStep2로 응답하면
    // handleYjsSync에서 서버의 SyncStep2를 보내는 표준 핸드셰이크 흐름
    const encoder1 = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder1, doc);
    client.emit(YJS_EVENT.SYNC, {
      nodeId,
      data: Array.from(encoding.toUint8Array(encoder1))
    });

    return { ok: true, readOnly };
  }

  @SubscribeMessage(YJS_EVENT.SYNC)
  handleYjsSync(
    @MessageBody() payload: { nodeId: string; data: Buffer },
    @ConnectedSocket() client: Socket
  ) {
    const { nodeId, data } = payload;
    const doc = this.yjsDocManager.getDoc(nodeId);
    if (!doc) return;

    const update = new Uint8Array(
      Buffer.isBuffer(data)
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data
    );

    const decoder = decoding.createDecoder(update);
    const encoder = encoding.createEncoder();
    const messageType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      doc,
      null
    );

    // 응답이 있으면 (SyncStep2) 요청자에게 전송
    if (encoding.length(encoder) > 0) {
      client.emit(YJS_EVENT.SYNC, {
        nodeId,
        data: Array.from(encoding.toUint8Array(encoder))
      });
    }

    // Update 메시지(messageType === 2)면 다른 클라이언트에 브로드캐스트
    // readSyncMessage가 이미 doc에 적용했으므로 scheduleSave만 호출
    if (messageType === 2) {
      // VIEWER면 update 차단
      if (client.data.yjsReadOnly?.[nodeId]) return;

      client.to(yjsRoom(nodeId)).emit(YJS_EVENT.SYNC, { nodeId, data });
      this.yjsDocManager.scheduleSave(nodeId, client.data.userId);
    }
  }

  @SubscribeMessage(YJS_EVENT.AWARENESS)
  handleYjsAwareness(
    @MessageBody() payload: { nodeId: string; data: Buffer },
    @ConnectedSocket() client: Socket
  ) {
    client.to(yjsRoom(payload.nodeId)).emit(YJS_EVENT.AWARENESS, payload);
  }

  @SubscribeMessage(YJS_EVENT.LEAVE)
  handleYjsLeave(
    @MessageBody() payload: { nodeId: string },
    @ConnectedSocket() client: Socket
  ) {
    const { nodeId } = payload;
    client.leave(yjsRoom(nodeId));
    this.yjsDocManager.removeClient(nodeId, client.id);

    const rooms = this.yjsRooms.get(client.id);
    if (rooms) {
      rooms.delete(nodeId);
      if (rooms.size === 0) this.yjsRooms.delete(client.id);
    }
  }

  // ── 워크스페이스 레벨 Awareness ──────────────────────────────

  @SubscribeMessage(YJS_WS_EVENT.AWARENESS)
  async handleWsAwareness(
    @MessageBody() payload: { workspaceId: string; data: Buffer },
    @ConnectedSocket() client: Socket
  ) {
    const { workspaceId, data } = payload;

    if (!workspaceId || !data) return;

    // 멤버십 검증 (이미 join_workspace를 호출했으면 workspaceId가 세팅됨)
    if (client.data.workspaceId !== workspaceId) return;

    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as unknown as ArrayLike<number>);

    // Redis 캐싱 (30s TTL) + 다른 클라이언트에 relay (병렬)
    await this.yjsWsAwareness.cacheAwareness(workspaceId, buf);
    client.to(yjsWsRoom(workspaceId)).emit(YJS_WS_EVENT.AWARENESS, payload);
  }

  // ── Broadcast (REST → WS) ────────────────────────────────────

  broadcast(event: WsEvent): void {
    // pub/sub 메시지는 모든 인스턴스가 받으므로 자기 소켓에만 emit한다 (다중 인스턴스 중복 전송 방지)
    this.server.local
      .to(event.workspaceId)
      .except(userRoom(event.userId))
      .emit('workspace_event', event);

    // 노드 삭제 시 Yjs doc 정리
    if (event.type === 'NODE_DELETE') {
      this.yjsDocManager.cleanupNode(event.nodeId).catch((err) => {
        this.logger.error(`Yjs cleanup failed for ${event.nodeId}`, err);
      });
    }
  }

  broadcastYjsUpdate(nodeId: string, update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    this.server.to(yjsRoom(nodeId)).emit(YJS_EVENT.SYNC, {
      nodeId,
      data: Array.from(encoding.toUint8Array(encoder))
    });
  }
}
