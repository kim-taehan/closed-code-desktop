// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionDetail } from './ExtensionDetail'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import type { ExtensionReadmeResult } from '../../shared/ipc/extensionPayloads'

// 설정 창 「상세」 — 확장의 README.md 를 그린다.
//
// 이 화면이 지켜야 하는 것:
// - **설명이 없는 것은 오류가 아니다.** README 없는 확장이 대부분이라 오류로 그리면
//   멀쩡한 확장이 고장난 것처럼 보인다
// - 진짜 오류는 사유가 보이고, 모르는 사유는 코드를 그대로 보여준다
// - 설치 위치를 늘 보여준다 — 폴더째 복사·심링크로도 설치되므로 어디 것인지가 정보다

const OUTLINE: ExtensionEntryPayload = {
  name: 'sample-ext',
  displayName: '샘플 확장',
  version: '0.1.0',
  dir: '/Users/x/.davis-code/desktop-extensions/sample-ext',
  enabled: true,
}

const readExtensionReadme = vi.fn<() => Promise<ExtensionReadmeResult>>()
;(window as unknown as { davis: unknown }).davis = { readExtensionReadme }

beforeEach(() => {
  readExtensionReadme.mockReset().mockResolvedValue({ ok: true, text: '# 제목' })
})

afterEach(cleanup)

describe('확장 상세', () => {
  it('그 확장의 이름으로 README 를 묻는다', async () => {
    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    await waitFor(() => expect(readExtensionReadme).toHaveBeenCalledWith({ name: 'sample-ext' }))
  })

  it('이름·버전·설치 위치를 보여준다', async () => {
    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    expect(screen.getByText('샘플 확장')).toBeTruthy()
    expect(screen.getByText('0.1.0')).toBeTruthy()
    expect(screen.getByText(OUTLINE.dir)).toBeTruthy()
  })

  it('README 를 마크다운으로 그린다', async () => {
    readExtensionReadme.mockResolvedValue({
      ok: true,
      text: '# 샘플 확장\n\n무언가를 모읍니다.',
    })

    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    // 원문(`# 샘플 확장`)이 아니라 제목으로 그려져야 한다
    const heading = await screen.findByRole('heading', { name: '샘플 확장' })
    expect(heading).toBeTruthy()
    expect(screen.getByText('무언가를 모읍니다.')).toBeTruthy()
  })

  it('「← 목록」 을 누르면 돌아간다', async () => {
    const onBack = vi.fn()
    render(<ExtensionDetail extension={OUTLINE} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: '← 목록' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('설명이 없는 것은 오류가 아니다', () => {
  it('없으면 어떻게 하면 되는지 알려준다 — 오류로 그리지 않는다', async () => {
    readExtensionReadme.mockResolvedValue({ ok: false, reason: 'missing' })

    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    expect(await screen.findByText(/이 확장에는 설명이 없습니다/)).toBeTruthy()
    expect(screen.getByText(/README.md 를 두면 여기 보입니다/)).toBeTruthy()
  })

  it.each([
    ['too_large', /너무 커서/],
    ['not_file', /파일이 아닙니다/],
    ['unreadable', /읽지 못했습니다/],
    ['outside', /이름이 올바르지 않습니다/],
  ])('%s 는 사유가 보인다', async (reason, expected) => {
    readExtensionReadme.mockResolvedValue({ ok: false, reason })

    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    expect(await screen.findByText(expected)).toBeTruthy()
  })

  it('모르는 사유는 코드를 그대로 보여준다 — 감추면 고칠 수 없다', async () => {
    readExtensionReadme.mockResolvedValue({ ok: false, reason: 'wat_is_this' })

    render(<ExtensionDetail extension={OUTLINE} onBack={vi.fn()} />)

    expect(await screen.findByText(/알 수 없는 사유 \(wat_is_this\)/)).toBeTruthy()
  })
})
