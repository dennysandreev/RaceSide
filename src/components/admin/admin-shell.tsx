"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Shield } from "lucide-react";

import { AdminCommandMenu } from "@/components/admin/admin-command-menu";
import { adminNavigation } from "@/components/admin/admin-navigation";
import { RaceMateLogo, RaceMateMark } from "@/components/racemate/racemate-logo";
import { ThemeToggle } from "@/components/racemate/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export function AdminShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string;
}) {
  const pathname = usePathname();
  const navigatingFromMenu = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const navigationGroups = [...new Set(adminNavigation.map((item) => item.group))];

  return (
    <SidebarProvider
      className="admin-shell"
      style={
        {
          "--sidebar-width": "17rem",
          "--sidebar-width-icon": "3.5rem",
        } as React.CSSProperties
      }
    >
      <a className="sr-only z-50 rounded-md bg-background px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4" href="#admin-main">
        Перейти к содержанию
      </a>
      <AdminNavigationFocus />
      <Sidebar collapsible="icon" onMobileCloseAutoFocus={(event) => {
        if (navigatingFromMenu.current) {
          event.preventDefault();
          document.getElementById("admin-main")?.focus({ preventScroll: true });
          navigatingFromMenu.current = false;
        } else {
          event.preventDefault();
          menuTrigger.current?.focus({ preventScroll: true });
        }
      }}>
        <SidebarHeader className="border-b border-sidebar-border p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="h-16 group-data-[collapsible=icon]:h-12" size="lg" tooltip="RaceSide — админка">
                <AdminNavigationLink aria-label="RaceSide, операционная панель" className="group" href="/admin" onMobileNavigate={() => { navigatingFromMenu.current = true; }}>
                  <span className="hidden group-data-[collapsible=icon]:block">
                    <RaceMateMark className="size-5" />
                  </span>
                  <RaceMateLogo className="group-data-[collapsible=icon]:hidden" variant="signature" />
                </AdminNavigationLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {navigationGroups.map((group) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavigation.filter((item) => item.group === group).map((item) => {
                  const active = item.href === "/admin"
                    ? pathname === item.href
                    : pathname.startsWith(item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <AdminNavigationLink href={item.href} onMobileNavigate={() => { navigatingFromMenu.current = true; }}>
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </AdminNavigationLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Открыть публичный сайт">
                <Link href="/" target="_blank">
                  <ExternalLink aria-hidden="true" />
                  <span>Публичный сайт</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="group-data-[collapsible=icon]:hidden">
            <ThemeToggle />
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center">
            <Shield aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span className="truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {email}
            </span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm md:px-6">
          <SidebarTrigger ref={menuTrigger} />
          <AdminCommandMenu />
        </header>
        <main className="min-w-0 flex-1" id="admin-main" tabIndex={-1}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AdminNavigationLink({ href, children, onClick, onMobileNavigate, ...props }: React.ComponentProps<typeof Link> & { onMobileNavigate?: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <Link {...props} href={href} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented && isMobile) { onMobileNavigate?.(); setOpenMobile(false); } }}>{children}</Link>;
}

function AdminNavigationFocus() {
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname && isMobile) {
      setOpenMobile(false);
      document.getElementById("admin-main")?.focus({ preventScroll: true });
    }
    previousPath.current = pathname;
  }, [pathname, isMobile, setOpenMobile]);
  return null;
}
