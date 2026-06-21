type OperatorGuideAnswerLike = {
  answer: string;
  next_actions: string[];
  suggested_questions: string[];
  source_files: string[];
};

function normalizeQuestion(question: string) {
  return question.trim().toLowerCase();
}

export function getOperatorGuidePlaybook(question: string): OperatorGuideAnswerLike | null {
  const normalized = normalizeQuestion(question);

  if (
    (normalized.includes("crm") || normalized.includes("询盘")) &&
    normalized.includes("首响")
  ) {
    return {
      answer: [
        "从 CRM 进入首响审批，按这个顺序操作：",
        "1. 进入 `/crm`，先在询盘列表里找到目标询盘或线索。",
        "2. 在列表行或详情抽屉里点击“用 AI 起草首响”。",
        "3. 系统会生成首响草稿，并把任务放入 `/replies`。",
        "4. 进入 `/replies` 审阅草稿，可编辑、拒绝，或确认发送。",
        "5. 对外发送仍走现有 HITL 审批流，不是 AI 直接外发。",
        "",
        "注意：客户姓名、电话、询盘正文属于隐私数据，只能走本地 Qwen；报价、交期、认证等关键承诺也必须人工确认。",
      ].join("\n"),
      next_actions: [
        "先去 /crm 找到目标询盘并触发“用 AI 起草首响”。",
        "再去 /replies 审阅草稿并走审批发送。",
      ],
      suggested_questions: [
        "如果我要补知识库资料，应该先去哪一页？",
        "首响草稿被拒绝后，下一步怎么处理？",
      ],
      source_files: [
        "built_in/operator-handbook",
        "apps/web/app/crm/crm-client.tsx",
        "apps/web/app/replies/replies-client.tsx",
      ],
    };
  }

  if (
    normalized.includes("上传") ||
    normalized.includes("补产品资料") ||
    normalized.includes("知识库")
  ) {
    return {
      answer: [
        "补产品资料或上传内部资料，优先走知识库审核页：`/kb/reviews`。",
        "操作顺序：上传资料 -> 等待解析/入库 -> 在审核页确认内容和标签 -> 标记已核准 -> 再回站点、内容包或首响环节使用。",
        "如果资料含报价、内部案例或未公开信息，需标成仅内部，这类内容只允许本地路径使用，不能外发到公开营销生成。",
      ].join("\n"),
      next_actions: [
        "进入 /kb/reviews 上传文件或网址。",
        "完成审核后，再回业务页面继续生成内容或回复。",
      ],
      suggested_questions: [
        "发布内容前，我应该检查哪几个页面？",
        "站点上线审批要去哪里处理？",
      ],
      source_files: [
        "built_in/operator-handbook",
        "docs/HANDOVER.md",
      ],
    };
  }

  if (
    normalized.includes("发布") ||
    normalized.includes("上线") ||
    normalized.includes("内容前")
  ) {
    return {
      answer: [
        "发布前建议按这条路径检查：",
        "1. `/design`：先确认内容包是否准备好。",
        "2. `/sites`：如果是站点内容，确认站点草稿和站内改动。",
        "3. `/publish-checklist`：统一查看待发布、待上线、待审批事项。",
        "4. `/notifications`：确认有没有阻塞提醒。",
        "5. `/hitl` 或对应审批入口：完成最终人工审批。",
        "",
        "不要跳过审批；所有对外发送和发布动作都要经过现有 HITL。",
      ].join("\n"),
      next_actions: [
        "先在 /design 或 /sites 检查内容本体。",
        "再到 /publish-checklist 收口处理待发布事项。",
      ],
      suggested_questions: [
        "通知中心里的提醒怎么处理？",
        "设置页里哪些治理项需要管理员维护？",
      ],
      source_files: [
        "built_in/operator-handbook",
        "docs/HANDOVER.md",
      ],
    };
  }

  return null;
}
