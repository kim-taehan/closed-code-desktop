// 시험용 확장 — 정해진 행 하나를 그대로 내보낸다.
//
// **배포되는 확장이 아니다.** 호스트가 "확장 여럿이 실린 상태" 를 만들어야 하는 시험
// (`serviceReload.test.ts`)에서 쓴다. 파일을 읽지 않아 프로젝트 내용과 무관하게 늘 같다.
//
// 호스트 시험이 배포 확장을 쓰면 **호스트가 특정 확장에 매인다** — 그 확장을 고치거나
// 다른 레포로 빼는 순간 앱 테스트가 깨진다. 그래서 픽스처를 따로 둔다.

'use strict'

function activate(davis) {
  return {
    commands: {
      'echoRows.run': async () => {
        await davis.view.setRows('echoRows.results', [{ file: 'echo.ts', lines: 1 }])
      },
    },
  }
}

module.exports = { activate }
