import { ApiError } from "@/server/api/errors";

/**
 * Tool: currency_rate（汇率工具）
 * 纯本地、纯新增。第一版用 mock 表；真实源后续可经环境变量接入（如 CURRENCY_RATE_BASE_URL）。
 * 报价场景只作参考：返回值带 source 与 asOf，调用方须人工确认汇率时点。
 */

// 相对 USD 的静态参考汇率（1 USD = X 目标币）。仅 mock，禁止当作实时成交汇率。
const MOCK_USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CNY: 7.18,
  JPY: 156.0,
  AED: 3.67,
  SAR: 3.75,
  RUB: 92.0,
  INR: 83.3,
  HKD: 7.81,
};

export type ConversionResult = {
  from: string;
  to: string;
  rate: number;
  amount: number | null;
  converted: number | null;
  source: "mock";
  asOf: string;
  disclaimer: string;
};

function rate(from: string, to: string): number {
  const f = MOCK_USD_RATES[from.toUpperCase()];
  const t = MOCK_USD_RATES[to.toUpperCase()];
  if (f == null || t == null) {
    throw new ApiError(
      400,
      "UNSUPPORTED_CURRENCY",
      `Unsupported currency. Supported: ${Object.keys(MOCK_USD_RATES).join(", ")}.`,
    );
  }
  // from -> USD -> to
  return Math.round((t / f) * 1e6) / 1e6;
}

export function convertCurrency(params: {
  from: string;
  to: string;
  amount?: number;
}): ConversionResult {
  const r = rate(params.from, params.to);
  const amount = params.amount ?? null;
  return {
    from: params.from.toUpperCase(),
    to: params.to.toUpperCase(),
    rate: r,
    amount,
    converted: amount == null ? null : Math.round(amount * r * 100) / 100,
    source: "mock",
    asOf: new Date().toISOString().slice(0, 10),
    disclaimer: "参考汇率（mock），非实时成交汇率，报价前须人工确认。",
  };
}
