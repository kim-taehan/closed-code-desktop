// 시험 전용 3판 확장 (`tests/extensions/webview-v3`). 앞단이 보낸 것을 **받은 프로젝트와 함께** 되돌려 준다.
// 되돌릴 때 projectId 를 적지 않는다 — 겉봉(처리기가 도는 동안의 프로젝트)이 행선지를 정해야 한다.
exports.activate = (code) => {
  code.ui.onMessage('board', async (message, context) => {
    await code.ui.post('board', { echo: message, from: context.projectId })
  })
  return {
    commands: {
      'webviewFixture.open': async () => {
        await code.ui.open('board')
      },
      // 명령 안에서 미는 것 — 명령을 건 프로젝트의 탭으로 가야 한다
      'webviewFixture.push': async (selection) => {
        await code.ui.post('board', { pushed: selection ?? null })
      },
    },
  }
}
