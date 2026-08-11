import { describe, expect, it, vi } from 'vitest'
import { PtySocket, type PtyLikeSocket } from './socket'

// 이 파일이 겨누는 것 하나: **제어 프레임을 터미널 바이트로 흘리지 않는가.**
// 안 가르면 드로어를 열자마자 화면 맨 앞에 `{"cursor":0}` 이 찍힌다.

class FakeSocket implements PtyLikeSocket {
  readonly sent: string[] = []
  closed = false
  terminated = false
  private handlers = new Map<string, (...args: never[]) => void>()

  on(event: string, handler: (...args: never[]) => void): void {
    this.handlers.set(event, handler)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
  terminate(): void {
    this.terminated = true
  }

  emit(event: string, ...args: unknown[]): void {
    ;(this.handlers.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args)
  }
}

function connect(): { socket: PtySocket; fake: FakeSocket; headers: Record<string, string>[] } {
  const fake = new FakeSocket()
  const headers: Record<string, string>[] = []
  const socket = new PtySocket({
    url: 'ws://127.0.0.1:4096/api/pty/pty_1/connect',
    headers: { Authorization: 'Basic xyz' },
    create: (_url, given) => {
      headers.push(given)
      return fake
    },
  })
  socket.open()
  return { socket, fake, headers }
}

describe('PtySocket', () => {
  // 실측: 첫 프레임은 바이너리 `\x00{"cursor":0}` 다.
  it('0x00 을 앞세운 바이너리는 제어 프레임이고 화면으로 안 간다', () => {
    const { socket, fake } = connect()
    const data = vi.fn()
    const control = vi.fn()
    socket.onData(data)
    socket.onControl(control)

    fake.emit('message', Buffer.concat([Buffer.from([0x00]), Buffer.from('{"cursor":0}')]), true)

    expect(control).toHaveBeenCalledWith({ cursor: 0 })
    expect(data).not.toHaveBeenCalled()
  })

  it('모르는 제어 프레임은 조용히 버린다 — 터미널 바이트로 흘리면 화면에 쓰레기가 찍힌다', () => {
    const { socket, fake } = connect()
    const data = vi.fn()
    socket.onData(data)

    fake.emit('message', Buffer.concat([Buffer.from([0x00]), Buffer.from('JSON 아님')]), true)
    // 0x00 로 시작하지 않는 바이너리도 마찬가지
    fake.emit('message', Buffer.from([0x07, 0x08]), true)

    expect(data).not.toHaveBeenCalled()
  })

  it('텍스트 프레임은 터미널 바이트 그대로 흐른다', () => {
    const { socket, fake } = connect()
    const data = vi.fn()
    socket.onData(data)

    // `ws` 는 텍스트도 Buffer 로 준다 (binaryType 기본값)
    fake.emit('message', Buffer.from('MARKER_42\r\n'), false)
    expect(data).toHaveBeenCalledWith('MARKER_42\r\n')
  })

  // 실측: JSON 봉투로 보냈더니 그 JSON 문자열이 셸에 그대로 타이핑됐다
  it('보내는 것은 원시 바이트다 — 봉투를 씌우지 않는다', () => {
    const { socket, fake } = connect()
    socket.write('echo hi\n')
    expect(fake.sent).toEqual(['echo hi\n'])
  })

  it('아직 안 열렸으면 버린다 — 큐에 쌓으면 셸이 준비된 뒤 한꺼번에 쏟아진다', () => {
    const socket = new PtySocket({ url: 'ws://x', create: () => new FakeSocket() })
    expect(socket.write('a')).toBe(false)
  })

  it('인증 헤더를 그대로 소켓에 넘긴다 — 없으면 비밀번호 건 서버에서 401 이다', () => {
    const { headers } = connect()
    expect(headers[0]).toEqual({ Authorization: 'Basic xyz' })
  })

  // 실측: 셸이 끝나면 제어 프레임이 아니라 WS close(1000) 로 온다
  it('상대가 끊으면 알린다', () => {
    const { socket, fake } = connect()
    const closed = vi.fn()
    socket.onClose(closed)

    fake.emit('close', 1000, Buffer.from(''))
    expect(closed).toHaveBeenCalledWith({ code: 1000, reason: '' })
  })

  // 드로어를 접는 것은 "셸이 끝났다" 가 아니다. 여기서 안 가르면 접을 때마다
  // 화면에 종료 안내가 뜨고, pty 를 되찾을 수 있다는 사실이 가려진다.
  it('우리가 접은 것은 종료로 알리지 않는다', () => {
    const { socket, fake } = connect()
    const closed = vi.fn()
    socket.onClose(closed)

    socket.close()
    fake.emit('close', 1000, Buffer.from(''))

    expect(fake.closed).toBe(true)
    expect(closed).not.toHaveBeenCalled()
  })

  it('두 번 열어도 소켓은 하나다', () => {
    let made = 0
    const socket = new PtySocket({
      url: 'ws://x',
      create: () => {
        made += 1
        return new FakeSocket()
      },
    })
    socket.open()
    socket.open()
    expect(made).toBe(1)
  })
})
