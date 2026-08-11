import type { ActiveFileNotice } from '../../shared/ipc/extensionPayloads'

// current_view 도구가 모델에게 돌려줄 말.
//
// **JSON 이 아니라 문장으로 준다.** 모델이 이걸로 하는 일은 "이거", "여기" 를 푸는
// 것이고, 그 판단에는 값이 왜 그런 모양인지가 함께 가야 한다. 필드만 던지면 모델은
// null 하나를 보고 "화면을 못 본다" 고 결론 내린다.
//
// **공여(develop-desktop)와 전제가 다르다.** 저쪽은 본문이 늘 터미널이라 활성 탭이
// 언제나 `terminal` 이었고, 그래서 `lastViewedFile`("직전에 본 파일")이 문장의 중심이었다.
// 수용은 본문 탭이 `[대화, …파일들, 로그, 소스관리]` 이고 **파일 탭이 실제로 앞에 나와
// 있을 수 있다** — 그래서 "직전" 이 아니라 "지금 보고 있는 것" 을 곧바로 말한다.
//
// **공여에 있던 「저장 안 한 편집」 경고는 옮기지 못했다.** 우리가 읽을 수 있는 값
// (`ActiveFileTracker` → `ActiveFileNotice`)은 `{path, line}` 뿐이라 dirty 여부가 실려
// 있지 않다. 없는 것을 추측해 문장으로 만들지 않는다 — 확장 계약(`extensionPayloads`)에
// 필드를 더하는 것은 이 기능의 범위 밖이다.

export interface ViewReport {
  /** 이 프로젝트가 지금 앞에 나와 있는 탭인지 (`ProjectRegistry.active`) */
  focused: boolean
  /**
   * 편집기에서 보고 있는 파일. 대화 탭에 있으면 `null`.
   *
   * 값의 주인은 렌더러다 (`src/state/useActiveFileNotice.ts`). **활성 프로젝트의 것만
   * 흐른다** — 파일 탭은 프로젝트를 옮기면 비워지므로(`useOpenFiles`), 뒤에 있는
   * 프로젝트에 대해서는 애초에 알 수 있는 값이 없다.
   */
  activeFile: ActiveFileNotice | null
}

export function describeView({ focused, activeFile }: ViewReport): string {
  if (!focused) {
    return [
      '사용자는 지금 다른 프로젝트를 보고 있습니다 — 이 프로젝트는 뒤에 있습니다.',
      '이 앱은 프로젝트를 옮기면 파일 탭을 비우므로, 뒤에 있는 프로젝트에 무엇이 열려 있는지는 알 수 없습니다.',
      '"이거", "여기" 같은 말이 무엇을 가리키는지 확실하지 않으면 사용자에게 되물으세요.',
    ].join('\n')
  }

  const lines = ['사용자가 지금 이 프로젝트를 보고 있습니다.']

  if (activeFile === null) {
    lines.push('보고 있는 화면: 대화창 (파일 탭이 앞에 나와 있지 않습니다)')
    lines.push(
      '어떤 파일을 가리키는지 화면으로는 알 수 없습니다. "이거", "여기" 라는 말이 나오면 되물으세요.',
    )
    return lines.join('\n')
  }

  const at = activeFile.line === undefined ? '' : ` (${activeFile.line}번째 줄 근처)`
  lines.push(`보고 있는 파일: ${activeFile.path}${at}`)
  lines.push(
    `사용자가 "이거", "여기", "이 파일" 이라고 하면 ${activeFile.path} 을(를) 가리킬 가능성이 높습니다.`,
  )
  return lines.join('\n')
}
