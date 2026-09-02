import { ipcMain } from 'electron'
import { describeError } from '../../shared/errors/describeError'
import { Channel } from '../../shared/ipc/channels'
import { fetchCommands } from '../opencode/commandList'
import { checkModels, pingOpencode } from '../opencode/probe'
import { disposeInstance, readOpencodeConfig, writeOpencodeConfig } from '../settings/opencodeConfig'
import type { ServerControlPayload, ServerStatusPayload } from '../../shared/ipc/diagnosticsTypes'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// **활성 프로젝트의 opencode 서버에 묻거나 그 서버를 조작하는** IPC 묶음.
// ProjectBridge 가 300줄 상한에 닿아 갈라냈지만, 경계는 줄 수가 아니라 이 공통점이다 —
// 여덟 채널이 전부 "서버가 있어야 답할 수 있는 것" 이고, 프로젝트 목록 자체와는 무관하다.
// 등록/해제 수명은 여전히 ProjectBridge 의 register()/dispose()(HANDLED_CHANNELS)가 쥔다
// (`projectFsHandlers.ts` 와 같은 규칙).

/**
 * 이 묶음이 바깥에서 받아 오는 것. **전부 함수다** — 활성 프로젝트도 서버 주소도
 * 앱이 도는 중에 바뀌므로 값으로 받으면 등록 시점에 굳는다.
 */
export interface ServerHandlerPorts {
  /** 지금 활성인 프로젝트. 없으면 null — 이 묶음은 전부 활성 기준이라 없으면 답할 것이 없다. */
  activeProject(): ProjectRecord | null
  /** 활성 프로젝트의 서버 주소. 아직 안 떴으면 빈 문자열이다 (`ProjectBridge.serverUrl` 머리말). */
  serverUrl(): string
  /** 세션을 접었다 다시 붙인다 (`ProjectBridgeListener.onReconnect` 와 같은 계약). */
  onReconnect(project: ProjectRecord): Promise<void>
  /** 활성 프로젝트의 서버 상태. 「다시 시작」과 「서버 시작」이 여기서 갈린다 */
  serverStatus(): ServerStatusPayload
  onServerControl(action: 'start' | 'restart' | 'stop'): Promise<void>
}

export function registerServerHandlers(ports: ServerHandlerPorts): void {
  ipcMain.handle(Channel.COMMAND_LIST, async () => {
    // 목록은 **디렉토리마다 다르다** — 활성 프로젝트 경로를 반드시 실어 보낸다
    // (빼면 서버 cwd 의 목록이 온다. commandList.ts 머리말).
    const result = await fetchCommands(ports.serverUrl(), ports.activeProject()?.root ?? '')
    // 못 받아도 빈 목록으로 돌려준다 — 사유만 함께 알린다
    return {
      ok: result.error === undefined,
      commands: result.commands,
      ...(result.error ? { error: result.error } : {}),
    }
  })
  // opencode 자신의 설정 — 활성 프로젝트의 `opencode.json` 하나만 다룬다.
  ipcMain.handle(Channel.OPENCODE_CONFIG_READ, () =>
    readOpencodeConfig(ports.activeProject()?.root ?? '', ports.serverUrl()),
  )
  ipcMain.handle(Channel.OPENCODE_CONFIG_WRITE, (_event, payload: { path: string; content: string }) =>
    writeOpencodeConfig(payload.path, payload.content),
  )
  // instance 를 버리면 설정을 다시 읽는다. **버린 자리에는 세션도 MCP 등록도 없다** —
  // 그래서 곧바로 다시 붙인다 (SESSION_RECONNECT 와 같은 경로).
  ipcMain.handle(Channel.OPENCODE_CONFIG_RELOAD, async () => {
    const active = ports.activeProject()
    if (!active) return { ok: false, error: '열린 프로젝트가 없습니다' }
    const result = await disposeInstance(active.root, ports.serverUrl())
    if (!result.ok) return result
    await ports.onReconnect(active)
    return result
  })
  // 화면이 주소를 실어 보내던 자리다. 이제 고칠 주소가 없다 — 서버는 우리가 띄우고,
  // 진단은 **그 서버**만 본다. (설정 화면에서 주소를 바꿔 저장 전에 확인하던 흐름이
  // 통째로 없어졌다. `shared/settings/appSettings.ts` 의 `opencodeUrl` 제거 근거와 같다.)
  ipcMain.handle(Channel.MODEL_CHECK, async () => {
    const result = await checkModels(ports.serverUrl())
    return { ok: result.ok, message: result.detail }
  })
  ipcMain.handle(Channel.SERVER_PING, () => pingOpencode(ports.serverUrl()))
  ipcMain.handle(Channel.SERVER_STATUS, () => ports.serverStatus())
  // 서버 조작. **실패를 삼키지 않는다** — 실행 파일을 못 찾았다는 사유가 여기로 온다.
  ipcMain.handle(Channel.SERVER_CONTROL, async (_event, payload: ServerControlPayload) => {
    if (ports.activeProject() === null) {
      return { ok: false, error: '열린 프로젝트가 없습니다', status: ports.serverStatus() }
    }
    try {
      await ports.onServerControl(payload.action)
      const status = ports.serverStatus()
      // **떠 있어야 성공이다.** 조작이 예외 없이 끝나도 서버가 없으면 실패다
      // (시작·다시 시작에서 spawn 이 조용히 못 붙는 경우).
      //
      // ⚠️ **`status.running` 으로 재지 않는다.** 그것은 "우리 표에 있나" 일 뿐이라
      // 자식이 SIGKILL 돼도 exit 이 도착하기 전까지 참으로 남는다 — 그때 이 자리는
      // **아무것도 안 하고 성공을 돌려준다** (실측 2026-08-16, contract-qa).
      // 물어야 할 것은 하나다: **그 주소가 지금 응답하나.**
      if (payload.action !== 'stop') {
        const health = await pingOpencode(ports.serverUrl())
        if (!health.ok) {
          return { ok: false, error: `서버가 응답하지 않습니다 — ${health.detail}`, status }
        }
      }
      return { ok: true, status }
    } catch (error) {
      return {
        ok: false,
        error: describeError(error),
        status: ports.serverStatus(),
      }
    }
  })
}
