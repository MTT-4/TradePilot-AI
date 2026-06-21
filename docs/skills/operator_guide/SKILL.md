# operator_guide

面向平台操作人员的问答智能体。

## 落点

- 服务：`apps/web/server/agents/operator-guide.ts`
- 路由：`apps/web/app/api/skills/operator-guide/route.ts`
- 页面：`apps/web/app/operator-guide/*`

## 输入

- `question: string`

## 输出

- `answer`
- `next_actions[]`
- `suggested_questions[]`
- `source_files[]`

## 约束

- 仅回答平台怎么操作、去哪操作、流程顺序和注意事项。
- 只基于内置资料回答；资料不足时明确说无法确认。
- 资料按 `INTERNAL_ONLY` 走本地模型，不外发项目内部信息。
- 不代替审批，不自动确认价格/交期/认证等关键承诺。
