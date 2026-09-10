// ⚠️ Aideep_backend/src/redis/redis.keys.ts 의 축소 사본입니다.
//    실시간 서버가 실제로 쓰는 키만 남겼습니다. 공유 키의 형식이 바뀌면 양쪽을 함께 갱신해야 합니다.
export const REDIS_KEYS = {
  BLACKLIST: (accessToken: string | undefined) => `blacklist:${accessToken}`,
  MASTER_TOKEN: (userId: string) => `masterToken:${userId}`,
  WORKSPACE_SYNC: (workspaceId: string) => `workspace:sync:${workspaceId}`,
  YJS_DOC: (nodeId: string) => `yjs:doc:${nodeId}`,
  YJS_WS_AWARENESS: (workspaceId: string) => `yjs:ws:awareness:${workspaceId}`,
  NODE_CONTENT_OPERATION: (
    workspaceId: string,
    nodeId: string,
    actorId: string,
    key: string
  ) => `node:content-op:${workspaceId}:${nodeId}:${actorId}:${key}`,
  WS_PRESENCE: (workspaceId: string) => `ws:presence:${workspaceId}`,
  EMBED_JOBS_QUEUE: 'embed_jobs'
};
