// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { McpSection } from './McpSection'
import type { McpServerStatus, McpState } from '../../shared/protocol/mcpConfig'

// 커넥터 다이얼로그 본문 — 자격 입력 칸이던 것을 연결 상태 카드로 바꿨다.
//
// 겨누는 것 둘: **거짓 문구가 사라졌는가**(davis 의 "관리자 화면") 와
// **「켜기」·「다시 연결」이 같은 호출로 나가는가** (opencode 가 둘을 안 가른다).

const setMcpCredentials = vi.fn(async () => undefined)

beforeEach(() => {
  setMcpCredentials.mockClear()
  ;(window as unknown as { davis: unknown }).davis = {
    requestMcpStatus: vi.fn(async () => undefined),
    setMcpCredentials,
  }
})
afterEach(cleanup)

function server(overrides: Partial<McpServerStatus>): McpServerStatus {
  return { serverName: 'sys', status: 'connected', transport: 'remote', tools: [], ...overrides }
}

function show(servers: McpServerStatus[], message = ''): void {
  const state: McpState = { servers, message }
  render(<McpSection state={state} />)
}

describe('McpSection', () => {
  it('등록처를 opencode.json 으로 안내한다 — "관리자 화면" 은 opencode 에 없다', () => {
    show([])
    expect(screen.getByText(/opencode\.json/)).toBeTruthy()
    expect(screen.queryByText(/관리자 화면/)).toBeNull()
  })

  it('목록을 못 받았으면 사유를 보여준다 — 빈 목록과 구분된다', () => {
    show([], 'HTTP 500')
    expect(screen.getByText(/HTTP 500/)).toBeTruthy()
  })

  it('실패한 서버는 오류 원문과 주소를 그대로 보여준다', () => {
    show([server({ status: 'failed', url: 'http://10.0.0.1:8300/mcp', error: 'connect ECONNREFUSED' })])
    expect(screen.getByText('실패')).toBeTruthy()
    expect(screen.getByText('connect ECONNREFUSED')).toBeTruthy()
    expect(screen.getByText('http://10.0.0.1:8300/mcp')).toBeTruthy()
  })

  it('「다시 연결」은 enabled:true 로 나간다 (자격은 안 실린다)', () => {
    show([server({ status: 'failed', error: '죽음' })])
    fireEvent.click(screen.getByText('다시 연결'))
    expect(setMcpCredentials).toHaveBeenCalledWith({
      serverName: 'sys',
      credentials: {},
      enabled: true,
    })
  })

  // opencode 의 connect 가 꺼진 서버도 켠다 — 문구만 다르고 부르는 곳은 하나다
  it('꺼진 서버의 「켜기」도 같은 호출이다', () => {
    show([server({ status: 'disabled' })])
    fireEvent.click(screen.getByText('켜기'))
    expect(setMcpCredentials).toHaveBeenCalledWith({
      serverName: 'sys',
      credentials: {},
      enabled: true,
    })
  })

  it('연결된 서버에는 누를 것이 없다', () => {
    show([server({ status: 'connected' })])
    expect(screen.queryByText('다시 연결')).toBeNull()
    expect(screen.queryByText('켜기')).toBeNull()
  })

  it('우리 서버는 도구 칩과 "이 앱이 띄움" 으로 갈린다', () => {
    show([server({ serverName: 'closed-code-desktop', transport: 'unknown', tools: [{ name: 'open_file' }] })])
    expect(screen.getByText('open_file')).toBeTruthy()
    expect(screen.getByText(/이 앱이 띄움/)).toBeTruthy()
  })

  // 모르는 갈래를 「실패」로 칠하면 사용자가 없는 장애를 쫓는다
  it('OAuth 갈래도 이름을 갖는다 — 실패로 칠하지 않는다', () => {
    show([server({ status: 'needs_auth' })])
    expect(screen.getByText('로그인 필요')).toBeTruthy()
    expect(screen.queryByText('실패')).toBeNull()
  })

  // `status:"failed"` 인데 `error` 가 빈 문자열인 경우 — contract-qa2 실측이고, 실측과 별개로
  // `parseMcpState` 가 `error !== ''` 로 빈 값을 떨구므로 구조적으로도 도달한다.
  // 그때 아무것도 안 그리면 빨간 pill 만 남아 사용자가 이유를 물을 곳이 없다.
  it('실패인데 사유가 없으면 없다고 말한다 — 빨간 딱지만 남기지 않는다', () => {
    show([server({ status: 'failed' })])
    expect(screen.getByText(/실패 사유를 알려주지 않았습니다/)).toBeTruthy()
  })

  // 「켜기」는 런타임 한정이다 — 설정 파일의 enabled 는 false 로 남는다 (실측)
  it('「켜기」가 영구적인 척하지 않는다', () => {
    show([server({ status: 'disabled' })])
    expect(screen.getByTitle(/이 실행에서만 켭니다/)).toBeTruthy()
  })
})

// **설명은 처음부터 있었다.** `electron/mcp/toolSchemas.ts` 에 도구마다 한국어로 적혀
// 있는데, payload 를 만드는 자리가 `.map((tool) => tool.name)` 으로 떨어뜨리고 있었다 —
// 화면에는 이름표만 남아 무엇을 하는 도구인지 알려면 소스를 열어야 했다.
describe('도구를 고르면 설명이 열린다', () => {
  const TOOLS = [
    { name: 'open_file', description: '프로젝트 안의 파일을 편집기 탭으로 연다.' },
    { name: 'read_logs', description: '띄워 둔 칸의 출력을 읽는다.' },
    // 설명 없는 도구도 온다 — MCP 규약상 설명은 선택이다
    { name: 'legacy_tool' },
  ]

  function ours() {
    show([server({ serverName: 'closed-code-desktop', transport: 'unknown', tools: TOOLS })])
  }

  it('처음에는 아무 설명도 안 보인다 — 카드가 열자마자 부풀지 않는다', () => {
    ours()
    expect(screen.queryByText(/편집기 탭으로 연다/)).toBeNull()
  })

  it('누르면 그 도구의 설명이 뜬다', () => {
    ours()
    fireEvent.click(screen.getByRole('button', { name: 'open_file' }))
    expect(screen.getByText('프로젝트 안의 파일을 편집기 탭으로 연다.')).toBeTruthy()
  })

  // 다 펼치면 카드가 화면을 통째로 먹는다 — 칸은 하나고 내용만 갈린다
  it('다른 것을 누르면 앞의 것은 닫힌다 — 한 번에 하나다', () => {
    ours()
    fireEvent.click(screen.getByRole('button', { name: 'open_file' }))
    fireEvent.click(screen.getByRole('button', { name: 'read_logs' }))

    expect(screen.getByText('띄워 둔 칸의 출력을 읽는다.')).toBeTruthy()
    expect(screen.queryByText(/편집기 탭으로 연다/)).toBeNull()
  })

  it('같은 것을 다시 누르면 닫힌다 — 연 것을 닫을 다른 문이 없다', () => {
    ours()
    const pill = screen.getByRole('button', { name: 'open_file' })
    fireEvent.click(pill)
    fireEvent.click(pill)

    expect(screen.queryByText(/편집기 탭으로 연다/)).toBeNull()
  })

  // 눌리는데 아무 일도 안 일어나는 버튼을 두지 않는다. 흐리게도 안 만든다 —
  // 그 도구가 못 쓰는 것으로 읽힌다.
  it('설명이 없는 도구는 누를 수 없다', () => {
    ours()
    expect(screen.getByRole('button', { name: 'legacy_tool' })).toHaveProperty('disabled', true)
  })
})
