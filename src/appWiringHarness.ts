import { vi } from 'vitest'
import { EMPTY_GIT_STATE } from '../shared/git/gitState'

// `App.wiring.test.tsx` 전용 `window.davis` 대역.
//
// App 은 훅 서른 개 남짓을 통해 브리지의 90개 가까운 메서드를 건드린다. 그것을 손으로
// 세우면 시험이 배선이 아니라 **대역 유지보수**가 된다 — 그래서 프록시로 없는 이름을
// 그때그때 만들어 준다. 이름 규칙 하나만 지키면 된다: `on*` 은 구독(해제자를 돌려준다),
// 나머지는 프라미스를 돌려주는 호출.
//
// ⚠️ **이건 계약을 재는 가짜가 아니다.** 계약(요청/응답 shape)은 `tests/fake-opencode/`
// 와 어댑터 시험이 잰다. 여기서 재는 것은 화면 조립뿐이라, 응답이 필요한 몇 개만
// 진짜 모양으로 세워 두고 나머지는 조용히 넘긴다.

export type DavisMock = Record<string, ReturnType<typeof vi.fn>>

/** 구독자 보관소 — `emit` 이 여기서 꺼내 부른다. 창을 다시 그려도 같은 곳을 본다. */
const listeners = new WeakMap<DavisMock, Map<string, ((...args: unknown[]) => void)[]>>()

const PROJECT = { id: 'p1', root: '/tmp/p1', name: 'p1', favorite: false, lastOpenedAt: 0 }

/**
 * 응답 모양이 실제로 쓰이는 것들.
 *
 * 프록시 기본값(`undefined`)으로 두면 호출자가 결과를 풀다 터진다. **여기 있는 것은
 * 터져 봐서 추가된 목록이지 브리지 전체가 아니다** — 빈 껍데기를 자동으로 지어내는
 * 기본값(예: 없는 이름마다 `[]`)을 쓰지 않은 이유가 이것이다. 그런 기본값은 배선을
 * 바꿔 새 호출이 생겨도 조용히 넘어가, 시험이 안 도는데 초록이 된다.
 *
 * 대화 배선과는 무관한 것들이다 — 마운트를 통과시키는 데만 쓴다.
 */
const SEEDS: Record<string, unknown> = {
  // 프로젝트 목록이 비면 App 이 런처 화면으로 일찍 되돌아가 입력창도 대화 화면도 안 그려진다
  listProjects: { all: [PROJECT], open: [PROJECT], activeId: PROJECT.id },
  readDir: { entries: [] },
  listCommands: { commands: [] },
  // 빈 모양을 손으로 짓지 않는다 — 앱이 쓰는 그 상수를 그대로 쓴다
  gitState: { state: EMPTY_GIT_STATE },
  gitBranches: { branches: [] },
  gitStashes: { stashes: [] },
  readRunList: { entries: [], found: false, stale: false },
}

export function installDavisMock(): DavisMock {
  const target: DavisMock = {}
  const registry = new Map<string, ((...args: unknown[]) => void)[]>()

  const davis = new Proxy(target, {
    get(store, name: string) {
      if (!(name in store)) store[name] = make(name, registry)
      return store[name]
    },
    // React·훅이 `in` 으로 존재를 묻는 경우까지 덮는다
    has: () => true,
  }) as DavisMock

  listeners.set(davis, registry)
  window.davis = davis as never
  return davis
}

function make(
  name: string,
  registry: Map<string, ((...args: unknown[]) => void)[]>,
): ReturnType<typeof vi.fn> {
  if (name.startsWith('on')) {
    return vi.fn((handler: (...args: unknown[]) => void) => {
      const list = registry.get(name) ?? []
      list.push(handler)
      registry.set(name, list)
      return () => {
        registry.set(name, (registry.get(name) ?? []).filter((entry) => entry !== handler))
      }
    })
  }
  const seed = SEEDS[name]
  return vi.fn(async () => seed)
}

/**
 * main 이 보내는 것처럼 구독자에게 밀어 넣는다.
 *
 * 채널 이름은 브리지의 메서드 이름 그대로다 (`onSessionState`·`onTurnEvent`).
 * 구독자가 하나도 없으면 던진다 — 이름을 틀려도 조용히 통과하면 그 시험은
 * 아무것도 안 겨눈다.
 */
export function emit(davis: DavisMock, channel: string, ...args: unknown[]): void {
  const handlers = listeners.get(davis)?.get(channel) ?? []
  if (handlers.length === 0) {
    throw new Error(`구독자가 없는 채널로 보냈다: ${channel}`)
  }
  for (const handler of [...handlers]) handler(...args)
}
