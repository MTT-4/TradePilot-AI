#!/bin/bash

echo "========== TradePilot AI 工具复查 =========="

for cmd in \
brew \
git \
gh \
node \
npm \
pnpm \
uv \
docker \
psql \
redis-server \
minio \
mc \
llama-server \
llama-cli \
jq \
yq \
tree \
rg \
fd \
wget \
curl \
openssl \
codex \
claude
do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "✅ $cmd: $($cmd --version 2>/dev/null | head -n 1)"
  else
    echo "❌ $cmd 未找到"
  fi
done

echo ""
echo "========== npm 全局包 =========="
npm list -g --depth=0 2>/dev/null || true

echo ""
echo "========== 端口检查 =========="
for port in 3000 3100 5432 6379 9000 9001 8080 8081 8082 8025; do
  if lsof -i :"$port" >/dev/null 2>&1; then
    echo "⚠️ 端口 $port 已占用"
    lsof -i :"$port" | head -n 3
  else
    echo "✅ 端口 $port 空闲"
  fi
done

echo ""
echo "========== Docker 容器 =========="
docker ps -a 2>/dev/null || true

echo ""
echo "========== 检查完成 =========="
