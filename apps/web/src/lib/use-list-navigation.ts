import { useSearchParams } from "react-router";

export function useListNavigation(
  views: readonly string[],
  defaultView = "all",
) {
  const [params, setParams] = useSearchParams();

  const raw = Number(params.get("offset") ?? 0);
  const offset =
    Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_000_000 ? raw : 0;
  const view = views.includes(params.get("view") ?? "")
    ? params.get("view")!
    : defaultView;
  const q = (params.get("q") ?? "").slice(0, 200);

  function update(changes: Record<string, string>, replace = false) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  }
  return {
    offset,
    view,
    q,
    search: params.toString(),
    setOffset: (value: number) => update({ offset: String(value) }),
    setView: (value: string) => update({ view: value, offset: "" }),
    setSearch: (value: string) => update({ q: value.trim(), offset: "" }),
  };
}
