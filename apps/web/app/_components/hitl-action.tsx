"use client";

import { useState } from "react";

type HitlActionProps = {
  tenantId: string;
  endpoint: string;
  idleLabel: string;
  busyLabel: string;
  body?: unknown;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
  onSuccess?: (payload: unknown) => void | Promise<void>;
  onError?: (message: string) => void;
};

export function HitlAction({
  tenantId,
  endpoint,
  idleLabel,
  busyLabel,
  body,
  disabled,
  variant = "primary",
  fullWidth,
  onSuccess,
  onError,
}: HitlActionProps) {
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (disabled || submitting) {
      return;
    }

    setSubmitting(true);
    onError?.("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "X-Tenant-Id": tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "操作失败。");
      }

      const payload = await response.json().catch(() => null);
      await onSuccess?.(payload);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      className={`rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        fullWidth ? "w-full" : ""
      } ${
        variant === "primary"
          ? "bg-[#1f6a52] text-white"
          : "border border-[#ddd3bd] bg-white text-[#1f241f]"
      }`}
      disabled={disabled || submitting}
      onClick={() => void submit()}
    >
      {submitting ? busyLabel : idleLabel}
    </button>
  );
}
