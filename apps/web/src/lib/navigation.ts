export function safeReturnTo(value: string | null, fallback = "/"): string {
  if (
    !value ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return fallback;
  try {
    const url = new URL(value, "https://navigation.invalid");
    if (url.origin !== "https://navigation.invalid") return fallback;
    if (
      !/^\/(?:account|members|audit|status|nominations|ballots(?:\/[a-f0-9-]{36})?|meetings(?:\/[a-f0-9-]{36}(?:\/polls\/[a-f0-9-]{36}\/projector)?)?)?$/.test(
        url.pathname,
      )
    )
      return fallback;

    const params = new URLSearchParams();

    for (const key of ["section", "view", "offset", "q", "ballot"]) {
      const entry = url.searchParams.get(key);
      if (entry !== null && entry.length <= 254) params.set(key, entry);
    }

    const parent = url.searchParams.get("returnTo");

    if (parent && parent.startsWith("/") && !parent.startsWith("//")) {
      const list = new URL(parent, "https://navigation.invalid");
      const expected = url.pathname.startsWith("/ballots/")
        ? "/ballots"
        : url.pathname.startsWith("/meetings/")
          ? "/meetings"
          : null;

      if (list.pathname === expected && !list.searchParams.has("returnTo"))
        params.set("returnTo", safeReturnTo(parent, expected!));
    }
    return url.pathname + (params.size ? `?${params}` : "");
  } catch {
    return fallback;
  }
}

export function loginUrl(destination: string) {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(destination))}`;
}

export const ballotStateLabels = {
  DRAFT: "Draft",
  OPEN: "Voting open",
  CLOSED: "Awaiting publication",
  PUBLISHED: "Published",
  CANCELLED: "Cancelled draft",
};
