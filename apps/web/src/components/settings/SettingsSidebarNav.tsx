import { useCallback, type ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  FlaskConicalIcon,
  FolderGitIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  Settings2Icon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { T3ConnectSidebarAvatar, T3ConnectSidebarSignIn } from "../clerk/T3ConnectSidebarSignIn";
import { useProjects } from "../../state/entities";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/beta"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
  { label: "Keybindings", to: "/settings/keybindings", icon: KeyboardIcon },
  { label: "Providers", to: "/settings/providers", icon: BotIcon },
  { label: "Source Control", to: "/settings/source-control", icon: GitBranchIcon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  { label: "Beta", to: "/settings/beta", icon: FlaskConicalIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

/** Settings route for a single project, used by the nav and the sidebar gear. */
export function projectSettingsPath(environmentId: string, projectId: string): string {
  return `/settings/projects/${environmentId}/${projectId}`;
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = useProjects();
  const handleSectionClick = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, replace: true });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleProjectClick = useCallback(
    (environmentId: string, projectId: string) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/settings/projects/$environmentId/$projectId",
        params: { environmentId, projectId },
        replace: true,
      });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handleBackClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="p-2">
          <SidebarMenu>
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => handleSectionClick(item.to)}
                  >
                    <Icon />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        {projects.length > 0 ? (
          <SidebarGroup className="px-2 pb-2">
            <SidebarGroupLabel>Repositories</SidebarGroupLabel>
            <SidebarMenu>
              {projects.map((project) => {
                const to = projectSettingsPath(project.environmentId, project.id);
                return (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      isActive={pathname === to}
                      onClick={() => handleProjectClick(project.environmentId, project.id)}
                    >
                      <FolderGitIcon />
                      <span className="truncate">{project.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="p-2">
        <T3ConnectSidebarSignIn />
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleBackClick}>
                <ArrowLeftIcon />
                <span>Back</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <T3ConnectSidebarAvatar />
        </div>
      </SidebarFooter>
    </>
  );
}
