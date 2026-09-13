import type { RawDamageGroup } from "../types";
import { parseLocationBlock, parseLocationList } from "./normalize";

/** 개발 스펙 14번 항목의 목표 결과를 재현하는 샘플 데이터 (AI/PDF 없이 화면 검증용). */
export const SAMPLE_GROUPS: RawDamageGroup[] = [
  {
    groupNo: "①",
    section: "1구간",
    damageName: "기붕괴흔",
    part: "사면하부",
    repairMethod: "주의관찰",
    quantityGroupTotal: null,
    locations: [{ subPart: "-", location: "110m", quantity: "25㎥" }],
    photoCount: 2,
    sourcePages: [78],
    sourceReferences: [{ page: 78, type: "table" }],
  },
  {
    groupNo: "②",
    section: "1구간",
    damageName: "식생불량",
    part: "사면하부",
    repairMethod: "주의관찰",
    quantityGroupTotal: null,
    locations: [
      { subPart: "-", location: "48~154m", quantity: "1,568㎡" },
      { subPart: "-", location: "300~343m", quantity: null },
    ],
    photoCount: 4,
    sourcePages: [79],
    sourceReferences: [{ page: 79, type: "table" }],
  },
  {
    groupNo: "③",
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    repairMethod: "주입보수",
    quantityGroupTotal: "23.3m",
    locations: parseLocationBlock(
      "165, 187, 188, 190, 217, 261, 267, 275m\n도수로 208m\n산마루측구 211, 323m",
      "소단측구"
    ),
    photoCount: 8,
    sourcePages: [80, 81],
    sourceReferences: [
      { page: 80, type: "table" },
      { page: 81, type: "conclusion" },
    ],
  },
  {
    groupNo: "④",
    section: "1구간",
    damageName: "낙엽·이물질 집적",
    part: "배수시설",
    repairMethod: "배수로 정비",
    quantityGroupTotal: "37.5m",
    locations: parseLocationList("65m, 176~206m", "소단측구"),
    photoCount: 2,
    sourcePages: [82],
    sourceReferences: [{ page: 82, type: "table" }],
  },
  {
    groupNo: "⑤",
    section: "1구간",
    damageName: "단차",
    part: "배수시설",
    repairMethod: "주의관찰",
    quantityGroupTotal: "3.4m",
    locations: parseLocationList("214, 227m", "소단측구"),
    photoCount: 2,
    sourcePages: [83],
    sourceReferences: [{ page: 83, type: "table" }],
  },
];
