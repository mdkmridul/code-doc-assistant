import { Suspense } from "react";
import { Workspace } from "@/components/workspace";

export default function Home() {
  return (
    // The workspace reads the URL (?repo=, ?session=): runtime data, so it
    // renders behind Suspense and the shell stays static.
    <Suspense fallback={<div className="h-dvh bg-muted/40" aria-busy="true" />}>
      <Workspace />
    </Suspense>
  );
}
