import { ipcMain } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import type { ActiveFileNotice } from '../../shared/ipc/extensionPayloads'

// 편집기에서 **보고 있는 파일**을 들고 있다가 확장에 준다.
//
// `extensionBridge.ts` 에서 뽑아 왔다 — 저쪽이 300줄 상한에 닿았고, 이건 하나의 관심사다:
// 렌더러가 알려 준 값을 **쥐는 일**(당김: `workspace.activeFile()`)과 **넘기는 일**
// (밀기: `onActiveFile`).
//
// **값의 주인은 렌더러다** (`src/state/useActiveFileNotice.ts`). main 이 스스로 알아내지
// 않는다 — 열린 탭은 렌더러 상태이고, 여기서 짐작하면 화면과 확장이 서로 다른 파일을 말한다.

/** 확장에 밀어 줄 쪽. `ExtensionService.activeFileChanged` 만 있으면 된다. */
export interface ActiveFileSink {
  activeFileChanged(file: unknown, projectId: string | null): Promise<void>
}

export interface ActiveFileTracker {
  /** 지금 보고 있는 것. 아무것도 안 보고 있으면 null. */
  current(): ActiveFileNotice | null
  /** 채널을 연다. 되돌리는 함수를 준다 (`dispose` 에서 부른다). */
  listen(): () => void
}

/**
 * `on` 이지 `handle` 이 아니다 — 파일을 옮길 때마다 도는 자리라, 왕복을 기다리면
 * 탭 전환이 확장의 느린 조회만큼 느려진다. 밀기가 실패해도 편집기는 그대로 돌아야 한다.
 */
export function createActiveFileTracker(
  sink: ActiveFileSink,
  activeProjectId: () => string | null,
): ActiveFileTracker {
  let current: ActiveFileNotice | null = null

  return {
    current: () => current,
    listen() {
      const handler = (_event: unknown, file: unknown): void => {
        current = toActiveFile(file)
        // 사유는 확장 호스트 로그에 남는다. 여기서 던지면 렌더러 send 가 끊긴다.
        void sink.activeFileChanged(current, activeProjectId()).catch(() => {})
      }
      ipcMain.on(Channel.EXTENSION_ACTIVE_FILE, handler)
      return () => ipcMain.removeListener(Channel.EXTENSION_ACTIVE_FILE, handler)
    },
  }
}

/**
 * 렌더러가 보낸 값의 모양만 확인한다. **아니면 null.**
 *
 * 빈 객체를 만들면 확장이 「경로 없는 파일」을 받는데, 그건 「아무것도 안 보고 있다」와
 * 구분되지 않는다 — 이 레포가 경계하는 조용한 실패다.
 */
export function toActiveFile(value: unknown): ActiveFileNotice | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const path = record['path']
  if (typeof path !== 'string' || path.trim() === '') return null
  const line = record['line']
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? { path, line } : { path }
}
