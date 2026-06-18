#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT_DIR="$PROJECT_ROOT/runtime/logs"
REPORT="$REPORT_DIR/mac_env_check_$(date +%Y%m%d_%H%M%S).txt"

mkdir -p "$REPORT_DIR"

{
echo "========== TradePilot AI 本机环境检查 =========="
echo "检查时间: $(date)"
echo ""

echo "========== 1. Mac 基本信息 =========="
sw_vers
echo ""
system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Chip|Total Number of Cores|Memory|Serial Number" || true
echo ""

echo "========== 2. CPU / 内存 =========="
sysctl -n machdep.cpu.brand_string 2>/dev/null || true
sysctl hw.memsize | awk '{print "Memory GB:", $2/1024/1024/1024}'
echo ""

echo "========== 3. 磁盘空间 =========="
df -h /
echo ""
diskutil info / | grep -E "Volume Name|Total Size|Free Space|File System|Device Node" || true
echo ""

echo "========== 4. 项目目录 =========="
echo "PROJECT=$PROJECT_ROOT"
if [ -d "$PROJECT_ROOT" ]; then
  echo "✅ 项目目录存在"
  find "$PROJECT_ROOT" -maxdepth 2 -type d | sort
else
  echo "❌ 项目目录不存在"
fi
echo ""

echo "========== 5. 模型目录 =========="
if [ -d "$HOME/AI/models" ]; then
  echo "✅ 模型目录存在: $HOME/AI/models"
  find "$HOME/AI/models" -maxdepth 2 -type f | sed "s#$HOME/AI/models/##" | head -n 100
else
  echo "❌ 模型目录不存在: $HOME/AI/models"
fi
echo ""

echo "========== 6. Homebrew =========="
if command -v brew >/dev/null 2>&1; then
  echo "✅ brew 已安装"
  brew --version
else
  echo "❌ brew 未安装"
fi
echo ""

echo "========== 7. Git / GitHub =========="
command -v git >/dev/null 2>&1 && git --version || echo "❌ git 未安装"
command -v gh >/dev/null 2>&1 && gh --version | head -n 1 || echo "❌ gh 未安装"
echo ""

echo "========== 8. Node / pnpm / npm =========="
command -v node >/dev/null 2>&1 && node -v || echo "❌ node 未安装"
command -v npm >/dev/null 2>&1 && npm -v || echo "❌ npm 未安装"
command -v pnpm >/dev/null 2>&1 && pnpm -v || echo "❌ pnpm 未安装"
command -v corepack >/dev/null 2>&1 && corepack --version || echo "❌ corepack 未安装"
echo ""

echo "========== 9. Python / uv =========="
command -v python3 >/dev/null 2>&1 && python3 --version || echo "❌ python3 未安装"
command -v uv >/dev/null 2>&1 && uv --version || echo "❌ uv 未安装"
echo ""

echo "========== 10. Docker =========="
if command -v docker >/dev/null 2>&1; then
  echo "✅ docker 已安装"
  docker --version
  docker compose version 2>/dev/null || echo "⚠️ docker compose 不可用"
  docker info >/dev/null 2>&1 && echo "✅ Docker 正在运行" || echo "❌ Docker 未启动"
else
  echo "❌ docker 未安装"
fi
echo ""

echo "========== 11. PostgreSQL / Redis / MinIO =========="
command -v psql >/dev/null 2>&1 && psql --version || echo "❌ psql 未安装"
command -v redis-server >/dev/null 2>&1 && redis-server --version || echo "❌ redis-server 未安装"
command -v minio >/dev/null 2>&1 && minio --version || echo "❌ minio 未安装"
command -v mc >/dev/null 2>&1 && mc --version || echo "❌ mc 未安装"
echo ""

echo "========== 12. llama.cpp =========="
command -v llama-server >/dev/null 2>&1 && llama-server --version || echo "❌ llama-server 未安装"
command -v llama-cli >/dev/null 2>&1 && llama-cli --version || echo "❌ llama-cli 未安装"
echo ""

echo "========== 13. Codex / Claude =========="
command -v codex >/dev/null 2>&1 && codex --version || echo "❌ codex 未安装"
command -v claude >/dev/null 2>&1 && claude --version || echo "❌ claude 未安装"
echo ""

echo "========== 14. 常用工具 =========="
for cmd in jq yq tree rg fd wget curl openssl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "✅ $cmd: $($cmd --version 2>/dev/null | head -n 1)"
  else
    echo "❌ $cmd 未安装"
  fi
done
echo ""

echo "========== 15. 端口占用检查 =========="
for port in 3000 3100 5432 6379 9000 9001 8080 8081 8082 8025; do
  if lsof -i :"$port" >/dev/null 2>&1; then
    echo "⚠️ 端口 $port 已被占用"
    lsof -i :"$port" | head -n 5
  else
    echo "✅ 端口 $port 空闲"
  fi
done
echo ""

echo "========== 16. Docker 容器 =========="
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker ps -a
else
  echo "Docker 不可用，跳过容器检查"
fi
echo ""

echo "========== 17. npm 全局包 =========="
if command -v npm >/dev/null 2>&1; then
  npm list -g --depth=0 2>/dev/null || true
else
  echo "npm 不可用"
fi
echo ""

echo "========== 18. 检查完成 =========="
echo "报告文件: $REPORT"
} | tee "$REPORT"

open "$REPORT"
