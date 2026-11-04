import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

export function renderWithProviders(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: 0 }, mutations: { retry: false },
  } });

  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

export function deferred<T>() {

  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });

  return { promise, resolve };
}
