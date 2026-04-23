import { paths } from "./paths.ts";

export type ProjectConfig = {
  projectName: string;
  tmuxSession: string;
  defaultModel?: string;
  createdAt: string;
};

export async function readConfig(projectRoot: string): Promise<ProjectConfig | null> {
  const file = Bun.file(paths(projectRoot).config);
  if (!(await file.exists())) return null;
  return (await file.json()) as ProjectConfig;
}

export async function writeConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  await Bun.write(paths(projectRoot).config, JSON.stringify(config, null, 2) + "\n");
}
