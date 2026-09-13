import { describe, expect, it } from "vitest";
import { deriveDamagePhotoLinks, manuallyLinkPhoto, manuallyUnlinkPhoto, matchPhotosToDamages, setDamageNoPhoto } from "./matchPhotos";
import type { DamageRecord, ExtractedPhoto } from "../types";

function damage(overrides: Partial<DamageRecord>): DamageRecord {
  return {
    id: "③-01",
    groupNo: "③",
    groupIndex: 1,
    section: "1구간",
    damageName: "균열",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    repairMethod: "주입보수",
    quantity: null,
    quantityGroup: "23.3m",
    photos: [],
    status: "review",
    sourcePages: [80],
    sourceReferences: [],
    ...overrides,
  };
}

function photo(overrides: Partial<ExtractedPhoto>): ExtractedPhoto {
  return {
    id: "P001",
    sourceFile: "report.pdf",
    page: 120,
    photoNo: "③-01",
    caption: "소단측구 균열 165m",
    section: "1구간",
    part: "배수시설",
    subPart: "소단측구",
    location: "165m",
    damageName: "균열",
    image: { dataUrl: "", width: 100, height: 100 },
    damageRelated: true,
    nearbyText: "③-01 소단측구 균열 165m",
    ocrText: null,
    ocrConfidence: null,
    visionInference: null,
    sourceRef: { page: 120 },
    duplicateCandidate: false,
    duplicateOfIds: [],
    matchCandidates: [],
    linkedDamageIds: [],
    status: "review",
    extractionStatus: "ok",
    ...overrides,
  };
}

