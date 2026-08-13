import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { discardDownload, downloadPackage } from './packageDownload'

// 배포처에서 패키지 바이트를 받는 것만. 푸는 것은 `install.ts` 몫이다.
//
// 네트워크에 붙지 않는다 — `fetchImpl` 을 갈아끼운다. 폐쇄망 CI 에서도 돌아야 한다.

const URL_OK = 'http://registry.local/packages/sample-ext/0.2.0'
const BYTES = Buffer.from('PKfake-zip-bytes')

function respond(body: Buffer | string, init: { status?: number } = {}) {
  const buffer = typeof body === 'string' ? Buffer.from(body) : body
  return vi.fn(async () => ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  })) as unknown as typeof fetch
}

describe('주소를 먼저 본다 — 네트워크를 건드리기 전에', () => {
  it('주소 모양이 아니면 부르지도 않는다', async () => {
    const fetchImpl = respond(BYTES)
    const result = await downloadPackage({ url: '아무거나', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // 화면이 넘긴 주소라도 다시 본다 — renderer 는 신뢰 경계 밖이다
  it('http/https 가 아니면 거부한다', async () => {
    const fetchImpl = respond(BYTES)
    const result = await downloadPackage({ url: 'file:///etc/passwd', fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'bad_url', detail: 'file:' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('받아서 임시 파일로 떨군다', () => {
  it('받은 바이트가 그대로 파일에 있다', async () => {
    const result = await downloadPackage({ url: URL_OK, fetchImpl: respond(BYTES) })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await readFile(result.path)).toEqual(BYTES)
    expect(result.bytes).toBe(BYTES.byteLength)
    await discardDownload(result.dir)
  })

  // 설치 폴더 안에 두면 scanExtensions 가 받는 동안 유령 행(no_manifest)으로 잡는다
  it('확장 설치 폴더가 아니라 임시 폴더에 둔다', async () => {
    const result = await downloadPackage({ url: URL_OK, fetchImpl: respond(BYTES) })
    if (!result.ok) throw new Error('내려받기가 실패했다')

    expect(result.dir.startsWith(tmpdir())).toBe(true)
    expect(result.dir).not.toContain('desktop-extensions')
    await discardDownload(result.dir)
  })

  // 주소 마지막 조각을 파일명으로 쓰면 배포처가 이름으로 경로를 밀어 넣을 수 있다
  it('파일 이름을 배포처가 정하지 못한다', async () => {
    const result = await downloadPackage({
      url: 'http://registry.local/a/..%2F..%2Fevil.sh',
      fetchImpl: respond(BYTES),
    })
    if (!result.ok) throw new Error('내려받기가 실패했다')

    expect(result.path).toBe(`${result.dir}/package.axcx`)
    await discardDownload(result.dir)
  })

  it('치우면 임시 폴더가 사라진다', async () => {
    const result = await downloadPackage({ url: URL_OK, fetchImpl: respond(BYTES) })
    if (!result.ok) throw new Error('내려받기가 실패했다')

    await discardDownload(result.dir)
    await expect(stat(result.dir)).rejects.toThrow()
  })

  // 설치는 이미 끝나 있다 — 못 치웠다고 실패로 뒤집으면 되지도 않은 실패가 보인다
  it('없는 폴더를 치워도 던지지 않는다', async () => {
    await expect(discardDownload('/nowhere/code-ext-없음')).resolves.toBeUndefined()
  })
})

describe('실패 사유를 가른다', () => {
  it('못 닿으면 unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.local')
    }) as unknown as typeof fetch
    const result = await downloadPackage({ url: URL_OK, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' })
    expect((result as { detail?: string }).detail).toContain('ENOTFOUND')
  })

  it('4xx/5xx 는 상태코드를 함께 준다', async () => {
    const result = await downloadPackage({
      url: URL_OK,
      fetchImpl: respond('없음', { status: 404 }),
    })
    expect(result).toMatchObject({ ok: false, reason: 'http_error', detail: 'HTTP 404' })
  })

  it('시간을 넘기면 timeout — unreachable 과 가른다 (할 일이 다르다)', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    }) as unknown as typeof fetch
    const result = await downloadPackage({ url: URL_OK, fetchImpl, timeoutMs: 50 })
    expect(result).toMatchObject({ ok: false, reason: 'timeout', detail: '50ms' })
  })

  // 헤더만 받고 끊기는 것이 실제로 흔하다. 본문 읽기도 같은 사유로 잡혀야 한다
  it('본문을 받다 끊겨도 unreachable 로 잡는다', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        throw new Error('terminated')
      },
    })) as unknown as typeof fetch
    const result = await downloadPackage({ url: URL_OK, fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'unreachable', detail: 'terminated' })
  })
})
