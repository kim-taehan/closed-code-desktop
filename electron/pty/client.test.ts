import { describe, expect, it, vi } from 'vitest'
import { PtyClient } from './client'

// 이 파일이 겨누는 것은 **경로와 질의의 오타**다. pty 는 세션과 달리 화면에 증상이
// "빈 터미널" 로만 나타나서, 질의 이름 한 글자가 틀려도 어디가 틀렸는지 알 수 없다.

function fake(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch
}

function calls(impl: typeof fetch): [string, RequestInit][] {
  return (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
}

const DIR = '/Users/me/내 프로젝트'
const pty = { id: 'pty_1', title: 't', command: '/bin/zsh', args: ['-l'], cwd: DIR, status: 'running', pid: 1 }

describe('PtyClient', () => {
  // 실측: 질의를 빼면 서버가 **자기 cwd** 로 떨어진다. 그러면 A 프로젝트의 드로어가
  // 엉뚱한 폴더의 pty 를 본다 — 이 한 줄이 격리의 전부다.
  it('location[directory] 를 인코딩해서 싣는다', async () => {
    const fetchImpl = fake({ data: [pty] })
    await new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl }).list(DIR)

    const [url] = calls(fetchImpl)[0]!
    expect(url).toContain('location%5Bdirectory%5D=')
    // 대괄호를 그대로 내보내면 서버가 못 읽는다
    expect(url).not.toContain('location[directory]')
    // URLSearchParams 는 공백을 `+` 로 쓴다. **실측으로 확인함**: opencode 는 `+` 와 `%20`
    // 을 똑같이 공백으로 읽는다 (`/Users/…/live space` 로 둘 다 되돌아왔다).
    // 여기서 못 박아 두지 않으면 다음 사람이 "이거 버그 아닌가" 로 손대게 된다.
    expect(new URL(url).searchParams.get('location[directory]')).toBe(DIR)
  })

  it('끝의 / 를 떼어 //api 가 되지 않게 한다', async () => {
    const fetchImpl = fake({ data: [pty] })
    await new PtyClient({ baseUrl: 'http://127.0.0.1:4096/', fetchImpl }).list(DIR)
    expect(calls(fetchImpl)[0]![0]).toContain('http://127.0.0.1:4096/api/pty?')
  })

  // 실측: 서버가 로그인 셸 인자(`-l`)를 스스로 붙인다. 우리가 주면 `["-l","-l"]` 이 된다.
  it('create 는 args 를 보내지 않는다', async () => {
    const fetchImpl = fake({ data: pty })
    await new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl }).create(DIR, { title: '드로어' })

    const [url, init] = calls(fetchImpl)[0]!
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/pty?')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({ cwd: DIR, title: '드로어' })
    expect(body['args']).toBeUndefined()
    // `command` 도 안 보낸다 — 서버가 사용자 기본 셸을 고른다 (공여의 셸 탐색 32줄이 없어지는 자리).
    // `size` 는 스키마에 아예 없다. 넣으면 400 이므로 첫 크기는 `PUT` 으로 따로 간다.
    expect(body['command']).toBeUndefined()
    expect(body['size']).toBeUndefined()
  })

  it('`{location, data}` 래핑을 벗겨서 준다', async () => {
    const fetchImpl = fake({ location: { directory: DIR }, data: pty })
    const created = await new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl }).create(DIR)
    expect(created.id).toBe('pty_1')
  })

  // 실측: WS 로 보내는 길은 없다. PUT 이다.
  it('resize 는 PUT /api/pty/{id} 로 간다', async () => {
    const fetchImpl = fake({ data: pty })
    await new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl }).resize(DIR, 'pty_1', {
      rows: 24,
      cols: 100,
    })

    const [url, init] = calls(fetchImpl)[0]!
    expect(init.method).toBe('PUT')
    expect(url).toContain('/api/pty/pty_1?')
    expect(JSON.parse(String(init.body))).toEqual({ size: { rows: 24, cols: 100 } })
  })

  // 실측: `rows`·`cols` 는 `exclusiveMinimum: 0` 이라 0 이면 HTTP 400 이다.
  // **접힌 드로어에서 addon-fit 이 0 을 내놓으므로 정상 흐름에서 밟는다** — 그때 400 이
  // 나면 로그만 더럽고 할 수 있는 일이 없다. 보낼 것이 없으니 안 보내는 것이 맞다.
  it('0 이하 크기는 아예 보내지 않는다', async () => {
    const fetchImpl = fake({ data: pty })
    const client = new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl })

    await client.resize(DIR, 'pty_1', { rows: 0, cols: 80 })
    await client.resize(DIR, 'pty_1', { rows: 24, cols: 0 })
    await client.resize(DIR, 'pty_1', { rows: -1, cols: -1 })
    await client.resize(DIR, 'pty_1', { rows: 1.5, cols: 80 })
    expect(calls(fetchImpl)).toHaveLength(0)

    await client.resize(DIR, 'pty_1', { rows: 1, cols: 1 })
    expect(calls(fetchImpl)).toHaveLength(1)
  })

  // 끝난 셸의 exitCode 를 물으러 가는 자리다 — 없어졌으면 던지지 않고 null 이어야
  // 드로어가 "셸이 끝났다" 를 못 알리고 멈추는 일이 없다.
  it('없는 pty 를 물으면 null 이다', async () => {
    const fetchImpl = fake({}, false)
    const found = await new PtyClient({ baseUrl: 'http://127.0.0.1:4096', fetchImpl }).get(DIR, 'pty_x')
    expect(found).toBeNull()
  })

  it('socketUrl 은 ws 로 바꾸고 cursor 를 싣는다', () => {
    const url = new PtyClient({ baseUrl: 'http://127.0.0.1:4096' }).socketUrl(DIR, 'pty_1')
    expect(url.startsWith('ws://127.0.0.1:4096/api/pty/pty_1/connect?')).toBe(true)
    // cursor=0 = 처음부터 다시 보내 달라 (스크롤백 재생). 빼면 드로어를 다시 펼 때 화면이 빈다.
    expect(url).toContain('cursor=0')
    expect(url).toContain('location%5Bdirectory%5D=')
  })

  it('https 는 wss 가 된다', () => {
    const url = new PtyClient({ baseUrl: 'https://host:8443' }).socketUrl(DIR, 'pty_1')
    expect(url.startsWith('wss://host:8443/')).toBe(true)
  })

  // ⚠️ Bearer 가 아니라 Basic 이고 사용자명이 `opencode` 로 고정이다 (1.17.18 실측).
  // WS 도 같은 헤더를 쓴다 — 여기가 틀리면 비밀번호 건 서버에서 드로어가 통째로 못 붙는다.
  it('비밀번호를 걸면 Basic opencode:<pw> 헤더가 붙는다', () => {
    const headers = new PtyClient({ baseUrl: 'http://127.0.0.1:4096', password: 'secret123' }).headers
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from('opencode:secret123').toString('base64')}`)
  })

  it('비밀번호가 없으면 인증 헤더도 없다', () => {
    expect(new PtyClient({ baseUrl: 'http://127.0.0.1:4096' }).headers['Authorization']).toBeUndefined()
  })
})
