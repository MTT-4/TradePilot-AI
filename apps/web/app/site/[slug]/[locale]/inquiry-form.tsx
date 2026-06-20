"use client";

import { FormEvent, useState } from "react";

type InquiryFormProps = {
  tenantSlug: string;
  ctaLabel: string;
  preferredLocale?: string;
  trackingSlug?: string;
};

export function InquiryForm({
  tenantSlug,
  ctaLabel,
  preferredLocale,
  trackingSlug,
}: InquiryFormProps) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) {
      setError("Please describe your inquiry.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/public/leads/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          ...(trackingSlug ? { trackingSlug } : {}),
          fields: {
            name: name.trim() || undefined,
            companyName: company.trim() || undefined,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            message: message.trim(),
            ...(preferredLocale ? { preferredLocale } : {}),
          },
        }),
      });

      if (response.status === 429) {
        throw new Error("Too many submissions. Please try again in a minute.");
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Submission failed, please retry.");
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        id="inquiry-form"
        className="rounded-[28px] border border-[#dce7e1] bg-[#f4faf7] p-8 text-center shadow-[0_18px_70px_rgba(54,45,23,0.06)]"
      >
        <h2 className="text-2xl font-semibold tracking-tight text-[#1f6a52]">
          Thank you — we received your inquiry.
        </h2>
        <p className="mt-3 text-sm leading-7 text-[#55554d]">
          Our team will reply shortly. 我们会尽快与您联系。
        </p>
      </div>
    );
  }

  return (
    <form
      id="inquiry-form"
      onSubmit={handleSubmit}
      className="rounded-[28px] border border-[#e4dcc8] bg-white p-6 shadow-[0_18px_70px_rgba(54,45,23,0.06)]"
    >
      <h2 className="text-2xl font-semibold tracking-tight">{ctaLabel}</h2>
      <p className="mt-2 text-sm leading-7 text-[#666154]">
        Leave your details and we will get back to you. 留下联系方式，我们尽快回复。
      </p>

      {error ? (
        <div className="mt-4 rounded-2xl border border-[#e7c4b8] bg-[#fbeee9] px-4 py-3 text-sm text-[#a23b22]">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <input
          className="rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
        <input
          className="rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none"
          placeholder="Company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          autoComplete="organization"
        />
        <input
          className="rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
        <input
          className="rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none"
          placeholder="Phone / WhatsApp"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          autoComplete="tel"
        />
        <textarea
          className="min-h-32 rounded-2xl border border-[#ddd3bd] px-4 py-3 text-sm outline-none md:col-span-2"
          placeholder="What project or market are you targeting?"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !message.trim()}
        className="mt-4 rounded-full bg-[#1f6a52] px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Sending…" : ctaLabel}
      </button>
    </form>
  );
}
