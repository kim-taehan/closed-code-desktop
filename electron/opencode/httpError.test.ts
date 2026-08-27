import { describe, expect, it } from 'vitest'
import { httpFailure } from './httpError'

const fail = (status: number, body: string) => httpFailure('/session/s1/prompt_async', new Response(body, { status }))

describe('HTTP 실패 문구', () => {
  // 회귀: 게이트웨이 429 가 화면에 JSON 통째로 떴다 (2026-08-27 실측).
  // 위층은 이 문자열을 그대로 그리므로, 여기서 안 꺼내면 사용자가 중괄호를 읽는다.
  it('OpenAI 모양의 오류에서 문장만 꺼낸다', async () => {
    const body = JSON.stringify({
      error: { message: '분당 요청 수 한도(1회)를 넘겼습니다. 잠시 뒤 다시 시도하세요.', type: 'gateway_error' },
    })

    const message = await fail(429, body)

    expect(message).toContain('분당 요청 수 한도(1회)를 넘겼습니다.')
    expect(message).toContain('HTTP 429')
    expect(message).not.toContain('{')
    expect(message).not.toContain('gateway_error')
  })

  it('opencode 의 data.message 와 최상위 message 도 안다', async () => {
    expect(await fail(500, JSON.stringify({ data: { message: '세션이 없습니다' } }))).toContain('세션이 없습니다')
    expect(await fail(500, JSON.stringify({ message: '망가졌습니다' }))).toContain('망가졌습니다')
  })

  /**
   * **모르는 모양이면 원문을 남긴다.**
   *
   * 본문을 통째로 싣던 원래 이유가 진단이었다. 문장을 못 찾았다고 빈 문구로 떨어지면
   * 낯선 실패를 추적할 근거가 사라진다 — 그때는 JSON 을 보여 주는 편이 낫다.
   */
  it('JSON 이 아니거나 문장이 없으면 원문을 남긴다', async () => {
    expect(await fail(502, '<html>Bad Gateway</html>')).toContain('<html>Bad Gateway</html>')
    expect(await fail(400, JSON.stringify({ error: { type: 'oops' } }))).toContain('"type":"oops"')
  })

  /** 빈 문장은 문장이 아니다 — 공백만 든 message 를 꺼내면 상태 코드만 남는다 */
  it('빈 message 는 무시하고 원문을 남긴다', async () => {
    const body = JSON.stringify({ error: { message: '   ' } })

    expect(await fail(500, body)).toContain(body)
  })

  it('경로와 상태를 함께 남긴다', async () => {
    expect(await fail(404, 'nope')).toBe('opencode /session/s1/prompt_async 실패: HTTP 404 nope')
  })
})
