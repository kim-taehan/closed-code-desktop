// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionRegistryTab } from './ExtensionRegistryTab'
import { OUTLINE, URL_A, URL_B, davisStub, index, renderTab } from './extensionRegistryTestBed'

// 배포처를 못 읽었을 때. **사유가 사람 말로** 보여야 한다.
//
// 폐쇄망에서 배포처가 안 보이는 원인은 대개 주소 오타 · 사내망 미접속 · 서버 다운
// 셋 중 하나인데 **고치는 방법이 전혀 다르다.** "조회 실패" 한 줄로 뭉뚱그리면
// 사용자가 어디를 봐야 할지 모른다.
//
// 나머지(등록·조회 성공·상태 판정)는 `ExtensionRegistryTab.test.tsx` 몫이다.

beforeEach(() => {
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [URL_A] })
  davisStub.addExtensionRegistry.mockReset()
  davisStub.removeExtensionRegistry.mockReset()
  davisStub.fetchExtensionRegistry.mockReset()
})

afterEach(cleanup)

describe('조회 실패 — 사유를 갈라 보여준다', () => {
  it.each([
    ['bad_url', /주소 형식이 올바르지 않습니다/],
    ['unreachable', /배포처에 닿지 못했습니다/],
    ['timeout', /제때 응답하지 않았습니다/],
    ['invalid_json', /JSON 형식이 아닙니다/],
    ['unsupported_registry_version', /읽을 수 없는 registryVersion/],
  ])('%s 는 사람 말로 보인다', async (reason, expected) => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({ ok: false, url: URL_A, reason })

    renderTab()

    expect(await screen.findByText(expected)).toBeTruthy()
  })

  it('HTTP 오류는 상태 코드까지 보여준다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: false,
      url: URL_A,
      reason: 'http_error',
      detail: 'HTTP 404',
    })

    renderTab()

    expect(await screen.findByText(/배포처가 오류를 돌려줬습니다 \(HTTP 404\)/)).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다 — 감추면 고칠 수 없다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: false,
      url: URL_A,
      reason: 'wat_is_this',
    })

    renderTab()

    expect(await screen.findByText(/알 수 없는 사유 \(wat_is_this\)/)).toBeTruthy()
  })

  // 이름은 목록 문서 안에 있어서 못 읽으면 모른다. 주소로 알린다
  it('어느 배포처가 실패했는지 주소로 알린다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: false,
      url: URL_A,
      reason: 'unreachable',
    })

    renderTab()

    expect(await screen.findByText(URL_A)).toBeTruthy()
  })

  /**
   * 한 곳이 죽었다고 나머지 배포처의 확장까지 못 보게 만들지 않는다.
   * 폐쇄망에서 배포처가 여러 개면 흔한 상황이다.
   */
  it('한 배포처가 실패해도 나머지 목록은 보인다', async () => {
    davisStub.listExtensionRegistries.mockResolvedValue({ urls: [URL_A, URL_B] })
    davisStub.fetchExtensionRegistry.mockImplementation((async (payload: { url: string }) =>
      payload.url === URL_A
        ? { ok: false, url: URL_A, reason: 'unreachable' }
        : { ok: true, url: URL_B, index: index('사내 공통 배포처', [OUTLINE]) }) as never)

    renderTab()

    expect(await screen.findByText(/배포처에 닿지 못했습니다/)).toBeTruthy()
    expect(screen.getByText('샘플 확장')).toBeTruthy()
  })

  // 배포처가 하나도 없으면 조회할 곳이 없다 — 실패도 아니다
  it('배포처가 없으면 묻지 않는다', async () => {
    davisStub.listExtensionRegistries.mockResolvedValue({ urls: [] })

    render(<ExtensionRegistryTab installed={[]} />)

    expect(await screen.findByText(/등록한 배포처가 없습니다/)).toBeTruthy()
    expect(davisStub.fetchExtensionRegistry).not.toHaveBeenCalled()
  })
})
