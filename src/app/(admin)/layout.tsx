"use client";

import React from "react";
import { Topbar } from "@/components/topbar/Topbar";
import { AppSidebar } from "@/components/shop/Sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

// D-12: The master scope gate now lives in Edge middleware (src/middleware.ts,
// Plan 26-08). This layout only renders AFTER the middleware has already
// verified the request carries a valid master-scope access token. Non-master
// requests are redirected at the edge before reaching here.

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Topbar />
        <main className="min-h-screen p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
