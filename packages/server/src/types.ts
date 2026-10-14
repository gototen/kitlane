/** A concrete colour scheme. */
export type Scheme = "light" | "dark";
/** A scheme, or "system" meaning "follow the operating system". */
export type ThemeSetting = Scheme | "system";
/** How the Explore tools rail is themed: match the framed tool, or force one scheme. */
export type RailPref = "tool" | Scheme;

export interface User {
  id: string;
  external_id: string;
  display_name: string;
  email: string | null;
  team: string | null;
  is_admin: boolean;
  is_dev_user: boolean;
  team_locked: boolean;
  /** Portal theme: light, dark, or follow the OS. */
  theme_pref: ThemeSetting;
  /** Rail theme: match the tool (default) or always light/dark. */
  rail_pref: RailPref;
  created_at: Date;
  last_seen_at: Date;
}

export type EntryKind = "tool" | "resource";
export type EntryMode = "hosted" | "external";
export type Lifecycle = "experimental" | "maintained" | "retired";

export interface Entry {
  id: string;
  kind: EntryKind;
  mode: EntryMode;
  title: string;
  purpose: string;
  tags: string[];
  creator_id: string;
  owner_id: string;
  team: string | null;
  lifecycle: Lifecycle;
  repo_url: string | null;
  external_url: string | null;
  replacement_entry_id: string | null;
  featured: boolean;
  frozen: boolean;
  frozen_reason: string | null;
  copied_from_entry_id: string | null;
  copied_from_version_id: string | null;
  /** Declared in kitlane.json: the scheme the tool renders in, or "system" when it adapts to the OS. */
  theme: ThemeSetting | null;
  created_at: Date;
  updated_at: Date;
}

export interface EntryWithNames extends Entry {
  names: string[];
  creator_name: string;
  creator_team: string | null;
  owner_name: string;
}

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
}

export interface Version {
  id: string;
  entry_id: string;
  number: number;
  created_by: string | null;
  created_at: Date;
  file_count: number;
  total_bytes: string | number;
  content_hash: string;
  manifest: { files: ManifestFile[]; entry: string };
  note: string | null;
  source_entry_id: string | null;
  source_version_id: string | null;
  removed: boolean;
  removed_reason: string | null;
  removed_at: Date | null;
  /** Sniffed from index.html's color-scheme meta at publish time; null when absent. */
  detected_theme: ThemeSetting | null;
}

export interface Deployment {
  entry_id: string;
  active_version_id: string | null;
  publication_revision: number;
  updated_at: Date;
  updated_by: string | null;
}

export interface SharedCollection {
  id: string;
  installation_id: string;
  origin_tool_id: string;
  owner_id: string;
  name: string;
  description: string;
  revision: number;
  frozen: boolean;
  frozen_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentRecord {
  id: string;
  data: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface Actor {
  type: "user" | "updater" | "system";
  id: string | null;
}

export const userActor = (userId: string): Actor => ({ type: "user", id: userId });
export const systemActor: Actor = { type: "system", id: null };
