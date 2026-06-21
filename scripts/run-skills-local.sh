#!/usr/bin/env bash
#
# run-skills-local.sh
# 一键起本地依赖并联调 G1–G5 新增的本地 skill 接口（全部本地、零外部服务）。
# 用法：
#   bash scripts/run-skills-local.sh check    # 仅跑 lint + typecheck（不需 DB）
#   bash scripts/run-skills-local.sh commit    # 解锁 git 并提交 G1–G5 新增代码与文档
#   bash scripts/run-skills-local.sh up        # 起依赖 + seed + dev
#   bash scripts/run-skills-local.sh smoke      # 接口冒烟测试（需先登录拿 cookie，见下）
#
# 推荐顺序：check → commit → up / npm run dev:local →（确认 Qwen 在线）→ smoke
#
# 前置：Node 22、Docker、以及按 README 起好的本地 Qwen（llama-server: localhost:8080）。

set -euo pipefail
cd "$(dirname "$0")/.."

ACTION="${1:-up}"

unlock_git() {
  # 清理沙箱/异常退出残留的 git 锁（如有）。
  [ -f .git/index.lock ] && rm -f .git/index.lock || true
  [ -f .git/HEAD.lock ] && rm -f .git/HEAD.lock || true
}

case "$ACTION" in
  check)
    echo "==> lint + typecheck（不需数据库）"
    npm run lint
    npm run typecheck
    echo "OK：代码可编译、规范通过。"
    ;;

  commit)
    unlock_git
    echo "==> 暂存全部改动（git add -A，.gitignore 会自动排除 .env 等密钥）"
    echo "    本次工作树含 skills(G1–G5)、中文化、以及 codex 另建的 operator-guide /"
    echo "    tech-assistant / agents / hitl 等。先看一眼将提交的内容："
    git add -A
    echo "------ 即将提交的文件 ------"
    git status --short
    echo "---------------------------"
    echo "确认无误后回车提交，或 Ctrl+C 取消。"
    read -r _
    git commit -m "feat: TradePilot skills(G1-G5) + localization + agent/hitl features"
    echo "OK：已提交。git log -1 查看。"
    ;;

  up)
    command -v nvm >/dev/null 2>&1 && nvm use || echo "（跳过 nvm，请确认 Node 22）"
    [ -f .env ] || cp .env.example .env
    echo "==> 启动本地依赖（Postgres / Redis / MinIO）"
    docker compose up -d
    echo "==> 生成 Prisma client 并写入演示数据"
    npm run prisma:generate
    npm run prisma:seed
    echo
    echo "提醒：另开一个终端按 README 起本地 Qwen（llama-server --port 8080 ...），"
    echo "      否则 inquiry-detection / 回复生成等会 fail-closed（隐私优先，不外发）。"
    echo
    echo "==> 启动 Web（http://localhost:3100）"
    echo "    登录：owner-a@tradepilot.local / TradePilot@2026"
    npm run dev
    ;;

  smoke)
    # 冒烟测试：next-auth 是会话登录，需先在浏览器登录后从开发者工具复制 Cookie，
    # 并填入下面的 COOKIE 与 TENANT。INQ 填一条真实询盘 id。
    : "${BASE:=http://localhost:3100}"
    : "${COOKIE:?请先 export COOKIE='next-auth.session-token=...'}"
    : "${TENANT:?请先 export TENANT='<你的租户id>'}"
    INQ="${INQ:-}"
    H=(-H "Cookie: $COOKIE" -H "X-Tenant-Id: $TENANT" -H "Content-Type: application/json")

    echo "== compliance-risk（无需询盘）=="
    curl -s "${H[@]}" -X POST "$BASE/api/skills/compliance-risk" \
      -d '{"product":"LED panel light","markets":["EU"],"country":"DE"}' | head -c 800; echo

    echo "== hs-code =="
    curl -s "${H[@]}" "$BASE/api/skills/hs-code?q=led+panel+light" | head -c 400; echo

    echo "== currency-rate =="
    curl -s "${H[@]}" "$BASE/api/skills/currency-rate?from=USD&to=EUR&amount=100" | head -c 400; echo

    echo "== quotation（给成本基准，AI 不出价由规则算）=="
    curl -s "${H[@]}" -X POST "$BASE/api/skills/quotation" \
      -d '{"product":"LED panel","quantity":"5000","baseUnitCost":8,"marginPercent":25}' | head -c 800; echo

    echo "== analytics: funnel =="
    curl -s "${H[@]}" "$BASE/api/skills/analytics?report=funnel" | head -c 600; echo

    if [ -n "$INQ" ]; then
      echo "== inquiry-detection（需本地 Qwen）=="
      curl -s "${H[@]}" -X POST "$BASE/api/skills/inquiry-detection" -d "{\"inquiryId\":\"$INQ\"}" | head -c 800; echo
      echo "== crm-auto-entry =="
      curl -s "${H[@]}" -X POST "$BASE/api/skills/crm-auto-entry" -d "{\"inquiryId\":\"$INQ\"}" | head -c 600; echo
      echo "== follow-up（仅生成计划，不落库）=="
      curl -s "${H[@]}" -X POST "$BASE/api/skills/follow-up" -d "{\"inquiryId\":\"$INQ\"}" | head -c 600; echo
    else
      echo "（设 INQ=<询盘id> 可继续测 inquiry-detection / crm-auto-entry / follow-up）"
    fi
    ;;

  *)
    echo "未知动作：$ACTION（可选 check | commit | up | smoke）"; exit 1;;
esac

unlock_git
