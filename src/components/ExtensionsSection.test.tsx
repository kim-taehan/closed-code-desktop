// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionsSection } from './ExtensionsSection'
import type {
  ExtensionInstallPayload,
  ExtensionListPayload,
} from '../../shared/ipc/extensionPayloads'
import type { ExtensionReadmeResult } from '../../shared/ipc/extensionPayloads'
import type { RegistryListPayload } from '../../shared/ipc/extensionRegistryPayloads'

// 설정 창의 "확장" 분류.
//
// 여기서는 **설치됨 탭**만 본다. 배포처 탭은 `ExtensionRegistryTab.test.tsx` 몫이라
// 여기서는 배포처가 하나도 없는 상태(빈 목록)로만 둔다.

const EMPTY: ExtensionListPayload = { extensions: [], skipped: [] }

const davisStub = {
  listExtensions: vi.fn<() => Promise<ExtensionListPayload>>(),
  installExtensionFromDisk: vi.fn<() => Promise<ExtensionInstallPayload>>(),
  listExtensionRegistries: vi.fn<() => Promise<RegistryListPayload>>(),
  readExtensionReadme: vi.fn<() => Promise<ExtensionReadmeResult>>(),
}
;(window as unknown as { davis: unknown }).davis = davisStub

beforeEach(() => {
  davisStub.listExtensions.mockReset().mockResolvedValue(EMPTY)
  davisStub.installExtensionFromDisk.mockReset()
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [] })
  davisStub.readExtensionReadme.mockReset().mockResolvedValue({ ok: false, reason: 'missing' })
})

afterEach(cleanup)

describe('설치됨 탭', () => {
  it('열자마자 설치됨을 보여주고 목록을 물어본다', async () => {
    render(<ExtensionsSection />)

    expect(screen.getByRole('tab', { name: /설치됨/ }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(davisStub.listExtensions).toHaveBeenCalled())
  })

  it('하나도 없으면 무엇을 하라고 알려준다 — 빈 목록만 보이면 막힌다', async () => {
    render(<ExtensionsSection />)

    expect(await screen.findByText(/아직 설치한 확장이 없습니다/)).toBeTruthy()
    expect(screen.getByText(/디스크에서 설치하세요/)).toBeTruthy()
  })

  it('설치된 확장을 이름·설명·버전으로 보여준다', async () => {
    davisStub.listExtensions.mockResolvedValue({
      extensions: [
        {
          name: 'sample-ext',
          displayName: '샘플 확장',
          version: '0.1.0',
          description: '무언가를 모읍니다',
          dir: '/home/u/.davis-code/desktop-extensions/sample-ext',
          enabled: true,
        },
      ],
      skipped: [],
    })

    render(<ExtensionsSection />)

    expect(await screen.findByText('샘플 확장')).toBeTruthy()
    expect(screen.getByText(/무언가를 모읍니다 · 0\.1\.0/)).toBeTruthy()
  })

  // 감추면 "설치했는데 목록에 안 뜬다" 로 끝난다. 이 화면의 존재 이유 중 하나다.
  it('건너뛴 것을 사유와 함께 보여준다', async () => {
    davisStub.listExtensions.mockResolvedValue({
      extensions: [],
      skipped: [{ dir: '/x/broken-ext', reason: 'missing_manifest_version' }],
    })

    render(<ExtensionsSection />)

    expect(await screen.findByText('broken-ext')).toBeTruthy()
    expect(screen.getByText('manifestVersion 이 없습니다')).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다 — 감추면 고칠 수 없다', async () => {
    davisStub.listExtensions.mockResolvedValue({
      extensions: [],
      skipped: [{ dir: '/x/odd', reason: 'wat_is_this' }],
    })

    render(<ExtensionsSection />)

    expect(await screen.findByText(/알 수 없는 사유 \(wat_is_this\)/)).toBeTruthy()
  })
})

describe('디스크에서 설치', () => {
  it('설치하면 결과를 알리고 목록을 다시 읽는다', async () => {
    davisStub.installExtensionFromDisk.mockResolvedValue({
      ok: true,
      name: 'sample-ext',
      version: '0.1.0',
    })

    render(<ExtensionsSection />)
    await waitFor(() => expect(davisStub.listExtensions).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '디스크에서 설치…' }))

    expect(await screen.findByText(/sample-ext 0\.1\.0 을\(를\) 설치했습니다/)).toBeTruthy()
    // 설치 결과만 믿지 않는다 — 방금 넣은 것이 훑기에서 걸러졌을 수 있다
    await waitFor(() => expect(davisStub.listExtensions).toHaveBeenCalledTimes(2))
  })

  // 창을 닫은 사람에게 오류를 보여주면 안 된다
  it('사용자가 파일 선택을 취소하면 아무 말도 하지 않는다', async () => {
    davisStub.installExtensionFromDisk.mockResolvedValue({ ok: false, cancelled: true })

    render(<ExtensionsSection />)
    await waitFor(() => expect(davisStub.listExtensions).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '디스크에서 설치…' }))

    await waitFor(() => expect(davisStub.installExtensionFromDisk).toHaveBeenCalled())
    expect(screen.queryByText(/설치하지 못했습니다/)).toBeNull()
    expect(davisStub.listExtensions).toHaveBeenCalledTimes(1)
  })

  it('실패하면 사유를 사람 말로 알린다', async () => {
    davisStub.installExtensionFromDisk.mockResolvedValue({
      ok: false,
      reason: 'unsafe_entry',
      detail: '../../evil.js',
    })

    render(<ExtensionsSection />)
    fireEvent.click(screen.getByRole('button', { name: '디스크에서 설치…' }))

    expect(
      await screen.findByText(/설치 폴더 밖을 가리키는 경로가 있습니다 \(\.\.\/\.\.\/evil\.js\)/),
    ).toBeTruthy()
  })
})

