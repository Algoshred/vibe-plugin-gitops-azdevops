/**
 * @vibecontrols/vibe-plugin-gitops-azdevops
 *
 * Azure DevOps provider plugin.
 */
import {
  BoundLogger,
  createLifecycleHooks,
  ProviderRegistry,
  TelemetryEmitter,
} from "@vibecontrols/plugin-sdk";
import type {
  HostServices,
  ProfileContext,
  VibePlugin,
  VibePluginFactory,
} from "@vibecontrols/plugin-sdk/contract";

import { AzureDevOpsProvider } from "./provider.js";

const PLUGIN_NAME = "gitops-azdevops";
const PLUGIN_VERSION = "0.1.0";
const PROVIDER_NAME = "azdevops";

let provider: AzureDevOpsProvider | null = null;

export const createPlugin: VibePluginFactory = (
  _ctx: ProfileContext,
): VibePlugin => {
  const telemetry = new TelemetryEmitter(PLUGIN_NAME, PLUGIN_VERSION);
  const lifecycle = createLifecycleHooks({
    name: PLUGIN_NAME,
    telemetryEventName: "gitops.provider.ready",
    onInit: async (hostServices: HostServices) => {
      const log = new BoundLogger(hostServices.logger, PLUGIN_NAME);
      provider = new AzureDevOpsProvider(hostServices);
      await provider.init();
      new ProviderRegistry(hostServices).registerProvider(
        "gitops",
        PROVIDER_NAME,
        provider,
      );
      telemetry.emit("gitops.provider.ready", { provider: PROVIDER_NAME });
      log.info("Azure DevOps gitops provider registered");
    },
    onShutdown: async () => {
      provider = null;
    },
  });
  return {
    capabilities: {
      storage: "rw",
      secrets: "rw",
      telemetry: true,
      audit: true,
    },
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description:
      "Azure DevOps provider for the GitOps meta plugin (REST 7.1). meta.organization required in auth.",
    tags: ["backend", "provider", "integration"],
    onServerStart: lifecycle.onServerStart,
    onServerStop: lifecycle.onServerStop,
  };
};

export default createPlugin;
export { AzureDevOpsProvider } from "./provider.js";
export type * from "./types.js";
