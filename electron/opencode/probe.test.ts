import { describe, expect, it, vi } from 'vitest'
import { MIN_OPENCODE_VERSION } from '../../shared/opencode/version'
import { fakeFetch, urlOf } from './probeFixtures'
import { pingOpencode } from './probe'

// **진단이 실제로 무엇을 호출하는가 — URL 을 문자열로 단언한다.**
//
// 이 레포가 두 번 밟은 자리다: `POST /mcp` 에 `location[directory]=`(pty 표면 이름)를
// 잘못 써도 **HTTP 200 이 났고**, 증상은 한참 뒤에야 다른 모양으로 나타났다.
// 진단은 그보다 나쁘다 — 틀린 주소로 물어 실패하면 화면에 **"서버가 안 떠 있습니다"** 라고
// 뜨므로, **오진이 정답처럼 보인다.**
//
// 그래서 응답 해석만 보지 않고 `fetchImpl` 이 받은 URL 자체를 본다.
//
// 모델 쪽(`checkModels`)은 300줄 상한 때문에 `probeModels.test.ts` 로 갈렸다.

/** 실측 응답 그대로 — `/global/health` 는 `version` 을 함께 준다 */
const HEALTH = { healthy: true, version: MIN_OPENCODE_VERSION }

describe('pingOpencode — 서버가 떠 있나', () => {
  // ⚠️ **`/api/health` 가 아니다.** 옮긴 이유가 둘이다: `/global/health` 만 릴리스 버전을
  // 주고(진단 패널은 사람이 캡처해서 묻는 화면이라 버전이 찍혀 있으면 되묻지 않아도 된다),
  // **`/api/health` 라우트가 1.14.28 에는 없어** 그 주소가 웹 UI HTML 을 돌려준다.
  // 되돌리면 구버전을 "안 떠 있습니다" 로 **오진**한다 — 개선이자 수리다.
  // **잰 점은 1.14.28 · 1.17.17 · 1.17.18 · 1.18.16 넷이고 그 사이는 안 쟀다.**
  it('GET {base}/global/health 를 부른다', async () => {
    const impl = fakeFetch(HEALTH)
    await pingOpencode('http://127.0.0.1:4096', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/global/health')
  })

  // 주소 정규화. ⚠️ **"안 떼면 404" 는 실측이 아니었다** — 1.17.18 은 `//global/health`·
  // `//api/health`·`//config/providers` 를 **전부 200 으로 받는다** (재 봤다).
  // 그래도 떼는 이유는 두 가지다: 사용자가 붙여넣는 주소가 제각각이라 **한 모양으로 모으는 것**과,
  // 앞에 프록시·리버스프록시가 붙으면 이중 슬래시를 어떻게 다루는지 **재 본 적이 없다**는 것.
  // (`client.ts` 도 같은 정규화를 한다.)
  it('주소 끝의 / 를 떼고 붙인다', async () => {
    const impl = fakeFetch(HEALTH)
    await pingOpencode('http://127.0.0.1:4096///', impl)
    expect(urlOf(impl)).toBe('http://127.0.0.1:4096/global/health')
  })

  it('healthy 면 통과하고 주소를 detail 에 적는다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch(HEALTH))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('127.0.0.1:4096')
  })

  // 200 인데 healthy 가 아닌 응답 — 다른 서버가 그 포트를 잡고 있을 때 이렇게 온다
  it('응답은 왔는데 healthy 가 아니면 실패다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: false }))
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('health 응답이 healthy 가 아닙니다')
  })

  it('빈 주소는 호출조차 하지 않는다', async () => {
    const impl = fakeFetch(HEALTH)
    const result = await pingOpencode('   ', impl)
    expect(result.ok).toBe(false)
    expect(impl).not.toHaveBeenCalled()
  })

  // 화면에 그대로 뜨는 문장이다 — 다음 행동을 함께 적어야 한다
  it('못 닿으면 사유에 `opencode serve` 안내를 붙인다', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch
    const result = await pingOpencode('http://127.0.0.1:4096', impl)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('fetch failed')
    expect(result.detail).toContain('opencode serve')
  })

  // abort 는 "느리다" 가 아니라 "안 떠 있다" 일 때가 대부분이라 그렇게 읽히게 쓴다
  it('시간 초과는 응답이 없다고 적는다', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const impl = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch
    const result = await pingOpencode('http://127.0.0.1:4096', impl)
    expect(result.detail).toContain('응답이 없습니다')
  })

  it('HTTP 오류도 실패다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({}, false))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('HTTP 500')
  })
})

// 하한선만 있고 **상한이 없다.** 비교 자체는 shared/opencode/version.test.ts 가 겨눈다 —
// 여기서 보는 것은 "프로브가 그 판정을 실제로 쓰는가" 다.
describe('pingOpencode — 버전 하한선', () => {
  it('하한선 이상이면 통과하고 버전을 detail 에 적는다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: true, version: '1.18.16' }))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('1.18.16')
  })

  // 문자열 비교로 짜면 `'1.9.0' > '1.17.18'` 이 참이라 **여기서 통과해 버린다**
  it('하한선 미만이면 healthy 여도 실패다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: true, version: '1.9.0' }))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('1.9.0')
    expect(result.detail).toContain(MIN_OPENCODE_VERSION)
  })

  it('한참 높은 버전은 막지 않는다 — 상한이 없다', async () => {
    expect((await pingOpencode('http://x', fakeFetch({ healthy: true, version: '99.0.0' }))).ok).toBe(true)
  })

  // 버전을 안 주는 서버는 재 본 적이 없다. 모르는 것을 실패로 적으면 진단이 거짓말을 한다.
  it('버전 필드가 없어도 막지 않고 「미상」이라고 적는다', async () => {
    const result = await pingOpencode('http://127.0.0.1:4096', fakeFetch({ healthy: true }))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('버전 미상')
  })
})
