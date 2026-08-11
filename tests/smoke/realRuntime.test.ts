import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { WsConnection } from '../../electron/ws/connection'
import { Heartbeat } from '../../electron/ws/heartbeat'
import { Handshake } from '../../electron/session/handshake'
import { ChatSession } from '../../electron/session/chatSession'
import { normalizeSendContext } from '../../electron/session/editorContext'
import { ChainLocator, FixedPortLocator, InstanceFileLocator, toWebSocketUrl } from '../../electron/runtime/locator'
import type { TurnEvent } from '../../shared/ipc/channels'

// A7 관문: 실제 runtime 스모크 (계획 §9.4).
//
// 가짜 서버 테스트와 같은 코드 경로를 타되 상대가 진짜 runtime 이다.
// 환경변수가 없으면 건너뛴다 — CI 와 일상 개발에서는 돌지 않는다.
//
// 실행 (runtime 은 online 프로파일로 띄운다):
//   DAVIS_LICENSE_KEY=agent DAVIS_RUNTIME_PORT=<포트> npx vitest run tests/smoke
//
// ⚠️ 라이선스가 프로젝트를 고르고, 프로젝트가 LLM 설정을 고른다.
// 'agent' → 프로젝트 112 (사내 vLLM, 정상). 'skax' → 프로젝트 1 (LLM 설정 어긋남, 400).
// 자세한 내용은 docs/superpowers/specs/2026-07-20-davis-code-desktop-chat-plan.md 의 검증 기록 참조.

const licenseKey = process.env['DAVIS_LICENSE_KEY']
const fixedPort = Number(process.env['DAVIS_RUNTIME_PORT'])
const workspacePath = process.env['DAVIS_WORKSPACE'] ?? process.cwd()

const enabled = Boolean(licenseKey)

interface Live {
  chat: ChatSession
  events: TurnEvent[]
  stages: string[]
  dispose: () => void
}

async function connect(): Promise<Live | null> {
  const locator = new ChainLocator([
    ...(Number.isFinite(fixedPort) && fixedPort > 0 ? [new FixedPortLocator(fixedPort)] : []),
    new InstanceFileLocator(),
  ])

  const located = await locator.locate()
  expect(located.found, `runtime 을 찾지 못했습니다: ${located.found ? '' : located.failure.reason}`).toBe(true)
  if (!located.found) return null

  console.log(`[스모크] runtime = ${located.endpoint.host}:${located.endpoint.port} (${located.endpoint.source})`)

  const connection = new WsConnection({ url: toWebSocketUrl(located.endpoint, randomUUID()), autoReconnect: false })
  const heartbeat = new Heartbeat(connection)
  const chat = new ChatSession(connection)
  const events: TurnEvent[] = []
  chat.onEvent((event) => events.push(event))

  const handshake = new Handshake(connection, { licenseKey: licenseKey!, workspacePath })
  const stages: string[] = []
  handshake.onStateChange((state) => stages.push(state.stage))

  heartbeat.start()
  chat.start()

  const ready = handshake.run()
  await connection.connect()
  await ready

  return {
    chat,
    events,
    stages,
    dispose: () => {
      handshake.dispose()
      chat.stop()
      heartbeat.stop()
      connection.dispose()
    },
  }
}

/** 턴이 끝날 때까지 기다렸다가 종료 이벤트와 누적 텍스트를 돌려준다. */
async function awaitTurn(live: Live): Promise<{ ended: Extract<TurnEvent, { type: 'turn_ended' }>; text: string }> {
  const ended = await new Promise<Extract<TurnEvent, { type: 'turn_ended' }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('턴이 120초 안에 끝나지 않았습니다')), 120_000)
    live.chat.onEvent((event) => {
      if (event.type === 'turn_ended') {
        clearTimeout(timer)
        resolve(event)
      }
    })
  })

  const text = live.events
    .filter((event): event is Extract<TurnEvent, { type: 'text' }> => event.type === 'text')
    .map((event) => event.text)
    .join('')

  return { ended, text }
}

