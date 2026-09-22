// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useOpenFiles } from './useOpenFiles'
import { requestExtensionView, useExtensionViewOpen } from './useExtensionViewOpen'
import { webviewTabKey } from './useOpenWebviewTab'
import { cycleTab } from './tabCycle'
import type { ExtensionUiOpenPayload } from '../../shared/ipc/extensionUiBridge'

// 웹뷰 탭을 여는 두 문(E5) — `code.ui.open`(main 이 민다)과 설정 창 「열기」 — 이 **같은 길**로
// 탭 목록에 닿는지, 그리고 그 탭이 다른 본문 탭과 같은 순환(⌃Tab·⌘⌥↑↓)에 끼는지.

type OpenHandler = (payload: ExtensionUiOpenPayload, projectId: string) => void
let pushOpen: OpenHandler = () => {}

beforeEach(() => {
  ;(window as unknown as { davis: unknown }).davis = {
    onExtensionUiOpen: (handler: OpenHandler) => {
      pushOpen = handler
      return () => {
        pushOpen = () => {}
      }
    },
  }
})

function bed(projectId: string) {
  return renderHook(() => {
    const files = useOpenFiles(projectId)
    useExtensionViewOpen(projectId, files.openWebview)
    return files
  })
}

const KEY = webviewTabKey('ext', 'board')

describe('웹뷰 탭 열기', () => {
  it('code.ui.open 이 밀면 **지금 프로젝트의 것만** 연다 — 다른 프로젝트 것은 버린다', () => {
    const { result } = bed('P')

    act(() => pushOpen({ extension: 'ext', viewId: 'board', title: '보드' }, 'Q'))
    expect(result.current.files).toEqual([])

    act(() => pushOpen({ extension: 'ext', viewId: 'board', title: '보드' }, 'P'))
    expect(result.current.active).toBe(KEY)
    expect(result.current.files).toEqual([
      { path: KEY, text: '', label: '보드', webview: { extension: 'ext', viewId: 'board', projectId: 'P' } },
    ])
  })

  it('설정 창 「열기」도 같은 길로 연다', () => {
    const { result } = bed('P')
    act(() => requestExtensionView({ extension: 'ext', viewId: 'board', projectId: 'P' }, '보드'))
    expect(result.current.active).toBe(KEY)
  })

  it('이미 열린 탭을 다시 열면 **그 탭으로 가기만** 한다 — 탭 객체를 새로 만들지 않는다', () => {
    const { result } = bed('P')
    act(() => requestExtensionView({ extension: 'ext', viewId: 'board', projectId: 'P' }, '보드'))
    const first = result.current.files[0]
    act(() => result.current.select('chat'))

    act(() => pushOpen({ extension: 'ext', viewId: 'board', title: '보드' }, 'P'))

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0]).toBe(first)
    expect(result.current.active).toBe(KEY)
  })

  it('웹뷰 탭도 본문 탭 순환에 낀다 (⌃Tab·⌘⌥↑↓ 가 같은 길)', () => {
    const { result } = bed('P')
    act(() => requestExtensionView({ extension: 'ext', viewId: 'board', projectId: 'P' }, '보드'))
    const files = result.current.files.map((file) => file.path)
    expect(cycleTab({ active: 'chat', files, logsOpen: false, direction: 1 })).toBe(KEY)
    expect(cycleTab({ active: KEY, files, logsOpen: false, direction: 1 })).toBe('chat')
  })
})
