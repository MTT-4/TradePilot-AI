# TradePilot AI 本地服务器项目

TradePilot AI 是一个本地优先、可迁移的 AI 外贸营销获客平台。当前仓库已完成 `T0.1` 脚手架：Next.js App Router、TypeScript、Tailwind、环境变量校验、`/api/health` 探活、Docker Compose 本地依赖和基础检查脚本。

## 目录结构

- `apps/web`: Next.js 控制台与 API
- `docs`: 需求、契约、架构和验收文档
- `prisma`: Prisma schema 占位
- `tests`: API / E2E 测试目录占位
- `tools/check`: 环境检查脚本

## 本地启动

1. 使用 Node 22。
2. 复制环境变量模板。
3. 安装依赖并启动本地基础设施。
4. 启动本地 Qwen 与 bge-m3 端点。
5. 运行 Web 应用。

```bash
nvm use
cp .env.example .env
npm install
docker compose up -d
npm run dev
```

如果你希望把 Docker、本地 bge-m3、Web dev 一起收口，可以直接执行：

```bash
npm run dev:local
```

说明：
- 这条命令会自动启动 Docker 依赖
- 如果 `8082` 没在线，会自动拉起本地 `bge-m3`
- 如果 `8080` 的 Qwen 没在线，只会提示，不会自动代起
- Web 控制台仍运行在 `http://localhost:3100`

Web 控制台默认运行在 `http://localhost:3100`。

## llama.cpp 端点示例

下面的命令是当前仓库约定的本地端口，模型文件名请按你本机实际文件替换：

```bash
llama-server \
  --host 0.0.0.0 \
  --port 8080 \
  --model "$HOME/AI/models/Qwen_Qwen2.5-VL-32B-Instruct-Q8_0.gguf" \
  --alias "$LOCAL_QWEN_MODEL"

llama-server \
  --host 0.0.0.0 \
  --port 8082 \
  --embedding \
  --model "/path/to/your/bge-m3.gguf" \
  --alias "$LOCAL_BGE_MODEL"
```

如果你的 Qwen 变体需要 `mmproj`，在第一条命令里追加 `--mmproj /path/to/mmproj.gguf`。

## bge-m3 本地端点补充

如果你本机已经有 `bge-m3.gguf`，可以继续按上面的 `llama-server --embedding` 方式起 `8082`。

如果你本机像当前仓库一样，只有 `~/AI/models/bge-m3` 这种 Hugging Face / ONNX 目录，没有 GGUF 文件，
可以直接用仓库自带脚本起一个本地 OpenAI-compatible embedding 端点：

```bash
python3 -m venv tmp/bge-server-venv
source tmp/bge-server-venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy onnxruntime tokenizers
python scripts/bge_m3_local_server.py --host 0.0.0.0 --port 8082
```

也可以直接用仓库脚本：

```bash
npm run serve:bge-local
```

默认读取目录：

```text
$HOME/AI/models/bge-m3
```

启动后可用下面两个接口自检：

```bash
curl http://localhost:8082/health
curl http://localhost:8082/v1/models
```

项目里的 `LOCAL_BGE_BASE_URL=http://localhost:8082/v1`、`LOCAL_BGE_MODEL=bge-m3` 可直接复用，不需要改业务代码。

## 检查命令

- `npm run check`: 运行 lint、typecheck、test
- `npm run dev`: 使用根目录 `.env` 启动 `apps/web`
- `bash tools/check/check_mac_env.sh`: 输出当前 Mac 环境检查报告

## 探活接口

启动依赖后访问：

```text
GET /api/health
```

健康时返回：

```json
{
  "status": "ok",
  "db": "up",
  "redis": "up"
}
```
