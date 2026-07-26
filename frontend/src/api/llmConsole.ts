import api, {
  type AgentTaskMapping,
  type LLMRouterSummary,
  type ModelEntry,
  type ModelTiersConfig,
  type ProviderStatus,
  type TierConfig,
  type UsageRecord,
} from './client';

export const llmConsole = {
  getConfig: (): Promise<ModelTiersConfig> => api.getLLMConfig(),
  getProviders: (): Promise<ProviderStatus[]> => api.getProviders(),
  saveConfig: (cfg: ModelTiersConfig): Promise<LLMRouterSummary> =>
    api.putLLMConfig(cfg),
  reload: (): Promise<LLMRouterSummary> => api.reloadLLMConfig(),
  getUsage: (limit = 50): Promise<UsageRecord[]> => api.getLLMUsage(limit),
};

export type {
  ModelTiersConfig,
  ModelEntry,
  TierConfig,
  AgentTaskMapping,
  ProviderStatus,
  UsageRecord,
  LLMRouterSummary,
};
