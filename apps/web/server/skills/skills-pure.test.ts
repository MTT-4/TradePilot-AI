import { describe, expect, it } from "vitest";
import { normalizeLimit, parsePositiveIntegerParam } from "@/server/skills/access";
import { convertCurrency } from "@/server/currency/service";
import {
  lookupCertifications,
  screenCountry,
  suggestHsCode,
} from "@/server/compliance/rules";

/**
 * G1–G5 新增代码的纯逻辑单元测试（不依赖 DB / 模型）。
 * 覆盖：limit 校验、汇率换算、认证/HS Code 查询、出口国筛查。
 */

describe("normalizeLimit", () => {
  it("缺省回退到 fallback", () => {
    expect(normalizeLimit(undefined, 50, 200)).toBe(50);
  });
  it("正常值原样返回", () => {
    expect(normalizeLimit(5, 50, 200)).toBe(5);
  });
  it("超上限夹到 max", () => {
    expect(normalizeLimit(9999, 50, 200)).toBe(200);
  });
  it("0 夹到 1", () => {
    expect(normalizeLimit(0, 50, 200)).toBe(1);
  });
  it("NaN 回退 fallback（防 Prisma 收到坏值）", () => {
    expect(normalizeLimit(Number.NaN, 50, 200)).toBe(50);
  });
  it("小数向下取整", () => {
    expect(normalizeLimit(3.7, 50, 200)).toBe(3);
  });
});

describe("parsePositiveIntegerParam", () => {
  it("空值返回 undefined", () => {
    expect(parsePositiveIntegerParam(null, "limit")).toBeUndefined();
    expect(parsePositiveIntegerParam("", "limit")).toBeUndefined();
  });
  it("合法正整数", () => {
    expect(parsePositiveIntegerParam("10", "limit")).toBe(10);
  });
  it("非法值抛 400", () => {
    expect(() => parsePositiveIntegerParam("abc", "limit")).toThrow();
    expect(() => parsePositiveIntegerParam("0", "limit")).toThrow();
    expect(() => parsePositiveIntegerParam("-5", "limit")).toThrow();
    expect(() => parsePositiveIntegerParam("1.5", "limit")).toThrow();
  });
});

describe("convertCurrency", () => {
  it("USD->EUR 有汇率与换算", () => {
    const r = convertCurrency({ from: "USD", to: "EUR", amount: 100 });
    expect(r.source).toBe("mock");
    expect(r.rate).toBeGreaterThan(0);
    expect(r.converted).toBeCloseTo(100 * r.rate, 2);
    expect(r.disclaimer).toContain("人工确认");
  });
  it("同币种 rate=1", () => {
    expect(convertCurrency({ from: "USD", to: "USD" }).rate).toBe(1);
  });
  it("不支持币种抛错", () => {
    expect(() => convertCurrency({ from: "USD", to: "ZZZ" })).toThrow();
  });
});

describe("compliance rules", () => {
  it("LED 灯命中 HS Code 9405", () => {
    const codes = suggestHsCode("LED panel light").map((c) => c.code);
    expect(codes).toContain("9405");
  });
  it("LED 灯进欧盟命中 CE / RoHS", () => {
    const certs = lookupCertifications("led light", ["EU"]).map((c) => c.code);
    expect(certs).toContain("CE");
    expect(certs).toContain("RoHS");
  });
  it("市场不匹配则不返回该认证", () => {
    const certs = lookupCertifications("led light", ["US"]).map((c) => c.code);
    expect(certs).not.toContain("CE");
  });
  it("出口国恒提示筛查；受限国额外警示", () => {
    expect(screenCountry("de").needs_screening).toBe(true);
    expect(screenCountry("ir").note).toContain("制裁");
  });
});
