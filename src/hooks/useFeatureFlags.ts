import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ClientConfig } from '@/api/types';

const DEFAULT_FLAGS: ClientConfig['flags'] = {
  situational_brief: false,
  cascade_analysis: false,
  offline_guidance_cards: false,
  on_device_assistant: false,
  mesh_relay: false,
  proximity_confirmation: false,
  early_tier_opt_in: false,
};

const DEFAULT_CONFIG: ClientConfig = {
  min_supported_client: '1.0.0',
  flags: DEFAULT_FLAGS,
};

export function useFeatureFlags() {
  const query = useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: DEFAULT_CONFIG,
  });

  const config = query.data ?? DEFAULT_CONFIG;

  const isEnabled = (flag: keyof ClientConfig['flags']): boolean => {
    return config.flags[flag] === true;
  };

  return {
    config,
    flags: config.flags,
    isEnabled,
    loading: query.isLoading && !query.isPlaceholderData,
    error: query.error ? 'Could not load configuration' : null,
    refetch: query.refetch,
  };
}
