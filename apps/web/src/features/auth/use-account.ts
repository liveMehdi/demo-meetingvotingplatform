import { useQuery } from "@tanstack/react-query";
import { currentUserKey, getCurrentUser } from "./api";

export function useAccount() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
    networkMode: "always",
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
