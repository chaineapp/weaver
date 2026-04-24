import { findWorkspace, getProject, type Workspace, type ProjectRecord } from "@weaver/core";

// Resolution of the "ambient" workspace + project that this MCP server is
// operating inside. weave up sets WEAVER_WORKSPACE_ROOT and WEAVER_PROJECT_ID
// as env vars on the planner claude process, and the MCP server inherits them.

export type Context = {
  workspace: Workspace | null;
  project: ProjectRecord | null;
  serverCwd: string;
};

export async function loadContext(serverCwd: string): Promise<Context> {
  const workspaceRoot = process.env.WEAVER_WORKSPACE_ROOT ?? undefined;
  const projectId = process.env.WEAVER_PROJECT_ID ?? undefined;

  const workspace = workspaceRoot
    ? await findWorkspace(workspaceRoot)
    : await findWorkspace(serverCwd);

  const project = workspace && projectId ? await getProject(workspace, projectId) : null;
  return { workspace, project, serverCwd };
}

export function requireProject(ctx: Context): { workspace: Workspace; project: ProjectRecord } {
  if (!ctx.workspace) throw new Error("not inside a Weaver workspace — run `weave workspace init`");
  if (!ctx.project) throw new Error("no current project — run `weave new` and `weave up --project <id>`");
  return { workspace: ctx.workspace, project: ctx.project };
}
