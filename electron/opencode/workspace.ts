import { Action, Kind, WorkspaceState } from '../../shared/protocol/kinds'
import type { ModelRef, OpencodeClient } from './client'

// workspace_sync 봉투 → opencode 세션 생성.
//
// `transport.ts` 에서 갈라냈다 (300줄 상한). davis 의 "워크스페이스를 알린다" 와
// opencode 의 "세션을 만든다" 가 같은 자리인 것이 이 번역의 전부다 —
// directory 가 곧 워크스페이스이자 설정 조회 범위다 (`client.providers` 주석).

export interface WorkspaceSyncResult {
  /** 위층에 그대로 밀어 넣을 봉투 */
  frame: Record<string, unknown>
  /** 세션이 만들어졌을 때만. 실패면 null 이고 어댑터의 sessionId 는 그대로 둔다. */
  session: { id: string; model: ModelRef | null; directory: string } | null
}

export async function syncWorkspace(
  client: OpencodeClient,
  data: Record<string, unknown>,
  options: { model?: ModelRef; agent?: string },
): Promise<WorkspaceSyncResult> {
  const workspace = (data['workspace'] ?? {}) as Record<string, unknown>
  const directory = typeof workspace['workspacePath'] === 'string' ? workspace['workspacePath'] : ''
  if (!directory) {
    return {
      frame: {
        kind: Kind.WORKSPACE,
        action: Action.ERROR,
        data: { code: 'NO_WORKSPACE', message: 'workspacePath 가 비어 있습니다' },
      },
      session: null,
    }
  }
  const session = await client.createSession({
    directory,
    ...(options.model ? { model: options.model } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
  })
  return {
    frame: { kind: Kind.WORKSPACE, action: Action.WORKSPACE_STATE, data: { state: WorkspaceState.READY } },
    session: { ...session, directory },
  }
}
