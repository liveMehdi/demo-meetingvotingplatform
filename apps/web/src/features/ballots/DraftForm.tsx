import { useRef, useState, type FormEvent } from "react";
import { useUnsavedChanges } from "@/lib/UnsavedChanges";
import {
  actionButtonClass as buttonClass,
  inputClass as sharedInputClass,
} from "@/components/ui/control-styles";
import type { Ballot, BallotInput } from "./api";
import { RankedVotingHelp } from "./RankedVotingHelp";

const inputClass = `${sharedInputClass} mt-2`;

export function DraftForm({
  editing,
  pending,
  locked,
  onSave,
  onCancel,
}: {
  editing: Ballot | null;
  pending: boolean;
  locked: boolean;
  onSave: (input: BallotInput) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BallotInput["kind"]>(
    editing?.kind ?? "election",
  );

  const [source, setSource] = useState<BallotInput["candidate_source"]>(
    editing?.candidate_source ?? "manual",
  );

  const [method, setMethod] = useState<BallotInput["counting_method"]>(
    editing?.counting_method ?? "standard",
  );

  const [question, setQuestion] = useState(editing?.question ?? "");

  const [description, setDescription] = useState(editing?.description ?? "");

  const [options, setOptions] = useState(
    editing?.kind === "election"
      ? editing.options.map((o) => o.label).join("\n")
      : "",
  );

  const [error, setError] = useState<string | null>(null);

  const initial = useRef(
    JSON.stringify([kind, source, method, question, description, options]),
  );

  const confirmDiscard = useUnsavedChanges(
    locked ||
      initial.current !==
        JSON.stringify([kind, source, method, question, description, options]),
    pending,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const manualElection = kind === "election" && source === "manual";
    const labels = manualElection
      ? options
          .trim()
          .split(/\r?\n/)
          .map((label) => label.trim())
      : [];
    if (
      !question.trim() ||
      (manualElection &&
        (labels.length < 2 ||
          labels.length > 50 ||
          labels.some((label) => !label || label.length > 200)))
    ) {
      setError(
        "Enter a question and for an election, 2–50 nonempty options (up to 200 characters each).",
      );
      return;
    }
    setError(null);
    onSave({
      kind,
      question: question.trim(),
      description: description.trim(),
      options: labels,
      candidate_source: source,
      counting_method: kind === "election" ? method : "standard",
    });
  }

  return (
    <form onSubmit={submit} className="my-6 surface-inset" aria-busy={pending}>
      <h3 className="text-lg font-semibold tracking-tight">
        {editing ? "Edit draft" : "Create a draft ballot"}
      </h3>
      <fieldset
        disabled={pending || locked}
        className="mt-4 space-y-4 disabled:opacity-60"
      >
        <div>
          <label htmlFor="ballot-kind" className="text-sm font-medium">
            Ballot type
          </label>
          <select
            id="ballot-kind"
            value={kind}
            disabled={
              editing?.candidate_source === "nominations" ||
              !!editing?.followup_kind
            }
            onChange={(e) => {
              setKind(e.target.value as BallotInput["kind"]);
              if (e.target.value === "motion") setSource("manual");
            }}
            className={inputClass}
          >
            <option value="election">Election</option>
            <option value="motion">Motion</option>
          </select>
        </div>
        <div>
          <label htmlFor="ballot-question" className="text-sm font-medium">
            Question
          </label>
          <input
            id="ballot-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={500}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ballot-description" className="text-sm font-medium">
            Description (optional)
          </label>
          <textarea
            id="ballot-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={3}
            className={inputClass}
          />
        </div>
        {kind === "election" && (
          <div>
            <label htmlFor="counting-method" className="text-sm font-medium">
              Voting method
            </label>
            <select
              id="counting-method"
              className={inputClass}
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as BallotInput["counting_method"])
              }
            >
              <option value="standard">Single choice (most votes wins)</option>
              <option value="irv_v1">Ranked choice (one winner)</option>
            </select>
            {method === "irv_v1" && <RankedVotingHelp />}
          </div>
        )}
        {kind === "election" && (
          <div>
            <label htmlFor="candidate-source" className="text-sm font-medium">
              Candidates
            </label>
            <select
              id="candidate-source"
              className={inputClass}
              value={source}
              disabled={editing !== null}
              onChange={(e) =>
                setSource(e.target.value as BallotInput["candidate_source"])
              }
            >
              <option value="manual">Enter candidates manually</option>
              <option value="nominations">
                Member nominations and officer approval
              </option>
            </select>
            <p className="mt-2 supporting-copy">
              Cannot be changed after creation.
            </p>
          </div>
        )}
        {kind === "election" && source === "manual" ? (
          <div>
            <label htmlFor="ballot-options" className="text-sm font-medium">
              Options — one per line
            </label>
            <textarea
              id="ballot-options"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              required
              maxLength={10050}
              rows={5}
              className={inputClass}
              aria-describedby="options-help"
            />
            <p id="options-help" className="mt-2 supporting-copy">
              2–50 distinct options.{" "}
              {method === "irv_v1"
                ? "Members will rank one or more."
                : "Members will select one."}
            </p>
          </div>
        ) : (
          <p className="supporting-copy">
            {kind === "motion"
              ? "Choices: For / Against / Abstain. Members will select one."
              : "Create the draft, open nominations and approve consenting candidates before opening voting."}
          </p>
        )}
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
          {pending ? "Saving…" : editing ? "Save draft" : "Create draft"}
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
