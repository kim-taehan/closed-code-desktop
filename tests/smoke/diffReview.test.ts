import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { toWebSocketUrl } from '../../electron/runtime/locator'
import { WsConnection } from '../../electron/ws/connection'
import { Heartbeat } from '../../electron/ws/heartbeat'
import { Handshake } from '../../electron/session/handshake'
import { ChatSession } from '../../electron/session/chatSession'
import { TurnReviewController } from '../../electron/session/turnReview'
import { PermissionModeController } from '../../electron/session/permissionMode'
import { PermissionMode } from '../../shared/protocol/kinds'
import { isContentRef, type TurnReview } from '../../shared/protocol/turnReview'
import type { TurnEvent } from '../../shared/ipc/channels'

// M3 관문: 실제 runtime 에 파일 수정을 시켜 turn_changes 를 받는다.
//
// 실행:
//   DAVIS_LICENSE_KEY=agent DAVIS_RUNTIME_PORT=<포트> \
//   DAVIS_DIFF_WORKSPACE=/tmp/davis-diff-test \
//   npx vitest run tests/smoke/diffReview

const licenseKey = process.env['DAVIS_LICENSE_KEY']
const port = Number(process.env['DAVIS_RUNTIME_PORT'])
const workspacePath = process.env['DAVIS_DIFF_WORKSPACE']

const enabled = Boolean(licenseKey && Number.isFinite(port) && workspacePath)

describe.runIf(enabled)('실제 runtime diff 리뷰 스모크', () => {
  it(
    '파일 수정을 시키면 turn_changes 가 오고 changeBlocks 가 담겨 있다',
    async () => {
      const connection = new WsConnection({
        url: toWebSocketUrl({ host: '127.0.0.1', port, source: 'smoke' }, randomUUID()),
        autoReconnect: false,
      })
      const heartbeat = new Heartbeat(connection)
      // 승인 요청에 응답하지 않으면 턴이 영원히 멈춘다 (설계 §4.4).
      // 스모크는 사람이 없으므로 자동 승인한다.
      const chat = new ChatSession(connection, { autoApprove: true })
      const reviews = new TurnReviewController(connection)
      const permission = new PermissionModeController(connection)

      const events: TurnEvent[] = []
      chat.onEvent((event) => events.push(event))
      const received: TurnReview[] = []
      reviews.onChange((all) => received.push(...all))

      const handshake = new Handshake(connection, { licenseKey: licenseKey!, workspacePath: workspacePath! })

      heartbeat.start()
      chat.start()
      reviews.start()
      permission.start()

      const ready = handshake.run()
      await connection.connect()
      await ready

      // 승인 없이 진행되게 편집 자동 승인으로 둔다
      permission.set(PermissionMode.ACCEPT_EDITS)
      await new Promise((resolve) => setTimeout(resolve, 300))

      // 프로젝트 112 의 주 에이전트는 읽기 전용이라 edit_file 이 없다.
      // task 도구로 general_purpose 서브에이전트에 위임해야 파일이 바뀐다.
      chat.send(
        'task 도구로 general_purpose 서브에이전트에게 위임해서, ' +
          'sample.txt 파일의 "line two" 를 "line TWO changed" 로 edit_file 로 바꾸게 해줘.',
      )

      const ended = await new Promise<Extract<TurnEvent, { type: 'turn_ended' }>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('턴이 180초 안에 끝나지 않았습니다')), 180_000)
        chat.onEvent((event) => {
          if (event.type === 'turn_ended') {
            clearTimeout(timer)
            resolve(event)
          }
        })
      })
      console.log(`[스모크] 턴 종료: failed=${ended.failed} ${ended.errorCode ?? ''}`)

      // turn_changes 는 stream_end 뒤에 올 수도 있다
      await new Promise((resolve) => setTimeout(resolve, 2_000))

      const all = reviews.all
      console.log(`[스모크] 받은 리뷰 ${all.length}건`)
      for (const review of all) {
        console.log(`  turnId=${review.turnId} status=${review.status} files=${review.files.length}`)
        for (const file of review.files) {
          const inline = !isContentRef(file.baseline) && !isContentRef(file.modified)
          console.log(
            `    ${file.operation} ${file.path} +${file.additions} -${file.deletions} ` +
              `blocks=${file.changeBlocks.length} inline=${inline}`,
          )
        }
      }

      expect(all.length, '턴 리뷰가 오지 않았습니다').toBeGreaterThan(0)
      const withFiles = all.find((review) => review.files.length > 0)
      expect(withFiles, '파일 변경이 담긴 리뷰가 없습니다').toBeTruthy()
      expect(withFiles!.files[0]!.changeBlocks.length, 'changeBlocks 가 비었습니다').toBeGreaterThan(0)

      handshake.dispose()
      chat.stop()
      reviews.stop()
      permission.stop()
      heartbeat.stop()
      connection.dispose()
    },
    240_000,
  )
})
