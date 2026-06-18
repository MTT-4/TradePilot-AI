export default function Home() {
  const setupSteps = [
    "Copy .env.example to .env and fill the required keys.",
    "Run docker compose up -d to start Postgres, Redis, and MinIO.",
    "Expose local Qwen on :8080 and bge-m3 embeddings on :8082.",
    "Use npm run check before starting feature work.",
  ];

  const modules = [
    "Knowledge base and review flow",
    "Website generation and HITL publish gate",
    "Content packs and tracking links",
    "CRM, first reply, and attribution dashboard",
  ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
      <section className="overflow-hidden rounded-[32px] border border-border bg-surface-strong shadow-[0_20px_80px_rgba(31,36,31,0.08)] backdrop-blur">
        <div className="grid gap-8 p-8 md:grid-cols-[1.2fr_0.8fr] md:p-12">
          <div className="space-y-6">
            <p className="font-mono text-sm uppercase tracking-[0.24em] text-accent">
              T0.1 Scaffold Ready
            </p>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
                TradePilot AI local server baseline
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted">
                Next.js, TypeScript, Tailwind, env validation, health probes, and
                local infrastructure are now the enforced starting point for M0.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 font-mono text-sm">
              <span className="rounded-full bg-accent px-4 py-2 text-white">
                http://localhost:3100
              </span>
              <span className="rounded-full border border-border bg-white/70 px-4 py-2">
                /api/health
              </span>
              <span className="rounded-full border border-border bg-white/70 px-4 py-2">
                npm run check
              </span>
            </div>
          </div>

          <div className="rounded-[28px] border border-border bg-[#1f241f] p-6 text-[#f5f2e8] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-[#c9ebe6]">
                Baseline
              </h2>
              <span className="rounded-full bg-[#29443f] px-3 py-1 font-mono text-xs">
                M0
              </span>
            </div>
            <div className="space-y-4 text-sm leading-7 text-[#d7d1c4]">
              <p>Public marketing content routes to OpenAI later.</p>
              <p>Privacy-sensitive flows must route to local Qwen only.</p>
              <p>Tracking links and tenant isolation stay non-negotiable.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[28px] border border-border bg-surface p-8 backdrop-blur">
          <h2 className="mb-5 text-2xl font-semibold">Startup checklist</h2>
          <ol className="space-y-4 text-base leading-7 text-muted">
            {setupSteps.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-sm text-accent">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-[28px] border border-border bg-surface p-8 backdrop-blur">
          <h2 className="mb-5 text-2xl font-semibold">Closed-loop targets</h2>
          <ul className="space-y-4 text-base leading-7 text-muted">
            {modules.map((module) => (
              <li
                key={module}
                className="rounded-2xl border border-border bg-white/70 px-4 py-3"
              >
                {module}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
