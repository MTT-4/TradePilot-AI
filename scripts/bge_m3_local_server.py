#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


@dataclass
class AppState:
    model_alias: str
    model_dir: Path
    tokenizer: Tokenizer
    session: ort.InferenceSession
    max_length: int

    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        encoded = self.tokenizer.encode_batch(texts)
        token_counts = sum(len(item.ids) for item in encoded)

        padded_ids: list[list[int]] = []
        padded_masks: list[list[int]] = []
        target_len = min(
            self.max_length,
            max((len(item.ids) for item in encoded), default=1),
        )

        for item in encoded:
            ids = item.ids[:target_len]
            attention_mask = [1] * len(ids)
            pad_len = target_len - len(ids)
            if pad_len > 0:
                ids += [1] * pad_len
                attention_mask += [0] * pad_len

            padded_ids.append(ids)
            padded_masks.append(attention_mask)

        outputs = self.session.run(
            None,
            {
                "input_ids": np.asarray(padded_ids, dtype=np.int64),
                "attention_mask": np.asarray(padded_masks, dtype=np.int64),
            },
        )

        sentence_embeddings = outputs[1]
        norms = np.linalg.norm(sentence_embeddings, axis=1, keepdims=True)
        normalized = sentence_embeddings / np.clip(norms, 1e-12, None)
        vectors = normalized.astype(np.float32).tolist()
        return vectors, token_counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve local bge-m3 embeddings with an OpenAI-compatible API.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="bind host, default 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8082,
        help="bind port, default 8082",
    )
    parser.add_argument(
        "--model-dir",
        default=str(Path.home() / "AI/models/bge-m3"),
        help="directory containing tokenizer files and onnx/model.onnx",
    )
    parser.add_argument(
        "--alias",
        default="bge-m3",
        help="model alias returned by /v1/models and /v1/embeddings",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=2048,
        help="token truncation length, default 2048",
    )
    return parser.parse_args()


def build_state(args: argparse.Namespace) -> AppState:
    model_dir = Path(args.model_dir).expanduser().resolve()
    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    session = ort.InferenceSession(
        str(model_dir / "onnx" / "model.onnx"),
        providers=["CPUExecutionProvider"],
    )
    return AppState(
        model_alias=args.alias,
        model_dir=model_dir,
        tokenizer=tokenizer,
        session=session,
        max_length=args.max_length,
    )


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class EmbeddingHandler(BaseHTTPRequestHandler):
    state: AppState

    def _send_json(self, status: int, payload: Any) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def do_GET(self) -> None:
        if self.path in {"/health", "/healthz"}:
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "model": self.state.model_alias,
                    "modelDir": str(self.state.model_dir),
                },
            )
            return

        if self.path == "/v1/models":
            self._send_json(
                HTTPStatus.OK,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": self.state.model_alias,
                            "object": "model",
                            "owned_by": "local-bge-server",
                        },
                    ],
                    "models": [
                        {
                            "name": self.state.model_alias,
                            "model": self.state.model_alias,
                            "type": "model",
                            "capabilities": ["embedding"],
                        },
                    ],
                },
            )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"error": {"message": "Not found."}},
        )

    def do_POST(self) -> None:
        if self.path != "/v1/embeddings":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": {"message": "Not found."}},
            )
            return

        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": {"message": "Request body must be valid JSON."}},
            )
            return

        input_value = payload.get("input")
        if isinstance(input_value, str):
            texts = [input_value]
        elif isinstance(input_value, list) and all(isinstance(item, str) for item in input_value):
            texts = input_value
        else:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": {"message": "input must be a string or string array."}},
            )
            return

        vectors, token_count = self.state.embed(texts)
        self._send_json(
            HTTPStatus.OK,
            {
                "object": "list",
                "data": [
                    {
                        "object": "embedding",
                        "index": index,
                        "embedding": vector,
                    }
                    for index, vector in enumerate(vectors)
                ],
                "model": payload.get("model") or self.state.model_alias,
                "usage": {
                    "prompt_tokens": token_count,
                    "total_tokens": token_count,
                },
            },
        )

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[bge-m3-local] {self.address_string()} - {fmt % args}")


def main() -> None:
    args = parse_args()
    state = build_state(args)
    EmbeddingHandler.state = state
    server = ThreadingHTTPServer((args.host, args.port), EmbeddingHandler)
    print(
        f"bge-m3 local server listening on http://{args.host}:{args.port} "
        f"using {state.model_dir}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
