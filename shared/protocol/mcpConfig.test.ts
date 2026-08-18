import { describe, expect, it } from 'vitest'
import { parseMcpState } from './mcpConfig'

// 커넥터 상태 payload 를 안전한 모양으로 되돌리는 자리.
//
// 이 파일은 **도구 목록**만 본다 — 뒤늦게 모양이 넓어진 칸이라 옛 payload 와 섞여 돈다.
// 나머지 칸(상태·전송·주소)은 이 파일이 생기기 전부터 있었고 여기서 뒤늦게 덮지 않는다.

/** 서버 한 대짜리 payload. `tools` 만 갈아 끼운다. */
function stateWith(tools: unknown) {
  return parseMcpState({ servers: [{ server_name: 'closed-code-desktop', status: 'connected', tools }] })
}

function toolsOf(tools: unknown) {
  return stateWith(tools).servers[0]?.tools
}

describe('도구 목록', () => {
  it('이름과 설명을 담는다', () => {
    expect(toolsOf([{ name: 'open_file', description: '파일을 연다.' }])).toEqual([
      { name: 'open_file', description: '파일을 연다.' },
    ])
  })

  // MCP 규약상 설명은 선택이다. 빈 문자열로 채우면 화면이 「설명이 있는데 비었다」로
  // 그려서, 눌러도 빈 칸만 열린다 (`url`·`error` 와 같은 규칙).
  it('설명이 없거나 비면 칸 자체를 안 만든다', () => {
    expect(toolsOf([{ name: 'a' }, { name: 'b', description: '' }, { name: 'c', description: 42 }])).toEqual([
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ])
  })

  // **앱과 opencode 는 각자 갱신된다.** 이 목록을 만드는 자리가 예전에는 이름만 실었고
  // (`string[]`), 그 모양이 한동안 함께 돈다. 통째로 버리면 「이 앱이 띄웠다」 표식
  // (`McpSection` 의 `ours`)까지 사라져 **서버 카드가 남의 서버처럼 보인다** —
  // 설명만 없는 것과 결과가 다르다.
  it('이름만 온 옛 모양도 받는다 — 목록을 통째로 잃지 않는다', () => {
    expect(toolsOf(['open_file', 'read_logs'])).toEqual([{ name: 'open_file' }, { name: 'read_logs' }])
  })

  it('섞여 와도 받는다', () => {
    expect(toolsOf(['open_file', { name: 'read_logs', description: '읽는다.' }])).toEqual([
      { name: 'open_file' },
      { name: 'read_logs', description: '읽는다.' },
    ])
  })

  // 이름이 없으면 그릴 수도 부를 수도 없다. 그 줄만 버리고 나머지는 담는다 —
  // 하나가 깨졌다고 목록을 비우면 위와 같은 일이 일어난다.
  it('이름 없는 줄만 버린다', () => {
    expect(toolsOf([{ description: '이름이 없다' }, '', null, 7, { name: 'ok' }])).toEqual([{ name: 'ok' }])
  })

  it('배열이 아니면 빈 목록이다 — 남의 서버는 도구를 안 준다', () => {
    for (const shape of [undefined, null, 'open_file', {}]) expect(toolsOf(shape)).toEqual([])
  })
})
