// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RegistryEntry } from '../../shared/extensions/registryIndex'
import { URL_A, davisStub, index, renderTab } from './extensionRegistryTestBed'

// 설정 창 "확장 → 배포처" 의 **상세** — 받기 전에 설명을 읽는 자리 (표준 §4.4).
//
// 여기서 지켜야 하는 것 셋:
// - 설명 주소는 **목록 문서가 준 것**이다. 앱이 만들어 내지 않는다
// - 배포처가 설명을 안 내놓으면(정적 파일로 손수 쓴 곳) 묻지도 않는다 — 그게 정상이다
// - 주소가 있는데 못 받은 것은 오류다. 조용히 "설명 없음" 으로 바꾸면 배포처가 틀린 채로 남는다

const WITH_README: RegistryEntry = {
  name: 'line-checker',
  displayName: '라인 체커',
  description: '줄 수가 많은 파일부터 모아 봅니다',
  latest: '0.3.0',
  versions: [
    {
      version: '0.3.0',
      url: 'http://localhost:4321/packages/line-checker/0.3.0',
      readme: 'http://localhost:4321/packages/line-checker/0.3.0/readme',
    },
  ],
}

const WITHOUT_README: RegistryEntry = {
  name: 'plain-ext',
  displayName: '설명 없는 확장',
  latest: '1.0.0',
  versions: [{ version: '1.0.0', url: 'http://localhost:4321/packages/plain-ext/1.0.0' }],
}

function showing(entry: RegistryEntry) {
  davisStub.listExtensionRegistries.mockResolvedValue({ urls: [URL_A] })
  davisStub.fetchExtensionRegistry.mockResolvedValue({
    ok: true,
    url: URL_A,
    index: index('로컬 임시 배포처', [entry]),
  })
}

/** 목록에서 그 줄의 「상세」를 누른다 */
async function openDetail(name: string) {
  const row = (await screen.findByText(name)).closest('li')!
  fireEvent.click(within(row, '상세'))
}

function within(row: HTMLElement, name: string): HTMLElement {
  const found = [...row.querySelectorAll('button')].find((button) => button.textContent === name)
  if (!found) throw new Error(`줄에 "${name}" 버튼이 없다`)
  return found
}

beforeEach(() => {
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [] })
  davisStub.fetchExtensionRegistry.mockReset()
  davisStub.fetchExtensionRegistryReadme.mockReset()
  davisStub.installExtensionFromRegistry.mockReset()
})

afterEach(cleanup)

describe('받기 전에 설명을 읽는다', () => {
  it('목록 문서가 준 주소를 그대로 조회한다 — 앱이 만들지 않는다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({ ok: true, text: '# 라인 체커' })

    renderTab()
    await openDetail('라인 체커')

    await waitFor(() =>
      expect(davisStub.fetchExtensionRegistryReadme).toHaveBeenCalledWith({
        url: 'http://localhost:4321/packages/line-checker/0.3.0/readme',
      }),
    )
    expect(await screen.findByText('라인 체커', { selector: 'h1' })).toBeTruthy()
  })

  it('어느 배포처의 무슨 버전인지 함께 보여준다 — 같은 확장을 여러 곳이 줄 수 있다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({ ok: true, text: '내용' })

    renderTab()
    await openDetail('라인 체커')

    expect(await screen.findByText('로컬 임시 배포처')).toBeTruthy()
    expect(screen.getByText('0.3.0')).toBeTruthy()
  })

  // 패키지를 미리 받으면 안 받을 수도 있는 것을 받는 셈이다 (폐쇄망 회선)
  it('설명을 보는 것만으로 패키지를 받지 않는다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({ ok: true, text: '내용' })

    renderTab()
    await openDetail('라인 체커')

    await screen.findByText('내용')
    expect(davisStub.installExtensionFromRegistry).not.toHaveBeenCalled()
  })

  it('목록으로 되돌아간다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({ ok: true, text: '내용' })

    renderTab()
    await openDetail('라인 체커')
    fireEvent.click(await screen.findByRole('button', { name: '← 목록' }))

    expect(await screen.findByRole('button', { name: '상세' })).toBeTruthy()
  })
})

describe('설명을 안 내놓는 배포처', () => {
  // 정적 파일로 손수 쓴 배포처가 그렇다 — 강요하지 않는다 (표준 §4.4)
  it('주소가 없으면 묻지도 않는다', async () => {
    showing(WITHOUT_README)

    renderTab()
    await openDetail('설명 없는 확장')

    expect(await screen.findByText(/이 확장에는 설명이 없습니다/)).toBeTruthy()
    expect(screen.getByText(/이 배포처는 설명을 내놓지 않았습니다/)).toBeTruthy()
    expect(davisStub.fetchExtensionRegistryReadme).not.toHaveBeenCalled()
  })
})

describe('주소는 있는데 못 받았다', () => {
  // 배포처가 틀린 것이다. 조용히 "설명 없음" 으로 바꾸면 틀린 채로 남는다
  it('오류로 알린다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({
      ok: false,
      reason: 'http_error',
      detail: 'HTTP 404',
    })

    renderTab()
    await openDetail('라인 체커')

    expect(await screen.findByText('배포처가 설명을 주지 않았습니다')).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다 — 감추면 고칠 수 없다', async () => {
    showing(WITH_README)
    davisStub.fetchExtensionRegistryReadme.mockResolvedValue({ ok: false, reason: 'weird' })

    renderTab()
    await openDetail('라인 체커')

    expect(await screen.findByText(/알 수 없는 사유 \(weird\)/)).toBeTruthy()
  })
})
