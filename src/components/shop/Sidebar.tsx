"use client";

import React from "react";
import {
  Settings,
  User2,
  Database,
  ShoppingCart,
  ListOrdered,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarFooter,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

type TItem = {
  id: number;
  title: string;
  url: string | undefined;
  icon: React.ComponentType<{ className?: string }>;
  subItem?:
    | {
        id: number;
        title: string;
        url: string;
        disabled?: boolean;
      }[]
    | undefined;
};

// Static admin navigation — placeholder for the SPA's getSidebarOptions()
// repository (Repositories/sidebar not ported this phase).
const sidebarOptions: { items: TItem[]; userOptions: TItem } = {
  items: [
    {
      id: 1,
      title: "Produtos",
      url: "/admin/produtos",
      icon: ShoppingCart,
      subItem: [
        { id: 11, title: "Listar", url: "/admin/produtos" },
        { id: 12, title: "Criar", url: "/admin/produtos/novo" },
      ],
    },
    {
      id: 2,
      title: "Categorias",
      url: "/admin/categorias",
      icon: Database,
      subItem: [
        { id: 21, title: "Listar", url: "/admin/categorias" },
        { id: 22, title: "Criar", url: "/admin/categorias/novo" },
      ],
    },
    {
      id: 3,
      title: "Pedidos",
      url: "/admin/pedidos",
      icon: ListOrdered,
      subItem: [{ id: 31, title: "Listar", url: "/admin/pedidos" }],
    },
    {
      id: 4,
      title: "Configurações",
      url: "/admin/configuracoes",
      icon: Settings,
    },
  ],
  userOptions: {
    id: 91,
    title: "Admin",
    url: undefined,
    icon: User2,
    subItem: [
      { id: 91, title: "Logout", url: "/" },
      { id: 92, title: "Perfil", url: "/admin/perfil" },
    ],
  },
};

export function AppSidebar() {
  const { logout } = useAuth();
  const { setOpenMobile, setOpen } = useSidebar();

  const handleClick = (id: number) => {
    if (id === 91) {
      logout();
    }
    closeSidebar();
  };

  const closeSidebar = () => {
    setOpen(false);
    setOpenMobile(false);
  };

  const UserIcon = sidebarOptions?.userOptions?.icon ?? User2;

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="md:py-20 min-w-[250px]">
            <SidebarMenu>
              {(sidebarOptions?.items ?? []).map((item, index) => {
                const IconComponent = item.icon;
                return (
                  <Collapsible className="group/collapsible" key={index + 1}>
                    <SidebarGroup key={index}>
                      <SidebarGroupLabel asChild>
                        <CollapsibleTrigger className="hover:bg-gray-100 gap-4 group-data-[state=open]/collapsible:bg-gray-200 cursor-pointer border">
                          <IconComponent className="size-4" />
                          {item.title}
                          <span className="ml-auto -rotate-90 transition-transform group-data-[state=open]/collapsible:-rotate-180 text-black">
                            {item.subItem ? <>&spades;</> : null}
                          </span>
                        </CollapsibleTrigger>
                      </SidebarGroupLabel>
                      {item.subItem && item.subItem.length > 0
                        ? item.subItem.map((sub, i) => (
                            <CollapsibleContent
                              className="flex pl-6 py-1"
                              key={i}
                            >
                              <SidebarMenuButton
                                onClick={closeSidebar}
                                disabled={sub.disabled || false}
                                className="cursor-pointer"
                                asChild
                              >
                                <a href={sub.url}>
                                  <span className="mx-2 rotate-90">♠</span>
                                  {sub.title}
                                </a>
                              </SidebarMenuButton>
                            </CollapsibleContent>
                          ))
                        : null}
                    </SidebarGroup>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton>
              <UserIcon className="size-4" />
              {sidebarOptions?.userOptions?.title}
              <span className="ml-auto transition-transform duration-200 -rotate-90 [button[data-state=open]_&]:rotate-0">
                ♠
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            className="gap-2 text-center flex flex-col"
          >
            {sidebarOptions?.userOptions?.subItem?.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="w-[250px] border mb-1 hover:bg-black hover:text-white hover:border-white cursor-pointer border-black rounded-full"
              >
                <button
                  className="cursor-pointer"
                  onClick={() => handleClick(item.id)}
                  disabled={item.disabled}
                >
                  {item.title}
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
