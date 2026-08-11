// 배포처 목록의 한 줄이 어떤 상태인지 — 설치 / 업데이트 / 설치됨.
//
// **semver 비교를 하지 않는다.** 배포처가 준 `latest` 와 설치된 `version` 이 문자열로
// 다르면 그냥 "업데이트" 다. 이유는 표준 §4.4 — **latest 를 정하는 주체가 배포처**이기 때문이다.
// 앱이 "그건 낮은 버전이니 업데이트가 아니다" 라고 판정하려면 semver 파서가 필요해지고,
// 그 순간 `1.0.0-rc.1` · `2026.07.31` 처럼 배포처마다 다른 버전 표기를 우리가 해석하게 된다.
// 되돌리기(다운그레이드)를 구분해야 할 일이 실제로 생기면 그때 파서를 들인다.

export type RegistryRowState =
  /** 설치된 적이 없다 */
  | 'installable'
  /** 설치돼 있는데 배포처의 latest 와 다르다 */
  | 'updatable'
  /** 설치돼 있고 배포처의 latest 와 같다 */
  | 'installed'

/** 설치본에서 판정에 쓰는 것만. `ExtensionEntryPayload` 가 이 모양을 만족한다. */
export interface InstalledVersion {
  name: string
  version: string
}

/**
 * 짝은 **`name`** 으로 짓는다 — 설치 폴더 이름이 매니페스트의 `name` 이라
 * (`electron/extensions/install.ts`) 같은 이름이면 같은 확장이다.
 * `displayName` 은 배포처와 패키지가 다르게 적을 수 있어 기준이 될 수 없다.
 */
export function registryRowState(
  entry: { name: string; latest: string },
  installed: readonly InstalledVersion[],
): RegistryRowState {
  const match = installed.find((item) => item.name === entry.name)
  if (match === undefined) return 'installable'
  return match.version === entry.latest ? 'installed' : 'updatable'
}
