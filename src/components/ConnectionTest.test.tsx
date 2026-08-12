// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionTest } from './ConnectionTest'

// 「프로젝트 연결」 팝업 — 연결에 관한 **단 하나의 표면**이다.
//
// 안의 진단은 `ConnectionDoctor.test.tsx` 가 본다. 여기서 잠그는 것은 껍데기의 계약이다:
// 어느 프로젝트를 보고 있는지 · 닫는 길 · 백드롭을 눌러 닫히되 카드 안쪽 클릭은 안 닫히는 것.
// 마지막 것이 특히 — 주소를 고치려고 입력칸을 누를 때마다 팝업이 닫히면 값을 못 넣는다.

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { davis: unknown }).davis = {
    // 열자마자 진단이 도는데, 이 파일이 보는 것은 껍데기라 첫 단계에서 멈춰 세운다
    pingServer: vi.fn(() => new Promise(() => {})),
    checkModels: vi.fn(),
    diagnose: vi.fn(),
    reconnectProject: vi.fn(),
  }
})

function setup(props: Partial<Parameters<typeof ConnectionTest>[0]> = {}) {
  const onClose = vi.fn()
  render(
    <ConnectionTest status="ready" projectPath="/tmp/p1" onClose={onClose} {...props} />,
  )
  return { onClose }
}

describe('껍데기', () => {
  // 여러 개 열어 두면 어느 프로젝트를 보고 있는지 헷갈린다
  it('어느 프로젝트인지 경로를 보여준다', () => {
    setup()
    expect(screen.getByText('/tmp/p1')).toBeTruthy()
  })

  it('최초 등록처럼 맥락이 필요하면 안내 한 줄을 위에 둔다', () => {
    setup({ intro: '이 프로젝트를 처음 엽니다' })
    expect(screen.getByText('이 프로젝트를 처음 엽니다')).toBeTruthy()
  })

  it('intro 가 없으면 그 줄이 아예 없다', () => {
    setup()
    expect(document.querySelector('.dc-onboarding__intro')).toBeNull()
  })
})

describe('닫는 길', () => {
  it('× 버튼으로 닫는다', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByTitle('닫기'))
    expect(onClose).toHaveBeenCalled()
  })

  it('백드롭을 누르면 닫힌다', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })

  // **이게 없으면 주소를 못 고친다** — 입력칸을 누를 때마다 팝업이 닫힌다
  it('카드 안쪽을 눌러도 안 닫힌다', () => {
    const { onClose } = setup()
    fireEvent.click(document.querySelector('.dc-modal__card')!)
    expect(onClose).not.toHaveBeenCalled()
  })
})
