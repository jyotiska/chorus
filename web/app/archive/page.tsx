import { SessionExplorer } from "@/components/session-explorer";
import { RunArchive } from "@/components/harness/archive";
import { Suspense } from "react";
import { connection } from "next/server";
async function Content({ searchParams }: PageProps<"/archive">) {
  await connection();
  return process.env.CHORUS_LEGACY_TEST_UI === "1" && !("experiment" in await searchParams) ? (
    <SessionExplorer />
  ) : (
    <RunArchive />
  );
}
export default function Archive(props: PageProps<"/archive">) {
  return (
    <Suspense fallback={<p>Loading archives…</p>}>
      <Content {...props} />
    </Suspense>
  );
}
