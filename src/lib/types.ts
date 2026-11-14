import type { Analysis } from './analyze';

export interface Project {
  id: number;
  user_id: string;
  name: string;
  package_name: string | null;
  description: string | null;
  zip_path: string | null;
  zip_url: string | null;
  zip_name: string | null;
  zip_size: number | null;
  analysis: Analysis | null;
  created_at: string;
  updated_at: string | null;
}

export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface Build {
  id: number;
  project_id: number;
  status: BuildStatus;
  build_type: 'debug' | 'release';
  module: string | null;
  gradle_task: string;
  jdk_version: string;
  sdk_platform: string | null;
  build_tools: string | null;
  gradle_version: string | null;
  extra_args?: string | null;
  agent_id?: number | null;
  agent_name: string | null;
  apk_url: string | null;
  apk_size: number | null;
  error: string | null;
  logs?: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  projects?: { name: string; package_name: string | null; zip_name?: string | null } | null;
}

export type ToolKind = 'jdk' | 'android-sdk' | 'build-tools' | 'gradle' | 'ndk';

export interface Toolchain {
  id: number;
  kind: ToolKind;
  version: string;
  label: string | null;
  path: string | null;
  notes: string | null;
  enabled: boolean;
  is_default: boolean;
}

export interface Agent {
  id: number;
  name: string;
  token: string;
  os: string | null;
  status: string;
  last_seen: string | null;
  current_build_id: number | null;
  online: boolean;
  created_at: string;
}

export interface CloudConn { connected: boolean; login?: string; repo?: string }
