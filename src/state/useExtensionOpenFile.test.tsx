// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExtensionOpenFile } from './useExtensionOpenFile'
import { useOpenFiles } from './useOpenFiles'
import type { ExtensionOpenFilePayload } from '../../shared/ipc/extensionUiBridge'

// 확장이 연 파일(`code.workspace.openFile`)이 **본문 탭까지 닿는가**, 그리고 겉봉의 둘째 겹.
//
// main 도 보내기 전에 화면의 프로젝트인지 본다 (`electron/ipc/extensionUiBridge.test.ts`).
// 여기서 재는 것은 그 사이 사용자가 프로젝트를 옮겼을 때 **받는 쪽이 버리는가**다 —
// 한 겹만 잠그면 IPC 한 번 사이의 틈으로 남의 파일이 열린다 (`chat.post` 와 같은 자리).

type OpenHandler = (payload: ExtensionOpenFilePayload, projectId: string) => void
let pushOpen: OpenHandler = () => {}
let readFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  readFile = vi.fn(async () => ({ ok: true, text: '한\n두\n세\n', mtimeMs: 1 }))
  ;(window as unknown as { davis: unknown }).davis = {
    onExtensionOpenFile: (handler: OpenHandler) => {
      pushOpen = handler
      return () => {
        pushOpen = () => {}
      }
    },
    readFile,
  }
})

function bed(projectId: string) {
  return renderHook(() => {
    const files = useOpenFiles(projectId)
    useExtensionOpenFile(projectId, files.open)
    return files
  })
}

describe('확장이 연 파일', () => {
  it('지금 보고 있는 프로젝트의 것만 연다 — 다른 프로젝트 것은 버린다', async () => {
    const { result } = bed('P')

    act(() => pushOpen({ path: 'src/app.ts' }, 'Q'))
    expect(result.current.files).toEqual([])
    expect(readFile).not.toHaveBeenCalled()

    act(() => pushOpen({ path: 'src/app.ts' }, 'P'))
    expect(result.current.active).toBe('src/app.ts')
    await waitFor(() => expect(result.current.files[0]?.text).toBe('한\n두\n세\n'))
    expect(readFile).toHaveBeenCalledWith({ projectId: 'P', path: 'src/app.ts' })
  })

  it('줄 번호가 탭까지 간다 — 그 줄이 보이게 스크롤하는 근거다 (`revealLine`)', async () => {
    const { result } = bed('P')

    act(() => pushOpen({ path: 'src/app.ts', line: 42 }, 'P'))

    expect(result.current.files[0]?.revealLine).toBe(42)
    await waitFor(() => expect(result.current.files[0]?.text).toBe('한\n두\n세\n'))
    // 내용을 읽어 온 뒤에도 그 줄은 남는다 — 읽기 결과가 탭을 갈아끼우기 때문에 쉽게 사라지는 자리다
    expect(result.current.files[0]?.revealLine).toBe(42)
  })

  it('줄 번호가 없으면 맨 위다 — 열려 있던 탭의 줄을 지어내지 않는다', async () => {
    const { result } = bed('P')

    act(() => pushOpen({ path: 'src/app.ts', line: 42 }, 'P'))
    await waitFor(() => expect(result.current.files).toHaveLength(1))
    act(() => pushOpen({ path: 'src/app.ts' }, 'P'))

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0]?.revealLine).toBeUndefined()
  })
})
