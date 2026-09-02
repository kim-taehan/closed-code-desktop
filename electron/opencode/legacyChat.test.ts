import { describe, expect, it } from 'vitest'
import { abortTurn, replyPermissionLegacy, replyQuestionLegacy, sendPrompt } from './legacyChat'

// 보내는 네 호출이 **레거시 세대의 경로·본문 모양**을 지키는지 본다.
//
// 전부 1.18.18 실물 실측이 근거다. URL 문자열 자체를 단언하는 이유는, 세대를 잘못 짝지어도
// 겉으로는 조용하기 때문이다 — 승인은 404, 질문은 400 이 나는데 둘 다 화면에는
// "카드를 눌렀는데 아무 일도 없음" 으로만 보인다.

function recorder() {
  const calls: Array<{ path: string; body: unknown }> = []
  return {
    calls,
    post: async (path: string, body: unknown) => {
      calls.push({ path, body })
      return {}
    },
  }
}

describe('프롬프트', () => {
  it('prompt_async 로 가고 본문은 parts 하나뿐이다', async () => {
    const { calls, post } = recorder()
    await sendPrompt(post, 'ses_1', '안녕')
    expect(calls).toEqual([
      { path: '/session/ses_1/prompt_async', body: { parts: [{ type: 'text', text: '안녕' }] } },
    ])
  })

    // 세션이 이미 아는 값이라 안 싣는다. 최소 본문으로도 MCP 도구가 실리는 것을 캡처로 확인했고,
    // model 을 여기 또 실으면 `models.ts` 와 진실의 출처가 둘이 된다.
    it('model 도 ?directory= 도 안 싣는다', async () => {
      const { calls, post } = recorder()
      await sendPrompt(post, 'ses_1', '안녕')
      expect(calls[0]?.path).not.toContain('directory')
      expect(calls[0]?.body).not.toHaveProperty('model')
    })

    // 이미지는 텍스트 뒤에 `file` part 로 실린다 — `data:` URI 가 `url` 이다.
    it('이미지가 있으면 file part 를 text 뒤에 붙인다', async () => {
      const { calls, post } = recorder()
      await sendPrompt(post, 'ses_1', '이거 봐', [{ data: 'QUJD', mediaType: 'image/png' }])
      expect(calls).toEqual([
        {
          path: '/session/ses_1/prompt_async',
          body: {
            parts: [
              { type: 'text', text: '이거 봐' },
              { type: 'file', mime: 'image/png', url: 'data:image/png;base64,QUJD' },
            ],
          },
        },
      ])
    })

    it('여러 장이면 순서대로, mediaType 에 맞게 data URI 접두어가 갈린다', async () => {
      const { calls, post } = recorder()
      await sendPrompt(post, 'ses_1', '두 장', [
        { data: 'QUJD', mediaType: 'image/png' },
        { data: 'REVG', mediaType: 'image/jpeg' },
      ])
      const parts = (calls[0]?.body as { parts: Array<Record<string, unknown>> }).parts
      expect(parts[0]).toEqual({ type: 'text', text: '두 장' })
      expect(parts[1]).toEqual({ type: 'file', mime: 'image/png', url: 'data:image/png;base64,QUJD' })
      expect(parts[2]).toEqual({ type: 'file', mime: 'image/jpeg', url: 'data:image/jpeg;base64,REVG' })
    })

    // 빈 배열·undefined 는 parts 를 text 하나만 만들게 한다 — 안 붙인 것이다.
    it('이미지가 없으면 text part 하나뿐이다', async () => {
      const { calls, post } = recorder()
      await sendPrompt(post, 'ses_1', '안녕', [])
      expect(calls).toEqual([
        { path: '/session/ses_1/prompt_async', body: { parts: [{ type: 'text', text: '안녕' }] } },
      ])
    })
  })

describe('중단', () => {
  // 레거시 턴에 `/api/…/interrupt` 를 넣으면 204 를 주고 아무 일도 안 일어난다 (실측).
  it('레거시 abort 로 간다', async () => {
    const { calls, post } = recorder()
    await abortTurn(post, 'ses_1')
    expect(calls[0]?.path).toBe('/session/ses_1/abort')
  })
})

describe('승인 응답', () => {
  /**
   * 실물에서 신규 경로는 **404 PermissionNotFoundError** 다 — 레거시 턴이 올린 승인은
   * 신규 목록에 아예 없다(`GET /api/session/:id/permission` → `[]`). 만료가 아니라
   * 세대가 달라서고, 증상은 "허용을 눌러도 턴이 영원히 멈춤" 이다.
   */
  it('경로는 permissions(복수)이고 끝에 /reply 가 없다', async () => {
    const { calls, post } = recorder()
    await replyPermissionLegacy(post, 'ses_1', 'per_1', 'once')
    expect(calls[0]?.path).toBe('/session/ses_1/permissions/per_1')
  })

  // 값 셋은 두 세대가 같고 **키 이름만** 다르다.
  it('본문 키가 reply 가 아니라 response 다', async () => {
    const { calls, post } = recorder()
    await replyPermissionLegacy(post, 'ses_1', 'per_1', 'always')
    expect(calls[0]?.body).toEqual({ response: 'always' })
  })
})

describe('질문 응답', () => {
  /**
   * 여기는 신규 경로가 404 가 아니라 **400** 이다 — 본문 검증이 먼저 걸려
   * `Missing key at ["answers"]` 를 준다. 세대가 틀렸다는 사실 자체를 안 알려준다.
   */
  it('세션 id 를 안 쓰고 요청 id 하나로 간다', async () => {
    const { calls, post } = recorder()
    await replyQuestionLegacy(post, 'que_1', '왼쪽')
    expect(calls[0]?.path).toBe('/question/que_1/reply')
  })

  // `QuestionAnswer` 가 `string[]` 이라 질문 하나에 답 하나면 `[[답]]` 이다.
  it('본문이 {text} 가 아니라 answers 배열의 배열이다', async () => {
    const { calls, post } = recorder()
    await replyQuestionLegacy(post, 'que_1', '왼쪽')
    expect(calls[0]?.body).toEqual({ answers: [['왼쪽']] })
  })

  it('answer 가 null 이면 거절 경로로 가고 본문이 없다', async () => {
    const { calls, post } = recorder()
    await replyQuestionLegacy(post, 'que_1', null)
    expect(calls[0]?.path).toBe('/question/que_1/reject')
    expect(calls[0]?.body).toEqual({})
  })
})
