// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SkillPicker } from './SkillPicker'
import type { CommandSummaryPayload } from '../../shared/ipc/channels'

// `+ → 스킬` 목록. 고르면 실행이 아니라 입력창에 이름을 넣는다(onPick).
// 로딩·빈 목록·오류 안내·닫기를 본다.
//
// 목록은 `/` 팝업과 **같은 통로**(listCommands)로 온다 — opencode 는 명령과 스킬을 한
// 배열로 주므로 여기서 `source` 로 거른다. 그 거르기가 이 파일의 첫 시험이다.

const COMMANDS: CommandSummaryPayload[] = [
  { name: 'pptx', description: '슬라이드 생성', source: 'skill', template: '# 스킬 본문' },
  { name: 'deep-research', description: '심층 리서치', source: 'skill', template: '# 스킬 본문' },
  { name: 'init', description: 'AGENTS.md 만들기', source: 'command', template: '$ARGUMENTS' },
]

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    listCommands: () => Promise.resolve({ ok: true, commands: COMMANDS }),
    ...overrides,
  }
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('SkillPicker — 로딩/목록', () => {
  it('불러오는 동안 안내를 보이고, 오면 스킬을 그린다', async () => {
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('불러오는 중…')).toBeTruthy()
    await waitFor(() => screen.getByText('pptx'))
    expect(screen.getByText('심층 리서치')).toBeTruthy()
  })

  it('명령은 걸러진다 — 여기는 스킬 목록이다', async () => {
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('pptx'))
    expect(screen.queryByText('init')).toBeNull()
  })

  it('스킬이 없으면 빈 안내를 보인다', async () => {
    stubDavis({ listCommands: () => Promise.resolve({ ok: true, commands: [] }) })
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('이 프로젝트에 켜진 스킬이 없습니다'))
  })

  it('오류가 오면 사유를 함께 보이되 받아온 스킬은 계속 보인다', async () => {
    stubDavis({
      listCommands: () => Promise.resolve({ ok: false, commands: COMMANDS, error: '서버 응답 없음' }),
    })
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('서버 응답 없음'))
    expect(screen.getByText('pptx')).toBeTruthy()
  })
})

describe('SkillPicker — 선택/닫기', () => {
  it('스킬을 고르면 이름으로 onPick 하고 닫는다', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<SkillPicker onPick={onPick} onClose={onClose} />)
    await waitFor(() => screen.getByText('pptx'))
    fireEvent.click(screen.getByText('pptx'))
    expect(onPick).toHaveBeenCalledWith('pptx')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('백드롭 클릭으로 닫고, 안쪽 클릭은 닫지 않는다', async () => {
    const onClose = vi.fn()
    const { container } = render(<SkillPicker onPick={() => {}} onClose={onClose} />)
    await waitFor(() => screen.getByText('pptx'))
    fireEvent.click(container.querySelector('.dc-palette')!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.dc-modal')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