describe('배포처 탭으로 가는 길', () => {
  it('탭을 누르면 배포처 화면이 열리고 기억한 주소를 물어본다', async () => {
    render(<ExtensionsSection />)

    fireEvent.click(screen.getByRole('tab', { name: '배포처' }))

    await waitFor(() => expect(davisStub.listExtensionRegistries).toHaveBeenCalled())
    expect(await screen.findByText(/등록한 배포처가 없습니다/)).toBeTruthy()
  })

  // 배포처 행의 설치 상태를 판정하려면 설치 목록이 있어야 한다
  it('배포처 탭에서도 설치 목록을 알고 있다', async () => {
    render(<ExtensionsSection />)
    await waitFor(() => expect(davisStub.listExtensions).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('tab', { name: '배포처' }))

    expect(davisStub.listExtensions).toHaveBeenCalledTimes(1)
  })
})

// 목록을 갈아끼우는 방식이라, 버튼이 실제로 상세로 넘기는지는 여기서만 드러난다
describe('상세로 넘어가기', () => {
  beforeEach(() => {
    davisStub.listExtensions.mockResolvedValue({
      extensions: [
        { name: 'sample-ext', displayName: '샘플 확장', version: '0.1.0', dir: '/x', enabled: true },
      ],
      skipped: [],
    })
  })

  it('「상세」를 누르면 그 확장의 상세가 목록을 갈아끼운다', async () => {
    render(<ExtensionsSection />)
    await screen.findByText('샘플 확장')

    fireEvent.click(screen.getByRole('button', { name: '상세' }))

    // 목록 자리의 탭이 사라지고 돌아가는 길이 생긴다
    expect(await screen.findByRole('button', { name: '← 목록' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /배포처/ })).toBeNull()
  })

  it('「← 목록」 으로 돌아오면 목록이 다시 보인다', async () => {
    render(<ExtensionsSection />)
    await screen.findByText('샘플 확장')
    fireEvent.click(screen.getByRole('button', { name: '상세' }))

    fireEvent.click(await screen.findByRole('button', { name: '← 목록' }))

    expect(await screen.findByRole('tab', { name: /배포처/ })).toBeTruthy()
  })
})
