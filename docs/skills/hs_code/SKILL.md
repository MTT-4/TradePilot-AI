# Tool: hs_code（HS Code 候选）

## 目标
根据产品关键词给出章节级 HS Code 候选，供业务员初步参考。

## 实现落点
- `apps/web/server/compliance/rules.ts`（suggestHsCode）
- `GET /api/skills/hs-code?q=`

## 输入 / 输出
- 输入：`q` 产品描述。
- 输出：`query`、`candidates`、`disclaimer`。

## 风险控制
- 仅作为参考候选，不输出最终报关结论。
- 返回值恒带合规免责声明，要求人工或专业机构复核。
- 只读静态规则，不调用第三方服务。
