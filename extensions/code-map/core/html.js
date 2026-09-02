// 화면 조각 공용 — 새김·이름 다듬기·다리 규약 이름.
//
// `render.js` 와 `diagram.js` 가 **둘 다** 쓴다. 한쪽에 두고 다른 쪽에서 require 하면
// 순환이 되고, CommonJS 의 순환은 던지지 않고 **빈 객체를 준다** — 함수가 `undefined` 가
// 되어 화면이 통째로 빈다. 그래서 아래로 뺐다.

/** 화면에서 확장의 명령을 부를 때 쓰는 id (`data-command`). 다리 규약의 절반이다 */
const FOCUS = 'codeMap.focus'

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `Player.java` → `Player`. 칸이 좁아 확장자까지 넣으면 이름이 잘린다 */
function shortName(path) {
  return baseName(path).replace(/\.[^.]+$/, '')
}

/**
 * 긴 경로를 **디렉토리 경계에서** 접히게 한다.
 *
 * 그냥 두면 낱말 한가운데서 끊겨 `develop/ x/llm/…` 처럼 보인다 — 경로를 눈으로 따라가는
 * 것이 이 줄의 유일한 쓸모인데 그게 안 된다. `<wbr>` 은 **접어도 되는 자리**만 알려 주고
 * 글자를 더하지 않는다.
 */
function breakablePath(path) {
  return escapeHtml(path).split('/').join('/<wbr>')
}

module.exports = { escapeHtml, baseName, shortName, breakablePath, FOCUS }
