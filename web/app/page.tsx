import { ChorusApp } from "@/components/harness/app";
import { connection } from "next/server";

export default async function Home() {
  await connection();
  return <ChorusApp legacyCatalog={process.env.CHORUS_LEGACY_TEST_UI === "1"} />;
}
