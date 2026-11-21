import { QueryClient } from '@tanstack/react-query';

/** Shared QueryClient: App renders the provider, auth clears the cache on
 *  logout so the next login never flashes the previous user's data. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
