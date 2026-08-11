// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SkillPicker } from './SkillPicker'
import type { SkillSummaryPayload } from '../../shared/ipc/channels'

// `+ → 스킬` 목록. 고르면 실행이 아니라 입력창에 이름을 넣는다(onPick).
// 로딩·빈 목록·오류 안내·내장/fork 배지·닫기를 본다.

const SKILLS: SkillSummaryPayload[] = [
  { name: 'pptx', description: '슬라이드 생성', context: 'inline', builtin: true },
  { name: 'deep-research', description: '심층 리서치', context: 'fork' },
]

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    listSkills: () => Promise.resolve({ skills: SKILLS }),
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

  it('내장 스킬엔 "내장", fork 스킬엔 "fork" 배지가 붙는다', async () => {
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('pptx'))
    expect(screen.getByText('내장')).toBeTruthy()
    expect(screen.getByText('fork')).toBeTruthy()
  })

  it('스킬이 없으면 빈 안내를 보인다', async () => {
    stubDavis({ listSkills: () => Promise.resolve({ skills: [] }) })
    render(<SkillPicker onPick={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('이 프로젝트에 켜진 스킬이 없습니다'))
  })

  it('오류가 오면 사유를 함께 보이되 내장 스킬은 계속 보인다', async () => {
    stubDavis({
      listSkills: () => Promise.resolve({ skills: SKILLS, error: '서버 응답 없음' }),
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
