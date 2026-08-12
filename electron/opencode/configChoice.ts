import { toModelRef } from './models'

// 진단의 `model` 단계가 **어느 프로바이더를 볼지** 고르는 자리.
//
// `probe.ts` 에서 뽑아냈다 — 300줄 상한 때문이기도 하지만, 「무엇을 고르나」와
// 「고른 것이 살아 있나」는 서로 다른 물음이고 **틀리는 방식도 다르다.**
// 고르기가 틀리면 **초록인 채로** 틀리고, 생사 판정이 틀리면 빨간색으로 틀린다.

/**
 * `GET /config` 응답에서 이 모듈이 보는 부분만.
 * `agent`·`mode` 항목은 스키마상 같은 `AgentConfig` 이고, 여기서 필요한 것은 `model` 뿐이다.
 */
export interface OpencodeConfigView {
  model?: unknown
  small_model?: unknown
  agent?: Record<string, { model?: unknown } | undefined>
  mode?: Record<string, { model?: unknown } | undefined>
}

/**
 * 설정이 **쓸 수 있는** 프로바이더 id 들. 중복은 없앤다.
 *
 * **`config.model` 하나만 보면 거짓 초록이 난다.** 처음엔 그것을 "한계" 로만 적었는데
 * `contract-qa` 가 실제로 재현했다 (`_workspace/03_contract_qa.md` 20회차 M1):
 *
 *     model             : ollama-local/devstral:24b   ← 살아 있음
 *     agent.build.model : fake-remote/ghost:1b        ← 죽어 있음 → 그런데 진단은 초록
 *
 * `build` 는 **기본 primary 에이전트**라, 그 세션이 실제로 쓰는 프로바이더가 죽었는데
 * 초록이 나왔다. **「전부 본다」였을 땐 안 나던 것이고, 「고른 것만 본다」로 좁히면서
 * 생긴 구멍이다.**
 *
 * 그래서 `model` ∪ `small_model` ∪ `agent.*.model` ∪ `mode.*.model` 을 모은다.
 * **「전부」로 되돌아가는 게 아니라 「실제로 쓰일 수 있는 것들」로 넓히는 것**이라,
 * 안 쓰는 프로바이더가 죽었다고 진단이 늘 빨개지는 일은 여전히 없다.
 * (`mode` 는 스키마상 `@deprecated Use agent field instead` 지만 같은 `AgentConfig` 라
 * 옛 설정에 남아 있으면 그대로 산다.)
 *
 * **첫 `/` 에서만 자른다** — 모델 id 에 `/` 가 들어가는 게이트웨이가 있다
 * (`openrouter/anthropic/claude-3`). `models.ts` 의 `toModelRef()` 를 그대로 쓴다 —
 * 여기에 파서를 또 쓰면 두 벌이 되어 한쪽만 고쳐진다.
 *
 * ⚠️ **남은 한계 — 세션별 모델 변경은 못 본다.** `POST /api/session/{id}/model` 로 바꾼 것은
 * `/config` 에 안 비친다 (구조상 이 단계가 볼 수 없는 자리다). 진단은 **설정이 성한가**를 보고,
 * **지금 이 세션이 무엇을 쓰는가**는 안 본다.
 */
export function providerIdsOf(config: OpencodeConfigView): string[] {
  const named = [
    config.model,
    config.small_model,
    ...Object.values(config.agent ?? {}).map((entry) => entry?.model),
    ...Object.values(config.mode ?? {}).map((entry) => entry?.model),
  ]
  const ids = named
    .filter((name): name is string => typeof name === 'string')
    .map((name) => toModelRef(name)?.providerID)
    .filter((id): id is string => typeof id === 'string')
  return [...new Set(ids)]
}
