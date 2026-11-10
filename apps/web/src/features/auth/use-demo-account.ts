import { useQuery } from "@tanstack/react-query";
import { getDemoAccount } from "./api";

export function useDemoAccount() {
  return useQuery({
    queryKey: ["auth", "demo"],
    queryFn: ({ signal }) => getDemoAccount(signal),
    retry: false,
    gcTime: 0,
  });
}
