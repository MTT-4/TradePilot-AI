import { Suspense } from "react";
import { TrackingLinksClient } from "./tracking-links-client";

export default function TrackingLinksPage() {
  return (
    <Suspense fallback={<div className="card">加载中…</div>}>
      <TrackingLinksClient />
    </Suspense>
  );
}
