// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OUTLINE, URL_A, davisStub, index, renderTab } from './extensionRegistryTestBed'
import type { RegistryEntry } from '../../shared/extensions/registryIndex'

// `ExtensionRegistryTab.test.tsx` 에서 갈라 나온 셋째 — **내려받아 설치**만 본다.
// 가른 이유는 300줄 상한이다 (선례: `ScmChanges.diff.test.tsx`). 준비부는 testBed 하나다.
//
// 이 화면이 지켜야 하는 것:
// - 목록이 아니라 **`latest` 에 해당하는 버전의 주소**로 받는다
// - 성공 문구의 이름·버전은 배포처가 아니라 **패키지 매니페스트**에서 온 것이다
// - 받는 동안 **그 줄만** 잠긴다 — 배포처가 여러 개면 목록 전체가 굳을 이유가 없다

/** 같은 확장의 옛 버전도 함께 실어 둔다 — 목록에서 `latest` 를 골라내는지 보려면 필요하다 */
const MULTI: RegistryEntry = {
  ...OUTLINE,
  latest: '0.2.0',
  versions: [
    { version: '0.2.0', url: 'http://localhost:4321/packages/sample-ext/0.2.0' },
    { version: '0.1.0', url: 'http://localhost:4321/packages/sample-ext/0.1.0' },
  ],
}

const OTHER: RegistryEntry = {
  name: 'todo-collector',
  displayName: '할 일 모음',
  latest: '1.0.0',
  versions: [{ version: '1.0.0', url: 'http://localhost:4321/packages/todo-collector/1.0.0' }],
}

beforeEach(() => {
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [URL_A] })
  davisStub.addExtensionRegistry.mockReset()
  davisStub.removeExtensionRegistry.mockReset()
  davisStub.fetchExtensionRegistry.mockReset().mockResolvedValue({
    ok: true,
    url: URL_A,
    index: index('사내 공통 배포처', [MULTI]),
  })
  davisStub.installExtensionFromRegistry.mockReset()
})

afterEach(cleanup)

describe('내려받아 설치', () => {
  it('latest 에 해당하는 버전의 주소로 받는다', async () => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({
      ok: true,
      name: 'sample-ext',
      version: '0.2.0',
    })

    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    await waitFor(() => expect(davisStub.installExtensionFromRegistry).toHaveBeenCalledTimes(1))
    expect(davisStub.installExtensionFromRegistry).toHaveBeenCalledWith({
      url: 'http://localhost:4321/packages/sample-ext/0.2.0',
    })
  })

  // 배포처 목록과 패키지 매니페스트가 어긋나면 매니페스트가 사실이다 (설치 폴더를 그쪽이 정한다)
  it('알림의 이름·버전은 배포처가 아니라 설치 결과에서 온다', async () => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({
      ok: true,
      name: 'other-name',
      version: '9.9.9',
    })

    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    expect(await screen.findByText(/other-name 9\.9\.9 을\(를\) 설치했습니다/)).toBeTruthy()
  })

  // 배포처 말만 믿고 화면을 고치면 실제 설치본과 달라진다
  it('설치가 끝나면 부모에게 설치 목록을 다시 읽으라 한다', async () => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({
      ok: true,
      name: 'sample-ext',
      version: '0.2.0',
    })
    const onInstalled = vi.fn()

    renderTab([], onInstalled)
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(1))
  })

  it('실패해도 목록을 다시 읽지 않는다 — 달라진 것이 없다', async () => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({
      ok: false,
      reason: 'unreachable',
    })
    const onInstalled = vi.fn()

    renderTab([], onInstalled)
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    await screen.findByText(/패키지를 받지 못했습니다/)
    expect(onInstalled).not.toHaveBeenCalled()
  })
})

describe('실패 사유를 사람 말로 — 받기와 풀기가 한 통로로 온다', () => {
  it.each([
    ['unreachable', /패키지를 받지 못했습니다/],
    ['timeout', /받는 데 시간이 너무 걸렸습니다/],
    ['write_failed', /디스크에 쓰지 못했습니다/],
    ['unsafe_entry', /설치 폴더 밖을 가리키는 경로/],
    ['unreadable_package', /확장 패키지가 아닙니다/],
    ['invalid_manifest', /확장 규격에 맞지 않습니다/],
  ])('%s', async (reason, expected) => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({ ok: false, reason })

    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    expect(await screen.findByText(expected)).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다 — 감추면 고칠 수 없다', async () => {
    davisStub.installExtensionFromRegistry.mockResolvedValue({
      ok: false,
      reason: 'wat_is_this',
      detail: '무언가',
    })

    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '설치' }))

    expect(await screen.findByText(/알 수 없는 사유 \(wat_is_this\) \(무언가\)/)).toBeTruthy()
  })
})

describe('받는 동안', () => {
  it('그 줄만 잠기고 다른 줄은 그대로 눌린다', async () => {
    davisStub.fetchExtensionRegistry.mockResolvedValue({
      ok: true,
      url: URL_A,
      index: index('사내 공통 배포처', [MULTI, OTHER]),
    })
    // 끝나지 않는 설치 — "받는 중" 상태를 붙잡아 둔다
    davisStub.installExtensionFromRegistry.mockReturnValue(new Promise(() => {}))

    renderTab()
    // 두 줄 다 "설치" 라 버튼 이름만으로는 특정되지 않는다 — 줄로 범위를 좁힌다
    // (줄마다 「상세」도 있으므로 이름까지 함께 준다)
    const sampleRow = (await screen.findByText('샘플 확장')).closest('li')!
    fireEvent.click(within(sampleRow).getByRole('button', { name: '설치' }))

    // 누른 줄은 "받는 중…" 으로 잠긴다
    const busy = (await screen.findByRole('button', { name: '받는 중…' })) as HTMLButtonElement
    expect(busy.disabled).toBe(true)

    // 다른 확장은 그대로 받을 수 있다
    const otherRow = screen.getByText('할 일 모음').closest('li')!
    const otherButton = within(otherRow).getByRole('button', { name: '설치' }) as HTMLButtonElement
    expect(otherButton.disabled).toBe(false)
  })
})
