import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Subscription } from '@/api/types';

export function useSubscriptions() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.getSubscriptions(),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSubscription(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['subscriptions'] });
      const previous = queryClient.getQueryData<Subscription[]>(['subscriptions']);
      queryClient.setQueryData<Subscription[]>(['subscriptions'], (old) =>
        old ? old.filter((s) => s.subscription_id !== id) : [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['subscriptions'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  return {
    subscriptions: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? 'Could not load your subscriptions.' : null,
    deleteError: deleteMutation.error ? 'Could not remove subscription. Try again.' : null,
    deleteSubscription: deleteMutation.mutate,
    refetch: query.refetch,
  };
}
