---
name: report-damage-analysis
description: 시설물(비탈면/옹벽/교량/터널 등) 점검보고서 PDF를 분석해 손상 목록을 추출하고 Excel/Word/PDF로 출력한다. 사용자가 점검보고서 PDF를 주고 손상분석/손상목록/결과 출력을 요청할 때 사용한다.
---

# 보고서 손상분석 (report-damage-analysis)

이 스킬은 `damage-report-analyzer` 프로젝트(이 저장소)의 실제 STEP4~5(정규화·중복통합)와
STEP10(Excel/Word/PDF 생성) 로직을 그대로 재사용해서, Claude가 직접 보고서를 읽고 분석한
결과를 프로그램과 동일한 형식의 산출물로 만든다. **분석 규칙이나 출력 로직을 이 스킬 안에
다시 만들지 않는다** — 항상 아래 1단계에서 실제 소스 파일을 읽어서 그 내용을 따른다(규칙이
바뀌면 소스만 바뀌고 이 스킬 파일은 낡지 않는다).

## 이 스킬이 하지 않는 것 (먼저 밝힘)

- **사진 추출/연결(STEP6~7), 추가자료 교차검증(STEP8)은 포함하지 않는다.** 이 프로젝트의 사진
  추출 로직(`src/lib/photoExtraction.ts`)은 브라우저 Canvas API에 의존해서 Node/Claude만으로는
  재현할 수 없다. 사진까지 필요하면 사용자에게 웹앱(`npm run dev` 후 브라우저에서 PDF 업로드)을
  안내한다 — 사진 없이 만든 결과를 "완전한 분석"이라고 말하지 않는다.
- 여러 페이지에 걸친 표/스캔 이미지 기반 보고서는 Read 도구의 PDF 텍스트 추출 품질에 따라
  정확도가 달라질 수 있다. 확신이 없는 필드는 추측해서 채우지 말고 비워둔다(아래 규칙 동일).

## 실행 절차

### 1. 추출 규칙을 실제 소스에서 읽는다

이 스킬 파일에 규칙을 복사해두지 않는다 — 항상 최신 규칙을 그대로 따르기 위해, 먼저 이 저장소의
다음 파일을 Read 도구로 읽는다:

```
src/lib/aiPrompt.ts
```

`buildExtractionPrompt()` 함수 안의 "핵심 원칙"과 "출력 형식"(JSON 스키마)이 이 스킬이 따라야
할 규칙이다. 요약하면: 손상 그룹과 개별 위치를 구분할 것, part는 `src/types.ts`의
`STANDARD_PARTS` 표준값만 사용할 것, subPart에 실제 시설명을 넣을 것, 위치 범위(`176~206m`)는
쪼개지 말 것, 보고서에 없는 값은 추측하지 말고 `null`/`"-"`로 둘 것, 각 그룹의 출처(페이지 번호,
가능하면 원문 발췌)를 `sourceReferences`에 반드시 남길 것.

### 2. 보고서 PDF를 읽고 분석한다

사용자가 준 PDF를 Read 도구로 읽는다(페이지가 많으면 `pages` 파라미터로 나눠서, 최대 20페이지씩
읽는다). 1단계의 규칙을 그대로 적용해 손상 정보를 추출하고, `buildExtractionPrompt()`가 요구하는
JSON 스키마와 **정확히 같은 구조**의 `RawDamageGroup[]` 배열을 만든다(필드명을 임의로 바꾸지
않는다 — 이 저장소의 `RawDamageGroup`/`RawLocationEntry` 타입은 `src/types.ts`에 정의돼 있다).

이 JSON 배열을 임시 파일로 저장한다(예: 프로젝트 루트 밖, 임시 작업 디렉터리에
`raw-groups.json`).

### 3. 실제 파이프라인 스크립트로 결과를 만든다

이 저장소 루트에서 다음 명령을 실행한다(이미 `vite-node`가 devDependency로 설치돼 있다):

```bash
npx vite-node scripts/analyzeReport.ts --input <raw-groups.json 경로> --report-name "<보고서/프로젝트명>" --facility-name "<시설물명, 선택>" --facility-type "<시설물 유형, 선택>" --out <출력 폴더>
```

이 스크립트는 실제 `src/lib/normalize.ts`(`expandAllGroups`)와 `src/lib/mergeDuplicates.ts`
(`mergeDuplicates`)로 그룹을 개별 위치 레코드로 분리·중복통합한 뒤, 실제
`src/lib/report/exportExcel.ts` / `exportWord.ts` / `exportPdf.ts`로 Excel(.xlsx)/Word(.docx)/
PDF를 생성한다 — 이 스킬은 그 로직을 다시 구현하지 않고 그대로 호출만 한다.

명령이 끝나면 `{ groupCount, individualDamageCount, mergedRecordCount, mergedCount,
conflictCount, files: [...] }` 형태의 JSON을 표준출력으로 돌려준다. `conflictCount`가 0보다
크면, 같은 손상으로 통합됐지만 필드 값이 서로 달라 자동으로 확정하지 못한 항목이 있다는 뜻이니
사용자에게 알린다(`status: "conflict"`인 레코드).

### 4. 결과를 사용자에게 전달한다

`files` 배열의 파일들(Excel/Word/PDF)을 SendUserFile로 사용자에게 보낸다. 응답에는 반드시
다음을 포함한다:

- 추출된 손상 건수(그룹 수 → 개별 위치 수 → 통합 후 건수), 통합/충돌 건수
- **이 결과가 "1차 AI 분석 결과"이며, 사진 연결과 추가자료 교차검증은 포함되지 않았다는 점**
  (완료된 정식 검수 결과처럼 말하지 않는다)
- 정확도를 더 높이거나 사진까지 포함하려면 웹앱에서 직접 PDF를 업로드해 STEP1~10 전체 흐름을
  거치는 것을 권장한다는 안내

## 참고

- 이 스크립트는 Excel/Word/PDF 세 가지를 한 번에 만든다. 하나만 필요하면
  `--formats excel` 처럼 콤마로 원하는 형식만 지정할 수 있다(`excel`, `word`, `pdf` 조합).
- `scripts/analyzeReport.ts` 자체는 이 저장소의 실제 타입(`src/types.ts`)과 함수를 import해서
  쓰므로, STEP4/5/10 로직이 바뀌면 이 스킬의 출력도 자동으로 최신 로직을 따라간다 — 별도로
  업데이트할 필요가 없다.
