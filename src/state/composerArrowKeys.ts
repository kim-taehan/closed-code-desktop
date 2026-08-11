// 화살표 키가 **누구 것인가**를 정한다.
//
// ↑/↓ 를 노리는 곳이 셋이다: 자동완성 팝업(맨 화살표), 입력창의 히스토리 되짚기(맨 화살표),
// 그리고 하단 셸 드로어(⌘/Ctrl + 화살표, `useShortcuts`). 셋이 같은 키를 본다.
//
// **`preventDefault` 는 전파를 막지 않는다.** 그래서 입력창이 수식키를 안 보면 ⌘↑ 한 번에
// 드로어가 열리면서 **입력창 내용도 히스토리로 바뀐다** — 둘 다 일어나고, 사용자는 자기가
// 무엇을 눌렀는지 알 수 없게 된다. 이 판정을 Composer 밖으로 뽑은 이유는 파일 크기가 아니라
// 그것이다: "이 화살표는 내 것인가" 는 이름이 붙을 만한 판단이고, 드로어가 붙기 전에
// 못 박아 둬야 하는 자리다.

/** 판정에 필요한 것만. 진짜 KeyboardEvent 없이도 시험할 수 있게 좁혀 뒀다. */
export interface ArrowKeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
}

/** 지금 떠 있는 자동완성. 하나라도 떠 있으면 화살표는 그 팝업 것이다. */
export interface ComposerPopups {
  mention: string | null
  slash: string | null
  openArg: string | null
}

/** 이 화살표를 입력창의 히스토리 되짚기가 가져가도 되는가. */
export function wantsHistoryNav(event: ArrowKeyLike, popups: ComposerPopups): boolean {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
  // ⌘↑/⌘↓ 는 셸 드로어 것이다. macOS 에서 이 조합은 텍스트 영역의 "문서 처음/끝으로"
  // 기본 동작이기도 한데, 창 리스너가 preventDefault 로 그쪽을 취소한다.
  if (event.metaKey || event.ctrlKey) return false
  return popups.mention === null && popups.slash === null && popups.openArg === null
}
