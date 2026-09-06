import { createFileRoute } from "@tanstack/react-router";

import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { ProjectSettingsPanel } from "../components/settings/ProjectSettingsPanel";

function SettingsProjectRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <ProjectSettingsPanel
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}

export const Route = createFileRoute("/settings/projects/$environmentId/$projectId")({
  component: SettingsProjectRoute,
});
