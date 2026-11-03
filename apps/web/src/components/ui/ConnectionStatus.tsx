export function ConnectionStatus({ message }: { message: string }) {
  const connected = message === "Live updates connected";
  return (
    <p
      role="status"
      className="inline-flex items-center gap-2.5 supporting-copy"
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`}
      />
      {message}
    </p>
  );
}
