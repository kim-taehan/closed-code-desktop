// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionFixForm } from './ConnectionFixForm'

// **이 열에는 고칠 값이 없다.** 서버를 프로젝트마다 앱이 띄우면서 사용자가 넣을 주소가
// 사라졌다 (`ConnectionFixForm.tsx` 머리말). 이 파일은 그 뒤에 남은 계약을 잠근다:
// 무엇에 붙어 있는지 보여 주고, 다시 확인하라는 손잡이 하나를 준다.
//
// 예전 이 파일은 **"값을 바꾸고 연결 시도를 누르면 저장·재연결·재진단까지 한 번에"** 를
// 겨눴다 (저장은 이 폼, 재연결은 진단 쪽이라는 분담까지). 저장할 값이 없어져 그 축은
// 통째로 사라졌고, **"재연결을 직접 부르지 않는다" 만 그대로 유효하다** — 아래에 남겼다.

afterEach(cleanup)

function setup(overrides: { endpoint?: { host: string; port: number } | null; running?: boolean } = {}) {
  const onApply = vi.fn()
  render(
    <ConnectionFixForm
      endpoint={overrides.endpoint === undefined ? { host: '127.0.0.1', port: 55640 } : overrides.endpoint}
      running={overrides.running ?? false}
      onApply={onApply}
    />,
  )
  return { onApply, button: screen.getByRole('button') }
}

describe('고칠 값이 없다', () => {
  it('입력 칸이 하나도 없다 — 주소는 우리가 띄운 서버가 정한다', () => {
    setup()
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('버튼도 하나다', () => {
    setup()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button').textContent).toContain('연결 시도')
  })
})

describe('무엇에 붙어 있나', () => {
  // 포트를 우리가 고르지 않는다(opencode 가 빈 포트를 잡는다) — 프로젝트마다 다르고,
  // 사람이 캡처해서 묻는 화면이라 여기 찍혀 있어야 되묻지 않는다
  it('그 프로젝트의 서버 주소를 그대로 보여준다', () => {
    setup({ endpoint: { host: '127.0.0.1', port: 55641 } })
    expect(screen.getByText('http://127.0.0.1:55641')).toBeTruthy()
  })

  it('아직 안 떴으면 그렇게 말한다 — 빈 칸으로 두지 않는다', () => {
    setup({ endpoint: null })
    expect(screen.getByText(/아직 뜨지 않았습니다/)).toBeTruthy()
  })
})

describe('연결 시도', () => {
  it('누르면 재진단을 시킨다', () => {
    const { onApply, button } = setup()
    fireEvent.click(button)
    expect(onApply).toHaveBeenCalledOnce()
  })

  // **재연결은 이 폼의 몫이 아니다** — 진단이 세션 상태를 보고 판단한다.
  // 여기서 부르면 멀쩡한 세션을 끊었다 붙인다.
  it('재연결을 직접 부르지 않는다', () => {
    const reconnect = vi.fn()
    ;(window as unknown as { davis: unknown }).davis = { reconnectProject: reconnect }
    const { button } = setup()

    fireEvent.click(button)

    expect(reconnect).not.toHaveBeenCalled()
  })

  // 도는 중에 또 누르면 진단이 겹친다
  it('진단이 도는 동안에는 잠근다', () => {
    const { button } = setup({ running: true })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.textContent).toContain('진단 중…')
  })
})
