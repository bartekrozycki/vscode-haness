export const environmentTools = ['git', 'node', 'java', 'python'] as const;
export type EnvironmentTool = typeof environmentTools[number];
export type EnvironmentPaths = Record<EnvironmentTool, string>;
export interface ToolStatus {
    tool: EnvironmentTool;
    configuredPath: string;
    executable?: string;
    version?: string;
    error?: string;
}
export interface CredentialStatus { name: string; configured: boolean; }
export interface EnvironmentStatus { tools: ToolStatus[]; credentials: CredentialStatus[]; }
export interface EnvironmentDiscovery { inspect(tool: EnvironmentTool, configuredPath: string): Promise<ToolStatus>; }
