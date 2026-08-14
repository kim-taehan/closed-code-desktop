// 저장된 화면들. 정본은 `code.storage` 이고, 이 파일은 그 위의 얇은 규칙층이다.
//
// **저장소는 이미 확장별·프로젝트별로 갈려 있다** (`electron/extensions/storageStore.ts`).
// 확장이 프로젝트를 구분할 일이 없다 — `storage.get('screens')` 는 늘 지금 프로젝트 것이다.
//
// 화면 하나의 모양 (설계 §4):
//
//   { id, name, state, source, cases: [{ step, action, input, expect }] }
//
// `id` 는 **파일 경로**다. 에이전트가 준 이름은 다시 물으면 달라지지만 경로는 안 달라진다.

const KEY = 'screens'

/** 상태 셋. 「검토」를 두지 않는다 — 혼자 쓰는 도구에서 초안과 검토가 하는 일이 같다. */
const NONE = 'none'
const DRAFT = 'draft'
const FIXED = 'fixed'

/** 화면을 누가 넣었나. 다시 찾기는 `manual` 을 지우지 않는다 (설계 §3.2). */
const AGENT = 'agent'
const MANUAL = 'manual'

async function load(code) {
  const saved = await code.storage.get(KEY)
  // 없는 키는 `undefined` 다. 깨진 값(배열이 아닌 것)도 빈 것으로 시작한다 —
  // 여기서 던지면 확장이 아무것도 못 그려 사용자에게는 "안 뜬다" 로만 보인다.
  return Array.isArray(saved) ? saved.map(normalize).filter(Boolean) : []
}

async function save(code, screens) {
  await code.storage.set(KEY, screens)
}

/**
 * 화면 하나를 더한다. **같은 경로면 늘리지 않는다.**
 *
 * 사람이 고른 파일이 이미 목록에 있으면 그대로 둔다 — 덮어쓰면 그 화면에 붙은
 * 시나리오가 통째로 사라진다. 「이미 있다」는 실패가 아니라서 알리지도 않는다.
 */
function withScreen(screens, screen) {
  if (screens.some((one) => one.id === screen.id)) return screens
  return [...screens, screen]
}

/** 파일 경로로 화면 하나를 만든다. 이름은 파일명에서 뽑되 사람이 고친다. */
function screenOfPath(path, source) {
  return {
    id: path,
    name: baseName(path),
    state: NONE,
    source: source === MANUAL ? MANUAL : AGENT,
    cases: [],
  }
}

function baseName(path) {
  const last = String(path).split('/').pop() || String(path)
  // 확장자를 뗀다 — `OrderList.tsx` 보다 `OrderList` 가 이름 자리에 맞다.
  // 파일 이름은 목록의 둘째 줄에 그대로 따로 보인다.
  return last.replace(/\.[^.]+$/, '')
}

/**
 * 저장된 값 하나를 지금 모양으로 맞춘다. 모양이 아니면 `null` — 부르는 쪽이 거른다.
 *
 * **버리지 않고 채운다.** 앞으로 칸이 늘 때 예전에 저장한 것이 통째로 사라지면,
 * 사용자에게는 「지웠다」와 구분되지 않는다.
 */
function normalize(value) {
  if (value === null || typeof value !== 'object') return null
  const id = value.id
  if (typeof id !== 'string' || id === '') return null
  return {
    id,
    name: typeof value.name === 'string' && value.name !== '' ? value.name : baseName(id),
    state: value.state === DRAFT || value.state === FIXED ? value.state : NONE,
    source: value.source === MANUAL ? MANUAL : AGENT,
    cases: Array.isArray(value.cases) ? value.cases : [],
  }
}

module.exports = {
  KEY,
  NONE,
  DRAFT,
  FIXED,
  AGENT,
  MANUAL,
  load,
  save,
  withScreen,
  screenOfPath,
  baseName,
  normalize,
}
