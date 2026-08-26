# Changelog

릴리스마다 `## [버전]` 절을 위에 쌓는다 — release 워크플로가 이 절을 릴리스 본문으로 추출한다.
버전을 올리고(`package.json`) 이 파일에 절을 더한 뒤 main 에 push 하면 배포가 나간다.
일상 작업은 `dev` 브랜치에 쌓고, 릴리스 때만 main 으로 머지한다.

## [0.1.2] - 2026-08-26

- 제품명을 **Closed Code Desktop** 으로 변경 (창 제목·앱 내 표기·패키징·산출물 파일명 — 이전: AXGentic Desktop)
- 산출물 파일명 변경: `closed-code-desktop-<arch>.zip` / `closed-code-desktop-x64.exe`
- 전송 즉시 진행 표시 — LLM 응답이 오기 전에도 「응답 중」 스피너가 바로 뜬다.
  응답이 없으면 30초까지 유지돼 침묵 안내 말풍선과 끊김 없이 이어진다
- 셸 결과를 대화로 넘길 때도 같은 진행 표시가 뜬다
- README 를 설치 안내 전용으로 간소화 (macOS·Windows) — 개발 문서는 `docs/DEVELOPMENT.md`

## [0.1.1] - 2026-08-25

- 제품명을 **AXGentic Desktop** 으로 통일 (창 제목·패키징·릴리스·산출물 파일명 — 이전: Open Code Desktop)
- 산출물 파일명 변경: `axgentic-desktop-<arch>.zip` / `axgentic-desktop-x64.exe`

## [0.1.0] - 2026-08-25

첫 공개 릴리스.

- opencode 실행 파일 동봉 — 폐쇄망에서 설치 파일 하나로 끝난다 (탐색: `OPENCODE_BIN` > 동봉 > PATH > 알려진 자리)
- 채팅·리소스 관리(@ 검색)·도구 승인·변경 검토(diff)·확장(테스트 시나리오 등)
- 커넥터(MCP) 다이얼로그 — 좌측 서버 리스트 · 우측 상세(원격 서버 도구 목록 실시간 조회)
- 셸 결과를 대화로 넘길 때 덧말 입력
- 동시 프로젝트 10개 · 프로젝트 간 확장 화면 격리
