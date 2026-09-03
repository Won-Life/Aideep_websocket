// uuid@13은 순수 ESM이라 jest(CJS)에서 파싱되지 않으므로 테스트에서는 crypto로 대체
import { randomUUID } from 'crypto';

export const v4 = (): string => randomUUID();
