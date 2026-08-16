// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunPanel } from './RunPanel'
import { setSendToRuntime } from '../state/slashCommands'
import type { ShellDrawer } from '../state/useShellDrawer'

// 「실행」 패널이 지켜야 하는 것 셋 (설계 §1·§2):
//   · 목록은 **AGENTS.md 에서** 온다 — 앱이 캐시를 따로 안 든다
//   · ▶ 는 **main 왕복이 끝난 뒤에** 탭을 만든다 (순서를 뒤집으면 명령이 안 들어간다)
//   · 절이 없으면 **묻는다** — 말없이 20초를 태우지 않는다

const AGENTS = ['## 실행', '', '| dev 서버 | `npm run dev` | 개발 서버 |'].join('\n')

let files: Record<string, string>
let runShellPane: ReturnType<typeof vi.fn>
let showPane: ReturnType<typeof vi.fn>
let closeTab: ReturnType<typeof vi.fn>
let openPanes: string[]
let exits: Record<string, number | null>
let sent: string[]

beforeEach(() => {
  files = { 'AGENTS.md': AGENTS }
  runShellPane = vi.fn().mockResolvedValue({ ok: true, started: true })
  showPane = vi.fn()
  closeTab = vi.fn()
  openPanes = ['shell']
  exits = {}
  sent = []
  setSendToRuntime((text) => sent.push(text))

  window.davis = {
    readFile: ({ path }: { path: string }) =>
      Promise.resolve(
        files[path] === undefined
          ? { ok: false, text: '', reason: 'missing' }
          : { ok: true, text: files[path], mtimeMs: 0 },
      ),
    runShellPane,
    onRunListChanged: () => () => {},
  } as never
})

afterEach(cleanup)

function panel() {
  const shell = {
    tabs: { names: openPanes, active: 'shell' },
    exits: { exitOf: (name: string) => exits[name], clear: () => {} },
    showPane,
    closeTab,
  } as unknown as ShellDrawer

  render(<RunPanel projectId="p1" shell={shell} onOpenFile={vi.fn()} onToast={vi.fn()} />)
}

describe('RunPanel', () => {
  it('AGENTS.md 의 「실행」 절을 그린다', async () => {
    panel()
    expect(await screen.findByText('dev 서버')).toBeTruthy()
    expect(screen.getByText(/읽었습니다/)).toBeTruthy()
  })

  // 순서를 뒤집으면 그 탭이 같은 이름으로 칸을 열고, main 이 「이미 돌고 있다」로 읽어
  // 명령이 영영 안 들어간다 (`PTY_RUN` 머리말). 그래서 **왕복이 먼저**다.
  it('▶ 는 main 왕복이 끝난 뒤에 탭을 만든다', async () => {
    panel()
    fireEvent.click(await screen.findByTitle('npm run dev'))

    await waitFor(() => expect(showPane).toHaveBeenCalledWith('dev 서버'))
    expect(runShellPane).toHaveBeenCalledWith({ name: 'dev 서버', command: 'npm run dev' })
    // 먼저 부른 것이 main 이다 — 호출 순서 자체가 이 시험의 전부다
    expect(runShellPane.mock.invocationCallOrder[0]).toBeLessThan(showPane.mock.invocationCallOrder[0]!)
  })

  it('띄우지 못하면 탭을 만들지 않는다 — 빈 탭만 남으면 사용자가 뭘 볼지 모른다', async () => {
    runShellPane.mockResolvedValue({ ok: false, error: '서버가 아직 없습니다' })
    panel()
    fireEvent.click(await screen.findByTitle('npm run dev'))

    await waitFor(() => expect(runShellPane).toHaveBeenCalled())
    expect(showPane).not.toHaveBeenCalled()
  })

  it('도는 중이면 ■ 가 뜨고, 누르면 탭을 닫는다 (프로세스도 멈춘다)', async () => {
    openPanes = ['shell', 'dev 서버']
    panel()
    fireEvent.click(await screen.findByTitle('정지 (프로세스도 멈춥니다)'))

    expect(closeTab).toHaveBeenCalledWith('dev 서버')
  })

  it('끝난 것은 ▶ 로 돌아간다 — 탭이 남아 있어도', async () => {
    openPanes = ['shell', 'dev 서버']
    exits = { 'dev 서버': 1 }
    panel()

    expect(await screen.findByText('실패 · exit 1')).toBeTruthy()
    expect(screen.queryByTitle('정지 (프로세스도 멈춥니다)')).toBeNull()
  })

  it('절이 없으면 묻는다 — 말없이 분석하지 않는다', async () => {
    files = {}
    panel()

    fireEvent.click(await screen.findByText('실행 방법을 찾을까요?'))
    expect(sent[0]).toContain('save_run_commands')
    // 두 번 눌러 같은 분석이 둘 돌지 않게, 누른 사실이 화면에 남는다
    expect(screen.queryByText('실행 방법을 찾을까요?')).toBeNull()
  })

  // package.json 이 지문과 다르면 물어본다. **말없이 다시 분석하지 않는다** (설계 §2)
  it('매니페스트가 바뀌면 다시 확인할지 묻고, 누르기 전에는 아무것도 안 한다', async () => {
    files = {
      'AGENTS.md': ['## 실행', '', '<!-- open-code-desktop:run manifest=deadbeef -->', '', '| dev | `npm run dev` |'].join('\n'),
      'package.json': '{"scripts":{"dev":"vite"}}',
    }
    panel()

    const ask = await screen.findByText('다시 확인할까요?')
    expect(sent).toEqual([])

    fireEvent.click(ask)
    expect(sent[0]).toContain('매니페스트가 바뀌었으니')
  })
})
