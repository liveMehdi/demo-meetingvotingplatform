import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function StatusBadge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn("status-badge", className)}
      data-tone={tone}
      {...props}
    />
  );
}
