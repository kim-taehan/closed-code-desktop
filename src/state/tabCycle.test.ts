import { describe, expect, it, vi } from 'vitest'
import { cycleTab, tabNavigation } from './tabCycle'
import type { OpenFilesApi } from './useOpenFiles'

// 본문 탭 순환·닫기. ⌘W·Ctrl+Tab 과 ←·→ 제스처가 공유하는 경로라 여기가 틀리면 둘 다 틀린다.

const FILES = ['/a.ts', '/b.ts']

describe('cycleTab — 순환 순서', () => {
  it('대화 → 파일들 → 로그 → 대화로 감긴다', () => {
    expect(cycleTab({ active: 'chat', files: FILES, logsOpen: true, direction: 1 })).toBe('/a.ts')
    expect(cycleTab({ active: '/a.ts', files: FILES, logsOpen: true, direction: 1 })).toBe('/b.ts')
    expect(cycleTab({ active: '/b.ts', files: FILES, logsOpen: true, direction: 1 })).toBe('logs')
    expect(cycleTab({ active: 'logs', files: FILES, logsOpen: true, direction: 1 })).toBe('chat')
  })

  it('역방향도 감긴다 — 대화에서 뒤로 가면 마지막 탭', () => {
    expect(cycleTab({ active: 'chat', files: FILES, logsOpen: true, direction: -1 })).toBe('logs')
    expect(cycleTab({ active: '/a.ts', files: FILES, logsOpen: true, direction: -1 })).toBe('chat')
  })

  it('로그 탭이 닫혀 있으면 순환에서 빠진다', () => {
    expect(cycleTab({ active: '/b.ts', files: FILES, logsOpen: false, direction: 1 })).toBe('chat')
  })

  it('대화 탭만 있으면 제자리다', () => {
    expect(cycleTab({ active: 'chat', files: [], logsOpen: false, direction: 1 })).toBe('chat')
  })

  it('모르는 활성 탭은 대화 기준으로 센다 — 순환이 멈추지 않게', () => {
    expect(cycleTab({ active: '/gone.ts', files: FILES, logsOpen: false, direction: 1 })).toBe('/a.ts')
  })

  it('소스 관리는 로그 뒤에 낀다 — 화면의 탭 줄과 같은 순서', () => {
    const open = { files: FILES, logsOpen: true, scmOpen: true }
    expect(cycleTab({ ...open, active: 'logs', direction: 1 })).toBe('git')
    expect(cycleTab({ ...open, active: 'git', direction: 1 })).toBe('chat')
    expect(cycleTab({ ...open, active: 'chat', direction: -1 })).toBe('git')
  })

  it('소스 관리가 닫혀 있으면 순환에서 빠진다', () => {
    expect(cycleTab({ active: 'logs', files: FILES, logsOpen: true, scmOpen: false, direction: 1 })).toBe('chat')
    // 인자를 아예 안 줘도 같다 (기존 호출부는 넘기지 않는다)
    expect(cycleTab({ active: 'logs', files: FILES, logsOpen: true, direction: 1 })).toBe('chat')
  })

  it('로그가 닫혀 있어도 소스 관리는 낀다 — 서로 매이지 않는다', () => {
    expect(cycleTab({ active: '/b.ts', files: FILES, logsOpen: false, scmOpen: true, direction: 1 })).toBe('git')
  })
})

function makeOpenFiles(active: string): OpenFilesApi & { close: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> } {
  return {
    files: FILES.map((path) => ({ path, text: '' })),
    active,
    open: vi.fn(),
    openRouted: vi.fn(),
    openDiff: vi.fn(),
  openHtml: vi.fn(),
    close: vi.fn(),
    closeMany: vi.fn(),
    select: vi.fn(),
    edit: vi.fn(),
    flush: vi.fn(),
    setSelection: vi.fn(),
    chatContext: { dirtyFiles: [] },
  }
}

describe('tabNavigation — 닫기 경로', () => {
  it('파일 탭이면 그 파일을 닫는다 (MainTabs × 와 동일)', () => {
    const openFiles = makeOpenFiles('/a.ts')
    tabNavigation(openFiles, false, vi.fn()).closeActive()
    expect(openFiles.close).toHaveBeenCalledWith('/a.ts')
  })

  it('로그 탭이면 로그를 닫고 대화로 돌아간다', () => {
    const openFiles = makeOpenFiles('logs')
    const closeLogs = vi.fn()
    tabNavigation(openFiles, true, closeLogs).closeActive()
    expect(closeLogs).toHaveBeenCalledTimes(1)
    expect(openFiles.select).toHaveBeenCalledWith('chat')
  })

  it('대화 탭이면 아무 것도 안 한다 — 창을 닫지 않는다 (사용자 결정)', () => {
    const openFiles = makeOpenFiles('chat')
    const closeLogs = vi.fn()
    tabNavigation(openFiles, false, closeLogs).closeActive()
    expect(openFiles.close).not.toHaveBeenCalled()
    expect(closeLogs).not.toHaveBeenCalled()
  })

  it('소스 관리 탭이면 그 탭을 닫고 대화로 돌아간다 (파일이 아니라 close 로 안 닫힌다)', () => {
    const openFiles = makeOpenFiles('git')
    const closeScm = vi.fn()
    tabNavigation(openFiles, false, vi.fn(), { open: true, close: closeScm }).closeActive()
    expect(closeScm).toHaveBeenCalledTimes(1)
    expect(openFiles.select).toHaveBeenCalledWith('chat')
    expect(openFiles.close).not.toHaveBeenCalled()
  })

  it('소스 관리가 열려 있으면 순환에 낀다', () => {
    const openFiles = makeOpenFiles('chat')
    tabNavigation(openFiles, false, vi.fn(), { open: true, close: vi.fn() }).prev()
    expect(openFiles.select).toHaveBeenLastCalledWith('git')
  })

  it('next/prev 가 select 로 순환한다', () => {
    const openFiles = makeOpenFiles('chat')
    const nav = tabNavigation(openFiles, true, vi.fn())
    nav.next()
    expect(openFiles.select).toHaveBeenLastCalledWith('/a.ts')
    nav.prev()
    expect(openFiles.select).toHaveBeenLastCalledWith('logs')
  })
})
