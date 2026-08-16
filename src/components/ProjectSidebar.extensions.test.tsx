// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar, type ProjectSidebarProps } from './ProjectSidebar'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 설치된 확장이 **사이드바 선택기에 자기 패널을 등록**하는가.
//
// 여기서 보는 것은 배선의 양 끝이다: main 이 준 목록(`listExtensions`)이 선택기 항목이 되고,
// 고르면 그 뷰의 행이 그려지며, 명령·행 열기가 되돌아 나가는가. 순수 변환은
// `state/extensionPanels.test.ts`, 선택기 자체는 `SidebarPanelSelect.test.tsx` 가 본다.

const LINE_CHECKER: ExtensionEntryPayload = {
  name: 'sample-ext',
  displayName: '샘플 확장',
  version: '0.1.0',
  dir: '/확장/sample-ext',
  enabled: true,
  contributes: {
    commands: [{ id: 'sampleExt.run', title: '찾기' }],
    views: [{ id: 'sampleExt.results', title: '샘플 확장', kind: 'table' }],
  },
}

type RowsHandler = (payload: { viewId: string; rows: Record<string, unknown>[] }, projectId: string) => void

function stubDavis(extensions: ExtensionEntryPayload[]) {
  let pushRows: RowsHandler | null = null
  const stub = {
    listExtensions: vi.fn(() => Promise.resolve({ extensions, skipped: [] })),
    onExtensionRows: vi.fn((handler: RowsHandler) => {
      pushRows = handler
      return () => {
        pushRows = null
      }
    }),
    // HTML 뷰는 이 시험이 보지 않는다. 다만 **구독은 붙는다** — 없으면 훅이 그 자리에서 던진다.
    onExtensionHtml: vi.fn(() => () => {}),
    onExtensionTree: vi.fn(() => () => {}),
    redrawExtensionViews: vi.fn(() => Promise.resolve()),
    onExtensionProgress: vi.fn(() => () => {}),
    cancelExtension: vi.fn(() => Promise.resolve()),
    runExtensionCommand: vi.fn(() => Promise.resolve()),
    requestHistoryList: vi.fn(),
  }
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = stub
  return { stub, emit: (payload: Parameters<RowsHandler>[0]) => act(() => pushRows?.(payload, 'p1')) }
}

const PROJECT: ProjectRecord = { id: 'p1', root: '/tmp/p1', name: 'p1', favorite: false, lastOpenedAt: 0 }

/** 이 시험이 보지 않는 나머지 props. git·history 는 화면을 그릴 만큼만 채운다. */
const NOOP = {
  status: 'ready' as const,
  tree: { children: { '': [] }, expanded: new Set<string>(), loading: new Set<string>(), toggle: () => {} },
  onPickFile: () => {},
  onTestConnection: () => {},
  onFavorite: () => {},
  git: { state: EMPTY_GIT_STATE, loading: false, toggle: async () => {}, refetch: () => {} },
  onOpenDiff: () => {},
  gitActions: { onRevert: () => {}, onPull: () => {}, onCommit: () => {}, onPush: () => {} },
  history: { entries: [], loading: false, loadingChatId: null, current: null },
  onToast: () => {},
} as unknown as Omit<ProjectSidebarProps, 'project' | 'onOpenFile'>

function renderSidebar(overrides: { onOpenFile?: (path: string, line?: number) => void } = {}) {
  render(
    <ProjectSidebar
      {...NOOP}
      project={PROJECT}
      onOpenFile={overrides.onOpenFile ?? (() => {})}
    />,
  )
}

/** 선택기를 펼쳐 확장 패널을 고른다. 목록은 비동기로 오므로 항목이 뜰 때까지 기다린다. */
async function pickPanel(title: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))
  await waitFor(() => screen.getByText(title))
  fireEvent.click(screen.getByText(title))
}

afterEach(cleanup)