describe("matchPhotosToDamages — STEP 7", () => {
  it("TEST1: full agreement auto-links (confirmed)", () => {
    const d = damage({});
    const p = photo({});
    const { damages, photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].matchStatus).toBe("confirmed");
    expect(photos[0].linkedDamageIds).toEqual(["③-01"]);
    expect(damages[0].photoIds).toEqual(["P001"]);
    expect(damages[0].photoMatchStatus).toBe("confirmed");
  });

  it("TEST2: one damage, multiple matching photos all link", () => {
    const d = damage({});
    const p1 = photo({ id: "P001", caption: "소단측구 균열 165m 전체 모습" });
    const p2 = photo({ id: "P002", caption: "소단측구 균열 165m 근접 사진" });
    const { damages, photos } = matchPhotosToDamages([d], [p1, p2]);
    expect(photos.every((p) => p.matchStatus === "confirmed")).toBe(true);
    expect(damages[0].photoIds?.sort()).toEqual(["P001", "P002"]);
  });

  it("TEST3: one photo can link to multiple damages when evidence supports both", () => {
    const d1 = damage({ id: "③-01", location: "165m" });
    const d2 = damage({ id: "③-02", location: "165m", damageName: "균열" });
    // 동일 위치/세부부위/손상명을 공유하는 두 손상 레코드에 대해 사진 하나가 둘 다와 강하게 일치
    const p = photo({ photoNo: "③-01" });
    const { photos } = matchPhotosToDamages([d1, d2], [p]);
    // photoNo만 d1과 정확히 일치하지만 나머지 필드는 둘 다 동일하므로 최소 d1은 confirmed여야 한다.
    expect(photos[0].linkedDamageIds).toContain("③-01");
  });

  it("TEST4: same damage name, different location must not auto-link", () => {
    const d = damage({ location: "165m" });
    const p = photo({ photoNo: null, location: "300m", caption: "균열" });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].linkedDamageIds).toEqual([]);
    expect(photos[0].matchStatus).not.toBe("confirmed");
  });

  it("TEST5: same photo number, different location -> conflict/review, not auto-confirmed", () => {
    const d = damage({ id: "③-09", location: "208m", subPart: "산마루측구" });
    const p = photo({ photoNo: "③-09", location: "211m", subPart: "산마루측구", caption: "산마루측구 균열 211m" });
    const { damages, photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].linkedDamageIds).toEqual([]);
    expect(photos[0].matchStatus).toBe("review");
    expect(photos[0].matchCandidates[0].conflict).toBe(true);
    expect(damages[0].photoMatchStatus).toBe("conflict");
  });

  it("TEST6: no photo number but caption/location match creates a candidate", () => {
    const d = damage({});
    const p = photo({ photoNo: null, caption: "소단측구 균열 165m" });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].matchCandidates.length).toBeGreaterThan(0);
  });

  it("TEST7: no photo number and little information -> review or unmatched, never a fabricated confirm", () => {
    const d = damage({});
    const p = photo({ photoNo: null, caption: "전경사진", subPart: null, location: null, damageName: null });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].matchStatus).not.toBe("confirmed");
  });

  it("TEST8: damage without any matching photo -> noPhoto", () => {
    const d = damage({ id: "D010-01", location: "320m" });
    const p = photo({ photoNo: null, caption: "전경사진", subPart: null, location: null, damageName: null });
    const { damages } = matchPhotosToDamages([d], [p]);
    expect(damages[0].photoIds).toEqual([]);
    expect(damages[0].photoMatchStatus).toBe("noPhoto");
  });

  it("TEST9: photo without any corresponding damage -> unmatched, not deleted", () => {
    const d = damage({ location: "165m", subPart: "소단측구" });
    const p = photo({ photoNo: null, caption: "옹벽 배부름", subPart: "옹벽", location: "900m", damageName: null });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos).toHaveLength(1);
    expect(photos[0].matchStatus).toBe("unmatched");
  });

  it("TEST10: 165m damage vs 208m photo must not auto-confirm", () => {
    const d = damage({ location: "165m" });
    const p = photo({ location: "208m", photoNo: "③-01" });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].matchStatus).not.toBe("confirmed");
  });

  it("TEST11: 165m damage vs 165m photo -> high confidence", () => {
    const d = damage({ location: "165m" });
    const p = photo({ location: "165m" });
    const { photos } = matchPhotosToDamages([d], [p]);
    expect(photos[0].confidence).toBeGreaterThan(0.9);
    expect(photos[0].matchStatus).toBe("confirmed");
  });

  it("TEST12: duplicate-candidate photos keep their own independent match state", () => {
    const d = damage({});
    const p1 = photo({ id: "P001", duplicateCandidate: true, duplicateOfIds: ["P002"] });
    const p2 = photo({ id: "P002", duplicateCandidate: true, duplicateOfIds: ["P001"] });
    const { photos } = matchPhotosToDamages([d], [p1, p2]);
    expect(photos.filter((p) => p.matchStatus === "confirmed")).toHaveLength(2);
    expect(photos.every((p) => p.duplicateCandidate)).toBe(true);
  });

  it("TEST13: manual override survives re-running the automatic matcher", () => {
    const d1 = damage({ id: "③-01", location: "165m" });
    const d2 = damage({ id: "③-02", location: "999m", subPart: "도수로" });
    let photos = [photo({ id: "P001", location: "999m", subPart: "도수로", photoNo: null, caption: null, damageName: null })];
    // 자동 분석으로는 d2와 약하게만 매칭됨
    let result = matchPhotosToDamages([d1, d2], photos);
    photos = result.photos;
    // 사용자가 수동으로 d1에 연결
    photos = manuallyLinkPhoto(photos, "P001", "③-01");
    // 자동 재분석을 다시 돌려도 수동 연결이 유지되어야 한다
    result = matchPhotosToDamages([d1, d2], photos);
    expect(result.photos[0].linkedDamageIds).toEqual(["③-01"]);
    expect(result.photos[0].manualOverride).toBe(true);
    expect(result.damages.find((d) => d.id === "③-01")?.photoIds).toEqual(["P001"]);
  });

  it("manual unlink and 'no photo' designation work and are reflected on the damage side", () => {
    const d = damage({});
    let photos = [photo({})];
    let result = matchPhotosToDamages([d], photos);
    photos = manuallyUnlinkPhoto(result.photos, "P001", "③-01");
    let damages = deriveDamagePhotoLinks(result.damages, photos);
    expect(damages[0].photoIds).toEqual([]);
    damages = setDamageNoPhoto(damages, "③-01", true);
    damages = deriveDamagePhotoLinks(damages, photos);
    expect(damages[0].photoMatchStatus).toBe("noPhoto");
  });

  it("TEST14 (regression smoke): running the matcher never drops damages or photos", () => {
    const damages = [damage({ id: "a" }), damage({ id: "b", location: "999m" })];
    const photos = [photo({ id: "P001" }), photo({ id: "P002", photoNo: null, caption: null })];
    const result = matchPhotosToDamages(damages, photos);
    expect(result.damages).toHaveLength(2);
    expect(result.photos).toHaveLength(2);
  });
});
