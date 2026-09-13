---
name: report-damage-analysis
description: 시설물(비탈면/옹벽/교량/터널 등) 점검보고서 PDF를 분석해 손상 목록을 추출하고 Excel/Word/PDF로 출력한다. 사용자가 점검보고서 PDF를 주고 손상분석/손상목록/결과 출력을 요청할 때 사용한다. 어느 프로젝트/폴더에서든 동작한다(독립 실행형).
---

# 보고서 손상분석 (report-damage-analysis)

시설물 점검보고서 PDF를 읽고 손상 정보를 구조화해 Excel/Word/PDF로 출력하는 **독립 실행형**
스킬이다. 이 폴더(`analyzeReport.bundle.cjs`)만 있으면 어느 프로젝트에서 실행하든 동작한다 —
`damage-report-analyzer` 원본 저장소가 그 자리에 없어도 된다(필요한 로직이 이 번들 파일 하나에
전부 들어있음, Node.js만 있으면 됨. `npm install` 불필요).

## 이 스킬이 하지 않는 것 (먼저 밝힘)

- **사진 추출/연결, 추가자료 교차검증은 포함하지 않는다.** 보고서 본문의 손상 텍스트 정보만
  분석한다. 사진은 PDF 안에 있어도 다루지 않는다(브라우저 Canvas 렌더링에 의존하는 기능이라
  독립 실행형 Node 스크립트로 옮길 수 없었다) — 사진 없이 만든 결과를 "완전한 분석"이라고
  말하지 않는다.
- 여러 페이지에 걸친 표/스캔 이미지 기반 보고서는 정확도가 떨어질 수 있다. 확신이 없는 필드는
  추측해서 채우지 말고 비워둔다(아래 3번 규칙과 동일한 원칙).

## 실행 절차

### 1. 보고서 PDF를 읽고 분석한다

사용자가 준 PDF를 Read 도구로 읽는다(페이지가 많으면 `pages` 파라미터로 나눠서, 최대 20페이지씩
읽는다). 아래 **추출 규칙**을 그대로 적용해 손상 정보를 추출하고, **출력 형식**과 정확히 같은
구조의 JSON 배열을 만든다.

#### 추출 규칙 (반드시 준수)

1. 보고서에서 "손상 그룹"과 "개별 손상 위치"를 구분하라. 하나의 손상 그룹에 여러 위치가 나열되어
   있는 경우 각각을 독립된 위치 항목으로 생성하라.
2. 동일한 손상명이라도 위치 또는 세부부위가 다르면 반드시 별도 위치 항목으로 생성하라.
3. 부위(part)와 세부부위(subPart)를 분리하라.
   - part는 다음 표준 분류값 중 하나만 사용하라: `상부자연사면, 사면, 사면하부, 보강시설, 보수시설, 배수시설, 기타`
   - 보고서에 나타난 실제 시설명(예: 소단측구, 산마루측구, 도수로, 배수로 등)은 subPart에
     저장하라. part 필드에 시설명을 넣지 마라.
4. 위치는 콤마로 나열된 개별 값은 각각 분리하되, "176~206m" 같은 범위는 하나의 위치로 유지하라.
   임의로 범위를 잘게 쪼개지 마라.
5. 보고서에 명시되지 않은 규모/물량을 추정하거나 계산하지 마라.
6. 여러 개별 위치가 하나의 총 물량(그룹 합계)만 공유하는 경우, 각 위치에 총 물량을 반복하지 말고
   `quantityGroupTotal` 필드 하나로 그룹 단위에 담아라. 특정 위치에만 명시적으로 대응되는 개별
   물량이 있는 경우에만 해당 위치의 `quantity`에 넣어라.
7. `photoCount`(그룹당 사진 수)는 문서에서 명확히 셀 수 있을 때만 채우고, 불확실하면 `null`로
   두라 — 이 스킬은 사진을 실제로 다루지 않으므로 참고용 숫자일 뿐이다.
8. 각 손상 그룹은 원문 출처(페이지 번호, 유형: table/body/conclusion/photo 등, 가능하면 원문
   발췌)를 `sourceReferences`에 남겨라.
9. 보고서 원문에 없는 정보를 절대 만들어내지 마라. 확실하지 않으면 필드를 `null`이나 `"-"`로
   두어라.
10. 특정 업체의 표 번호나 페이지를 전제로 하지 말고, 문서 전체 구조(본문 설명, 표, 사진대지)를
    근거로 판단하라. 이 보고서 한 건에만 맞는 규칙을 만들지 마라.

#### 출력 형식 (JSON 스키마)

