// 새로 찾은 목록을 있던 목록에 얹는다.
//
// **다시 찾기가 있던 것을 함부로 지우지 않는다.** 예전 판(davis 레포 `test-scenario`)이
// 값을 치르고 얻은 방어를 그대로 가져왔다 — 에이전트는 같은 질문에 매번 같이 답하지
// 않으므로, 답에 안 나온 것을 곧바로 「없어졌다」로 읽으면 **묶음 하나가 흔들릴 때마다
// 목록이 줄어든다.** 시나리오까지 함께 사라진다.
//
// 규칙 셋:
//  1. 사람이 넣은 화면(`manual`)은 답에 없어도 남는다 — 사람의 판단이 더 세다
//  2. 에이전트가 넣었던 화면이 **20% 넘게** 사라졌으면 지우지 않는다 (알리기만)
//  3. 이름이 바뀌면 갱신하되 **시나리오·상태는 그대로 둔다** — 이름은 매번 흔들린다

const { AGENT, MANUAL, NONE, baseName } = require('./store')

/** 이보다 많이 사라졌다고 하면 믿지 않는다. */
const DROP_LIMIT = 0.2

/**
 * @returns `{ screens, added, removed, kept, distrusted }`
 *   `distrusted` 가 참이면 지우지 않았다는 뜻이다 — 부르는 쪽이 사용자에게 알린다.
 */
function mergeScreens(previous, found) {
  const byFile = new Map(found.map((one) => [one.file, one]))

  const priorAgent = previous.filter((one) => one.source === AGENT)
  const missing = priorAgent.filter((one) => !byFile.has(one.id))
  // 앞에 아무것도 없으면 비율을 잴 수 없다 — 첫 훑기다
  const distrusted = priorAgent.length > 0 && missing.length / priorAgent.length > DROP_LIMIT

  const kept = previous.filter(
    (one) => one.source === MANUAL || byFile.has(one.id) || distrusted,
  )

  const updated = kept.map((one) => {
    const hit = byFile.get(one.id)
    // 이름만 갱신한다. 상태·시나리오를 건드리면 다시 찾기 한 번에 확정이 풀린다.
    return hit && hit.name !== '' && hit.name !== one.name ? { ...one, name: hit.name } : one
  })

  const known = new Set(previous.map((one) => one.id))
  const added = found
    .filter((one) => !known.has(one.file))
    .map((one) => ({
      id: one.file,
      name: one.name !== '' ? one.name : baseName(one.file),
      state: NONE,
      source: AGENT,
      cases: [],
    }))

  return {
    screens: [...updated, ...added],
    added: added.length,
    // 실제로 지운 수. 안 믿기로 했으면 0 이다.
    removed: distrusted ? 0 : missing.length,
    kept: updated.length,
    distrusted,
  }
}

module.exports = { mergeScreens, DROP_LIMIT }
