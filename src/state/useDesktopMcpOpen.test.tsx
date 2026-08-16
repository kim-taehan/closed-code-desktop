// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ProjectHandler } from '../../shared/ipc/desktopBridge'
import type { DesktopMcpOpenFilePayload, DesktopMcpOpenTerminalPayload } from '../../shared/ipc/channels'
import { useDesktopMcpOpen } from './useDesktopMcpOpen'

// **겉봉을 벗기는 쪽의 프로젝트 확인.** main 이 이미 같은 판정을 하지만
// (`electron/mcp/tools.ts`), 그 판정과 프레임 도착 사이에 사용자가 탭을 옮길 수 있다.
// 셸 칸은 앱 하나를 나눠 쓰므로 여기서 놓치면 **지금 보고 있는 프로젝트의 칸**이 펴진다.

let fileHandler: ProjectHandler<DesktopMcpOpenFilePayload> | null = null
let terminalHandler: ProjectHandler<DesktopMcpOpenTerminalPayload> | null = null

beforeEach(() => {
  fileHandler = null
  terminalHandler = null
  window.davis = {
    onDesktopMcpOpenFile: (handler: ProjectHandler<DesktopMcpOpenFilePayload>) => {
      fileHandler = handler
      return () => {
        fileHandler = null
      }
    },
    onDesktopMcpOpenTerminal: (handler: ProjectHandler<DesktopMcpOpenTerminalPayload>) => {
      terminalHandler = handler
      return () => {
        terminalHandler = null
      }
    },
  } as never
})

describe('useDesktopMcpOpen', () => {
  it('지금 보고 있는 프로젝트의 파일을 연다', () => {
    const open = vi.fn()
    renderHook(() => useDesktopMcpOpen('A', open, vi.fn()))

    fileHandler!({ path: 'src/a.ts', line: 3 }, 'A')
    expect(open).toHaveBeenCalledWith('src/a.ts', 3)
  })

  it('다른 프로젝트가 보낸 파일은 열지 않는다', () => {
    const open = vi.fn()
    renderHook(() => useDesktopMcpOpen('A', open, vi.fn()))

    fileHandler!({ path: 'src/a.ts' }, 'B')
    expect(open).not.toHaveBeenCalled()
  })

  it('셸 칸을 편다', () => {
    const openTerminal = vi.fn()
    renderHook(() => useDesktopMcpOpen('A', vi.fn(), openTerminal))

    terminalHandler!({ command: 'npm test' }, 'A')
    expect(openTerminal).toHaveBeenCalledTimes(1)
  })

  // 뒤에 있는 프로젝트가 시킨 것이 지금 화면의 칸을 펴면 안 된다 — 칸은 앱 하나뿐이다
  it('다른 프로젝트가 보낸 셸 칸 열기는 무시한다', () => {
    const openTerminal = vi.fn()
    renderHook(() => useDesktopMcpOpen('A', vi.fn(), openTerminal))

    terminalHandler!({ command: 'npm test' }, 'B')
    expect(openTerminal).not.toHaveBeenCalled()
  })

  // 글자를 넣는 일은 main 이 한다 (`drawerBridge.fill`) — 화면이 대신 치면
  // 칸이 처음 펴지는 경우에 pty 가 아직 없어 조용히 사라진다
  it('화면은 명령을 pty 로 보내지 않는다', () => {
    const sendShellInput = vi.fn()
    Object.assign(window.davis, { sendShellInput })
    renderHook(() => useDesktopMcpOpen('A', vi.fn(), vi.fn()))

    terminalHandler!({ command: 'npm test' }, 'A')
    expect(sendShellInput).not.toHaveBeenCalled()
  })
})
