// 시험 전용 3판 확장 (`tests/extensions/ai-stream`). `code.ai.run` 을 **글 조각을 받으며** 부른다.
//
// 받은 조각과 최종 답을 행으로 올린다 — 조각 통로(부모의 `NOTICE_AI_TEXT` → 자식의 `AiStreams`)가
// 이어져 있어야만 이 행이 나온다. 안 이어져 있으면 `onText` 를 준 순간 던져서 명령 자체가 실패한다.
exports.activate = (code) => ({
  commands: {
    'aiStreamFixture.ask': async () => {
      const pieces = []
      const answer = await code.ai.run('물음', { onText: (text) => pieces.push(text) })
      await code.view.setRows('ai', [{ pieces: pieces.join('|'), final: answer.text }])
    },
  },
})