describe('설치된 확장이 사이드바에 자기 패널을 등록한다', () => {
  it('확장의 뷰가 선택기 목록에 나온다', async () => {
    stubDavis([LINE_CHECKER])
    renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))

    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        '프로젝트',
        '소스 관리',
        '채팅이력',
        '실행',
        '샘플 확장',
      ]),
    )
  })

  // 꺼진 확장은 호스트에 실리지 않아 명령이 거부되고 행도 안 온다.
  // 선택기에 남기면 눌러도 아무 일이 없는 칸이 된다 — 목록에 남기는 자리는 설정 창이다.
  it('꺼 둔 확장의 패널은 선택기에 나오지 않는다', async () => {
    stubDavis([{ ...LINE_CHECKER, enabled: false }])
    renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))

    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        '프로젝트',
        '소스 관리',
        '채팅이력',
        '실행',
      ]),
    )
  })

  it('고르면 그 확장의 명령 버튼이 뜬다 — 빈 표 앞에서 무엇을 누를지 알 수 있어야 한다', async () => {
    const { stub } = stubDavis([LINE_CHECKER])
    renderSidebar()

    await pickPanel('샘플 확장')
    fireEvent.click(screen.getByText('찾기'))

    expect(stub.runExtensionCommand).toHaveBeenCalledWith({ commandId: 'sampleExt.run' })
  })

  it('돌리기 전에는 "아직 실행하지 않았습니다" 다', async () => {
    stubDavis([LINE_CHECKER])
    renderSidebar()

    await pickPanel('샘플 확장')

    expect(screen.getByText('아직 실행하지 않았습니다.')).toBeTruthy()
  })

  it('돌렸는데 0행이면 "결과가 없습니다" 로 갈린다 — 안 돌린 것과 같아 보이면 안 된다', async () => {
    // 실측: 훑을 대상이 하나도 없는 프로젝트에서 명령은 거부 없이 0행으로 끝난다.
    // 두 상태가 같은 문구면 사용자에게는 **버튼이 안 먹은 것**으로 보인다.
    const { emit } = stubDavis([LINE_CHECKER])
    renderSidebar()
    await pickPanel('샘플 확장')

    emit({ viewId: 'sampleExt.results', rows: [] })

    expect(screen.queryByText('아직 실행하지 않았습니다.')).toBeNull()
    expect(screen.getByText('결과가 없습니다.')).toBeTruthy()
  })

  it('도는 동안 버튼이 「중단」으로 바뀌고, 누르면 질의를 끊는다', async () => {
    const { stub } = stubDavis([LINE_CHECKER])
    let finish: (() => void) | null = null
    stub.runExtensionCommand.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    renderSidebar()
    await pickPanel('샘플 확장')

    fireEvent.click(screen.getByText('찾기'))

    // 잠긴 버튼으로 두면 수 분짜리 작업에서 사용자가 할 수 있는 일이 없다 —
    // 잘못 고른 대상이나 엉뚱한 프로젝트를 훑기 시작해도 마찬가지다.
    const stop = screen.getByText('중단')
    fireEvent.click(stop)
    expect(stub.cancelExtension).toHaveBeenCalledTimes(1)
    // 같은 명령이 겹쳐 돌지는 않는다 — 실행 버튼은 그 자리에 없다
    expect(stub.runExtensionCommand).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish?.()
    })
    expect(screen.getByText('찾기')).toBeTruthy()
  })

  it('올라온 행이 그 패널의 표에 그려진다', async () => {
    const { emit } = stubDavis([LINE_CHECKER])
    renderSidebar()
    await pickPanel('샘플 확장')

    emit({
      viewId: 'sampleExt.results',
      rows: [{ file: 'src/App.tsx', bytes: 9000, lines: 287, ext: 'tsx' }],
    })

    expect(screen.getByText('src/App.tsx')).toBeTruthy()
    expect(screen.getByText('287')).toBeTruthy()
    // 열 이름은 확장이 준 키 그대로다 (`extensionRows.deriveColumns`)
    expect(screen.getByText('lines')).toBeTruthy()
  })

  it('행을 누르면 그 파일을 연다', async () => {
    const onOpenFile = vi.fn()
    const { emit } = stubDavis([LINE_CHECKER])
    renderSidebar({ onOpenFile })
    await pickPanel('샘플 확장')
    emit({ viewId: 'sampleExt.results', rows: [{ file: 'src/App.tsx', lines: 287 }] })

    fireEvent.click(screen.getByText('src/App.tsx'))

    expect(onOpenFile).toHaveBeenCalledWith('src/App.tsx', undefined)
  })

  it('설치된 확장이 없으면 선택기는 내장 넷 그대로다', async () => {
    stubDavis([])
    renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: /프로젝트/ }))

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
  })

  it('프로젝트를 옮기면 선택이 따라오지 않고, 돌아오면 보던 패널로 돌아온다', async () => {
    stubDavis([LINE_CHECKER])
    const other: ProjectRecord = { ...PROJECT, id: 'p2', root: '/tmp/p2', name: 'p2' }
    const { rerender } = render(<ProjectSidebar {...NOOP} project={PROJECT} onOpenFile={() => {}} />)
    await pickPanel('샘플 확장')
    expect(screen.getByRole('button', { name: /샘플 확장/ })).toBeTruthy()

    rerender(<ProjectSidebar {...NOOP} project={other} onOpenFile={() => {}} />)
    expect(screen.getByRole('button', { name: /프로젝트/ })).toBeTruthy()

    rerender(<ProjectSidebar {...NOOP} project={PROJECT} onOpenFile={() => {}} />)
    expect(screen.getByRole('button', { name: /샘플 확장/ })).toBeTruthy()
  })

  it('보고 있던 확장이 사라지면 프로젝트로 되돌아간다 — 빈 화면에 가두지 않는다', async () => {
    const { stub } = stubDavis([LINE_CHECKER])
    renderSidebar()
    await pickPanel('샘플 확장')
    expect(screen.getByRole('button', { name: /샘플 확장/ })).toBeTruthy()

    // 설정 창에서 삭제한 뒤 선택기를 다시 펼치면 목록이 갱신된다
    stub.listExtensions.mockResolvedValue({ extensions: [], skipped: [] })
    fireEvent.click(screen.getByRole('button', { name: /샘플 확장/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: /프로젝트/ })).toBeTruthy())
  })
})
