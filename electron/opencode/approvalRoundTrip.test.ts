import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { approvalTurnScript, questionTurnScript } from '../../tests/fake-opencode/turnScript'
import { parseInbound } from '../../shared/protocol/envelope'
import { Handshake } from '../session/handshake'
import { OpencodeConnection } from './connection'

// 카드 왕복(승인·질문)을 **진짜 HTTP 가짜 서버**로 한 바퀴 돈다.
//
// ⚠️ **이 자리가 한 번 조용히 죽어 있었다.** 프롬프트·중단·스트림을 레거시로 옮기면서
// 승인 **응답**만 신규 세대로 남았다. 앞의 셋은 "보내고 받는" 축이라 같이 눈에 들어왔는데
// 승인 응답은 사용자 입력에서 시작하는 **역방향**이라 그 셋을 훑는 눈에 안 걸렸다
// (contract-qa 교차 대조에서 잡혔다).
//
// 실물에서 신규 경로는 레거시 턴의 승인을 **못 본다** — 404 `PermissionNotFoundError` 다.
// 그래서 증상이 "카드는 정상으로 뜨는데 눌러도 아무 일이 없고 턴이 영원히 멈춤" 이었고,
// 사용자가 원인을 알 수 없는 부류다. 가짜 서버도 그 404 를 그대로 흉내낸다.
//
// 단위 테스트(`legacyChat.test.ts`)는 URL 문자열을 재고, 여기서는 **어댑터가 실제로 그 길로
// 보내는지**를 잰다 — 둘 중 하나만으로는 배선이 어긋나도 초록이 날 수 있다.

let server: FakeOpencodeServer
let connection: OpencodeConnection | null = null

afterEach(async () => {
  connection?.close()
  connection = null
  // `server` 는 `askForCard` 안에서 만들어진다 — 그 앞에서 실패하면 아직 없다.
  await server?.stop()
})

/**
 * 이번 턴의 세션 id.
 *
 * 가짜가 만든 id 를 **서버에게 물어서** 쓴다. 카드의 `requestId` 에서 접두사를 떼어
 * 만들어 쓰던 자리인데, 그건 `per_<세션id>` 라는 대본의 우연한 생김새에 기댄 것이라
 * 대본을 바꾸면 조용히 엉뚱한 문자열을 비교하게 된다.
 */
function sessionId(): string {
  const created = server.calls.find((call) => call.url === '/api/session')
  expect(created).toBeDefined()
  return String((server.calls.find((call) => /\/prompt_async$/.test(call.url))?.url ?? '').split('/')[2])
}

async function askForCard(turn: typeof approvalTurnScript, want: string) {
  server = new FakeOpencodeServer({ turn })
  await server.start()
  connection = new OpencodeConnection({ baseUrl: server.baseUrl, autoReconnect: false })
  const chunks: Record<string, unknown>[] = []
  const errors: string[] = []
  connection.onMessage((raw) => {
    const frame = parseInbound(raw)
    if (!frame) return
    if (frame.action === 'stream_chunk') {
      const data = frame.data as Record<string, unknown>
      chunks.push(data)
      if (data['messageType'] === 'error') errors.push(String(data['message']))
    }
    if (frame.action === 'error') errors.push(String((frame.data as Record<string, unknown>)['message']))
  })

  const handshake = new Handshake(connection, { workspacePath: '/tmp/approval', projectName: 'approval' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  connection.send(
    JSON.stringify({ kind: 'chat', action: 'chat_request', reqId: 'r1', data: { query: '지워라' } }),
  )
  await vi.waitFor(() => expect(chunks.some((c) => c['messageType'] === want)).toBe(true))
  const card = chunks.find((c) => c['messageType'] === want)!
  return { card, errors }
}

const askForApproval = () => askForCard(approvalTurnScript, 'tool_approval_request')
const askForQuestion = () => askForCard(questionTurnScript, 'user_question')

describe('승인 왕복', () => {
  // 카드에 도구 이름이 실려야 무엇을 승인하는지 보인다. 레거시 페이로드에는 `action` 이
  // 없어서(`permission` 이다), 매핑이 빠지면 여기가 "알 수 없는 도구" 가 된다.
  it('레거시 permission.asked 가 도구 이름이 실린 승인 카드가 된다', async () => {
    const { card } = await askForApproval()
    expect(card['toolName']).toBe('bash')
    expect(card['args']).toEqual({ resources: ['echo hi'] })
  })

  it('승인 답신이 레거시 경로로 나간다 — 신규로 가면 실물이 404 다', async () => {
    const { card, errors } = await askForApproval()

    connection!.send(
      JSON.stringify({
        kind: 'chat',
        action: 'tool_approval_response',
        reqId: 'r2',
        data: { requestId: card['requestId'], approved: true },
      }),
    )

    await vi.waitFor(() => {
      expect(server.calls.some((call) => call.url.includes('/permissions/'))).toBe(true)
    })
    const reply = server.calls.find((call) => call.url.includes('/permissions/'))
    expect(reply?.url).toBe(`/session/${sessionId()}/permissions/${card['requestId']}`)
    // 경로도 본문 키도 레거시여야 한다 — 신규는 `reply` 다.
    expect(reply?.body).toEqual({ response: 'once' })
    // 신규 표면으로 샌 호출이 하나도 없어야 한다 (가짜가 404 를 준다 → 오류로 드러난다)
    expect(server.calls.some((call) => /\/api\/session\/[^/]+\/permission\//.test(call.url))).toBe(false)
    expect(errors).toEqual([])
  })
})

// 질문은 승인과 같은 병을 앓았는데 **더 조용했다** — 신규 경로가 404 가 아니라 400
// (`Missing key at ["answers"]`) 이라, 세대가 틀렸다는 사실 자체를 안 알려준다.
// 단위 테스트가 경로·본문·매핑을 각각 잠그고 있지만 **배선 한 겹**(`replies.ts` →
// `client.replyQuestion` → 레거시)이 승인과 달리 안 잠겨 있었다 (contract-qa 지적).
describe('질문 왕복', () => {
  // 레거시 페이로드는 글이 `questions[0]` 안에 있다. 매핑이 빠지면 여기가 빈 문자열이 되고,
  // 사용자는 **무엇을 묻는지 모르는 채** 답을 고르게 된다.
  it('중첩된 레거시 question.asked 가 글이 실린 질문 카드가 된다', async () => {
    const { card } = await askForQuestion()
    expect(card['question']).toBe('어느 쪽으로 갈까요?')
  })

  it('답신이 레거시 경로로 나간다 — 신규로 가면 실물이 400 이다', async () => {
    const { card, errors } = await askForQuestion()

    connection!.send(
      JSON.stringify({
        kind: 'chat',
        action: 'user_answer',
        reqId: 'r2',
        data: { questionId: card['questionId'], answer: '왼쪽' },
      }),
    )

    await vi.waitFor(() => {
      expect(server.calls.some((call) => call.url.startsWith('/question/'))).toBe(true)
    })
    const reply = server.calls.find((call) => call.url.startsWith('/question/'))
    // 세션 id 가 경로에 없다 — 레거시 질문 표면은 요청 id 하나로 찾는다.
    expect(reply?.url).toBe(`/question/${card['questionId']}/reply`)
    // `{text}` 가 아니라 답 하나가 배열인 `answers` 다.
    expect(reply?.body).toEqual({ answers: [['왼쪽']] })
    expect(server.calls.some((call) => /\/api\/session\/[^/]+\/question\//.test(call.url))).toBe(false)
    expect(errors).toEqual([])
  })
})
