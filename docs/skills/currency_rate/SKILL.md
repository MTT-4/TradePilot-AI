# Tool: currency_rate（汇率换算）

## 目标
为报价场景提供参考汇率换算。全本地，mock 起步。

## 实现落点
- `apps/web/server/currency/service.ts`（convertCurrency）+ `GET /api/skills/currency-rate?from=&to=&amount=`

## 输入 / 输出
- 输入：from、to（币种码），amount（可选）。
- 输出：rate、converted、source="mock"、asOf、disclaimer。

## 风险控制
- 返回值恒带 `disclaimer`：**参考汇率（mock），非实时成交汇率，报价前须人工确认。**
- 真实汇率源后续经环境变量接入，不硬编码密钥。
