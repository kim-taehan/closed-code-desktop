// 설명(README) 한 편의 상태. 설치본(`useExtensionReadme`)과 배포처(`useRegistryReadme`)가
// 같은 모양을 쓴다 — 같은 화면에 같은 모양으로 그려지므로 그리는 쪽(`ReadmeView`)이
// 출처를 알 이유가 없다.
//
// **없음을 실패와 가른다.** README 없는 확장이 대부분이라, 없음까지 오류로 그리면
// 아무 잘못도 없는 확장이 고장난 것처럼 보인다.

export type ReadmeState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  /** 설명이 없다. 오류가 아니다 */
  | { kind: 'none' }
  | { kind: 'error'; message: string }
