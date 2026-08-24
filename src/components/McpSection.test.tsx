// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { McpSection } from './McpSection'
import type { McpServerStatus, McpState } from '../../shared/protocol/mcpConfig'

// 커넥터 다이얼로그 본문 — 자격 입력 칸이던 것을 연결 상태로 바꿨고,
// 카드를 세로로 쌓던 것을 **왼쪽 리스트 / 오른쪽 상세**로 갈랐다.
//
// 겨누는 것 넷: **거짓 문구가 사라졌는가**(davis 의 "관리자 화면") ·
// **「켜기」·「다시 연결」이 같은 호출로 나가는가** (opencode 가 둘을 안 가른다) ·
// **도구 칩이 오른쪽에만 있는가** (왼쪽 열이 좁아 칩이 잘리던 것이 가른 이유다) ·
// **고른 것이 바뀌면 오른쪽이 통째로 따라오는가**.

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

// 갈래·상태 낱말은 **양쪽에 다 나온다** (`remote`·`연결됨`은 리스트 행에도 상세 머리에도 있다).
// 그래서 화면 전체에 대고 묻지 않고 칸을 집어 묻는다 — 안 그러면 어느 쪽을 본 것인지 모른다.
const list = () => within(screen.getByRole('group', { name: 'MCP 서버 목록' }))
const detail = () => within(screen.getByRole('region', { name: '서버 상세' }))

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
    expect(detail().getByText('실패')).toBeTruthy()
    expect(detail().getByText('connect ECONNREFUSED')).toBeTruthy()
    expect(detail().getByText('http://10.0.0.1:8300/mcp')).toBeTruthy()
  })

  // 주소·오류는 고르는 데 필요한 것이 아니다 — 좁은 왼쪽 열에 두면 이름을 밀어낸다
  it('주소와 오류 원문은 리스트에 없다', () => {
    show([server({ status: 'failed', url: 'http://10.0.0.1:8300/mcp', error: 'connect ECONNREFUSED' })])
    expect(list().queryByText('connect ECONNREFUSED')).toBeNull()
    expect(list().queryByText('http://10.0.0.1:8300/mcp')).toBeNull()
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
    expect(detail().getByText('open_file')).toBeTruthy()
    expect(detail().getByText(/이 앱이 띄움/)).toBeTruthy()
  })

  // **도구가 있다고 우리 것이 아니다.** 원격 서버에도 도구를 채우게 되면서
  // (`electron/opencode/remoteMcpTools.ts`) `tools.length > 0` 이라는 옛 표식이 거짓이 됐다.
  // 그대로 뒀으면 사내 원격 서버가 도구를 준 순간 「local · 이 앱이 띄움」으로 뒤집혔다.
  it('남의 원격 서버는 도구가 있어도 remote 다', () => {
    show([server({ serverName: 'davis-cloud-mcp', transport: 'remote', tools: [{ name: 'health_check' }] })])
    expect(detail().getByText('health_check')).toBeTruthy()
    expect(screen.queryByText(/이 앱이 띄움/)).toBeNull()
    expect(detail().getByText('remote')).toBeTruthy()
  })

  // 거꾸로도 성립해야 한다 — 우리 서버를 가리는 근거가 도구 목록이 아니라 이름이다
  it('우리 서버는 도구를 못 실어도 우리 것이다', () => {
    show([server({ serverName: 'closed-code-desktop', transport: 'unknown', tools: [] })])
    expect(detail().getByText(/이 앱이 띄움/)).toBeTruthy()
  })

  // 갈래는 고를 때도 필요한 정보다 — 이름만 있으면 같은 이름의 두 서버를 못 가린다
  it('갈래와 상태는 리스트에도 있다', () => {
    show([server({ serverName: 'davis-cloud-mcp' })])
    expect(list().getByText('remote')).toBeTruthy()
    expect(list().getByText('연결됨')).toBeTruthy()
  })

  // 모르는 갈래를 「실패」로 칠하면 사용자가 없는 장애를 쫓는다
  it('OAuth 갈래도 이름을 갖는다 — 실패로 칠하지 않는다', () => {
    show([server({ status: 'needs_auth' })])
    expect(detail().getByText('로그인 필요')).toBeTruthy()
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

// **자리를 가른 것이 이 묶음이 겨누는 전부다.** 좁은 왼쪽 한 열에 카드와 도구 칩이 전부
// 몰려 칩이 잘리고 오른쪽이 비어 있었다 — 도구는 오른쪽에만, 리스트는 고를 것만.
describe('왼쪽은 고르고 오른쪽만 도구를 보여준다', () => {
  const CLOUD = server({ serverName: 'davis-cloud-mcp', tools: [{ name: 'health_check' }] })
  const JIRA = server({ serverName: 'jira-mcp', tools: [{ name: 'search_issue' }] })
  const SERVERS = [CLOUD, JIRA]

  it('처음 열면 첫 서버가 펼쳐져 있다', () => {
    show(SERVERS)
    expect(detail().getByText('davis-cloud-mcp')).toBeTruthy()
    expect(detail().getByText('health_check')).toBeTruthy()
  })

  it('도구 칩은 리스트에 없다 — 이름은 양쪽에 있다', () => {
    show(SERVERS)
    expect(list().getByText('davis-cloud-mcp')).toBeTruthy()
    expect(list().queryByText('health_check')).toBeNull()
    expect(list().queryByText('search_issue')).toBeNull()
  })

  // 고르지 않은 서버의 도구는 **어디에도** 없다. 세로로 쌓던 시절에는 전부 한꺼번에 보였고
  // 그게 다이얼로그를 끝없이 길게 만들었다.
  it('고르지 않은 서버의 도구는 안 보인다', () => {
    show(SERVERS)
    expect(screen.queryByText('search_issue')).toBeNull()
  })

  it('리스트에서 누르면 오른쪽이 그 서버로 바뀐다', () => {
    show(SERVERS)
    fireEvent.click(list().getByText('jira-mcp'))

    expect(detail().getByText('search_issue')).toBeTruthy()
    expect(screen.queryByText('health_check')).toBeNull()
  })

  // 목록이 다시 오면서 고른 서버가 사라질 수 있다 (`opencode.json` 을 고치면 온다).
  // 되돌리는 효과 없이 순수하게 유도하므로 빈 상세가 남지 않는다.
  // **다시 그려야 재진다** — 새로 렌더하면 고른 것이 처음부터 없어 저절로 통과한다.
  it('고른 서버가 목록에서 사라지면 첫 서버로 돌아간다', () => {
    const { rerender } = render(<McpSection state={{ servers: SERVERS, message: '' }} />)
    fireEvent.click(list().getByText('jira-mcp'))
    rerender(<McpSection state={{ servers: [CLOUD], message: '' }} />)

    expect(detail().getByText('davis-cloud-mcp')).toBeTruthy()
    expect(screen.queryByText('search_issue')).toBeNull()
  })
})

// 도구 목록이 비었다는 것은 **「도구가 없다」가 아니라 「모른다」**다
// (`shared/protocol/mcpConfig.ts` 의 `tools` 주석). 그 구분이 화면 문구에 걸린다 —
// 아무것도 안 그리면 멀쩡한 서버가 고장으로 읽힌다.
describe('도구를 모를 때는 왜 모르는지 말한다', () => {
  it('실행형(stdio) 서버는 밖에서 물을 자리가 없다고 말한다', () => {
    show([server({ serverName: 'filesystem', transport: 'local', url: 'npx -y @mcp/filesystem' })])
    expect(detail().getByText(/stdio 로 붙는 서버라/)).toBeTruthy()
  })

  // 원격은 붙어 있을 때만 물어본다 (`remoteMcpTools.ts`) — 안 붙은 것을 「도구 없음」으로
  // 그리면 사용자가 연결 문제를 도구 문제로 쫓는다
  it('안 붙은 원격 서버는 붙으면 물어본다고 말한다', () => {
    show([server({ status: 'disabled', transport: 'remote' })])
    expect(detail().getByText(/연결되면 도구 목록을 물어봅니다/)).toBeTruthy()
  })

  it('붙어 있는데 빈 목록이면 못 받았다고 말한다 — 없다고 하지 않는다', () => {
    show([server({ status: 'connected', transport: 'remote' })])
    expect(detail().getByText(/도구 목록을 받지 못했습니다/)).toBeTruthy()
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

  it('처음에는 아무 설명도 안 보인다 — 상세가 열자마자 부풀지 않는다', () => {
    ours()
    expect(screen.queryByText(/편집기 탭으로 연다/)).toBeNull()
  })

  it('누르면 그 도구의 설명이 뜬다', () => {
    ours()
    fireEvent.click(screen.getByRole('button', { name: 'open_file' }))
    expect(screen.getByText('프로젝트 안의 파일을 편집기 탭으로 연다.')).toBeTruthy()
  })

  // 다 펼치면 상세가 화면을 통째로 먹는다 — 칸은 하나고 내용만 갈린다
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

  // 서버를 갈아탔는데 앞 서버에서 펼쳐 둔 설명이 남으면, 그 도구를 가진 적 없는 서버가
  // 남의 설명을 달고 있게 된다 (`McpSection` 의 `key` 가 막는다)
  it('서버를 갈아타면 펼쳐 둔 설명이 따라오지 않는다', () => {
    show([
      server({ serverName: 'closed-code-desktop', transport: 'unknown', tools: TOOLS }),
      server({ serverName: 'jira-mcp', tools: [{ name: 'search_issue', description: '이슈를 찾는다.' }] }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'open_file' }))
    fireEvent.click(list().getByText('jira-mcp'))

    expect(screen.queryByText(/편집기 탭으로 연다/)).toBeNull()
    expect(screen.queryByText('이슈를 찾는다.')).toBeNull()
  })
})
