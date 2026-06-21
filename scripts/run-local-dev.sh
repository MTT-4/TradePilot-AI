#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "==> 启动本地依赖（Postgres / Redis / MinIO）"
docker compose up -d

if ! lsof -nP -iTCP:8082 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "==> 启动本地 bge-m3（8082）"
  mkdir -p tmp
  nohup bash "$ROOT_DIR/scripts/run-bge-local.sh" >/tmp/tradepilot-bge.log 2>&1 &
  sleep 2
fi

if lsof -nP -iTCP:8082 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK：bge-m3 已在线（8082）"
else
  echo "警告：bge-m3 仍未在线，请检查 /tmp/tradepilot-bge.log"
fi

if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK：Qwen 已在线（8080）"
else
  echo "提醒：Qwen（8080）未在线。隐私链路会 fail-closed。"
  echo "请按 README 的 llama-server 命令手动启动本地 Qwen。"
fi

echo "==> 启动 Web（http://localhost:3100）"
exec npm run dev
