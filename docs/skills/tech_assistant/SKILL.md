# tech_assistant

面向技术人员的项目问答智能体。

## 落点

- 服务：`apps/web/server/agents/tech-assistant.ts`
- 路由：`apps/web/app/api/skills/tech-assistant/route.ts`
- 页面：`apps/web/app/tech-assistant/*`

## 输入

- `question: string`

## 输出

- `answer`
- `source_files[]`
- `commands[]`
- `caveats[]`

## 约束

- 仅回答架构、目录、API、命令、排障、联调与开发约定。
- 只基于项目内置资料回答；资料不足时明确说无法确认。
- 资料按 `INTERNAL_ONLY` 走本地模型，不外发项目内部信息。
- 默认要求 `OPERATOR` 及以上角色。
