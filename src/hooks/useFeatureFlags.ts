import { useState, useEffect, useCallback } from 'react';
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
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.getConfig();
      setConfig(data);
      setError(null);
    } catch {
      setError('Could not load configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const isEnabled = useCallback(
    (flag: keyof ClientConfig['flags']): boolean => {
      return config.flags[flag] === true;
    },
    [config],
  );

  return { config, flags: config.flags, isEnabled, loading, error, refetch: fetchConfig };
}