describe.runIf(enabled)('실제 runtime 스모크', () => {
  let live: Live | null = null
  afterEach(() => {
    live?.dispose()
    live = null
  })

  it(
    '탐색 → 연결 → 핸드셰이크 → 채팅 → 턴 종료',
    async () => {
      live = await connect()
      if (!live) return

      expect(live.stages).toEqual(['awaiting_connected', 'authenticating', 'syncing_workspace', 'ready'])
      console.log('[스모크] 핸드셰이크 완료')

      live.chat.send('안녕하세요. 한 문장으로만 인사해 주세요.')
      const { ended, text } = await awaitTurn(live)

      console.log(`[스모크] 응답: ${text}`)
      console.log(`[스모크] 턴 종료: turnId=${ended.turnId} failed=${ended.failed}`)

      expect(ended.failed, `턴이 실패했습니다: ${ended.errorCode ?? ''}`).toBe(false)
      expect(text.length, '응답 텍스트가 비어 있습니다').toBeGreaterThan(0)
    },
    150_000,
  )

  // P1 관문: 편집기 컨텍스트가 **실제 runtime 의 프롬프트까지 도달하는가.**
  //
  // 가짜 런타임 재생으로는 구조적으로 확인할 수 없는 축이다 — 가짜는 우리가 믿는 계약을
  // 재생할 뿐이라, 키 이름이나 좌표계에 대한 우리 믿음이 틀렸으면 가짜도 똑같이 틀린다.
  // runtime 은 `extra='ignore'` 라 **키를 틀려도 에러 없이 조용히 버린다** (domains/chat.py).
  //
  // 그래서 모델에게 "지금 내가 어디를 보고 있나"를 되묻는다. 파일 내용을 읽어야 답할 수
  // 있는 질문(선택 범위의 코드 내용 등)은 도구 사용 여부에 따라 흔들리므로 쓰지 않는다 —
  // `message_builder.py:109-121` 이 주입하는 것은 **경로와 줄 번호뿐**이고, 그 둘은 프롬프트를
  // 그대로 읽기만 하면 답할 수 있다.
  it(
    'activeEditor·selection 이 프롬프트에 도달한다',
    async () => {
      live = await connect()
      if (!live) return

      // 우연히 맞을 확률을 낮추려고 흔치 않은 줄 번호를 고른다 (대상 파일은 159줄).
      const START_LINE = 42
      const END_LINE = 57

      const context = normalizeSendContext(
        {
          activeEditor: {
            filePath: 'shared/protocol/errorMessages.ts',
            selection: { startLine: START_LINE, endLine: END_LINE },
          },
          // `git:` 가짜 탭이 섞여도 새어 나가지 않아야 한다. 실물에서는 걸러졌는지
          // 직접 관측할 수 없으므로(server.received 가 없다) 턴이 정상 수락되는 것까지만 본다.
          dirtyFiles: ['docs/STATUS.md', 'git:staged:shared/protocol/errorMessages.ts'],
        },
        workspacePath,
      )

      expect(context.activeEditor?.filePath, '변환이 절대경로를 내지 않았습니다').toMatch(/^\//)
      expect(context.dirtyFiles, 'git: 가짜 탭이 걸러지지 않았습니다').toHaveLength(1)

      live.chat.send(
        '지금 내가 편집기에서 보고 있는 파일 경로와, 선택한 줄 범위의 시작·끝 줄 번호를 알려 주세요. ' +
          '파일을 열어 보지 말고, 주어진 정보만으로 "경로 시작줄-끝줄" 형식으로 짧게만 답해 주세요.',
        context,
      )
      const { ended, text } = await awaitTurn(live)

      console.log(`[스모크] 응답: ${text}`)
      console.log(`[스모크] 턴 종료: turnId=${ended.turnId} failed=${ended.failed}`)

      expect(ended.failed, `턴이 실패했습니다: ${ended.errorCode ?? ''}`).toBe(false)

      // 줄 번호가 되돌아오면 selection 이 프롬프트에 들어갔다는 뜻이다.
      // 틀린 좌표계(0-based)를 보냈다면 41·56 이 돌아와 이 단언이 깨진다.
      expect(text, `선택 시작줄(${START_LINE})이 응답에 없습니다`).toContain(String(START_LINE))
      expect(text, `선택 끝줄(${END_LINE})이 응답에 없습니다`).toContain(String(END_LINE))
      expect(text, '활성 파일이 응답에 없습니다').toContain('errorMessages')
    },
    150_000,
  )
})
