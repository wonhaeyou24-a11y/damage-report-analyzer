import type { AdditionalSourceType } from "../../types";

/**
 * STEP 8 — 파일명 + 내용 일부를 보고 추가자료 종류를 추정한다. 특정 업체의 파일명
 * 규칙에 의존하지 않고, 흔히 쓰이는 키워드만으로 느슨하게 분류한다. 확신이 낮으면
 * "기타" + 낮은 신뢰도로 남기고, 그래도 파일 자체는 계속 분석한다.
 */
const KEYWORD_RULES: { sourceType: AdditionalSourceType; keywords: string[] }[] = [
  { sourceType: "외관조사망도", keywords: ["외관조사망도", "조사망도", "망도"] },
  { sourceType: "사진대지", keywords: ["사진대지", "손상사진", "사진첩"] },
  { sourceType: "보수보강표", keywords: ["보수보강", "보강현황", "보수현황", "보강표", "보수표"] },
  { sourceType: "수량표", keywords: ["수량표", "수량산출", "물량표", "물량산출"] },
  { sourceType: "도면", keywords: ["도면", "평면도", "단면도"] },
  { sourceType: "종합결론", keywords: ["종합결론", "종합의견", "결론"] },
];

export function classifySourceType(fileName: string, contentSample: string): { sourceType: AdditionalSourceType; confidence: number } {
  for (const rule of KEYWORD_RULES) {
    const fileNameHit = rule.keywords.some((k) => fileName.includes(k));
    const contentHit = rule.keywords.some((k) => contentSample.includes(k));
    if (fileNameHit && contentHit) return { sourceType: rule.sourceType, confidence: 0.9 };
    if (fileNameHit) return { sourceType: rule.sourceType, confidence: 0.7 };
    if (contentHit) return { sourceType: rule.sourceType, confidence: 0.55 };
  }
  return { sourceType: "기타", confidence: 0.2 };
}
