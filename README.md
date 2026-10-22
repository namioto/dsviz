# dsviz

글, 문서, 데이터를 설명 그림으로 만드는 Claude Code 플러그인입니다. 개념도, 구조도, 흐름도, 표, 선/막대/산점도 차트를 단독 HTML(canvas)로 그리고, 그림이 그려지는 순서를 애니메이션으로 보여 줍니다. JS가 돌지 않는 곳(Confluence, 슬라이드, 메신저)에 넣을 애니메이션 WebP와 PNG도 내보냅니다.

## 설치

```
/plugin marketplace add namioto/dsviz
/plugin install dsviz@dsviz
```

## 사용

Claude Code에서 그림을 요청하면 스킬이 불립니다.

```
dsviz 스킬로 아래 글을 설명하는 다이어그램을 만들어줘.
"..."
```

- 진입점 3가지: 완성 그림 하나(`createDiagram`), 단계마다 캡션이 바뀌는 데모(`createDemo`), 독자가 값을 바꿔 보는 실험(`createLab`)
- 애니메이션 강도 3가지: 기본, 약하게(모든 요소가 처음부터 보이고 강조만 움직임), 끄기
- 사람은 사람 모양(`person`), 인원 비율은 사람 아이콘 격자(`people`)로 그림
- 색은 역할 이름(`focus` `alert` 등)으로만 지정해 라이트/다크 모드를 함께 지원
- 그린 뒤 자동 검사(글자 겹침, 넘침, 잘못된 순서 지정)와 캡처로 결과를 확인

## 필요한 것

- Node.js: 검증과 내보내기 스크립트가 처음 실행될 때 `npm i`로 Playwright를 설치합니다
- ffmpeg-full: WebP와 GIF 내보내기에 씁니다. 기본 `ffmpeg`에는 WebP 인코더가 없습니다

```
brew install ffmpeg-full   # macOS
winget install ffmpeg       # Windows
```

## 라이선스

MIT
