// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SlashPopup } from './SlashPopup'
import { Composer } from './Composer'
import { setOpenFileHandler } from '../state/slashCommands'
import type { CommandSummaryPayload } from '../../shared/ipc/channels'

// `/` 팝업은 **평면 한 단계**다 (opencode CLI 와 같은 모양).
// 예전 davis 식 2단계(`/command clear`·`/skill pptx`)는 없앴다 — 데스크톱 명령과
// opencode 가 주는 명령·스킬이 한 목록에 섞여 뜨고, 종류는 태그로만 갈린다.

const COMMANDS: CommandSummaryPayload[] = [
  { name: 'init', description: 'AGENTS.md 만들기', source: 'command', template: '$ARGUMENTS' },
  { name: 'pptx', description: '슬라이드 생성', source: 'skill', template: '# 스킬 본문', subtask: true },
]

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    listCommands: () => Promise.resolve({ ok: true, commands: COMMANDS }),
    listFiles: () => Promise.resolve({ files: ['src/a.ts', 'src/b.ts'], dirs: [], truncated: false }),
    resetChat: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('SlashPopup — 평면 목록', () => {
  it('`/` 하나에 데스크톱 명령과 opencode 항목이 함께 뜬다', async () => {
    render(<SlashPopup query="" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('init'))

    const names = Array.from(document.querySelectorAll('.dc-mentions__name')).map((n) => n.textContent)
    // 데스크톱 명령이 앞이다 — 이름이 겹치면 이쪽이 임자라 찾는 순서와 같아야 한다
    // `mcps` 는 opencode 목록에 없는 앱 자체 항목이다 — 서버는 자기 MCP 상태를 보여주는
    // 명령을 주지 않는다 (`slashCommands.ts`). 그래서 데스크톱 쪽에 섞여 앞에 선다.
    expect(names).toEqual(['new', 'compact', 'open', 'rename', 'restart', 'logs', 'mcps', 'init', 'pptx'])
    // 카테고리 단계가 없다
    expect(screen.queryByText('command')).toBeNull()
    expect(screen.queryByText('skill')).toBeNull()
  })

  it('이름·설명 어느 쪽으로든 좁힌다', async () => {
    render(<SlashPopup query="ini" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('init'))
    expect(screen.queryByText('rename')).toBeNull()
  })

  it('opencode 항목에는 출처 태그가 붙는다 — 데스크톱 명령에는 없다', async () => {
    render(<SlashPopup query="" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('pptx'))

    expect(screen.getByText('스킬')).toBeTruthy()
    expect(screen.getByText('subtask')).toBeTruthy()
    // 명령(init·데스크톱 명령)은 태그가 없다 — 한 줄로 보이는 것이 opencode 의 모양이다
    expect(document.querySelectorAll('.dc-skill__tag')).toHaveLength(2)
  })

  it('데스크톱 명령을 고르면 command choice 로 알린다', async () => {
    const onPick = vi.fn()
    render(<SlashPopup query="new" onPick={onPick} onClose={() => {}} />)
    await waitFor(() => screen.getByText('new'))
    fireEvent.mouseDown(screen.getByText('new'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command' }))
  })

  it('opencode 항목을 고르면 이름으로 알린다 — 전개는 전송 때 한다', async () => {
    const onPick = vi.fn()
    render(<SlashPopup query="init" onPick={onPick} onClose={() => {}} />)
    await waitFor(() => screen.getByText('init'))
    fireEvent.mouseDown(screen.getByText('init'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'opencode', name: 'init' })
  })

  // 일치가 0행이면 상자는 남는다 — Esc 의 임자 판정(useShortcuts.ts)이 `[role=listbox]` 로
  // 팝업을 보기 때문이다. 사라지면 같은 Esc 가 응답 중단까지 발동해, 오타를 지우려던
  // 손동작이 진행 중인 턴을 죽인다.
  it('일치가 0행이면 보이지 않는 상자를 남긴다 — Esc 임자 판정용', async () => {
    render(<SlashPopup query="zzzz" onPick={() => {}} onClose={() => {}} />)

    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    const box = document.querySelector('.dc-mentions')!
    expect(box.hasAttribute('hidden')).toBe(true) // 눈에는 안 보인다
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
  })
})

describe('Composer — 평면 목록에서 고르기', () => {
  it('데스크톱 명령을 고르면 곧바로 실행하고 입력창을 비운다', async () => {
    const resetChat = vi.fn()
    stubDavis({ resetChat })
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/new' } })
    await waitFor(() => screen.getByText('new'))
    fireEvent.mouseDown(screen.getByText('new'))

    expect(resetChat).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('')
  })

  it('opencode 항목을 고르면 `/이름 ` 이 들어가고 인자를 이어 칠 수 있다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/ini' } })
    await waitFor(() => screen.getByText('init'))
    fireEvent.mouseDown(screen.getByText('init'))

    // 바로 실행하지 않는다 — 인자를 넣을 기회가 사라진다
    expect(textarea.value).toBe('/init ')
  })

  it('이름 뒤에 공백을 치면 팝업이 닫힌다 — 거기서부터는 인자 구간이다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/init' } })
    await waitFor(() => screen.getByText('init'))
    fireEvent.change(textarea, { target: { value: '/init 한국어로' } })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '명령·스킬' })).toBeNull())
  })
})

describe('Composer — /open 인라인 파일 리스트', () => {
  it('`/open ` 뒤에서는 명령 팝업이 닫히고 파일 리스트가 뜬다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/open ' } })
    await waitFor(() => screen.getByRole('listbox', { name: '파일 열기' }))
    expect(screen.getByText('src/a.ts')).toBeDefined()
    expect(screen.queryByText('pptx')).toBeNull()
  })

  it('목록에서 open 을 고르면 `/open ` 이 들어가며 곧바로 파일 리스트로 이어진다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/ope' } })
    await waitFor(() => screen.getByRole('listbox', { name: '명령·스킬' }))
    fireEvent.mouseDown(screen.getByText('open'))

    expect(textarea.value).toBe('/open ')
    await waitFor(() => screen.getByRole('listbox', { name: '파일 열기' }))
  })

  it('파일을 고르면 열기 핸들러가 불리고 입력창을 비운다', async () => {
    const opened: string[] = []
    setOpenFileHandler((path) => opened.push(path))
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/open b' } })
    await waitFor(() => screen.getByText('src/b.ts'))
    fireEvent.mouseDown(screen.getByText('src/b.ts'))

    expect(opened).toEqual(['src/b.ts'])
    expect(textarea.value).toBe('')
  })
})
