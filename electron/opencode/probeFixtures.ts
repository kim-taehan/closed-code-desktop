import { vi } from 'vitest'

// `probe.test.ts` 와 `probeModels.test.ts` 가 같이 쓰는 가짜 fetch.
//
// 파일이 갈린 이유는 300줄 상한이다 — 프로브가 **서버 확인**과 **모델 확인** 두 축이고,
// 각 축이 URL 단언·실패 문장·유출 방지까지 보느라 한 파일에 안 들어간다.
// 헬퍼를 양쪽에 복사하면 한쪽만 고쳐져 **같은 이름의 가짜가 서로 다르게 답하게 된다.**

/** 모든 호출에 같은 응답을 주는 fetch */
export function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

/**
 * URL 별로 다르게 답하는 fetch. `checkModels` 가 두 겹(providers 조회 → baseURL ping)이라
 * 한 응답으로는 **"설정은 됐는데 주소가 죽었다"** 를 만들 수 없다.
 * `dead` 로 시작하는 주소는 **연결 자체가 실패**한다 — 데몬이 안 떠 있을 때의 모양이다.
 */
export function routedFetch(body: unknown, dead: string[] = []): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    if (dead.some((prefix) => url.startsWith(prefix))) {
      return Promise.reject(new Error('fetch failed'))
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }) as unknown as typeof fetch
}

/** n 번째 호출이 받은 URL */
export function urlOf(impl: typeof fetch, call = 0): string {
  return (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[call]![0]
}

export function callCount(impl: typeof fetch): number {
  return (impl as unknown as { mock: { calls: unknown[] } }).mock.calls.length
}
