"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  Loader2Icon,
  RouteIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolStep } from "@/lib/turns";

/** Reads a string field from a tool's untyped input. */
const field = (input: unknown, key: string): string | undefined => {
  const value = (input as Record<string, unknown> | null)?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
};

/** A human description of what a step did, from its tool and input. */
export function describeStep(step: ToolStep): { icon: typeof SearchIcon; label: string; detail?: string } {
  if (step.name === "search_code") {
    const scope = [field(step.input, "pathPrefix"), field(step.input, "language")]
      .filter(Boolean)
      .join(" · ");
    return {
      icon: SearchIcon,
      label: `Searched code for “${field(step.input, "query") ?? "…"}”`,
      detail: scope || undefined,
    };
  }
  if (step.name === "read_file") {
    const path = field(step.input, "path") ?? "a file";
    const start = field(step.input, "startLine");
    const end = field(step.input, "endLine");
    const range = start ? `:${start}${end ? `-${end}` : ""}` : "";
    return { icon: FileTextIcon, label: `Read ${path}${range}` };
  }
  if (step.name === "list_endpoints") {
    const filters = [field(step.input, "method"), field(step.input, "pathContains"), field(step.input, "pathPrefix")]
      .filter(Boolean)
      .join(" · ");
    return { icon: RouteIcon, label: "Listed API endpoints", detail: filters || undefined };
  }
  return { icon: WrenchIcon, label: `Ran ${step.name}` };
}

function StepRow({ step }: { step: ToolStep }) {
  const { icon: Icon, label, detail } = describeStep(step);
  return (
    <li className="flex items-start gap-2.5 py-1.5" data-status={step.status}>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border bg-background",
          step.status === "error" && "border-destructive/40 text-destructive",
        )}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-foreground" title={label}>
          {label}
          {detail && <span className="ml-1.5 text-muted-foreground">in {detail}</span>}
        </p>
        <p
          className={cn(
            "text-xs",
            step.status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {step.status === "running" && "Running…"}
          {step.status === "done" && (step.summary ?? "Done")}
          {step.status === "error" && (step.summary ?? "Failed")}
        </p>
      </div>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {step.status === "running" && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        )}
        {step.status === "done" && <CheckIcon className="size-3.5 text-emerald-600" />}
        {step.status === "error" && <AlertCircleIcon className="size-3.5 text-destructive" />}
      </span>
    </li>
  );
}

/**
 * The tool calls made while researching one answer, shown above it. Open while
 * the answer streams; collapsed to a one-line summary once it is done.
 */
export function ToolSteps({ steps, active }: { steps: ToolStep[]; active: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  if (steps.length === 0) return null;

  const running = steps.filter((s) => s.status === "running").length;
  const failed = steps.filter((s) => s.status === "error").length;
  const isOpen = open ?? active;
  const title = active
    ? running > 0
      ? `Researching · ${running} running`
      : `Researching · ${steps.length} step${steps.length === 1 ? "" : "s"}`
    : `Researched with ${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;

  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} className="rounded-lg border bg-muted/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        {active && running > 0 ? (
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <WrenchIcon className="size-3.5" aria-hidden />
        )}
        <span className="flex-1">{title}</span>
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol aria-label="Tool steps" className="divide-y border-t px-3">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
