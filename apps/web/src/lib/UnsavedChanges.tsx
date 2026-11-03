import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router";
import { actionButtonClass as button } from "@/components/ui/control-styles";

type Entry = { dirty: boolean; pending: boolean };
const warning =
  "Discard unsaved changes? If a save was not confirmed, it may already have succeeded. Check the list before creating it again.";
const Context = createContext({
  set: (_id: string, _entry: Entry | null) => {},
  confirmLeave: (): boolean => true,
  clear: () => {},
});

export function shouldBlockFormNavigation(
  dirty: boolean,
  currentPath: string,
  nextPath: string,
  currentBallot: string | null = null,
  nextBallot: string | null = null,
) {
  return dirty && (currentPath !== nextPath || currentBallot !== nextBallot);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const set = useCallback(
    (id: string, entry: Entry | null) =>
      setEntries((previous) => {
        const next = { ...previous };

        if (entry) next[id] = entry;
        else delete next[id];
        return next;
      }),
    [],
  );
  const dirty = Object.values(entries).some(
    (entry) => entry.dirty || entry.pending,
  );
  const pending = Object.values(entries).some((entry) => entry.pending);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlockFormNavigation(
        dirty,
        currentLocation.pathname,

        nextLocation.pathname,
        new URLSearchParams(currentLocation.search).get("ballot"),
        new URLSearchParams(nextLocation.search).get("ballot"),
      ) ||
      (dirty &&
        currentLocation.pathname === "/nominations" &&
        currentLocation.search !== nextLocation.search),
  );
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);

  useEffect(() => {
    if (blocker.state === "blocked" && !dirty) blocker.reset();
    if (blocker.state === "blocked" && dirty) dialog.current?.showModal();
    else dialog.current?.close();
  }, [blocker, dirty]);

  return (
    <Context.Provider
      value={{
        set,
        clear: () => setEntries({}),
        confirmLeave: () => !dirty || (!pending && window.confirm(warning)),
      }}
    >
      {children}
      <dialog
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();

          if (blocker.state === "blocked") blocker.reset();
        }}
        aria-labelledby="unsaved-heading"
        className="m-auto max-w-lg surface-panel text-foreground shadow-xl backdrop:bg-black/70"
      >
        <h2 id="unsaved-heading" className="text-lg font-semibold">
          Leave unsaved changes?
        </h2>
        <p className="mt-3 text-sm">
          {pending
            ? "A save is still running. Wait for its result before leaving."
            : warning}
        </p>

        <div className="mt-5 action-row">
          <button
            autoFocus
            className={button}
            onClick={() => {
              if (blocker.state === "blocked") blocker.reset();
            }}
          >
            Stay here
          </button>
          <button
            className={button}
            disabled={pending}
            onClick={() => {
              if (blocker.state === "blocked") blocker.proceed();
            }}
          >
            Discard and leave
          </button>
        </div>
      </dialog>
    </Context.Provider>
  );
}

export function useUnsavedChanges(dirty: boolean, pending = false) {
  const { set } = useContext(Context);
  const id = useId();
  useEffect(() => {
    set(id, { dirty, pending });
    return () => set(id, null);
  }, [set, id, dirty, pending]);
  return () => !pending && (!dirty || window.confirm(warning));
}

export function useUnsavedNavigation() {
  return useContext(Context);
}
