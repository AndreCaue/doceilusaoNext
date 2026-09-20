"use client";

import { Topbar } from "@/components/topbar/Topbar";
import { SidebarProvider } from "@/components/ui/sidebar";
import React from "react";

// Public store route group — applies the Topbar to every public store page.
// Wrapped in SidebarProvider because Topbar renders a SidebarTrigger (mobile
// menu / admin toggle) which requires the provider context. Public pages do not
// render the admin AppSidebar.
export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Topbar />
      <main className="min-h-screen">{children}</main>
    </SidebarProvider>
  );
}
