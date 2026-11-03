import { buttonClass as button } from "@/components/ui/control-styles";
import { RankedVotingHelp } from "./RankedVotingHelp";

export function RankingInput({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  function move(index: number, direction: number) {
    const next = [...value];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <p className="supporting-copy">
        Rank at least one candidate, favourite first. You may leave candidates
        unranked.
      </p>
      <RankedVotingHelp />
      <ol className="space-y-3" aria-label="Your ranking">
        {value.map((id, index) => {
          const label = options.find((o) => o.id === id)!.label;
          return (
            <li key={id} className="surface-inset">
              <p className="break-words">
                {index + 1}. {label}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={index === 0}
                  aria-label={`Move ${label} up`}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={index === value.length - 1}
                  aria-label={`Move ${label} down`}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className={button}
                  aria-label={`Remove ${label} from ranking`}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-medium">Unranked candidates</p>
      <ul className="space-y-2">
        {options
          .filter((o) => !value.includes(o.id))
          .map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={`${button} max-w-full break-words text-left`}
                onClick={() => onChange([...value, o.id])}
              >
                Add {o.label} at rank {value.length + 1}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
