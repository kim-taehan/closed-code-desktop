// 에이전트의 답에서 화면 목록을 꺼낸다.
//
// **답은 자유 문장이다.** 프롬프트로 JSON 한 덩이를 못 박아도 모델은 앞뒤에 말을 붙이고,
// 약한 모델은 형식 자체를 흘린다 (`desktop/CLAUDE.md` 「모델」 — 프롬프트가 무르면
// 도구도 안 부른다는 실측이 있다). 그래서 **견디되 지어내지 않는다**:
// 읽히면 읽고, 안 읽히면 **빈 목록이 아니라 오류**다.
//
// 빈 목록으로 삼키면 안 되는 이유: 「훑었는데 화면이 없다」와 「답을 못 읽었다」가
// 화면에서 똑같아진다. 앞은 정상이고 뒤는 다시 눌러야 하는 상황이다.

/** 실패를 `{ ok:false, reason }` 으로 돌려준다 — 던지지 않는다 (부르는 쪽이 화면에 띄운다). */
function parseScreens(answer) {
  const text = typeof answer === 'string' ? answer : ''
  const block = jsonBlock(text)
  if (block === null) return { ok: false, reason: 'JSON 을 찾지 못했습니다' }

  let parsed
  try {
    parsed = JSON.parse(block)
  } catch (error) {
    return { ok: false, reason: `JSON 을 읽지 못했습니다: ${error.message}` }
  }

  const list = parsed && typeof parsed === 'object' ? parsed.screens : null
  if (!Array.isArray(list)) return { ok: false, reason: '`screens` 배열이 없습니다' }

  const screens = list.map(toScreen).filter(Boolean)
  // **모양이 하나도 안 맞으면 오류다.** 「찾은 것이 없다」로 넘기면 위와 같은 혼동이 난다.
  // 다만 배열이 애초에 비어 있는 것은 정상 답이다 — 화면이 없는 프로젝트가 있다.
  if (screens.length === 0 && list.length > 0) {
    return { ok: false, reason: '항목에 `file` 이 없습니다' }
  }
  return { ok: true, screens }
}

/**
 * 답에서 JSON 덩이 하나를 떼어 낸다.
 *
 * 실제로 오는 모양 셋을 다 받는다: 그대로 · ```json 울타리 · 말 사이에 낀 것.
 * 마지막은 **첫 `{` 부터 마지막 `}` 까지**로 잡는다 — 중괄호를 세어 가며 짝을 맞추는
 * 것보다 무디지만, 답에 JSON 이 둘 있는 경우를 본 적이 없고 무딘 쪽이 덜 깨진다.
 */
function jsonBlock(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return body.slice(start, end + 1)
}

/**
 * 항목 하나를 화면으로. **`file` 이 없으면 버린다** — 경로가 식별자라 그것이 없으면
 * 같은 화면인지 알 수 없고, 목록에 넣어도 열 수가 없다.
 */
function toScreen(item) {
  if (item === null || typeof item !== 'object') return null
  const file = typeof item.file === 'string' ? item.file.trim() : ''
  if (file === '') return null
  return {
    file: file.replace(/^\.\//, ''),
    name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : '',
  }
}

module.exports = { parseScreens, jsonBlock, toScreen }
