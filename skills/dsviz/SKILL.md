---
name: dsviz
description: "글/문서/데이터를 그림으로 만든다. 개념도/구조도/흐름도/표와 선/영역/막대/산점도 차트를 단독 HTML(canvas)로 그리고, 그려지는 순서 애니메이션, 단계별 데모, 독자가 조작하는 실험으로 만든다. Confluence/슬라이드에 넣을 애니메이션 WebP/PNG도 내보낸다. 사용자가 차트나 그래프, 설명 다이어그램, 표 그림, 데이터 시각화, 단계별이나 인터랙티브 설명 그림을 요청하거나 dsviz를 언급할 때 쓴다."
---

# dsviz

개념도와 차트를 대본(`draw` + `sequence`)으로 쓰고, 그리기/반응형/애니메이션/검증은 런타임에 맡긴다.

- 런타임: [runtime/dsviz.js](runtime/dsviz.js), 색 토큰과 카드 틀: [runtime/dsviz.css](runtime/dsviz.css)
- API: [references/api.md](references/api.md)
- 설명 구조 카탈로그: [references/patterns.md](references/patterns.md)
- 캡션 규칙: [references/copy.md](references/copy.md)
- 시작 템플릿: [templates/diagram.html](templates/diagram.html), [templates/demo.html](templates/demo.html)(단계별), 완성 예시: [examples/request-response.html](examples/request-response.html)(개념도), [examples/charts.html](examples/charts.html)(차트), [examples/demo.html](examples/demo.html)(단계별 데모), [examples/lab.html](examples/lab.html)(실험)

## 작업 순서

1. **보여줄 결론 하나 고르기**: 글이면 독자가 잘못 이해하기 쉬운 지점, 데이터면 그 데이터가 보여주는 가장 중요한 사실 하나. 데이터만 주고 결론을 정하지 않은 요청이라도 데이터 안에 뚜렷한 사실(교차, 최대/최소, 급변, 추세 전환)이 있으면 그것을 결론으로 쓴다. 그런 사실이 없을 때만 캡션에 무엇을 그렸는지 적는다
   - 글의 반전이나 핵심 주장을 캡션에만 두지 말고 그림 요소로 그린다
2. **설명 구조 고르기**: [patterns.md](references/patterns.md)에서 하나. 데이터 차트는 차트 구조(`trend` `compare-bars` `summary-trap` 등)에서 고른다. 맞는 구조가 없으면 사용자에게 제안하고 확인받는다
3. **진입점과 캡션 정하기** ([copy.md](references/copy.md))
   - 기본은 `createDiagram` + 결론 캡션 한 문장. 완성 그림과 결론 캡션만으로는 결론이 서지 않을 때만 `createDemo` + 단계별 캡션 2~4개(마지막 캡션이 결론): 앞 단계에서 독자가 먼저 믿게 되는 것(예: 평균이 같다)이 보여야 마지막 단계가 반전으로 읽히는 경우. 사실이 쌓이기만 하는 설명은 단계로 나누지 않는다
   - 독자가 값을 바꿔 보며 차이를 직접 겪어야 이해되면(방식 A/B 비교, 용량과 대기열) `createLab` + 결론 캡션 한 문장. 사용자가 "직접 해볼 수 있게", "조작", "실험"을 요청해도 이것
   - `createLab`이 아니면 애니메이션 강도를 사용자에게 묻는다: 기본, 약하게(`motion: "soft"`, 모든 요소가 처음부터 보이고 강조/기준선/화살표/칩만 가볍게 움직임), 끄기(`motion: "off"`, 완성 그림만). 약하게와 끄기는 캐러셀 없이 결론 캡션 하나
   - 기본 + `createDemo`일 때만 표시 방식을 묻는다: 한 그림에서 단계가 넘어가는 캐러셀(기본) 또는 단계마다 그림을 하나씩 세로로 놓는 나눠 보기(`display: "split"`). HTML과 내보낸 WebP 모두 이 방식을 따른다
4. **draw 작성**: 640 기준 폭 좌표로 배치. 세로로 쌓아야 읽히는 그림이면 `mobile`(360 기준)도 작성
   - 사람은 흐름의 단계나 처리 주체로 나와도 `box` 대신 `person`으로 그린다. `label`에는 사람을 부르는 이름을 쓰고, 하는 일을 덧붙일 때는 `text`로 적는다. 인원 중 일부가 결론이면(N명 중 M명) `people`
5. **sequence 작성**: 그림이 완성되는 순서. 끄기를 골랐으면 생략
6. **검증**: 아래 명령으로 캡처와 자동 검사 실행 → FAIL 0건 + 캡처 이미지를 직접 열어 확인.

```bash
cd <이 스킬 폴더>/scripts
[ -d node_modules ] || npm i --silent
node capture.mjs <html 경로> --out <캡처 폴더>            # 라이트, 720/390폭, 진행률 0.33/0.66/1
node capture.mjs <html 경로> --out <캡처 폴더> --t 1 --dark  # 다크, 720/390폭 마지막 프레임
```

