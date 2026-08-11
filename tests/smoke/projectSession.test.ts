import { describe, expect, it } from 'vitest'
import { ProjectSession } from '../../electron/session/projectSession'
import type { SessionStatePayload, TurnEvent } from '../../shared/ipc/channels'

// P1 관문: ProjectSession 을 실제 runtime 에 물린다.
//
// realRuntime 스모크는 하위 부품(WsConnection·Handshake·ChatSession)을 직접 조립하므로
// ProjectSession 자체는 지나가지 않는다. 이 스모크가 그 빈틈을 메운다 —
// main.ts 가 만드는 것과 같은 설정으로 세션을 통째로 돌린다.
//
// 실행:
//   DAVIS_LICENSE_KEY=agent npx vitest run tests/smoke/projectSession.test.ts

const licenseKey = process.env['DAVIS_LICENSE_KEY']
const fixedPort = Number(process.env['DAVIS_RUNTIME_PORT'])
const workspacePath = process.env['DAVIS_WORKSPACE'] ?? process.cwd()

describe.runIf(Boolean(licenseKey))('ProjectSession 실제 runtime 스모크', () => {
  it(
    '세션이 준비되고 채팅 한 턴이 끝난다',
    async () => {
      const states: SessionStatePayload[] = []
      const events: TurnEvent[] = []
      let turnEnded: (() => void) | null = null
      const ended = new Promise<void>((resolve) => {
        turnEnded = resolve
      })

      const session = new ProjectSession(
        {
          licenseKey: licenseKey!,
          workspacePath,
          ...(Number.isFinite(fixedPort) && fixedPort > 0 ? { fixedPort } : {}),
        },
        {
          onState: (state) => states.push(state),
          onTurnEvent: (event) => {
            events.push(event)
            if (event.type === 'turn_ended') turnEnded?.()
          },
          onSnapshot: () => {},
          onPermissionMode: () => {},
          onHistoryState: () => {},
          onReviewState: () => {},
        },
      )

      try {
        await session.start()

        const last = states.at(-1)
        console.log(`[스모크] 마지막 상태 = ${last?.handshake.stage} @ ${last?.endpoint?.port}`)
        expect(last?.handshake.stage).toBe('ready')

        session.send('안녕하세요. 한 문장으로만 답해주세요.')
        await ended

        const ending = events.find((event) => event.type === 'turn_ended')
        console.log(`[스모크] 턴 종료: ${JSON.stringify(ending)}`)
        expect(ending).toBeDefined()
        // 턴이 "끝났다" 로는 부족하다 — 실패로 끝나도 종료는 온다.
        // LLM 설정이 어긋난 runtime 에 붙으면 여기서 걸린다 (실제로 8002 에서 걸렸다).
        expect(ending).toMatchObject({ failed: false })
      } finally {
        await session.dispose()
      }
    },
    120_000,
  )
})
