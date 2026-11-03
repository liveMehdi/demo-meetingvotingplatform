import { useEffect, useRef, useState } from "react";

export function ListViews({
  value,
  choices,
  onChange,
}: {
  value: string;
  choices: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    function revealSelection() {

      const selected = element!.querySelector<HTMLButtonElement>(
        '[aria-pressed="true"]',
      );
      if (!selected) return;
      const bounds = element!.getBoundingClientRect();

      const button = selected.getBoundingClientRect();
      // scrolling only the tabs, keeping the page position and keyboard focus
      if (button.left < bounds.left + 6)
        element!.scrollLeft += button.left - bounds.left - 6;

      else if (button.right > bounds.right - 6)
        element!.scrollLeft += button.right - bounds.right + 6;
    }
    const observer = new ResizeObserver(revealSelection);
    observer.observe(element);
    revealSelection();

    return () => observer.disconnect();

  }, [value]);
  return (
    <div ref={track} className="segmented-track my-6" aria-label="List views">
      {choices.map(([id, label]) => (

        <button

          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className="segmented-item"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ListSearch({
  value,
  label,
  onSearch,
}: {
  value: string;
  label: string;
  onSearch: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      role="search"
      className="mb-6 flex flex-wrap items-end gap-3"

      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft);
      }}
    >

      <label className="min-w-0 basis-full text-sm font-medium sm:flex-1 sm:basis-0">
        {label}
        <input
          type="search"
          maxLength={200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="mt-2 block ui-input"
        />

      </label>
      
      <button className="ui-button">Search</button>
      {value && (
        <button
          type="button"
          className="ui-button"
          onClick={() => {
            setDraft("");
            onSearch("");
          }}
        >
          Clear
        </button>
      )}
    </form>
  );
}
