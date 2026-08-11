# AXGentic Code Desktop 문서

davis-code-desktop 문서 색인.

## 문서
- [BACKLOG.md](./BACKLOG.md) — 백로그
- [STATUS.md](./STATUS.md) — 상태
- [guide/](./guide/) — 사용자 가이드. `drafts/*.md` → `npm run guide:build` → `index.html`
- [desktop-guide/](./desktop-guide/) — 가이드 PDF 생성 파이프라인. `guide.html` → 스크린샷 → `guide.pdf` ([BUILD-NOTES.md](./desktop-guide/BUILD-NOTES.md))
- [reference/](./reference/) — 참조 자료(vscode 실측 동작·postmortem). 소스 주석에서 참조됨
- [superpowers/specs/](./superpowers/specs/) — 기능 설계·계획 명세(날짜 접두)

## 공통
- 문서 구조·네이밍 표준: 메타 레포 `docs/conventions/docs-structure.md`
- 전체 아키텍처·ADR: 메타 레포 `docs/design-docs/adr/`

> 이 레포의 docs는 가이드 빌드 파이프라인(`guide/`·`desktop-guide/`)과 소스 주석 참조(`reference/`)에 얽혀 있어, 표준 taxonomy로 강제 재배치하지 않는다(표준 §4). 신규 문서만 표준 경로에 만든다.
