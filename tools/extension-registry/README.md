# 확장 배포처 (임시)

확장 패키지를 올리고 내려받는 작은 로컬 서버. **배포처 프로토콜을 실제로 굴려 보려고** 만들었다.

앱의 확장 화면이 조회할 `index.json` 의 모양을 여기서 먼저 고정하고, 화면·배선을 상상이 아니라
실물에 맞춘다. 의존성이 없다 — Node 내장만 쓰고, 패키지 안 `manifest.json` 을 읽을 때만
시스템 `tar`/`unzip` 을 부른다 (앱의 `electron/runtime/archive.ts` 와 같은 방식).

> ⚠️ **임시다.** 인증이 없고 업로드 크기 제한도 느슨하다. 사내망에서 잠깐 쓰는 용도이며,
> 실제 배포처가 되면 Admin 서버(`deployments`)에 붙이는 것이 맞다.

## 쓰기

```bash
npm run ext:registry              # http://localhost:4321
npm run ext:pack extensions/line-checker   # dist-extensions/line-checker-0.1.0.axcx
```

브라우저로 `http://localhost:4321` 을 열고 `.axcx` 를 끌어다 놓으면 올라간다.
포트를 바꾸려면 `PORT=5000 npm run ext:registry`.

패키지는 `tools/extension-registry/store/{이름}/{버전}.axcx` 로 쌓인다 (git 에 안 들어간다).

## 앱이 조회할 주소

```
http://localhost:4321/index.json
```

## 프로토콜 — `index.json`

**이 모양이 배포처 계약이다.** 앱이 이걸 읽어 "받을 수 있는 것" 목록을 그린다.

```jsonc
{
  "registryVersion": 1,          // 매니페스트의 manifestVersion 과 같은 뜻의 탈출구
  "name": "로컬 임시 배포처",     // 화면에 보일 배포처 이름
  "extensions": [
    {
      "name": "line-checker",
      "displayName": "라인 체커",
      "description": "줄 수가 많은 파일부터 모아 봅니다",
      "latest": "0.2.0",          // 버전 중 가장 높은 것
      "versions": [               // 높은 순
        {
          "version": "0.2.0",
          "url": "packages/line-checker/0.2.0",   // 이 문서 기준 상대경로
          "size": 3168,
          "uploadedAt": "2026-07-31T07:36:58.809Z",
          "readme": "packages/line-checker/0.2.0/readme"  // 설명이 있을 때만
        }
      ]
    }
  ]
}
```

`url` 을 **상대경로**로 둔 이유 — 폴더째 다른 곳으로 옮겨도 링크가 안 깨진다.
에어갭에서 배포처를 통째로 복사해 나르는 일이 생긴다.

## 엔드포인트

| | | |
|---|---|---|
| `GET` | `/index.json` | 목록 (위 프로토콜) |
| `POST` | `/upload` | 본문이 곧 패키지 바이트. **이름·버전은 패키지 안 매니페스트가 정한다** |
| `GET` | `/packages/{이름}/{버전}` | 내려받기 |
| `GET` | `/packages/{이름}/{버전}/readme` | 받기 전에 볼 설명 (마크다운) |
| `DELETE` | `/packages/{이름}/{버전}` | 지우기 |

설명은 따로 저장하지 않고 **패키지 안 `README.md` 를 그때그때 꺼내** 준다. 저장해 두면
패키지를 덮어썼을 때 설명만 옛것으로 남는다 — 정본은 언제나 패키지 안이다.
README 가 없는 패키지는 목록에 `readme` 를 싣지 않는다 (앱이 헛걸음하지 않게).

업로드가 파일명을 안 믿는 이유 — 파일명은 사람이 알아보라고 있는 것이고,
정본은 패키지 안 `manifest.json` 이다. 파일명을 바꿔 올려도 제자리에 들어간다.

## 확인된 것

`curl` 로 왕복을 돌려 봤다: 빈 목록 → 업로드 → 버전 2개 쌓임 → 최신 판정 →
내려받기(바이트 일치) → 같은 버전 덮어쓰기(`replaced: true`) → 아카이브 아닌 것 거부 → 지우기.

`scripts/pack-extension.mjs` 가 만든 패키지(`zip` CLI, deflate)가 앱의
`installPackage` 로 설치되는 것도 시험으로 잠갔다 (`electron/extensions/install.test.ts`).
