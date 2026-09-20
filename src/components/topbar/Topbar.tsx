"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { ShoppingCartIcon } from "lucide-react";
import { LogoTopbar } from "./LogoTopbar";
import { useState } from "react";
import { SmokeTabs } from "./SmokeTabs";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCart } from "@/hooks/useCart";
import { AnimatedSymbols } from "./AnimatedSymbols";
import { CartBadge } from "./CartBadge";
import { SearchInput } from "./SearchInput";
import { UserTopbar } from "./UserTopbar";
import { cn } from "@/lib/utils";
import { topbarTab } from "./utils";
import type { TValue } from "./UserTopbar";

export const Topbar = () => {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<string | null>("");
  const { user, logout, isGuest } = useAuth();
  const { summary } = useCart();

  const handleLogout = (value: TValue) => {
    switch (value.text) {
      case "Logout":
        logout();
        break;
      default:
        break;
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100">
      <div className="flex items-center justify-between h-16 px-4 lg:px-2 max-w-[1600px] mx-auto">
        <a
          href="/"
          className="flex items-center gap-3 group transition-transform hover:scale-[1.02] active:scale-[0.98]"
          aria-label="Ir para página inicial"
        >
          <LogoTopbar className="w-auto h-8" />
          <AnimatedSymbols hide={isMobile} />
        </a>

        <AnimatedSymbols hide={!isMobile} />

        <div className="hidden lg:flex lg:w-[360px]">
          {/* D-08: search inert */}
          <SearchInput
            background="light"
            disabled
            onSearch={() => {}}
            placeholder="Em desenvolvimento (bloqueado)..."
          />
        </div>

        <div className="flex items-center gap-2 lg:gap-4">
          <UserTopbar
            userEmail={user?.email ?? ""}
            isGuest={isGuest}
            onSelect={handleLogout}
            label="hidden lg:flex"
            options={[
              { text: "Logout", value: 1 },
              { text: "Pedidos", value: 2, href: "/pedidos" },
              { text: "Configurações", value: 3 },
            ]}
          />

          {/* D-09: cart CTA inert this phase */}
          <a
            href="/carrinho"
            className="relative p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors active:scale-95"
            aria-label="Carrinho de compras"
          >
            <ShoppingCartIcon className="w-5 h-5 text-gray-700 " />
            <CartBadge count={summary?.itemCount ?? 0} />
          </a>
          <SidebarTrigger
            className={cn(
              "p-2 rounded-lg hover:bg-gray-100 transition-colors lg:hidden",
              user?.isMaster && "lg:flex",
            )}
          />
        </div>
      </div>

      <SmokeTabs
        tabs={topbarTab}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Search input v1 — mobile, inert (D-08) */}
      {isMobile && <SearchInput background="light" disabled />}
    </header>
  );
};
