import { describe, expect, it } from 'vitest'
import {
  EXTENSION_COMMAND_MESSAGE,
  EXTENSION_OPEN_MESSAGE,
  extensionHtmlDoc,
  isCommandRequest,
  isOpenRequest,
  readPalette,
} from './extensionHtmlDoc'

// 확장 HTML 격리. **이 파일이 앱 화면의 신뢰 경계다** — 여기가 느슨해지면 확장 코드가
// 앱 DOM·`window.davis`(=main 으로 가는 IPC)에 닿는다. 그래서 "그려지는가" 가 아니라
// **"막히는가"** 를 잠근다.

const DOC = (html: string): string => extensionHtmlDoc(html)

describe('확장 HTML 격리 문서', () => {
  it('바깥 네트워크를 전부 막는다 — 확장 화면이 사내 자료를 실어 나갈 통로가 없어야 한다', () => {
    const doc = DOC('<p>hi</p>')

    expect(doc).toContain("default-src 'none'")
    // 에어갭 제약과 같은 방향이다. 이 줄이 사라지면 확장 HTML 이 fetch·img 로 밖을 부를 수 있다.
    expect(doc).toMatch(/Content-Security-Policy/)
  })

  it('클릭 다리를 심는다 — 이것이 없으면 행을 눌러도 아무 일이 없다', () => {
    const doc = DOC('<p>hi</p>')

    expect(doc).toContain(EXTENSION_OPEN_MESSAGE)
    expect(doc).toContain('data-open')
  })

  it('명령 다리도 함께 심는다 — 이것이 없으면 탭 안의 단추가 안 눌린다', () => {
    const doc = DOC('<p>hi</p>')

    expect(doc).toContain(EXTENSION_COMMAND_MESSAGE)
    expect(doc).toContain('data-command')
  })

  it('두 규약이 **다른 표식**을 쓴다 — 섞으면 받는 쪽이 경로인지 명령인지 추측하게 된다', () => {
    expect(EXTENSION_COMMAND_MESSAGE).not.toBe(EXTENSION_OPEN_MESSAGE)
  })

  it('nonce 를 쓰지 않는다 — 쓰면 확장 스크립트가 통째로 죽는다', () => {
    // CSP 규칙: **nonce 가 있으면 `'unsafe-inline'` 이 무시된다.** 둘을 같이 못 쓴다.
    // 확장 호스트가 애초에 샌드박스가 아니라(`hostEntry.ts`) 화면 안에서만 막는 것은
    // 악의를 못 막으면서 정렬·접기 같은 정상 기능만 죽인다 (`extensionHtmlDoc.ts` 머리말).
    const doc = DOC('<script>sortTable()</script>')

    expect(doc).toContain("script-src 'unsafe-inline'")
    expect(doc).not.toContain('nonce')
    // 확장 HTML 은 **그대로** 들어간다 (호스트가 내용을 고치지 않는다)
    expect(doc).toContain('<script>sortTable()</script>')
  })

  it('확장 HTML 을 고치지 않는다 — 호스트는 감싸기만 한다', () => {
    const html = '<table><tr data-open="a/b.java"><td>b</td></tr></table>'

    expect(DOC(html)).toContain(html)
  })

  it('색을 넘기면 그대로 심고, 선언을 빠져나갈 글자는 지운다', () => {
    const doc = extensionHtmlDoc('<p/>', {
      palette: {
        bg: '#111', text: '#eee', muted: '#888',
        border: '#333', surface: '#222',
        accent: 'red; } body { display:none',
      },
    })

    expect(doc).toContain('#111')
    // `;` `}` 가 남으면 확장이 준 값이 아니라도 뒤 규칙이 깨진다
    expect(doc).not.toContain('body { display:none')
  })
})

describe('열기 요청 판정', () => {
  const ok = { type: EXTENSION_OPEN_MESSAGE, path: 'src/A.java' }

  it('규약대로 온 것만 받는다', () => {
    expect(isOpenRequest(ok)).toBe(true)
    expect(isOpenRequest({ ...ok, line: 12 })).toBe(true)
  })

  it('남이 흉내 낸 모양은 버린다', () => {
    expect(isOpenRequest(null)).toBe(false)
    expect(isOpenRequest('열어줘')).toBe(false)
    expect(isOpenRequest({ path: 'a' })).toBe(false)
    expect(isOpenRequest({ type: '다른것', path: 'a' })).toBe(false)
    expect(isOpenRequest({ ...ok, path: '' })).toBe(false)
  })

  it('줄 번호는 1부터인 정수만 — 0·소수·문자열은 버린다', () => {
    // 행 클릭 규약(`extensionRowTarget.ts`)과 같은 규칙이다. 여기서 느슨하면
    // 편집기가 엉뚱한 자리로 뛴다.
    expect(isOpenRequest({ ...ok, line: 0 })).toBe(false)
    expect(isOpenRequest({ ...ok, line: 1.5 })).toBe(false)
    expect(isOpenRequest({ ...ok, line: '3' })).toBe(false)
  })
})

describe('테마 색 읽기', () => {
  it('읽을 곳이 없으면 기본값으로 떨어진다 — 화면이 비지 않는다', () => {
    const palette = readPalette(null)

    expect(palette.bg).toBe('#0d1117')
    expect(palette.text).toBe('#e6edf3')
  })
})

describe('명령 요청 판정', () => {
  const ok = { type: EXTENSION_COMMAND_MESSAGE, commandId: 'screenScenario.find' }

  it('규약대로 온 것만 받는다', () => {
    expect(isCommandRequest(ok)).toBe(true)
  })

  it('남이 흉내 낸 모양은 버린다', () => {
    expect(isCommandRequest(null)).toBe(false)
    expect(isCommandRequest('돌려줘')).toBe(false)
    expect(isCommandRequest({ commandId: 'a' })).toBe(false)
    expect(isCommandRequest({ type: '다른것', commandId: 'a' })).toBe(false)
    expect(isCommandRequest({ ...ok, commandId: '' })).toBe(false)
    expect(isCommandRequest({ ...ok, commandId: 3 })).toBe(false)
  })

  it('열기 요청과 서로를 통과시키지 않는다', () => {
    expect(isCommandRequest({ type: EXTENSION_OPEN_MESSAGE, path: 'a' })).toBe(false)
    expect(isOpenRequest(ok)).toBe(false)
  })

  it('명령 id 말고는 아무것도 받지 않는다 — 인자를 실으면 일반 통로가 된다', () => {
    // 모양 판정은 통과하되, 실린 여분은 **타입에 없다.** 이 시험은 계약을 적어 두는 자리다:
    // 여기에 인자를 더하려면 `extensionPayloads.ts` 의 경계 판단부터 다시 봐야 한다.
    const extra = { ...ok, args: { rm: '-rf' } } as Record<string, unknown>
    expect(isCommandRequest(extra)).toBe(true)
    expect(Object.keys(ok)).toEqual(['type', 'commandId'])
  })
})
