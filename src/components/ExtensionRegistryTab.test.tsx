// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionRegistryTab } from './ExtensionRegistryTab'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import { OUTLINE, URL_A, davisStub, index, renderTab } from './extensionRegistryTestBed'

// 설정 창 "확장 → 배포처".
//
// **네트워크에 붙지 않는다** — 조회는 IPC 너머 main 이 하고, 여기서는 stub 이다.
//
// 이 화면이 지켜야 하는 것:
// - 배포처가 없으면 무엇을 하라고 알려준다 (빈 목록만 보이면 막힌다)
// - 아직 못 하는 것(내려받아 설치)은 눌리지 않는다
//
// 조회 실패 사유는 `ExtensionRegistryTab.fail.test.tsx` 몫이다 (300줄 상한으로 갈랐다).

beforeEach(() => {
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [] })
  davisStub.addExtensionRegistry.mockReset()
  davisStub.removeExtensionRegistry.mockReset()
  davisStub.fetchExtensionRegistry.mockReset()
})

afterEach(cleanup)

describe('배포처가 하나도 없을 때', () => {
  it('무엇을 하라고 알려준다 — 빈 목록만 보이면 막힌다', async () => {
    renderTab()

    expect(await screen.findByText(/등록한 배포처가 없습니다/)).toBeTruthy()
    expect(screen.getByText(/전체 주소를 넣으세요/)).toBeTruthy()
  })

  it('고르개와 다시 조회는 눌리지 않는다 — 조회할 곳이 없다', async () => {
    renderTab()

    await waitFor(() => expect(davisStub.listExtensionRegistries).toHaveBeenCalled())
    expect((screen.getByLabelText('배포처 고르기') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '다시 조회' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    // 조회할 곳이 없으면 묻지도 않는다
    expect(davisStub.fetchExtensionRegistry).not.toHaveBeenCalled()
  })
})

describe('배포처 관리', () => {
  it('주소를 넣으면 기억하고 입력칸을 비운다', async () => {
    davisStub.addExtensionRegistry.mockResolvedValue({ ok: true, urls: [URL_A] })
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내 공통 배포처', []),
    })

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '배포처 관리…' }))

    const input = screen.getByLabelText('배포처 주소')
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(davisStub.addExtensionRegistry).toHaveBeenCalledWith({ url: URL_A })
    expect(await screen.findByText(URL_A)).toBeTruthy()
  })

  // 오타를 지워버리면 처음부터 다시 쳐야 한다
  it('주소가 틀리면 사유를 알리고 넣은 것을 지우지 않는다', async () => {
    davisStub.addExtensionRegistry.mockResolvedValue({ ok: false, reason: 'bad_url' })

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '배포처 관리…' }))
    const input = screen.getByLabelText('배포처 주소')
    fireEvent.change(input, { target: { value: '사내서버' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText(/http 또는 https 로 시작하는 전체 주소를 넣으세요/)).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('사내서버')
  })

  it('이미 등록한 주소라고 알려준다', async () => {
    davisStub.addExtensionRegistry.mockResolvedValue({ ok: false, reason: 'duplicate' })

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '배포처 관리…' }))
    fireEvent.change(screen.getByLabelText('배포처 주소'), { target: { value: URL_A } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('이미 등록한 배포처입니다')).toBeTruthy()
  })

  it('빈 칸으로는 추가할 수 없다', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '배포처 관리…' }))

    expect((screen.getByRole('button', { name: '추가' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('삭제하면 목록에서 빠진다', async () => {
    davisStub.listExtensionRegistries.mockResolvedValue({ urls: [URL_A] })
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내 공통 배포처', []),
    })
    davisStub.removeExtensionRegistry.mockResolvedValue({ urls: [] })

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '배포처 관리…' }))
    fireEvent.click(await screen.findByRole('button', { name: `삭제 ${URL_A}` }))

    expect(await screen.findByText(/등록한 배포처가 없습니다/)).toBeTruthy()
  })
})

describe('배포처 조회', () => {
  beforeEach(() => {
    davisStub.listExtensionRegistries.mockResolvedValue({ urls: [URL_A] })
  })

  it('확장을 이름·설명·버전·배포처와 함께 보여준다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내 공통 배포처', [OUTLINE]),
    })

    renderTab()

    expect(await screen.findByText('샘플 확장')).toBeTruthy()
    expect(
      screen.getByText(/무언가를 모읍니다 · 0\.2\.0 · 사내 공통 배포처/),
    ).toBeTruthy()
  })

  it('설치 안 된 것은 "설치", 버전이 다르면 "업데이트", 같으면 "설치됨"', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내', [OUTLINE]),
    })

    const { rerender } = renderTab()
    expect(await screen.findByRole('button', { name: '설치' })).toBeTruthy()

    const installed = (version: string): ExtensionEntryPayload[] => [
      { name: 'sample-ext', displayName: '샘플 확장', version, dir: '/x/sample-ext', enabled: true },
    ]

    rerender(<ExtensionRegistryTab installed={installed('0.1.0')} />)
    expect(await screen.findByRole('button', { name: '업데이트' })).toBeTruthy()

    rerender(<ExtensionRegistryTab installed={installed('0.2.0')} />)
    expect(await screen.findByRole('button', { name: '설치됨' })).toBeTruthy()
  })

  // 이미 최신이면 받을 것이 없다. 눌리는데 아무 일도 안 하면 앱이 고장난 줄 안다
  it('"설치됨" 은 눌리지 않는다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내', [OUTLINE]),
    })

    renderTab([
      { name: 'sample-ext', displayName: '샘플 확장', version: '0.2.0', dir: '/x', enabled: true },
    ])

    const button = (await screen.findByRole('button', { name: '설치됨' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('올라온 확장이 없으면 그렇다고 말한다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('빈 배포처', []),
    })

    renderTab()

    expect(await screen.findByText(/이 배포처에 올라온 확장이 없습니다/)).toBeTruthy()
  })

  it('다시 조회를 누르면 다시 묻는다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내', [OUTLINE]),
    })

    renderTab()
    await waitFor(() => expect(davisStub.fetchExtensionRegistry).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }))

    await waitFor(() => expect(davisStub.fetchExtensionRegistry).toHaveBeenCalledTimes(2))
  })
})
