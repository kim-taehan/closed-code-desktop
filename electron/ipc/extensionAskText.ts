import { ipcMain, type BrowserWindow } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import type { ExtensionAskTextResponsePayload } from '../../shared/ipc/channels'
import type { ExtensionAskText } from '../extensions/serviceDispatch'

// 확장이 사람에게 글을 묻는 자리 (`davis.ui.askText`).
//
// `extensionExportFile.ts` 와 **자리는 같고 창이 다르다.** 저쪽은 Electron 이 가진 저장
// 대화상자를 띄우면 끝인데, 글 입력에는 그런 것이 없다. 그래서 renderer 에 물음을 밀고
// 답이 되돌아오기를 기다린다 — 이 파일이 그 왕복을 잇는다.
//
// **답을 빠뜨리면 확장의 await 가 영영 걸린다.** 그래서 나가는 길이 셋뿐이다:
// 사람이 답한다 · 사람이 닫는다(`null`) · 창이 사라진다(던진다).
//
// 시간 제한은 두지 않는다 — 시나리오 본보기를 쓰는 데 몇 분이 걸리는 것은 정상이고,
// 제한에 걸려 창이 닫히면 사람은 쓰던 글을 잃는다 (도구 승인 모달과 다른 점이다.
// 저쪽은 안 답하면 턴이 멈춰 있어 자동 거부가 안전한 쪽이었다).

/**
 * 물음 통로를 연다. **창에 매인다** — 그래서 `ExtensionBridge` 가 쥔다
 * (`extensionActiveFile.ts` 와 같은 자리). 확장 호스트는 앱 수명이라 이 통로를 값이
 * 아니라 **함수로** 건네받는다.
 *
 * 핸들러 등록은 `register()` 안에서 일어난다 — 브리지가 `HANDLED_CHANNELS` 로 풀 수
 * 있어야 창을 다시 만들 때 핸들러가 새지 않는다 (`wiring.test.ts` 가 보는 것).
 */
export function createAskText(window: () => BrowserWindow | null): ExtensionAskText {
  const pending = new Map<string, (text: string | null) => void>()
  let counter = 0

  ipcMain.handle(Channel.EXTENSION_ASK_TEXT_RESPOND, (_event, payload: ExtensionAskTextResponsePayload) => {
    const answer = pending.get(payload.requestId)
    // 모르는 열쇠는 조용히 버린다 — 창이 사라져 이미 끊은 물음의 답이 뒤늦게 올 수 있다
    if (answer === undefined) return
    pending.delete(payload.requestId)
    answer(typeof payload.text === 'string' ? payload.text : null)
  })

  return (options) =>
    new Promise((resolve, reject) => {
      const target = window()
      // **조용히 취소로 눙치지 않는다.** 창이 없는데 `null` 을 주면 확장은 "사람이 닫았다"
      // 로 알고 아무 말도 하지 않아, 아무리 눌러도 창이 안 뜨는데 사유가 안 남는다.
      if (target === null || target.isDestroyed()) {
        reject(new Error('물어볼 창이 없습니다'))
        return
      }

      counter += 1
      const requestId = `askText:${counter}`

      // 창이 사라지면 **끊는다.** 안 그러면 확장이 영영 기다린다 — 사람은 창을 닫았을 뿐인데
      // 그 확장의 다음 명령이 전부 조용히 걸린다.
      const onClosed = () => {
        if (!pending.delete(requestId)) return
        reject(new Error('창이 닫혀 물음이 끊겼습니다'))
      }
      target.once('closed', onClosed)

      pending.set(requestId, (text) => {
        target.off('closed', onClosed)
        resolve(text)
      })

      target.webContents.send(Channel.EXTENSION_ASK_TEXT, {
        requestId,
        extension: options.label,
        title: options.title,
        ...(options.hint === undefined ? {} : { hint: options.hint }),
        value: options.value,
        multiline: options.multiline,
      })
    })
}