## 출력

- 기본: [templates/diagram.html](templates/diagram.html)을 복사해 작성하고 `dsviz.js`/`dsviz.css`를 같은 폴더에 둔다(템플릿 경로는 `./dsviz.*`)
- 아티팩트 게시: `files`에 `{"dsviz.js": ..., "dsviz.css": ...}`를 함께 지정
- 사용자가 경로를 주지 않으면 스크래치패드에 만들고 아티팩트로 게시
- 한 페이지에 다이어그램 여러 개 가능 (`div`마다 `createDiagram` 한 번)
- JS가 돌지 않는 곳(Confluence, 슬라이드, 메신저): 검증을 통과한 HTML을 애니메이션 WebP로 내보낸다. 다이어그램마다 한 주기 반복 WebP(색 128개 무손실, 4배 해상도)와 마지막 프레임 PNG가 나오고, 캡션은 그림 안에 포함(`--no-caption`이면 제외). 캡션을 그림 밖 본문 글자로 따로 쓰면 라벨 없는 문장처럼 떠 보이므로 쓰지 않는다
- 내보낸 WebP는 완성된 그림으로 시작한다. 기본 모드는 3초(timing.hold가 더 길면 그만큼) 멈춘 뒤 처음부터 그려지고, 약하게(`motion: "soft"`)와 `createLab`은 멈춤 없이 반복한다. 첫 프레임만 보여주는 곳(앱, 미리보기, PDF)에서도 완성된 그림이 보임
- 4배 해상도(2752px)인 이유: Confluence는 올린 원본 폭의 절반을 내려보낸다. 2752px를 올려야 1376px를 받아 레티나 화면에서도 선명함(1376px를 올리면 688px로 흐려짐)

```bash
node export.mjs <html 경로> --out <폴더>          # WebP + PNG. 기본 20fps
node export.mjs <html 경로> --out <폴더> --gif    # WebP를 못 쓰는 곳용 GIF도 함께(128색, 960px). ffmpeg 필요
node export.mjs --check                           # 내보내기가 실패했을 때만: 원인과 설치 명령 출력
```

- 인코딩 방식은 스크립트가 감지: WebP 인코더가 있는 ffmpeg면 찍은 화면을 바로 흘려보내 임시 파일 없이 만들고(pipe), 없으면 임시 PNG를 img2webp로 묶음(frames, 끝나면 삭제)
- 권장 설치는 `brew install ffmpeg-full`(미리 빌드된 파일, 컴파일 불필요). 설치하면 PATH의 `ffmpeg`가 ffmpeg-full로 바뀌고 기본 ffmpeg 기능도 그대로 포함. 기본 `brew install ffmpeg`에는 WebP 인코더가 없음
- 내보내기는 바로 실행한다. 실패했을 때만 `--check`로 원인을 보고, 출력된 설치 명령을 사용자에게 그대로 안내하고 설치 여부를 묻는다. 시스템에 프로그램을 설치하는 일이라 에이전트가 직접 설치하지 않는다

## 반드시 지킬 규칙

- 색은 역할 이름(`focus` `compare` `alert` `warn` `accent` `muted`)으로만 지정한다. 다크 모드에서는 역할 색 토큰만 바뀌므로 hex로 지정한 색은 어두운 배경에서 그대로 남는다
- 한 그림에서 색으로 대비시키는 짝은 `focus`/`compare` 또는 `focus`/`alert`. `compare`/`alert`, `warn`/`alert`를 함께 쓰면 둘 다 라벨을 붙이고 한쪽은 `dashed`(arrow/line/box 지원). `status` 기본 색이 `warn`이라 `alert` 옆에서는 `role` 명시
- 모든 요소에 글자 라벨. 색만으로 의미 전달 금지
- 차트: 그림 하나에 y축 하나(단위가 다른 두 값은 차트를 나눔), 시리즈 2개 이상이면 시리즈마다 `label`, 그림 안 숫자는 데이터에서 계산한 값만(캡션 포함. 근사 표현은 "약 600명"처럼 표시하고 데이터에서 반올림한 값만). 사용자가 준 데이터는 바꾸지 않고, 지어낸 예시 데이터면 캡션에 "예시 데이터"를 붙인다
- `createDemo`의 단계마다 그림에도 변화가 있어야 함(캡션만 바뀌면 검사 FAIL). 단계 캡션 번호는 런타임이 붙이므로 쓰지 않음
- `sequence`의 마지막 프레임(진행률 1)이 완성된 그림. reduced-motion/인쇄/화면 밖에서는 이 프레임만 보인다
- `capture.mjs`가 FAIL을 내면 고친 뒤 다시 실행. PASS여도 캡처 이미지를 열어 선과 도형 겹침, 간격, 방향 확인 (검사 범위는 [api.md](references/api.md) 끝)
