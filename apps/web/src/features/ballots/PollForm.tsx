import { useRef, useState } from "react";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import { buttonClass } from "@/components/ui/control-styles";
import type { Poll, PollInput } from "./poll-api";

const fieldClass = "mt-2 ui-input";

export function PollForm({
  editing,
  pending,
  locked,
  onSave,
  onCancel,
}: {
  editing: Poll | null;
  pending: boolean;
  locked: boolean;
  onSave: (input: PollInput) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PollInput["kind"]>(
    editing?.kind ?? "poll_single",
  );

  const [question, setQuestion] = useState(editing?.question ?? "");

  const [description, setDescription] = useState(editing?.description ?? "");
  const [options, setOptions] = useState(
    editing?.options.map((option) => option.label).join("\n") ?? "",
  );
  const [minimum, setMinimum] = useState(String(editing?.min_selections ?? 1));

  const [maximum, setMaximum] = useState(String(editing?.max_selections ?? 2));

  const [error, setError] = useState<string | null>(null);

  const initial = useRef(
    JSON.stringify([kind, question, description, options, minimum, maximum]),
  );

  const confirmDiscard = useUnsavedChanges(
    locked ||
      initial.current !==
        JSON.stringify([
          kind,
          question,
          description,
          options,
          minimum,
          maximum,
        ]),
    pending,
  );

  return (
    <form
      className="mt-5 surface-inset"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const labels = options
          .trim()
          .split(/\r?\n/)
          .map((label) => label.trim());
        const min = kind === "poll_single" ? 1 : Number(minimum);
        const max = kind === "poll_single" ? 1 : Number(maximum);
        if (
          !question.trim() ||
          labels.length < 2 ||
          labels.length > 50 ||
          labels.some((label) => !label || label.length > 200) ||
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          min < 1 ||
          min > max ||
          max > labels.length ||
          (kind === "poll_multiple" && max < 2)
        ) {
          setError(
            "Enter a question, 2–50 nonempty options, and valid selection limits within the option count.",
          );
          return;
        }
        setError(null);
        onSave({
          kind,
          question: question.trim(),
          description: description.trim(),
          options: labels,
          min_selections: min,
          max_selections: max,
        });
      }}
    >
      <h3 className="text-lg font-semibold tracking-tight">
        {editing ? "Edit poll draft" : "Create a poll draft"}
      </h3>
      <fieldset disabled={pending || locked} className="mt-4 space-y-4">
        <label className="block text-sm font-medium">
          Question type
          <select
            value={kind}
            className={fieldClass}
            onChange={(event) => {
              setKind(event.target.value as PollInput["kind"]);
              if (event.target.value === "poll_multiple" && Number(maximum) < 2)
                setMaximum("2");
            }}
          >
            <option value="poll_single">Single choice</option>
            <option value="poll_multiple">Multiple choice</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Question
          <input
            required
            maxLength={500}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Description (optional)
          <textarea
            maxLength={5000}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Options — one per line
          <textarea
            required
            maxLength={10050}
            rows={4}
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            className={fieldClass}
          />
        </label>
        <p className="supporting-copy">
          2–50 distinct options, up to 200 characters each.
        </p>
        {kind === "poll_multiple" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Minimum selections
              <input
                type="number"
                required
                min={1}
                max={50}
                step={1}
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="text-sm">
              Maximum selections
              <input
                type="number"
                required
                min={2}
                max={50}
                step={1}
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <div className="mt-6 action-row">
        <button
          className={`${buttonClass} ui-button-primary`}
          type="submit"
          disabled={pending || locked}
        >
          {pending
            ? "Saving…"
            : editing
              ? "Save poll draft"
              : "Create poll draft"}
        </button>
        <button
          className={buttonClass}
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirmDiscard()) onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
