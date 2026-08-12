// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionFixForm } from './ConnectionFixForm'
import { DEFAULT_OPENCODE_URL, DEFAULT_SETTINGS } from '../../shared/settings/appSettings'

// **"값을 바꾸고 연결 시도를 누르면 저장·재연결·재진단까지 한 번에"** — 그 한 번에가
// 실제로 셋을 다 하는지 잠근다 (`ConnectionDoctor.tsx:162` 가 화면에 그렇게 광고한다).
//
// 셋 중 저장과 재진단이 이 폼의 몫이고, **재연결은 이 폼이 안 부른다** — 진단이 세션이
// 죽은 것을 보면 알아서 붙인다 (`ConnectionFixForm.tsx:59`). 그 분담을 여기서 못 박는다:
// 폼이 재연결까지 부르면 멀쩡히 붙어 있는 세션을 끊었다 붙이게 된다.

afterEach(cleanup)

function setup(overrides: { url?: string; running?: boolean } = {}) {
  const onSaveSettings = vi.fn().mockResolvedValue(undefined)
  const onApply = vi.fn()
  const settings = { ...DEFAULT_SETTINGS, opencodeUrl: overrides.url ?? DEFAULT_OPENCODE_URL }

  render(
    <ConnectionFixForm
      settings={settings}
      onSaveSettings={onSaveSettings}
      running={overrides.running ?? false}
      onApply={onApply}
    />,
  )
  const input = screen.getByLabelText('opencode 서버') as HTMLInputElement
  const button = screen.getByRole('button')
  return { onSaveSettings, onApply, settings, input, button }
}

describe('칸은 하나다', () => {
  // davis 는 Backend URL·라이선스 키·시작 포트 셋이었다. opencode 에는 중앙 서버도
  // 라이선스도 포트 탐색도 없어 **주소 하나**만 남았다.
  it('입력 칸이 opencode 서버 주소 하나뿐이다', () => {
    const { input } = setup()
    expect(document.querySelectorAll('input')).toHaveLength(1)
    expect(input.value).toBe(DEFAULT_OPENCODE_URL)
  })

  it('버튼도 하나다 — 저장 버튼을 따로 두지 않는다', () => {
    setup()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button').textContent).toContain('연결 시도')
  })
})

describe('연결 시도 — 한 번에 무엇을 하나', () => {
  it('값을 바꿨으면 저장하고 재진단을 시킨다', async () => {
    const { onSaveSettings, onApply, input, button, settings } = setup()

    fireEvent.change(input, { target: { value: 'http://127.0.0.1:9999' } })
    fireEvent.click(button)
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())

    expect(onSaveSettings).toHaveBeenCalledWith({ ...settings, opencodeUrl: 'http://127.0.0.1:9999' })
  })

  // 바뀐 게 없는데 저장하면 설정 저장이 매번 도는 데다, 주소가 같은데 세션을 흔든다
  it('값이 그대로면 저장은 건너뛰고 재진단만 한다', async () => {
    const { onSaveSettings, onApply, button } = setup()

    fireEvent.click(button)
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())

    expect(onSaveSettings).not.toHaveBeenCalled()
  })

  // **재연결은 이 폼의 몫이 아니다** — 진단이 세션 상태를 보고 판단한다.
  // 여기서 부르면 멀쩡한 세션을 끊었다 붙인다.
  it('재연결을 직접 부르지 않는다', async () => {
    const reconnect = vi.fn()
    ;(window as unknown as { davis: unknown }).davis = { reconnectProject: reconnect }
    const { onApply, input, button } = setup()

    fireEvent.change(input, { target: { value: 'http://127.0.0.1:9999' } })
    fireEvent.click(button)
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())

    expect(reconnect).not.toHaveBeenCalled()
  })

  // 저장 전에 재진단이 돌면 옛 주소로 확인한다 — 순서가 뒤집히면 안 된다
  it('저장이 끝난 뒤에 재진단을 시킨다', async () => {
    const order: string[] = []
    const onApply = vi.fn(() => order.push('apply'))
    const onSaveSettings = vi.fn(async () => {
      order.push('save')
    })
    render(
      <ConnectionFixForm
          settings={{ ...DEFAULT_SETTINGS, opencodeUrl: DEFAULT_OPENCODE_URL }}
        onSaveSettings={onSaveSettings}
        running={false}
        onApply={onApply}
      />,
    )
    fireEvent.change(screen.getByLabelText('opencode 서버'), {
      target: { value: 'http://127.0.0.1:9999' },
    })
    fireEvent.click(screen.getByRole('button'))
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())

    expect(order).toEqual(['save', 'apply'])
  })

  // 빈 값을 그대로 저장하면 소비처가 "빈 문자열" 분기를 갖게 된다
  it('비우면 기본값으로 정규화해 저장한다', async () => {
    const { onSaveSettings, onApply, input, button } = setup({ url: 'http://127.0.0.1:9999' })

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(button)
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled())

    expect(onSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ opencodeUrl: DEFAULT_OPENCODE_URL }),
    )
  })
})

describe('주소 검증', () => {
  it('http/https 가 아니면 버튼을 잠그고 사유를 보여준다', () => {
    const { input, button } = setup()
    fireEvent.change(input, { target: { value: 'ftp://nope' } })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/http:\/\/ 또는 https:\/\//)).toBeTruthy()
  })

  it('주소 모양이 아니어도 잠근다', () => {
    const { input, button } = setup()
    fireEvent.change(input, { target: { value: '그냥 글자' } })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  // 빈 값은 "기본값을 쓴다" 는 뜻이라 오류가 아니다
  it('비운 것은 오류가 아니다', () => {
    const { input, button } = setup()
    fireEvent.change(input, { target: { value: '' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('진단이 도는 동안', () => {
  // 도는 중에 또 누르면 진단이 겹친다
  it('버튼을 잠그고 진단 중임을 알린다', () => {
    const { button } = setup({ running: true })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.textContent).toContain('진단 중…')
  })
})
