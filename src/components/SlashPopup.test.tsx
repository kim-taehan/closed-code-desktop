// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SlashPopup } from './SlashPopup'
import { Composer } from './Composer'
import { setOpenFileHandler, setSendToRuntime } from '../state/slashCommands'
import type { SkillSummaryPayload } from '../../shared/ipc/channels'

// `/` 팝업은 **카테고리 → 항목 2단계**다 (DC-980).
// 1단계에서 카테고리를 고르면 `/이름 ` 이 들어가고, 2단계에서 항목을 고르면 실행된다.

const SKILLS: SkillSummaryPayload[] = [
  { name: 'pptx', description: '슬라이드 생성', context: 'inline', builtin: true },
  { name: 'review', description: '코드 리뷰', context: 'inline' },
]

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    listSkills: () => Promise.resolve({ skills: SKILLS }),
    listFiles: () => Promise.resolve({ files: ['src/a.ts', 'src/b.ts'], dirs: [], truncated: false }),
    resetChat: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('SlashPopup — 2단계 네임스페이스', () => {
  it('1단계에서는 카테고리만 보인다 — 항목이 쏟아지지 않는다', async () => {
    render(<SlashPopup query="" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('command'))

    const names = Array.from(document.querySelectorAll('.dc-mentions__name')).map((n) => n.textContent)
    expect(names).toEqual(['command', 'skill'])
    expect(document.querySelectorAll('.dc-skill__tag')).toHaveLength(2)
    // 지금 어느 단계인지 머리말로 알려준다
    expect(document.querySelector('.dc-mentions__head')?.textContent).toBe('카테고리')
    // 항목은 아직 보이면 안 된다
    expect(screen.queryByText('clear')).toBeNull()
    expect(screen.queryByText('pptx')).toBeNull()
  })

  it('command 카테고리 안에서는 빌트인 명령만 보인다', async () => {
    render(<SlashPopup query="command " onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('clear'))

    const names = Array.from(document.querySelectorAll('.dc-mentions__name')).map((n) => n.textContent)
    // 런타임 조작 2종(restart·logs)도 별도 카테고리가 아니라 여기 있다
    expect(names).toEqual(['clear', 'compact', 'open', 'rename', 'restart', 'logs'])
    expect(screen.queryByText('pptx')).toBeNull()
  })

  it('skill 카테고리 안에서는 스킬만 보인다', async () => {
    render(<SlashPopup query="skill " onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('pptx'))

    const names = Array.from(document.querySelectorAll('.dc-mentions__name')).map((n) => n.textContent)
    expect(names).toEqual(['pptx', 'review'])
    expect(screen.queryByText('clear')).toBeNull()
  })

  it('항목 단계에서 쿼리로 좁힌다', async () => {
    render(<SlashPopup query="command cl" onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('clear'))
    expect(screen.queryByText('rename')).toBeNull()
  })

  it('카테고리를 고르면 category choice 로 알린다', async () => {
    const onPick = vi.fn()
    render(<SlashPopup query="" onPick={onPick} onClose={() => {}} />)
    await waitFor(() => screen.getByText('command'))
    fireEvent.mouseDown(screen.getByText('command'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'category', namespace: 'command' })
  })

  it('항목을 고르면 command choice 로 알린다', async () => {
    const onPick = vi.fn()
    render(<SlashPopup query="command cl" onPick={onPick} onClose={() => {}} />)
    await waitFor(() => screen.getByText('clear'))
    fireEvent.mouseDown(screen.getByText('clear'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command' }))
  })

  it('항목까지 고른 뒤(프롬프트 단계)에는 팝업이 사라진다', () => {
    render(<SlashPopup query="command clear " onPick={() => {}} onClose={() => {}} />)
    expect(document.querySelector('.dc-mentions')).toBeNull()
  })

  // 고르는 중인데 일치가 0행이면 상자는 남는다 — Esc 의 임자 판정(useShortcuts.ts:172)이
  // `[role=listbox]` 로 팝업을 보기 때문이다. 사라지면 같은 Esc 가 턴 리뷰 거절까지
  // 발동해 파일이 확인 없이 되돌아간다. **rows 가 비는 두 사유를 가르는 것**이 핵심이라
  // 양쪽(위 프롬프트 단계 = 사라짐 / 아래 0행 = 남음)을 함께 잠근다.
  it('고르는 중 일치가 0행이면 보이지 않는 상자를 남긴다 — Esc 임자 판정용', async () => {
    render(<SlashPopup query="zzzz" onPick={() => {}} onClose={() => {}} />)

    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    const box = document.querySelector('.dc-mentions')!
    expect(box.hasAttribute('hidden')).toBe(true) // 눈에는 안 보인다
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
  })

  it('2단계에서 일치가 0행일 때도 마찬가지다', async () => {
    render(<SlashPopup query="command zzzz" onPick={() => {}} onClose={() => {}} />)

    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
  })
})

describe('Composer — 2단계로 명령 실행', () => {
  it('카테고리를 고르면 `/command ` 가 들어가고 항목 단계로 이어진다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/' } })
    await waitFor(() => screen.getByText('command'))
    fireEvent.mouseDown(screen.getByText('command'))

    expect(textarea.value).toBe('/command ')
    await waitFor(() => screen.getByText('clear'))
  })

  it('/command 에서 clear 를 고르면 resetChat 를 부르고 입력창을 비운다', async () => {
    const resetChat = vi.fn()
    stubDavis({ resetChat })
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/command clear' } })
    await waitFor(() => screen.getByText('clear'))
    fireEvent.mouseDown(screen.getByText('clear'))

    expect(resetChat).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('')
  })

  it('/command 에서 compact 를 고르면 전송 핸들러로 "/compact" 가 나간다', async () => {
    const sent: string[] = []
    setSendToRuntime((text) => sent.push(text))
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/command compact' } })
    await waitFor(() => screen.getByText('compact'))
    fireEvent.mouseDown(screen.getByText('compact'))

    expect(sent).toEqual(['/compact'])
    expect(textarea.value).toBe('')
  })
})

describe('Composer — /open 인라인 파일 리스트', () => {
  it('`/open ` 뒤에서는 스킬 팝업이 닫히고 파일 리스트가 뜬다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/open ' } })
    await waitFor(() => screen.getByRole('listbox', { name: '파일 열기' }))
    expect(screen.getByText('src/a.ts')).toBeDefined()
    // 스킬 팝업은 공백에서 닫힌다 — 파일 리스트만 떠야 한다
    expect(screen.queryByText('pptx')).toBeNull()
  })

  it('/command 에서 open 을 고르면 `/open ` 이 들어가며 곧바로 파일 리스트로 이어진다', async () => {
    const view = render(<Composer onSubmit={() => {}} />)
    const textarea = view.container.querySelector('textarea')!

    fireEvent.change(textarea, { target: { value: '/command open' } })
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
