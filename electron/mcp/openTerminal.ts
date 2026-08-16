// open_terminal 도구가 받은 인자를 검사한다. `openFile.ts` 와 짝이고 하는 일은 정반대다 —
// 저쪽은 경로가 프로젝트 안인지 보고, 이쪽은 **이 글자가 실행되어 버리지 않는지** 본다.
//
// ⚠️ 실측(zsh · opencode 1.18.18 pty): 개행이 섞이면 그 지점까지가 **그 자리에서 실행된다.**
// `echo 한줄\necho 두줄` 을 pty 에 그대로 밀어 넣었더니 `한줄` 이 출력되고 뒤엣것만 줄에
// 남았다. 이 도구의 값은 "사람이 보고 직접 엔터를 친다" 하나뿐이라, 개행이 통과하는 순간
// 도구가 정반대의 것이 된다 — opencode 내장 `bash` 와 구별할 이유가 없어진다.

/**
 * 개행만이 아니라 C0 제어문자 전부를 막는다.
 *
 * `\r` 도 `\n` 과 같이 실행이고, ESC·탭도 셸에서 제 뜻대로 움직인다(완성·키 바인딩).
 * 넓게 막는 쪽이 안전하다 — 사람이 읽을 한 줄 명령에 제어문자가 필요할 일이 없다.
 */
const CONTROL = /[\u0000-\u001f\u007f]/

/**
 * 채울 명령을 꺼낸다. 없으면 `null` — 그때는 칸만 편다.
 *
 * **공백은 떼고 본다.** 모델은 `"ls\n"` 처럼 실행할 셈으로 개행을 붙여 보내는데, 양끝의
 * 그것은 "이걸 돌려라" 라는 뜻일 뿐 명령의 일부가 아니다. 떼어 내고 채우면 사용자가 보고
 * 엔터를 치는 이 도구의 뜻과도 맞는다. **가운데 것은 못 뗀다** — 거기서 줄이 갈리면
 * 명령이 두 개인 것이고, 공백으로 바꾸면 사용자가 확인할 글자가 모델이 말한 것과 달라진다.
 */
export function commandOf(args: Record<string, unknown>): string | null {
  const asked = args['command']
  if (asked === undefined || asked === null) return null
  if (typeof asked !== 'string') throw new Error('command 는 문자열이어야 합니다')

  const command = asked.trim()
  if (command === '') return null
  if (CONTROL.test(command)) {
    throw new Error(
      '여러 줄 명령이나 제어문자는 채울 수 없습니다 — 셸에 들어가는 즉시 실행되어 버려서, 사용자가 눈으로 확인할 기회가 사라집니다. 한 줄짜리 명령으로 다시 부르세요.',
    )
  }
  return command
}
