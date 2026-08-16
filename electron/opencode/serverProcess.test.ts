import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  parseListeningUrl,
  startOpencodeServer,
  type ServerChild,
  type SpawnServer,
} from './serverProcess'

// 가짜 자식 프로세스. **진짜 계약을 그대로 흉내낸다** — stdout 은 스트림이고, 종료는
// `exit` 이벤트이며, `kill` 은 신호 이름을 받는다. 실물과 어긋난 가짜는 초록을 주면서
// 버그를 통과시킨다 (이 레포의 `tests/fake-opencode/` 와 같은 원칙).
class FakeChild extends EventEmitter implements ServerChild {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid = 4242
  readonly signals: NodeJS.Signals[] = []

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}

function fakeSpawn(): { spawnImpl: SpawnServer; child: FakeChild; calls: unknown[] } {
  const child = new FakeChild()
  const calls: unknown[] = []
  const spawnImpl: SpawnServer = (binPath, args, options) => {
    calls.push({ binPath, args, cwd: options.cwd })
    return child
  }
  return { spawnImpl, child, calls }
}

describe('parseListeningUrl', () => {
  it('실측한 그 한 줄에서 주소를 뽑는다', () => {
    expect(parseListeningUrl('opencode server listening on http://127.0.0.1:55640')).toBe(
      'http://127.0.0.1:55640',
    )
  })

  it('끝의 슬래시를 떼어 낸다 — 소비처가 `${base}/config` 로 붙인다', () => {
    expect(parseListeningUrl('listening on http://127.0.0.1:55640/')).toBe('http://127.0.0.1:55640')
  })

  it('listening 이 없는 줄은 주소가 있어도 무시한다', () => {
    expect(parseListeningUrl('fetching http://example.com/models')).toBeNull()
  })
})

describe('startOpencodeServer', () => {
  it('--port 를 주지 않는다 — 주면 프로젝트끼리 포트를 다툰다', async () => {
    const { spawnImpl, child, calls } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.stdout.write('opencode server listening on http://127.0.0.1:55640\n')
    const server = await started

    expect(calls).toEqual([{ binPath: '/bin/oc', args: ['serve', '--hostname', '127.0.0.1'], cwd: '/p/a' }])
    expect(server.url).toBe('http://127.0.0.1:55640')
    expect(server.pid).toBe(4242)
  })

  it('청크가 URL 한가운데서 끊겨도 조각을 주소로 읽지 않는다', async () => {
    const { spawnImpl, child } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.stdout.write('opencode server listening on http://127.0.0.1:556')
    // 아직 줄이 안 끝났다 — 여기서 풀리면 포트가 잘린 주소로 굳는다
    await new Promise((done) => setImmediate(done))
    child.stdout.write('41\n')

    expect((await started).url).toBe('http://127.0.0.1:55641')
  })

  it('stderr 로 나와도 읽는다', async () => {
    const { spawnImpl, child } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.stderr.write('opencode server listening on http://127.0.0.1:1234\n')
    expect((await started).url).toBe('http://127.0.0.1:1234')
  })

  it('주소를 알리기 전에 죽으면 그때까지의 출력을 사유로 준다', async () => {
    const { spawnImpl, child } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.stderr.write('config parse error: opencode.json\n')
    await new Promise((done) => setImmediate(done))
    child.emit('exit', 1, null)

    await expect(started).rejects.toThrow(/config parse error/)
  })

  it('실행 자체가 안 되면 사유가 그대로 온다 (PATH 함정이 여기로 나온다)', async () => {
    const { spawnImpl, child } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.emit('error', new Error('spawn ENOENT'))
    await expect(started).rejects.toThrow(/spawn ENOENT/)
  })

  it('시간을 넘기면 죽이고 좀비를 남기지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const { spawnImpl, child } = fakeSpawn()
      const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl, timeoutMs: 100 })
      const settled = expect(started).rejects.toThrow(/주소를 알리지 않았습니다/)
      await vi.advanceTimersByTimeAsync(150)
      await settled
      expect(child.signals).toEqual(['SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop 은 SIGTERM 부터 — 안 죽으면 SIGKILL 로 올린다', async () => {
    vi.useFakeTimers()
    try {
      const { spawnImpl, child } = fakeSpawn()
      const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
      child.stdout.write('listening on http://127.0.0.1:55640\n')
      await vi.advanceTimersByTimeAsync(0)
      const server = await started

      const stopped = server.stop()
      expect(child.signals).toEqual(['SIGTERM'])
      await vi.advanceTimersByTimeAsync(6_000)
      await stopped
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop 은 상대가 SIGTERM 에 응하면 거기서 끝난다', async () => {
    const { spawnImpl, child } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/bin/oc', cwd: '/p/a', spawnImpl })
    child.stdout.write('listening on http://127.0.0.1:55640\n')
    const server = await started

    const stopped = server.stop()
    child.emit('exit', 0, 'SIGTERM')
    await stopped
    expect(child.signals).toEqual(['SIGTERM'])
  })
})

// ⭐⭐ **`pidStore` 의 명령줄 대조가 여기에 매달려 있다** (실측 2026-08-16, contract-qa).
//
// 회수(`reap`)와 주인 판정(`owns`)은 `ps -p <pid> -o command=` 의 argv[0] 이 우리가 적어 둔
// `bin` 을 **부분문자열로 품는지**로 판정한다. 그게 통하는 이유는 딱 하나다 —
// **spawn 에 넘긴 문자열과 기록하는 문자열이 같은 출처**라서다.
//
// 둘이 갈리는 날(예: 여기서 realpath 로 심볼릭 링크를 풀어 적으면) 대조는 **조용히 거짓**이
// 되고, 증상은 "우리 서버가 남의 것으로 보인다" → **서버가 자꾸 하나씩 는다** 로만 나온다.
// 회수도 재시작도 안 되는데 어느 테스트도 안 빨개진다. 그래서 그 동일성을 여기서 잠근다.
describe('bin 은 spawn 에 넘긴 그 문자열이다', () => {
  it('기록하는 bin 과 spawn 이 받은 binPath 가 같다', async () => {
    const { spawnImpl, child, calls } = fakeSpawn()
    const started = startOpencodeServer({ binPath: '/opt/bun/bin/opencode', cwd: '/p/a', spawnImpl })
    child.stdout.write('listening on http://127.0.0.1:55640\n')
    const server = await started

    const spawned = (calls[0] as { binPath: string }).binPath
    expect(server.bin).toBe(spawned)
    // 대조가 실제로 통하는 모양인지까지 본다 — `isOurServer` 가 하는 것과 같은 물음이다
    expect(`${spawned} serve --hostname 127.0.0.1`).toContain(server.bin)
  })
})
