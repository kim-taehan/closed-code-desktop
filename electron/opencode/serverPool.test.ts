import { describe, expect, it } from 'vitest'
import { OpencodeServerPool } from './serverPool'
import type { SpawnedServer } from './serverProcess'

// 프로젝트마다 서버 하나 — 그리고 **우리가 띄운 것만** 거둔다.
//
// 진짜 프로세스를 띄우지 않는다. 여기서 겨누는 것은 프로세스 제어가 아니라 **표의 규칙**이다:
// 프로젝트별로 갈리는가 · 겹쳐 들어와도 하나인가 · 닫으면 그것만 죽는가 · 기동 중에 닫아도
// 좀비가 안 남는가. 프로세스 쪽 계약(주소 한 줄 · SIGTERM→SIGKILL)은 serverProcess.test.ts 몫이다.

interface Fake extends SpawnedServer {
  stopped: number
}

function fakePool() {
  const roots: string[] = []
  const started: Fake[] = []
  let port = 55640

  const pool = new OpencodeServerPool({
    start: (root) => {
      roots.push(root)
      const server: Fake = {
        url: `http://127.0.0.1:${port++}`,
        pid: 1000 + started.length,
        bin: '/bin/opencode',
        stopped: 0,
        stop: () => {
          server.stopped += 1
          return Promise.resolve()
        },
      }
      started.push(server)
      return Promise.resolve(server)
    },
  })
  return { pool, roots, started }
}

describe('OpencodeServerPool', () => {
  it('프로젝트마다 서버가 갈린다 — 주소가 다르다', async () => {
    const { pool, roots } = fakePool()

    const a = await pool.urlFor('a', '/p/alpha')
    const b = await pool.urlFor('b', '/p/beta')

    expect(a).not.toBe(b)
    // 프로젝트 루트를 cwd 로 준다 — opencode 는 여기를 기준으로 설정·프로젝트를 잡는다
    expect(roots).toEqual(['/p/alpha', '/p/beta'])
  })

  it('같은 프로젝트를 다시 물으면 이미 뜬 것을 준다 — 두 번 띄우지 않는다', async () => {
    const { pool, started } = fakePool()

    const first = await pool.urlFor('a', '/p/alpha')
    const again = await pool.urlFor('a', '/p/alpha')

    expect(again).toBe(first)
    expect(started).toHaveLength(1)
  })

  it('겹쳐 들어와도 하나만 띄운다 — 탭 활성화가 연달아 오는 자리다', async () => {
    const { pool, started } = fakePool()

    const [x, y] = await Promise.all([pool.urlFor('a', '/p/alpha'), pool.urlFor('a', '/p/alpha')])

    expect(x).toBe(y)
    expect(started).toHaveLength(1)
  })

  it('urlOf 는 이미 뜬 것만 알려준다 — 진단이 서버를 띄우면 안 된다', async () => {
    const { pool, started } = fakePool()

    expect(pool.urlOf('a')).toBeNull()
    expect(pool.urlOf(null)).toBeNull()
    const url = await pool.urlFor('a', '/p/alpha')
    expect(pool.urlOf('a')).toBe(url)
    expect(started).toHaveLength(1)
  })

  it('한쪽을 닫으면 그쪽만 죽는다', async () => {
    const { pool, started } = fakePool()
    await pool.urlFor('a', '/p/alpha')
    await pool.urlFor('b', '/p/beta')

    await pool.stop('a')

    expect(started[0]!.stopped).toBe(1)
    expect(started[1]!.stopped).toBe(0)
    expect(pool.urlOf('a')).toBeNull()
    expect(pool.urlOf('b')).not.toBeNull()
  })

  it('안 띄운 프로젝트를 닫아도 아무 일도 없다', async () => {
    const { pool, started } = fakePool()
    await expect(pool.stop('없는것')).resolves.toBeUndefined()
    expect(started).toHaveLength(0)
  })

  it('stopAll 은 띄운 것을 전부 거둔다 — 앱 종료 경로', async () => {
    const { pool, started } = fakePool()
    await pool.urlFor('a', '/p/alpha')
    await pool.urlFor('b', '/p/beta')

    await pool.stopAll()

    expect(started.map((server) => server.stopped)).toEqual([1, 1])
    expect(pool.urlOf('a')).toBeNull()
  })

  it('기동 중에 닫으면 뜬 뒤에 거둔다 — 좀비를 남기지 않는다', async () => {
    let resolveStart: ((server: SpawnedServer) => void) | null = null
    let stopped = 0
    const pool = new OpencodeServerPool({
      start: () =>
        new Promise<SpawnedServer>((resolve) => {
          resolveStart = resolve
        }),
    })

    const pendingUrl = pool.urlFor('a', '/p/alpha')
    pendingUrl.catch(() => {}) // 닫혔으므로 거절된다 — 여기서 보는 것은 좀비 여부다
    const stopping = pool.stop('a')

    resolveStart!({
      url: 'http://127.0.0.1:55640',
      pid: 1,
      bin: '/bin/opencode',
      stop: () => {
        stopped += 1
        return Promise.resolve()
      },
    })
    await stopping

    expect(stopped).toBeGreaterThanOrEqual(1)
    expect(pool.urlOf('a')).toBeNull()
  })
})

// **`statusOf().ours` 가 Doctor 사다리 ②의 갈래를 정한다** (설계 2026-08-16 §1).
//
// `running`(우리 표에 있나)과 다른 물음이라 따로 잠근다 — 표에 있어도 그 PID 가 죽었거나
// 남이 물려받았으면 거짓이어야 한다. **여기서 참으로 굳으면 남의 서버에 재시작이 나간다.**
describe('statusOf — running 과 ours 는 다른 물음이다', () => {
  /** `pidStore` 흉내. `owns` 만 쓰므로 나머지는 안 채운다 */
  function poolWithOwns(owns: (pid: number | null) => boolean) {
    return new OpencodeServerPool({
      start: () =>
        Promise.resolve({
          url: 'http://127.0.0.1:55640',
          pid: 4242,
          bin: '/bin/opencode',
          stop: () => Promise.resolve(),
        }),
      pids: { owns, add: () => {}, forget: () => {} } as never,
    })
  }

  it('안 띄운 프로젝트는 둘 다 거짓이다', () => {
    expect(poolWithOwns(() => true).statusOf('없는프로젝트')).toEqual({
      running: false,
      url: null,
      pid: null,
      ours: false,
    })
  })

  it('표에 있고 그 PID 가 우리 것이면 ours 다', async () => {
    const pool = poolWithOwns((pid) => pid === 4242)
    await pool.urlFor('a', '/p/alpha')
    expect(pool.statusOf('a')).toMatchObject({ running: true, pid: 4242, ours: true })
  })

  // ⭐ 프로세스가 죽었거나 그 번호를 남이 물려받은 경우 — **표는 그대로다**
  it('표에 있어도 그 PID 가 우리 것이 아니면 ours 는 거짓이다', async () => {
    const pool = poolWithOwns(() => false)
    await pool.urlFor('a', '/p/alpha')
    expect(pool.statusOf('a')).toMatchObject({ running: true, ours: false })
  })

  // 흔적 저장소가 아예 없는 구성(시험용 풀)에서도 **모르면 거짓이다**
  it('pidStore 가 없으면 ours 는 거짓이다', async () => {
    const { pool } = fakePool()
    await pool.urlFor('a', '/p/alpha')
    expect(pool.statusOf('a')).toMatchObject({ running: true, ours: false })
  })
})
