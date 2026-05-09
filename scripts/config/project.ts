import fs from 'fs';
import path from 'path';

export const PROJECT_DIR = '.ragtech';
export const PROJECT_FILENAME = 'project.json';

export interface EpisodeMeta {
  id: string;
  title?: string;
  number?: number;
}

export interface ToolVersions {
  node?: string;
  ffmpeg?: string;
  whisper?: string;
  [key: string]: string | undefined;
}

export interface PipelineParams {
  [key: string]: unknown;
}

export interface ArtifactRefs {
  [stageId: string]: string;
}

export interface ProjectFile {
  version: string;
  episode: EpisodeMeta;
  brandId: string;
  tools: ToolVersions;
  params: PipelineParams;
  artifacts: ArtifactRefs;
}

export class ProjectNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Project file not found: ${filePath}`);
    this.name = 'ProjectNotFoundError';
  }
}

function projectFilePath(cwd: string): string {
  return path.join(cwd, PROJECT_DIR, PROJECT_FILENAME);
}

export function readProject(cwd: string = process.cwd()): ProjectFile {
  const filePath = projectFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    throw new ProjectNotFoundError(filePath);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProjectFile;
}

export function writeProject(project: ProjectFile, cwd: string = process.cwd()): void {
  const dirPath = path.join(cwd, PROJECT_DIR);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(projectFilePath(cwd), JSON.stringify(project, null, 2), 'utf-8');
}
