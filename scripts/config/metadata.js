import fs from 'fs';
import path from 'path';

export const ARTIFACT_SCHEMA_VERSION = '1';

function readProjectTools(cwd) {
  const projectPath = path.join(cwd, '.ragtech', 'project.json');
  try {
    const raw = fs.readFileSync(projectPath, 'utf-8');
    return JSON.parse(raw)?.tools ?? {};
  } catch {
    return {};
  }
}

export function buildToolVersions(cwd = process.cwd()) {
  const projectTools = readProjectTools(cwd);
  return { node: process.version, ...projectTools };
}

/**
 * Returns artifact with schema_version and tool_versions prepended.
 * Additive — existing fields are preserved and take precedence over metadata keys.
 */
export function stampMetadata(artifact, cwd = process.cwd()) {
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    tool_versions: buildToolVersions(cwd),
    ...artifact,
  };
}
