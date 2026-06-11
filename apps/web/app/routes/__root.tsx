import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/app/components/ui/sonner";
import { TooltipProvider } from "@/app/components/ui/tooltip";
import { AuthFetch } from "@/app/components/auth-fetch";
import { HelpOverlay } from "@/app/components/HelpOverlay";
import { CommandPalette } from "@/app/components/CommandPalette";
import { RegisterServiceWorker } from "@/app/components/RegisterServiceWorker";
import { MobileTabBar } from "@/app/components/MobileTabBar";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  return (
    <TooltipProvider delayDuration={200}>
      <AuthFetch />
      <RegisterServiceWorker />
      <Outlet />
      <HelpOverlay />
      <CommandPalette />
      <Toaster />
      <MobileTabBar />
    </TooltipProvider>
  );
}
