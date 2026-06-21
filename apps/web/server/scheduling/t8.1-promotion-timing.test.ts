import { describe, it, expect } from "vitest";
import {
  getPromotionHolidays,
  recommendPromotionTiming,
  COUNTRY_PROFILES,
  inferPromotionCountry,
  suggestNextPromotionTime,
} from "@/server/scheduling/promotion-timing";

describe("T8.1 promotion timing recommender", () => {
  it("returns localized windows + timezone for a known country", () => {
    const r = recommendPromotionTiming({
      country: "ae",
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(r.countryName).toBe("阿联酋");
    expect(r.timezone).toBe("Asia/Dubai");
    expect(r.recommendedWindows.length).toBeGreaterThan(0);
    expect(r.recommendedWindows[0].label).toContain("当地时间");
    expect(r.weekendLabels).toContain("周六");
  });

  it("only surfaces holidays within the horizon window", () => {
    const near = recommendPromotionTiming({
      country: "AE",
      now: new Date("2026-11-20T00:00:00Z"),
      horizonDays: 30,
    });
    expect(near.upcomingHolidays.some((h) => h.name.includes("国庆"))).toBe(true);

    const far = recommendPromotionTiming({
      country: "AE",
      now: new Date("2026-06-01T00:00:00Z"),
      horizonDays: 30,
    });
    expect(far.upcomingHolidays.some((h) => h.name.includes("国庆"))).toBe(false);
  });

  it("labels leverage vs avoid advice in Chinese", () => {
    const r = recommendPromotionTiming({
      country: "SA",
      now: new Date("2026-09-01T00:00:00Z"),
      horizonDays: 60,
    });
    const national = r.upcomingHolidays.find((h) => h.name.includes("国庆"));
    expect(national?.adviceLabel).toBe("建议借势");
  });

  it("falls back gracefully for unknown countries", () => {
    const r = recommendPromotionTiming({
      country: "ZZ",
      now: new Date("2026-06-01T00:00:00Z"),
    });
    expect(r.country).toBe("ZZ");
    expect(r.recommendedWindows.length).toBeGreaterThan(0);
    expect(r.dataCaveat).toContain("兜底");
  });

  it("ships starter data for all three target markets", () => {
    for (const code of ["AE", "SA", "BR", "MX", "RU", "DE"]) {
      expect(COUNTRY_PROFILES[code]).toBeTruthy();
    }
  });

  it("infers a country from broad market text", () => {
    expect(inferPromotionCountry("Middle East")).toBe("AE");
    expect(inferPromotionCountry("Russia")).toBe("RU");
    expect(inferPromotionCountry("")).toBeNull();
  });

  it("suggests the next upcoming promotion slot in UTC", () => {
    const next = suggestNextPromotionTime({
      country: "AE",
      now: new Date("2026-06-01T00:00:00Z"),
    });

    expect(next?.plannedAt.toISOString()).toBeTruthy();
    expect(next?.windowLabel).toContain("当地时间");
    expect(next?.plannedAt.getTime()).toBeGreaterThan(
      new Date("2026-06-01T00:00:00Z").getTime(),
    );
  });

  it("allows tenant holiday overrides to replace default reminders", () => {
    const holidays = getPromotionHolidays({
      AE: [
        {
          date: "2026-11-25",
          name: "租户自定义促销节点",
          advice: "leverage",
        },
      ],
    });
    const result = recommendPromotionTiming({
      country: "AE",
      now: new Date("2026-11-20T00:00:00Z"),
      horizonDays: 10,
      holidays,
    });

    expect(result.upcomingHolidays).toHaveLength(1);
    expect(result.upcomingHolidays[0]?.name).toBe("租户自定义促销节点");
  });
});
