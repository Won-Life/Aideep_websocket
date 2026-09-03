import { WsEvent } from './ws.event';

/**
 * WsEvent는 Redis pub/sub 페이로드로 가공 없이 실려간다.
 * JSON 라운드트립에서 값이 변하면 분리 전후 클라이언트가 받는 바이트가 달라지므로,
 * 추후 API 서버가 Spring으로 바뀌어도 같은 JSON을 만들 수 있음을 여기서 고정한다.
 */
describe('WsEvent JSON 계약', () => {
  const events: WsEvent[] = [
    {
      type: 'NODE_MOVE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      nodeId: 'node-1',
      x: -42.5,
      y: 1000.123
    },
    {
      type: 'NODE_CREATE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      node: {
        nodeId: 'node-1',
        title: 'Test',
        nodeType: 'PROJECT',
        position: { x: 0, y: 0 },
        data: { dataType: 'MARKDOWN', markdownBody: '# hi' },
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    },
    {
      type: 'NODE_DELETE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      nodeId: 'node-1'
    },
    {
      type: 'NODE_UPDATE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      nodeId: 'node-1',
      patch: { title: '변경', position: { x: 1, y: 2 } }
    },
    {
      type: 'EDGE_CREATE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      edge: {
        edgeId: 'edge-1',
        sourceId: 'node-1',
        targetId: 'node-2',
        sourceHandle: 'right',
        targetHandle: 'left'
      }
    },
    {
      type: 'EDGE_DELETED',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      edgeId: 'edge-1'
    },
    {
      type: 'EDGE_UPDATE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      edgeId: 'edge-1',
      patch: { sourceHandle: 'top' }
    }
  ];

  it.each(events.map((e) => [e.type, e] as const))(
    '%s는 JSON 라운드트립에서 변하지 않는다',
    (_type, event) => {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  );
});
