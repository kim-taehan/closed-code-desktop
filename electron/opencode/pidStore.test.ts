import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerPidStore, isOurServer, type ServerRecord } from './pidStore'

// 유령 회수 — **남의 프로세스를 죽이지 않는가**가 이 파일의 전부다.
//
// PID 는 재사용된다. 적어 둔 번호만 믿으면 그 번호를 물려받은 남의 프로세스를 죽인다.
// 그래서 `ps` 로 명령줄을 대조하고, 대조에 실패하면 **손대지 않는다.**

const store = (): ServerPidStore => new ServerPidStore(join(mkdtempSync(join(tmpdir(), 'pid-')), 'servers.json'))

function recordOf(pid: number, bin = '/opt/bin/opencode'): ServerRecord {
  return { pid, bin, url: 'http://127.0.0.1:55640', root: '/tmp/alpha', startedAt: Date.now() }
}

const spawned: { kill(signal?: NodeJS.Signals): void; pid?: number | undefined }[] = []

afterEach(() => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL')
    } catch {
      // 이미 죽었다 — 그게 이 파일이 바라는 결과다
    }
  }
  spawned.length = 0
})

describe('흔적 파일', () => {
  it('적고 읽고 지운다', () => {
    const pids = store()
    pids.add(recordOf(111))
    pids.add(recordOf(222))
    expect(pids.list().map((record) => record.pid)).toEqual([111, 222])

    pids.forget(111)
    expect(pids.list().map((record) => record.pid)).toEqual([222])
  })

  it('같은 pid 를 두 번 적어도 한 줄이다', () => {
    const pids = store()
    pids.add(recordOf(111))
    pids.add(recordOf(111))
    expect(pids.list()).toHaveLength(1)
  })

  // 이 파일 때문에 앱이 안 뜨면 안 된다
  it('없거나 망가진 파일은 빈 목록이다', () => {
    expect(new ServerPidStore('/nonexistent/dir/servers.json').list()).toEqual([])
  })
})

describe('우리 것인가', () => {
  it('명령줄이 우리가 띄운 그 파일 + serve 면 우리 것이다', () => {
    expect(isOurServer(recordOf(111), '/opt/bin/opencode serve --hostname 127.0.0.1')).toBe(true)
  })

  // PID 재사용 — 그 번호를 물려받은 남의 프로세스다
  it('다른 명령줄이면 남의 것이다', () => {
    expect(isOurServer(recordOf(111), '/usr/bin/python3 train.py')).toBe(false)
  })

  // 같은 이름이라도 `serve` 가 아니면 우리가 띄운 서버가 아니다 (예: `opencode run`)
  it('serve 가 아니면 손대지 않는다', () => {
    expect(isOurServer(recordOf(111), '/opt/bin/opencode run "안녕"')).toBe(false)
  })

  // ps 가 아무것도 못 읽었다 = 확인 못 했다. **확인 못 한 것은 안 죽인다.**
  it('명령줄을 못 읽으면 남의 것으로 본다', () => {
    expect(isOurServer(recordOf(111), null)).toBe(false)
    expect(isOurServer(recordOf(111), '')).toBe(false)
  })
})

// **Doctor 사다리 ②의 갈래가 이 물음 하나로 정해진다** (설계 2026-08-16 §1):
// 참이면 재시작(우리 것을 접었다 띄운다), 거짓이면 갈아타기(남의 것은 그대로 둔다).
// 회수(`reap`)와 **같은 두 겹**을 쓴다 — 판정 기준이 갈리면 "죽여도 되나" 와
// "죽였다" 가 서로 다른 답을 내게 된다.
describe('owns — 그 PID 가 지금도 우리 것인가', () => {
  it('기록에 없는 pid 는 우리 것이 아니다', () => {
    const pids = store()
    pids.add(recordOf(process.pid, process.execPath))
    expect(pids.owns(999_999)).toBe(false)
  })

  // **모르면 거짓이다** — pid 를 아예 모르는 자리(서버를 안 띄웠다)도 여기로 온다
  it('pid 가 null 이면 우리 것이 아니다', () => {
    expect(store().owns(null)).toBe(false)
  })

  // 기록에 있어도 명령줄이 안 맞으면 거짓이다. 이 시험 프로세스 자신이 그 경우다 —
  // 살아 있지만 `opencode serve` 가 아니다. **PID 재사용이 정확히 이 모양으로 온다.**
  it('기록에 있어도 명령줄이 우리 것이 아니면 거짓이다', () => {
    const pids = store()
    pids.add(recordOf(process.pid, '/opt/bin/opencode'))
    expect(pids.owns(process.pid)).toBe(false)
  })

  // ⭐ **「잴 수 없었다」도 거짓으로 온다** — 파일을 못 읽으면 목록이 비고 그대로 false 다.
  // 살아 있는 우리 서버가 조용히 「남의 것」이 되는 경로이고, 지금 견딜 만한 이유는
  // `ours` 가 **문구만** 가르기 때문이다 (`pidStore.ts` 의 owns 주석 4번).
  it('읽을 수 없는 저장소에서는 무엇을 물어도 거짓이다', () => {
    expect(new ServerPidStore('/nonexistent/dir/servers.json').owns(process.pid)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('살아 있고 명령줄이 맞으면 참이다', async () => {
    const ours = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000) /* serve */'])
    spawned.push(ours)
    await new Promise((done) => setTimeout(done, 300))

    const pids = store()
    pids.add(recordOf(ours.pid!, process.execPath))
    expect(pids.owns(ours.pid!)).toBe(true)
  }, 20_000)
})

describe('reap — 지난 실행이 남긴 것', () => {
  // 진짜 프로세스로 잰다. `ps` 파싱과 kill 이 실제로 도는지는 가짜로는 못 본다.
  it.skipIf(process.platform === 'win32')('명령줄이 맞는 프로세스만 죽인다', async () => {
    // 명령줄에 실행 파일 경로와 `serve` 가 함께 들어가게 만든다 — 우리 서버 흉내
    const ours = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000) /* serve */'])
    const stranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000) /* 남의것 */'])
    spawned.push(ours, stranger)
    await new Promise((done) => setTimeout(done, 300))

    const pids = store()
    pids.add({ ...recordOf(ours.pid!, process.execPath) })
    // 같은 실행 파일이지만 명령줄에 `serve` 가 없다 — 대조에서 걸러져야 한다
    pids.add({ ...recordOf(stranger.pid!, process.execPath) })

    const result = pids.reap()

    expect(result.killed).toEqual([ours.pid])
    expect(result.skipped).toEqual([stranger.pid])
    await new Promise((done) => setTimeout(done, 500))
    expect(alive(ours.pid!)).toBe(false)
    expect(alive(stranger.pid!)).toBe(true)
  }, 20_000)

  // 죽였든 남의 것이든, 그 줄은 더 이상 우리 것을 가리키지 않는다.
  // 남겨 두면 그 PID 를 **영원히** 다시 들여다본다.
  it('거둔 뒤에는 파일을 비운다', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pid-')), 'servers.json')
    const pids = new ServerPidStore(path)
    // 살아 있지만 명령줄이 우리 것이 아닌 PID (이 시험 프로세스 자신) — 안 죽이고 넘어간다
    pids.add(recordOf(process.pid))

    pids.reap()

    expect(pids.list()).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe('[]')
  })
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
