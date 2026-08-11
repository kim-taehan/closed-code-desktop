// 확장 **배포처** 채널이 주고받는 것. 설치본 쪽은 `extensionPayloads.ts` 다.
//
// `channels.ts` 가 291줄이라 타입을 거기 직접 늘리지 않는다 (상한 300).
//
// 배포처 주소를 설정 채널(`settings:get`/`settings:set`)로 다루지 않고 전용 채널을 둔 이유:
// 설정 화면이 `AppSettings` 통째로 저장하는 구조라, 배포처를 하나 더할 때도 화면이 읽고
// 고쳐 다시 쓰게 된다. 설정 창을 열어 둔 채 배포처를 건드리면 서로의 값을 덮어쓴다.
// 주소를 더하고 빼는 판단(중복·프로토콜)도 main 한 곳에 남는다.

import type { RegistryIndex } from '../extensions/registryIndex'

/** 기억한 배포처 주소. **사용자가 넣은 순서 그대로** — 화면 목록도 그 순서다. */
export interface RegistryListPayload {
  urls: string[]
}

/** 주소 하나를 가리킨다 (더하기·빼기·조회 공통). */
export interface RegistryUrlPayload {
  url: string
}

/**
 * 더하기 결과. 실패 사유를 돌려주는 이유 — `normalizeSettings` 도 http/https 아닌 것을
 * 걸러내지만 거기서 걸리면 **조용히 사라진다.** 사용자는 오타를 냈는지 알 길이 없다.
 */
export type RegistryAddPayload =
  | { ok: true; urls: string[] }
  | { ok: false; reason: 'bad_url' | 'duplicate' }

/**
 * 배포처 하나를 조회한 결과.
 *
 * `url` 을 결과에 다시 싣는다 — "전체 배포처" 로 여러 곳을 한꺼번에 조회하면 응답 순서만으로는
 * 어느 배포처의 것인지 짝지을 수 없고, 실패한 배포처를 이름 대신 주소로 알려야 한다.
 *
 * `reason` 은 코드값(`string`)이다. 정본은 main 의 `RegistryFetchFailure` 이고, 사람 말로
 * 옮기는 것은 화면 몫이다 — main 에 사유가 하나 늘어도 화면이 코드를 그대로 보여주며 버틴다
 * (`SkippedExtensionPayload` 와 같은 판단).
 */
export type RegistryFetchPayload =
  | { ok: true; url: string; index: RegistryIndex }
  | { ok: false; url: string; reason: string; detail?: string }

/**
 * 받기 전에 볼 설명을 달라는 요청. `url` 은 목록 문서의 `versions[].readme` 를 푼 것이다.
 *
 * `RegistryUrlPayload` 를 재사용하지 않는 이유는 `RegistryInstallRequest` 와 같다 —
 * 목록 문서 주소·패키지 주소·설명 주소가 전부 `{ url }` 모양이라 섞어 넣어도 타입이 못 잡는다.
 */
export interface RegistryReadmeRequest {
  url: string
}

/**
 * 설명 조회 결과.
 *
 * **"설명 없음" 은 여기 없다.** 목록 문서에 `readme` 가 없으면 화면이 애초에 부르지 않는다 —
 * 주소가 있는데 못 받은 것은 배포처가 틀린 것이라 오류로 남긴다.
 *
 * `reason` 은 코드값(`RegistryReadmeFailure`)이고 사람 말로 옮기는 것은 화면 몫이다.
 */
export type RegistryReadmePayload =
  | { ok: true; text: string }
  | { ok: false; reason: string; detail?: string }

/**
 * 배포처에서 하나를 내려받아 설치하라는 요청.
 *
 * `RegistryUrlPayload` 를 재사용하지 않는다 — 저쪽은 **목록 문서** 주소고 이쪽은
 * **패키지** 주소다. 같은 모양이라 섞어 넣어도 타입이 잡아주지 못한다.
 */
export interface RegistryInstallRequest {
  /** 패키지 주소. 파싱 때 목록 문서 기준으로 이미 절대 URL 로 풀려 있다 */
  url: string
}

/**
 * 설치 결과. **이름·버전은 배포처가 적은 것이 아니라 패키지 안 매니페스트에서 온다** —
 * 설치 폴더 이름을 정하는 것도 그쪽이라(`install.ts`), 배포처 목록과 어긋나면
 * 매니페스트가 사실이다. 화면은 이 값으로 알린다.
 *
 * `reason` 은 코드값이다. 내려받기(`PackageDownloadFailure`)와 설치(`InstallFailure`)의
 * 사유가 한 통로로 올라온다 — 사람 말로 옮기는 것은 화면 몫이다.
 */
export type RegistryInstallPayload =
  | { ok: true; name: string; version: string }
  | { ok: false; reason: string; detail?: string }
