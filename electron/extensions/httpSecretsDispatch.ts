import {
  METHOD_HTTP_FETCH,
  METHOD_SECRETS_DELETE,
  METHOD_SECRETS_GET,
  METHOD_SECRETS_SET,
} from './extensionApiMethods'
import { fetchAllowed, parseHttpRequest } from './httpFetch'
import { requireString } from './serviceParse'
import { requireEnabled } from './uiDispatch'
import type { DispatchDeps } from './serviceDispatch'

// 자식이 부른 `code.http.fetch`·`code.secrets.*` 를 받는다 (하이닉스 요구사항 확장 §5-1, H1).
// `serviceDispatch.ts` 에서 갈라 뒀다 — 저쪽이 300줄 상한에 붙어 있다.
//
// 둘 다 **확장 이름은 자식(`createExtensionApi`)이 채운 것**이다 — 확장이 실어 보내면 남의 허용 목록으로
// 부르고 남의 토큰을 읽는다 (`storage` 와 같은 규칙).

export type HttpSecretsMethod =
  | typeof METHOD_HTTP_FETCH
  | typeof METHOD_SECRETS_GET
  | typeof METHOD_SECRETS_SET
  | typeof METHOD_SECRETS_DELETE

export async function dispatchHttpSecrets(
  deps: DispatchDeps,
  method: HttpSecretsMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  const extension = requireString(params['extension'], 'extension')
  switch (method) {
    case METHOD_HTTP_FETCH: {
      // 프로젝트 규칙·켜짐은 `ui.post`·`ai.run` 과 같다 — 꺼진 프로젝트의 일로는 바깥에 못 닿는다.
      // 부르는 것 자체는 프로젝트와 무관하지만, 켜기가 「이 프로젝트에서 이 확장을 믿는다」는 사람의 결정이다
      await requireEnabled(method, params, deps.projectId(), deps.allowedIn)
      const request = parseHttpRequest(method, params)
      // 허용 목록은 **매니페스트에서만** 온다 (3판 `network`). 2판·모르는 이름은 빈 목록 = 전부 거절
      const allowed = (await deps.manifestOf(extension))?.network ?? []
      return fetchAllowed(allowed, request)
    }
    // 비밀은 **확장마다**다 — 프로젝트를 안 본다 (토큰은 사람의 것이다, `secretStore.ts` 머리말)
    case METHOD_SECRETS_GET:
      return deps.secrets.get(extension, requireString(params['key'], 'key'))
    case METHOD_SECRETS_SET:
      return deps.secrets.set(extension, requireString(params['key'], 'key'), requireString(params['value'], 'value'))
    case METHOD_SECRETS_DELETE:
      return deps.secrets.delete(extension, requireString(params['key'], 'key'))
  }
}
