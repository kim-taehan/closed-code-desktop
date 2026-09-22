// 시험 전용 3판 확장 (`tests/extensions/webview-sidebar`) — 사이드바 웹뷰와 본문 웹뷰를 **뒷단으로만** 잇는다
// (하이닉스 H2 결정 K-2). 사이드바가 고른 것을 받아 본문 탭을 열고 그 탭에 민다. 두 화면 사이 직통 길은 없다.
// 행선지 projectId 를 적지 않는다 — 겉봉(처리기가 도는 동안의 프로젝트)이 정해야 한다.
exports.activate = (code) => {
  code.ui.onMessage('list', async (message, context) => {
    await code.ui.open('detail')
    await code.ui.post('detail', { picked: message.pick, from: context.projectId })
  })
  return {
    commands: {
      // 명령을 건 프로젝트의 입력칸에 넣는다 (`code.chat.post`)
      'sidebarFixture.chat': async (selection) => {
        await code.chat.post(selection)
      },
    },
  }
}
