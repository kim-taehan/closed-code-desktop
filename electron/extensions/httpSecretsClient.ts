import {
  METHOD_HTTP_FETCH,
  METHOD_SECRETS_DELETE,
  METHOD_SECRETS_GET,
  METHOD_SECRETS_SET,
} from './extensionApiMethods'
import type { RpcCall } from './extensionApi'

// 확장이 받는 `code.http`·`code.secrets` — 자식(확장 호스트) 쪽 대리자 (하이닉스 요구사항 확장 §5-1).
// 부르는 것도 판정도 **부모(main)** 가 한다 (`httpSecretsDispatch.ts`). 여기는 이름을 채우고 답의 모양을 본다.
//
// **electron 을 import 하지 않는다** — 자식에서 돈다 (`rpc.ts` 머리말).

export interface HttpFetchInit {
  /** 기본 `GET` */
  method?: string
  headers?: Record<string, string>
  /** 글 본문. `bodyBase64` 와 함께 줄 수 없다 */
  body?: string
  /** 바이트 본문 (여러 조각 첨부 등 — 확장이 만든 것을 그대로 나른다) */
  bodyBase64?: string
  /** 기본 30000, 최대 120000 */
  timeoutMs?: number
  /** 겉봉이 없는 자리에서 프로젝트를 직접 적을 때만 — `ui.post` 의 `target` 과 같은 규칙 */
  projectId?: string
}

/** 본문은 `content-type` 이 글(text/*·json·xml…)이면 `body`, 아니면 `bodyBase64` */
export interface HttpFetchResponse {
  status: number
  /** 이름은 소문자 */
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
}

export interface ExtensionHttpApi {
  fetch(url: string, init?: HttpFetchInit): Promise<HttpFetchResponse>
}

export interface ExtensionSecretsApi {
  /** 넣은 적 없으면 `undefined` */
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export function createHttpApi(call: RpcCall, extensionName: string): ExtensionHttpApi {
  return {
    fetch: async (url, init = {}) => {
      // 아는 칸만 골라 싣는다 — 펼치면 확장이 `init` 에 `extension` 을 실어 남의 허용 목록으로 부른다
      const { method, headers, body, bodyBase64, timeoutMs, projectId } = init
      const answer = await call(METHOD_HTTP_FETCH, {
        url,
        ...(method === undefined ? {} : { method }),
        ...(headers === undefined ? {} : { headers }),
        ...(body === undefined ? {} : { body }),
        ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(projectId === undefined ? {} : { projectId }),
        extension: extensionName,
      })
      const record = (answer ?? {}) as Record<string, unknown>
      if (typeof record['status'] !== 'number') throw new Error(`${METHOD_HTTP_FETCH}: 답에 status 가 없습니다`)
      return record as unknown as HttpFetchResponse
    },
  }
}

export function createSecretsApi(call: RpcCall, extensionName: string): ExtensionSecretsApi {
  // `extension` 을 여기서 채운다 (`storage` 와 같은 규칙) — 확장이 실어 보내면 남의 토큰을 읽는다
  return {
    get: async (key) => {
      const value = await call(METHOD_SECRETS_GET, { extension: extensionName, key })
      if (value !== undefined && typeof value !== 'string') throw new Error(`${METHOD_SECRETS_GET} 응답이 문자열이 아닙니다`)
      return value
    },
    set: async (key, value) => {
      await call(METHOD_SECRETS_SET, { extension: extensionName, key, value })
    },
    delete: async (key) => {
      await call(METHOD_SECRETS_DELETE, { extension: extensionName, key })
    },
  }
}
