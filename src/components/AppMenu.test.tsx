// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppMenu } from './AppMenu'
import { accel } from '../state/modKey'

afterEach(cleanup)

const NOOP = { onSettings: () => {}, onLogs: () => {}, onFeedback: () => {} }

describe('⚙ 메뉴', () => {
  it('닫혀 있으면 항목을 그리지 않는다', () => {
    render(<AppMenu {...NOOP} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('설정을 담고, 개발자 모드면 로그 보기도 담는다', () => {
    render(<AppMenu {...NOOP} developerMode />)
    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(screen.getByText('설정…')).toBeTruthy()
    expect(screen.getByText('로그 보기')).toBeTruthy()
  })

  it('일반 모드에서는 로그 보기가 없다 (개발자 전용)', () => {
    render(<AppMenu {...NOOP} />)
    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(screen.getByText('설정…')).toBeTruthy()
    expect(screen.queryByText('로그 보기')).toBeNull()
  })

  it('설정을 고르면 알리고 닫는다', () => {
    const onSettings = vi.fn()
    render(<AppMenu {...NOOP} onSettings={onSettings} />)

    fireEvent.click(screen.getByTitle('설정·메뉴'))
    fireEvent.click(screen.getByText('설정…'))

    expect(onSettings).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('로그 보기를 고르면 알리고 닫는다', () => {
    const onLogs = vi.fn()
    render(<AppMenu {...NOOP} onLogs={onLogs} developerMode />)

    fireEvent.click(screen.getByTitle('설정·메뉴'))
    fireEvent.click(screen.getByText('로그 보기'))

    expect(onLogs).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // 단축키 표기는 설정의 목록과 **같은 판정**(modKey.accel)에서 나와야 한다.
  // 여기서 '⌘,' 를 하드코딩하면 Windows 에서 메뉴만 ⌘ 로 남아 목록과 갈린다.
  it('설정·로그에 등록된 단축키를 함께 적는다 (표기는 modKey 한 곳에서)', () => {
    render(<AppMenu {...NOOP} developerMode />)
    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(screen.getByText(accel(','))).toBeTruthy()
    expect(screen.getByText(accel('L'))).toBeTruthy()
  })

  // 「로그 보기」가 없으면 ⌘L 도 등록되지 않는다 (App.tsx) — 표기도 함께 사라져야 한다
  it('일반 모드에서는 로그 단축키 표기도 없다', () => {
    render(<AppMenu {...NOOP} />)
    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(screen.queryByText(accel('L'))).toBeNull()
  })

  // 단축키가 없는 항목은 그 자리를 비운다 — 가짜 키를 만들지 않는다
  it('항목마다 단축키가 있는 것만 키 칸을 갖는다', () => {
    const { container } = render(<AppMenu {...NOOP} developerMode />)
    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(container.querySelectorAll('.app-menu__item').length).toBe(2)
    expect(container.querySelectorAll('.app-menu__keys').length).toBe(2)
  })

  // 소스 관리는 이 메뉴에 두지 않는다 — 여는 길은 사이드바(「전체 화면에서 보기」) 하나다.
  it('메뉴에 소스 관리 항목이 없다', () => {
    render(<AppMenu {...NOOP} />)

    fireEvent.click(screen.getByTitle('설정·메뉴'))

    expect(screen.queryByText(/소스 관리/)).toBeNull()
  })

  it('바깥을 누르면 닫힌다', () => {
    render(<AppMenu {...NOOP} />)

    fireEvent.click(screen.getByTitle('설정·메뉴'))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
