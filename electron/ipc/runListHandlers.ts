import { ipcMain } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import type { RunListPayload, RunListResultPayload } from '../../shared/ipc/runBridgeSurface'
import { readRunList } from '../run/runListStore'
import { diskFingerprint } from '../run/runManifestDisk'

// 사이드바 「실행」 패널이 목록을 읽는 문. `projectFsHandlers.ts` 와 같은 자리·같은 이유로
// 갈라 뒀다 (`ProjectBridge` 가 300줄 상한에 붙어 있다) — 등록/해제 수명은 그쪽이 쥔다.
//
// **왜 문이 새로 났나**: 목록이 프로젝트 안(AGENTS.md)에서 앱 저장소로 옮겨 갔다
// (`shared/run/runList.ts` 머리말). 프로젝트 밖이라 `PROJECT_READ_FILE` 이 못 닿는다 —
// 그쪽은 열린 프로젝트 안으로만 들어가는 경로 판정을 지고 있고, 그 판정을 느슨하게 하는
// 것보다 경로를 아예 안 받는 문을 하나 내는 편이 안전하다.

export interface RunListHandlerDeps {
  /** 열린 프로젝트의 루트. 닫힌(또는 모르는) 프로젝트면 null */
  rootOf(projectId: string): string | null
  /** 실행 목록 저장소 폴더 (`main.ts` 가 `userData` 에서 짓는다) */
  dir: string
}

export function registerRunListHandlers(deps: RunListHandlerDeps): void {
  ipcMain.handle(
    Channel.RUN_LIST_READ,
    async (_event, payload: RunListPayload): Promise<RunListResultPayload> => {
      const root = deps.rootOf(payload.projectId)
      // 닫힌 프로젝트를 「목록이 없다」로 돌려준다 — 화면은 그 프로젝트를 이미 안 그린다
      if (root === null) return { found: false, entries: [], stale: false }

      const list = await readRunList(deps.dir, root)
      if (list === null) return { found: false, entries: [], stale: false }

      return { found: true, entries: list.entries, stale: await isStale(root, list.manifest) }
    },
  )
}

/**
 * 지문이 달라졌나. **지문이 없으면 묻지 않는다** — 우리가 적은 것이 아닌 목록을 우리 판단으로
 * 덮어쓰자고 청할 이유가 없다 (`RunList.manifest` 머리말).
 */
async function isStale(root: string, manifest: string | null): Promise<boolean> {
  if (manifest === null) return false
  return (await diskFingerprint(root)) !== manifest
}
