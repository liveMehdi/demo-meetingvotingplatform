import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("empty-state", className)}>
      <p className="text-base font-medium text-foreground">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md supporting-copy">{description}</p>
      )}
      {action && (
        <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div>
      )}
    </div>
  );
}
