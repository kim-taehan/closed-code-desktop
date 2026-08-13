// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionsSection } from './ExtensionsSection'
import type {
  ExtensionEntryPayload,
  ExtensionInstallPayload,
  ExtensionListPayload,
  ExtensionReadmeResult,
  ExtensionUninstallResult,
} from '../../shared/ipc/extensionPayloads'
import type { RegistryListPayload } from '../../shared/ipc/extensionRegistryPayloads'

// 설치됨 탭의 **켜기/끄기·삭제**. 목록 표시는 `ExtensionsSection.test.tsx` 몫이다 (300줄 상한).
//
// 여기서 지키는 것 셋:
// - 끈 확장도 **목록에 남는다.** 사라지면 다시 켤 자리가 없다
// - 지우기는 되돌릴 수 없어 **한 번 묻는다.** 바로 지우지 않는다
// - 어느 쪽이든 끝나면 목록을 **다시 읽는다** — main 이 실패했을 때 화면만 앞서가면 안 된다

function extension(overrides: Partial<ExtensionEntryPayload> = {}): ExtensionEntryPayload {
  return {
    name: 'line-checker',
    displayName: '라인 체커',
    version: '0.3.0',
    dir: '/home/u/.open-code/desktop-extensions/line-checker',
    enabled: true,
    ...overrides,
  }
}

const davisStub = {
  listExtensions: vi.fn<() => Promise<ExtensionListPayload>>(),
  installExtensionFromDisk: vi.fn<() => Promise<ExtensionInstallPayload>>(),
  listExtensionRegistries: vi.fn<() => Promise<RegistryListPayload>>(),
  readExtensionReadme: vi.fn<() => Promise<ExtensionReadmeResult>>(),
  setExtensionEnabled: vi.fn<() => Promise<void>>(),
  uninstallExtension: vi.fn<() => Promise<ExtensionUninstallResult>>(),
}
;(window as unknown as { davis: unknown }).davis = davisStub

function showing(...extensions: ExtensionEntryPayload[]) {
  davisStub.listExtensions.mockResolvedValue({ extensions, skipped: [] })
}

beforeEach(() => {
  davisStub.listExtensions.mockReset().mockResolvedValue({ extensions: [], skipped: [] })
  davisStub.installExtensionFromDisk.mockReset()
  davisStub.listExtensionRegistries.mockReset().mockResolvedValue({ urls: [] })
  davisStub.readExtensionReadme.mockReset().mockResolvedValue({ ok: false, reason: 'missing' })
  davisStub.setExtensionEnabled.mockReset().mockResolvedValue(undefined)
  davisStub.uninstallExtension.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

describe('켜기/끄기', () => {
  it('끄면 이름으로 알린다 — 폴더가 아니라 이름이 확장의 신원이다', async () => {
    showing(extension())
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByLabelText('라인 체커 켜기'))

    await waitFor(() =>
      expect(davisStub.setExtensionEnabled).toHaveBeenCalledWith({
        name: 'line-checker',
        enabled: false,
      }),
    )
  })

  it('끝나면 목록을 다시 읽는다 — 화면만 앞서가면 main 이 실패해도 켜진 것처럼 보인다', async () => {
    showing(extension())
    render(<ExtensionsSection />)
    await screen.findByLabelText('라인 체커 켜기')
    const before = davisStub.listExtensions.mock.calls.length

    fireEvent.click(screen.getByLabelText('라인 체커 켜기'))

    await waitFor(() =>
      expect(davisStub.listExtensions.mock.calls.length).toBeGreaterThan(before),
    )
  })

  // 목록에서까지 사라지면 다시 켤 자리가 없다
  it('꺼진 확장도 목록에 남고 꺼짐이라고 말한다', async () => {
    showing(extension({ enabled: false }))
    render(<ExtensionsSection />)

    expect(await screen.findByText('라인 체커')).toBeTruthy()
    expect(screen.getByText(/꺼짐/)).toBeTruthy()
    expect((screen.getByLabelText('라인 체커 켜기') as HTMLInputElement).checked).toBe(false)
  })
})

describe('삭제', () => {
  it('바로 지우지 않고 한 번 묻는다', async () => {
    showing(extension())
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))

    expect(screen.getByText('지울까요?')).toBeTruthy()
    expect(davisStub.uninstallExtension).not.toHaveBeenCalled()
  })

  it('확인하면 폴더로 지운다 — 설치 폴더 이름이 확장 이름과 늘 같지는 않다', async () => {
    showing(extension())
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))

    await waitFor(() =>
      expect(davisStub.uninstallExtension).toHaveBeenCalledWith({
        dir: '/home/u/.open-code/desktop-extensions/line-checker',
      }),
    )
  })

  it('물음을 취소하면 아무 일도 없다', async () => {
    showing(extension())
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(screen.getByRole('button', { name: '삭제' })).toBeTruthy()
    expect(davisStub.uninstallExtension).not.toHaveBeenCalled()
  })

  it('못 지우면 사유를 알린다 — 조용히 지워진 척하면 안 된다', async () => {
    showing(extension())
    davisStub.uninstallExtension.mockResolvedValue({ ok: false, reason: 'outside' })
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))

    expect(await screen.findByText(/설치 폴더 밖은 지우지 않습니다/)).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다', async () => {
    showing(extension())
    davisStub.uninstallExtension.mockResolvedValue({ ok: false, reason: 'weird' })
    render(<ExtensionsSection />)

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))

    expect(await screen.findByText(/지우지 못했습니다 \(weird\)/)).toBeTruthy()
  })
})
