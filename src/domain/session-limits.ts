import type { ProjectConfig } from '../contracts/model';
import type { Usage } from './usage';
/** Optional multiplier ceiling is a local guard, not an account quota or currency. */
export function usageLimit(usage: Usage, limits: ProjectConfig['session']): string | undefined {
    if (usage.output >= limits.maxOutputTokens)
        return `Extension limit: output tokens ${usage.output} / ${limits.maxOutputTokens}. Setting: session.maxOutputTokens.`;
    if (limits.maxPremiumRequests != null && (usage.premium ?? 0) >= limits.maxPremiumRequests)
        return `Extension limit: SDK premium-request units ${usage.premium} / ${limits.maxPremiumRequests}. Setting: session.maxPremiumRequests (null disables this ceiling).`;
}
