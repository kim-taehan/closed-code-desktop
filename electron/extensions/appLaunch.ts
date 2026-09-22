import { app, utilityProcess } from 'electron'
import * as path from 'node:path'
import { startExtensionHost } from './appHost'
import type { ExtensionService } from './service'
import type { AskResult } from './chatAsk'
import type { ExtensionAskText } from './serviceDispatch'
import type { SettingsStore } from '../settings/settingsStore'
import type { ProjectRegistry } from '../projects/projectRegistry'
import { createProjectExtensions, type ProjectExtensionsPort } from './projectExtensions'
import type { UiPorts } from './uiRouter'
import type { OpencodeServerPool } from '../opencode/serverPool'
import { ExtensionAiRuns } from '../opencode/extensionRun'
import { ExtensionSessionStore, useExtensionSessionStore } from '../opencode/extensionSessions'

// 확장 호스트 기동. 판단은 전부 `appHost.ts` 에 있고 여기서는 앱 상태만 잇는다.
// `main.ts` 가 300줄 상한에 닿아 그대로 옮겨 왔다 — **판단은 하나도 오지 않았다.**
//
// ⚠️ **여기 오는 것은 전부 함수다.** 확장 호스트는 앱 수명이고 창·브리지는 창 수명이라,
// 값으로 받아 굳히면 창을 되살린 뒤 죽은 세대를 바라본다 (`mcp/appWiring.ts` 와 같은 함정).
// **예외는 `ui` 하나다** — 그 객체 자체가 앱 수명이고, 창 쪽은 그 안에 붙었다 떨어진다 (`uiRouter.ts`).

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
  /** 웹뷰 탭의 행선지. **앱 수명이라 값으로 받는다** — 창 쪽은 붙었다 떨어진다 (`uiRouter.ts`) */
  ui: UiPorts
  /** 프로젝트마다 띄우는 opencode 서버. `ui` 와 같은 이유로 값이다 — 앱 수명이다 */
  servers: Pick<OpencodeServerPool, 'urlFor'>
}

export function launchExtensionHost(deps: ExtensionHostDeps): ExtensionService | null {
  // 확장 AI 세션 장부. 이력 숨김·지우기 정리도 같은 장부를 본다 — 그래서 앱에 하나를 건다
  const sessions = new ExtensionSessionStore(path.join(app.getPath('userData'), 'extension-ai-sessions.json'))
  useExtensionSessionStore(sessions)
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
    projects: appProjectExtensions(deps.registry, deps.settings),
    ui: deps.ui,
    ai: new ExtensionAiRuns({
      sessions,
      // 그 프로젝트의 서버에 묻는다. 레지스트리에 없는 프로젝트면 던진다 — 루트를 모르면 세션을 못 세운다
      server: async (projectId) => {
        const project = deps.registry()?.all.find((candidate) => candidate.id === projectId)
        if (project === undefined) throw new Error(`ai.run: 모르는 프로젝트입니다: ${projectId}`)
        return { url: await deps.servers.urlFor(project.id, project.root), directory: project.root }
      },
      log: (line) => console.log(line),
    }),
    log: (line) => console.log(line),
  })
  return started.service
}

/**
 * 프로젝트마다 켠 확장 (`projectExtensions.ts`). 호스트(싣기·목록·거절)와 브리지(켜기·지우기)가
 * 각자 만든다 — 상태는 레지스트리 하나에 살아 둘이 어긋나지 않는다.
 *
 * 옛 앱 전체 「꺼 둔 이름」은 **이전에만** 읽는다. 호스트가 설정보다 먼저 뜰 수 있어 없으면
 * 빈 목록으로 둔다 (꺼 둔 것이 없던 것으로 옮긴다).
 */
export function appProjectExtensions(
  registry: () => ProjectRegistry | null,
  settings: () => SettingsStore | null,
): ProjectExtensionsPort {
  return createProjectExtensions({
    registry,
    legacyDisabled: async () => (await settings()?.load())?.disabledExtensions ?? [],
    log: (line) => console.log(line),
  })
}