```json
[
  {
    "groupNo": "보고서 원문 그룹 번호 (예: ③), 없으면 순번 부여",
    "section": "구간 (예: 1구간)",
    "damageName": "손상명",
    "part": "표준 분류값 중 하나",
    "repairMethod": "보수방안",
    "quantityGroupTotal": "그룹 총 물량 (문자열, 예: '23.3m') 또는 null",
    "locations": [
      { "subPart": "세부부위 (없으면 '-')", "location": "개별 위치 (예: '165m' 또는 '176~206m')", "quantity": "이 위치에만 대응되는 개별 물량 또는 null" }
    ],
    "photoCount": "그룹에 연결된 사진 수 또는 null",
    "sourcePages": [80],
    "sourceReferences": [{ "page": 80, "type": "table", "excerpt": "원문 발췌 (가능한 경우)" }]
  }
]
```

이 JSON 배열을 임시 파일로 저장한다(예: 작업 디렉터리에 `raw-groups.json`).

### 2. 번들 스크립트로 결과를 만든다

이 스킬 폴더 안의 `analyzeReport.bundle.cjs`를 **plain Node.js로 직접 실행**한다(설치 단계
없음):

```bash
node <이 스킬 폴더 경로>/analyzeReport.bundle.cjs --input <raw-groups.json 경로> --report-name "<보고서/프로젝트명>" --facility-name "<시설물명, 선택>" --facility-type "<시설물 유형, 선택>" --out <출력 폴더>
```

옵션:
- `--formats excel,word,pdf` (기본값. 콤마로 원하는 형식만 지정 가능, 예: `--formats excel`)

동작: 1단계에서 만든 JSON을 (a) 손상 그룹 → 개별 위치 레코드로 분리하고, (b) 같은 위치/부위/
손상명으로 겹치는 레코드를 자동 통합(값이 다르면 통합하지 않고 "정보불일치" 상태로 남김)한 뒤,
(c) Excel(.xlsx)/Word(.docx)/PDF를 생성한다.

명령이 끝나면 다음 형태의 JSON을 표준출력으로 돌려준다:

```json
{
  "groupCount": 5,
  "individualDamageCount": 18,
  "mergedRecordCount": 18,
  "mergedCount": 0,
  "conflictCount": 0,
  "files": ["...xlsx", "...docx", "...pdf"]
}
```

`conflictCount`가 0보다 크면, 같은 손상으로 통합됐지만 필드 값이 서로 달라 자동으로 확정하지
못한 항목이 있다는 뜻이니 사용자에게 알린다.

### 3. 결과를 사용자에게 전달한다

`files` 배열의 파일들을 사용자에게 전달한다(SendUserFile 같은 파일 전송 기능이 있으면 사용).
응답에는 반드시 다음을 포함한다:

- 추출된 손상 건수(그룹 수 → 개별 위치 수 → 통합 후 건수), 통합/충돌 건수
- **이 결과가 "1차 AI 분석 결과"이며, 사진 분석과 추가자료 교차검증은 포함되지 않았다는 점**
  (완료된 정식 검수 결과처럼 말하지 않는다)
- 통합 과정에서 정보불일치(conflict)가 있었다면 어떤 항목인지

## 유지보수 메모 (damage-report-analyzer 저장소 작업자용)

`analyzeReport.bundle.cjs`는 이 저장소의 `scripts/analyzeReport.ts`(그리고 그것이 import하는
`src/lib/normalize.ts`/`mergeDuplicates.ts`/`report/exportExcel|Word|Pdf.ts`)를 esbuild로
번들링한 결과물이다. 원본 로직을 여기 직접 수정하지 말고, `scripts/analyzeReport.ts` 쪽을
고친 뒤 저장소 루트에서 다음 명령으로 다시 번들링한다:

```bash
npx esbuild scripts/analyzeReport.ts --bundle --platform=node --format=cjs --target=node18 --outfile=.claude/skills/report-damage-analysis/analyzeReport.bundle.cjs
```

(ESM `--format=esm`이 아니라 **CJS**로 빌드해야 한다 — `xlsx` 패키지가 조건부 `require("stream")`
같은 동적 require를 쓰는데, esbuild의 ESM 출력은 이를 지원하지 않아 실행 시
"Dynamic require ... is not supported" 오류가 난다.)

위 "추출 규칙"/"출력 형식" 절은 `src/lib/aiPrompt.ts`의 `buildExtractionPrompt()`에서 복사한
것이다 — 그쪽 규칙이 바뀌면 이 파일도 함께 갱신해야 한다(독립 실행형으로 만들기 위한 트레이드
오프: 매번 원본을 읽어오는 대신 내용을 이 파일에 고정해서 복사해 두었다).
