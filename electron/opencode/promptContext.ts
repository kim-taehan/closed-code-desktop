// 첨부·보는 중인 파일을 **프롬프트 글로 번역한다.**
//
// davis 는 `chat_request` 의 `contextFiles`·`activeEditor` 를 runtime 이 받아 프롬프트에
// 넣어 줬다. opencode 에는 그 자리가 없다 — `POST /api/session/:id/prompt` 는
// `{text, files, agents}` 뿐이라, 번역하지 않으면 **붙인 문서가 조용히 사라진다**
// (실제로 사라졌다: 문서를 첨부하고 "요약해줘" 를 보내면 "어떤 문서를 요약할까요?" 가 왔다).
//
// **`prompt.files` 가 아니다.** 그쪽은 미디어 첨부 통로라서 문서를 실으면 provider 가
// 거절한다 — 실측(1.17.18 + davis-litellm/glm-5.2): `.md` 를 `files` 로 보내니 턴이
// `"OpenAI Chat does not support media type text/markdown"` 으로 죽었다. 반면 **경로를 글에
// 적으면 모델이 read 도구로 직접 읽는다** (같은 조건에서 세 표현 다 성공 — `@경로`·꼬리표
// 블록·맨 경로). 이 앱의 계약도 원래 "내용이 아니라 경로만" 이다 (`shared/protocol/chatImage.ts`).
//
// 꼬리표 블록을 고른 이유는 **경로에 공백이 있어도 한 줄이 곧 한 경로**라서다.
// `@경로` 는 opencode 자신의 관례지만 공백에서 끊긴다.
//
// **아직 안 옮긴 것** (davis 에는 있고 여기서는 버려진다):
//   - `dirtyFiles` — davis runtime 은 그 턴 동안 그 파일 쓰기를 **거부**했다. 글로 적어
//     부탁하는 것과 거부하는 것은 다르므로, 지킬 수 없는 약속을 흉내내지 않는다
//   - `autoContext` — 최근 저장 파일. runtime 이 넣던 것이고 대체가 필요한지 아직 안 봤다
//
// **이미 옮긴 것:** `images` 는 이 번역(글로)을 거치지 않고 `legacyChat.ts` 의 `sendPrompt` 가
// `file` part(`data:` URI) 로 직접 실어 `prompt_async` 로 보낸다. 한때 `glm-5.2`(비전 없음)가
// 400 을 준 것으로 여기 미이치로 적혀 있었는데(2026-08-28 이전), 그 모델은 종료됐고 기본
// 모델 `gateway-local/qwen3.8-27b` 은 이미지 입력을 받는다( desktop/CLAUDE.md 모델 표).

/** 한 줄이 한 경로다. 공백이 든 경로도 그대로 간다. */
const OPEN = '<attached_context>'
const CLOSE = '</attached_context>'

interface ContextFileWire {
  filePath?: unknown
  type?: unknown
}

interface ActiveEditorWire {
  filePath?: unknown
  selection?: { start_offset?: unknown; end_offset?: unknown }
}

/**
 * `chat_request.data` 에 실려 온 컨텍스트를 질문 뒤에 덧붙인다.
 *
 * 붙일 것이 없으면 **질문을 그대로 돌려준다** — 빈 꼬리표만 붙으면 모델이 첨부가 있는 줄 안다.
 * 이미 질문에 적힌 경로는 다시 적지 않는다 (`@경로` 로 친 것이 그대로 온다).
 */
export function withPromptContext(query: string, data: Record<string, unknown>): string {
  const lines: string[] = []

  for (const file of asArray(data['contextFiles'])) {
    const path = pathOf(file)
    if (path === null || query.includes(path)) continue
    lines.push(`${(file as ContextFileWire).type === 'dir' ? 'dir' : 'file'}: ${path}`)
  }

  const editor = data['activeEditor']
  if (isRecord(editor)) {
    const path = pathOf(editor)
    // 선택 영역은 "이 부분 고쳐줘" 가 성립하는 근거다 — 있으면 줄 범위까지 적는다
    if (path !== null) lines.push(`viewing: ${path}${rangeOf(editor as ActiveEditorWire)}`)
  }

  if (lines.length === 0) return query
  return `${query}\n\n${OPEN}\n${lines.join('\n')}\n${CLOSE}`
}

/**
 * 붙였던 꼬리표를 떼어낸다 — **이력 재생 전용이다** (`historyReplay.ts`).
 *
 * 재생은 opencode 에 저장된 프롬프트를 그대로 읽는데, 거기에는 위 `withPromptContext` 가
 * 붙인 블록까지 들어 있다. 그대로 그리면 **사용자가 치지도 않은 `<attached_context>` 줄이
 * 자기 말풍선 안에 뜬다** (실측: `"@README.md  이 파일 열어줘\n\n<attached_context>\nfile: …"`).
 * davis 는 이 문제가 없었다 — 컨텍스트를 runtime 이 따로 받아 질문에 섞지 않았다.
 *
 * 붙이는 쪽과 떼는 쪽이 갈리면 형식이 조용히 어긋나므로 **같은 파일에 둔다.**
 * 꼬리에 붙은 것 하나만 뗀다 — 사용자가 본문에 같은 낱말을 쓴 경우는 건드리지 않는다.
 */
export function stripPromptContext(query: string): string {
  if (!query.endsWith(CLOSE)) return query
  const start = query.lastIndexOf(`\n\n${OPEN}\n`)
  return start < 0 ? query : query.slice(0, start)
}

function rangeOf(editor: ActiveEditorWire): string {
  const start = editor.selection?.start_offset
  const end = editor.selection?.end_offset
  if (typeof start !== 'number' || typeof end !== 'number') return ''
  return ` (${start}-${end}줄 선택)`
}

function pathOf(value: unknown): string | null {
  if (!isRecord(value)) return null
  const path = (value as ContextFileWire).filePath
  return typeof path === 'string' && path.trim() !== '' ? path : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
