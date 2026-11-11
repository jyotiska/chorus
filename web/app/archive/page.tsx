import { SessionExplorer } from "@/components/session-explorer";
import { HistoricalArchive } from "@/components/harness/archive";
import { Suspense } from "react";
import { connection } from "next/server";
async function Content() {
  await connection();
  return process.env.CHORUS_LEGACY_TEST_UI === "1" ? (
    <SessionExplorer />
  ) : (
    <HistoricalArchive />
  );
}
export default function Archive() {
  return (
    <Suspense fallback={<p>Loading archives…</p>}>
      <Content />
    </Suspense>
  );
}
