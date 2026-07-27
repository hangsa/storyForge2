import api, {
  type AgentTaskMapping,
  type LLMRouterSummary,
  type ModelEntry,
  type ModelTiersConfig,
  type ProviderEntry,
  type ProviderStatus,
  type TierConfig,
} from './client';

export const llmConsole = {
  getConfig: (): Promise<ModelTiersConfig> => api.getLLMConfig(),
  getProviders: (): Promise<ProviderStatus[]> => api.getProviders(),
  saveConfig: (cfg: ModelTiersConfig): Promise<LLMRouterSummary> => api.putLLMConfig(cfg),
  reload: (): Promise<LLMRouterSummary> => api.reloadLLMConfig(),
  upsertProvider: (id: string, provider: ProviderEntry): Promise<LLMRouterSummary> =>
    api.upsertProvider(id, provider),
  deleteProvider: (id: string): Promise<LLMRouterSummary> => api.deleteProvider(id),
  upsertModel: (providerId: string, modelId: string, model: ModelEntry): Promise<LLMRouterSummary> =>
    api.upsertModel(providerId, modelId, model),
  deleteModel: (providerId: string, modelId: string): Promise<LLMRouterSummary> =>
    api.deleteModel(providerId, modelId),
  setProviderApiKey: (providerId: string, value: string): Promise<LLMRouterSummary> =>
    api.setProviderApiKey(providerId, value),
  migrateConfig: (): Promise<{ backup_path?: string | null; added?: string[]; summary: object }> =>
    api.migrateConfig(),
};

export type {
  ModelTiersConfig,
  ModelEntry,
  TierConfig,
  AgentTaskMapping,
  ProviderEntry,
  ProviderStatus,
  LLMRouterSummary,
};