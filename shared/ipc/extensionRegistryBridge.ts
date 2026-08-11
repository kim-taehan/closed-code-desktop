import type {
  RegistryAddPayload,
  RegistryFetchPayload,
  RegistryInstallPayload,
  RegistryInstallRequest,
  RegistryListPayload,
  RegistryReadmePayload,
  RegistryReadmeRequest,
  RegistryUrlPayload,
} from './extensionRegistryPayloads'

// 확장 **배포처** 표면. `desktopBridge.ts` 가 300줄 상한에 붙어 갈라냈고
// 그쪽이 이걸 상속한다 — **renderer 쪽 쓰임은 그대로 `window.davis.*`**
// (선례: `gitHistoryBridge.ts`).
//
// 설치본 쪽(`listExtensions`·`installExtensionFromDisk`)은 저쪽에 남겼다.
// 가르는 선은 **배포처(바깥)냐 설치본(안)이냐**다 — 배포처는 신뢰 경계 밖이라
// 전부 `{ ok: false, reason }` 으로 실패를 돌려주는 반면, 설치본 쪽은 디스크만 본다.

export interface ExtensionRegistryBridge {
  /** 기억한 배포처 주소. 사용자가 넣은 순서 그대로 온다. */
  listExtensionRegistries(): Promise<RegistryListPayload>
  /** 주소를 더한다. 오타·중복은 사유로 온다 — 조용히 사라지면 사용자가 눈치채지 못한다. */
  addExtensionRegistry(payload: RegistryUrlPayload): Promise<RegistryAddPayload>
  /** 주소를 뺀다. 없는 주소를 빼도 실패가 아니다 — 결과는 언제나 남은 목록이다. */
  removeExtensionRegistry(payload: RegistryUrlPayload): Promise<RegistryListPayload>
  /**
   * 배포처 하나를 조회한다. **주소를 그대로 쓴다** — 앱이 뒤에 아무것도 덧붙이지 않는다 (표준 §4.4).
   *
   * 못 닿아도 예외가 아니라 `{ ok: false, reason }` 으로 온다. 배포처는 신뢰 경계 밖이라
   * 실패가 정상 경로다.
   */
  fetchExtensionRegistry(payload: RegistryUrlPayload): Promise<RegistryFetchPayload>
  /**
   * 받기 전에 볼 설명(마크다운)을 받아온다. 주소는 목록 문서가 준 `readme` 다.
   *
   * **패키지를 받아 열지 않는다** — 안 받을 수도 있는 것을 미리 받는 셈이라 폐쇄망
   * 회선에서 낭비다. 설명을 안 내놓는 배포처면 화면이 부르지 않는다.
   */
  fetchExtensionRegistryReadme(payload: RegistryReadmeRequest): Promise<RegistryReadmePayload>
  /**
   * 배포처에서 패키지를 내려받아 설치한다.
   *
   * 받은 것은 디스크 설치와 **같은 경로**로 간다 — zip slip 검사도 매니페스트 검증도
   * 다시 탄다. 배포처가 사내라도 그 안의 패키지는 누가 올렸는지 모른다 (표준 §4.4).
   *
   * 못 받거나 못 풀어도 예외가 아니라 `{ ok: false, reason }` 으로 온다.
   */
  installExtensionFromRegistry(payload: RegistryInstallRequest): Promise<RegistryInstallPayload>
}
