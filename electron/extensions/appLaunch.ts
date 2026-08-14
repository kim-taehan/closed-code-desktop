import { app, utilityProcess } from 'electron'
import * as path from 'node:path'
import { startExtensionHost } from './appHost'
import type { ExtensionService } from './service'
import type { AskResult } from './chatAsk'
import type { ExtensionAskText } from './serviceDispatch'
import type { SettingsStore } from '../settings/settingsStore'
import type { ProjectRegistry } from '../projects/projectRegistry'

// 확장 호스트 기동. 판단은 전부 `appHost.ts` 에 있고 여기서는 앱 상태만 잇는다.
// `main.ts` 가 300줄 상한에 닿아 그대로 옮겨 왔다 — **판단은 하나도 오지 않았다.**
//
// ⚠️ **여기 오는 것은 전부 함수다.** 확장 호스트는 앱 수명이고 창·브리지는 창 수명이라,
// 값으로 받아 굳히면 창을 되살린 뒤 죽은 세대를 바라본다 (`mcp/appWiring.ts` 와 같은 함정).

/** 창 수명 물건들을 그때그때 읽는 창구. 창이 없으면 `null` 이고, 그 처리는 아래에서 한다. */
export interface ExtensionHostDeps {
  registry: () => ProjectRegistry | null
  /** 확장이 물으면 그 프로젝트의 채팅에 턴을 만든다. 창이 없으면 null */
  askViaChat: (projectId: string | null, prompt: string) => Promise<AskResult> | null
  /** 렌더러가 알려 준 마지막 활성 파일 */
  activeFile: () => unknown
  /** 물음창. 창이 없으면 null */
  askText: (options: Parameters<ExtensionAskText>[0]) => ReturnType<ExtensionAskText> | null
  settings: () => SettingsStore | null
}

export function launchExtensionHost(deps: ExtensionHostDeps): ExtensionService | null {
  const started = startExtensionHost({
    userDataDir: app.getPath('userData'),
    entryPath: path.join(__dirname, 'hostEntry.js'),
    // 실제 utilityProcess 결선은 이 한 줄뿐이다 — host.ts 는 fork 를 주입받아
    // vitest(node 환경, electron 이 가짜)에서도 그대로 돈다.
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, args, options),
    registry: deps.registry,
    // 확장이 물으면 **그 프로젝트의 채팅에 턴을 만들어** 묻는다 (설계 2026-08-13).
    // 창이 없으면 브리지도 없다 — 그 경우 거절이 돌아간다.
    askViaChat: (projectId, prompt) =>
      deps.askViaChat(projectId, prompt) ??
      Promise.resolve({ status: 'rejected' as const, reason: '창이 없습니다' }),
    // 보고 있는 파일은 **브리지**가 쥔다. 브리지는 창과 함께 생기고 이 호스트는 앱과 함께
    // 뜨므로, 값이 아니라 함수로 넘긴다 — 여기서 굳히면 늘 「없음」이다.
    activeFile: deps.activeFile,
    // 물음창도 브리지(=창)가 쥔다. 창이 없으면 물을 곳이 없으니 사유와 함께 거절한다 —
    // 조용히 취소로 눙치면 확장은 사람이 닫은 줄 알고 아무 말도 하지 않는다.
    askText: (options) => deps.askText(options) ?? Promise.reject(new Error('물어볼 창이 없습니다')),
    // 호스트가 설정보다 먼저 뜰 수 있어 없으면 빈 목록으로 둔다 (전부 켜진 상태).
    disabledNames: async () => (await deps.settings()?.load())?.disabledExtensions ?? [],
    log: (line) => console.log(line),
  })
  return started.service
}
