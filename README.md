# Closed Code Desktop

AI 코딩 데스크톱 앱. 설치 파일 안에 실행에 필요한 것(opencode 포함)이 모두 들어 있어
**설치 파일 하나면 끝난다** — 폐쇄망에는 이 파일 하나만 반입한다.

다운로드: [GitHub Releases](https://github.com/kim-taehan/closed-code-desktop/releases)

| 판 | 파일 |
|---|---|
| macOS Apple Silicon (M1~) | `closed-code-desktop-arm64.zip` |
| macOS Intel | `closed-code-desktop-x64.zip` |
| Windows x64 | `closed-code-desktop-x64.exe` |

파일명에 버전이 없어 `releases/latest/download/<파일>` 주소로 항상 최신을 받을 수 있다.

## macOS 설치

1. 위 표에서 내 Mac 에 맞는 zip 을 받는다.
2. 압축을 풀어 `Closed Code Desktop.app` 을 **응용 프로그램** 폴더로 옮긴다.
3. 서명이 없는 앱이라 격리 딱지를 떼야 첫 실행이 된다 — 터미널에서:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Closed Code Desktop.app"
   ```

4. 실행한다.

## Windows 설치

1. `closed-code-desktop-x64.exe` 를 받는다.
2. 실행하면 설치기가 진행된다. 끝나면 시작 메뉴의 **Closed Code Desktop** 으로 실행한다.

## 실행 전 준비 — 모델 연결

앱은 프로젝트를 열 때 opencode 서버를 알아서 띄운다. 다만 **모델은 opencode 뒤의
프로바이더가 굴리므로**, 홈 디렉터리의 `.config/opencode/opencode.json` 에 프로바이더와
기본 모델이 설정돼 있어야 응답이 온다. 예:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "my-gateway/qwen3.6-35b",
  "provider": {
    "my-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://<게이트웨이 주소>/v1", "apiKey": "<키>" },
      "models": { "qwen3.6-35b": {} }
    }
  }
}
```

그 프로바이더(게이트웨이 등)가 켜져 있어야 한다 — 꺼져 있으면 앱은 뜨지만 답이 오지 않는다.

---

개발·설계 문서는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), 문서 색인은 [docs/](docs/README.md).
