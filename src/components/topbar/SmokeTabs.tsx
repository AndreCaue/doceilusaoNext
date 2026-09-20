"use client";

import { SmokeLink } from "@/components/new/SmokeLink";
import { SmokeButton } from "@/components/new/SmokeButton";
import { cn } from "@/lib/utils";
import {
  SmokeSubTab,
  SmokeSubTabConteudo,
  SmokeSubTabJogos,
} from "../topbar/utils";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import React from "react";

type TSmokeTabs = {
  tabs: { id: string; label: string; disabled?: boolean }[];
  activeTab: string | null;
  onTabChange: Dispatch<SetStateAction<string | null>>;
  className?: string;
  isMobile?: boolean;
};

export const SmokeTabs = ({
  tabs,
  activeTab,
  onTabChange,
  className,
  isMobile = false,
}: TSmokeTabs) => {
  function onClickCloseSubtab() {
    onTabChange(null);
  }
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeTab) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onTabChange(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeTab, onTabChange]);

  const tabContent: Record<string, React.ReactNode> = {
    loja: (
      <div className="flex justify-between px-10 underline w-full">
        {SmokeSubTab.map((tab) => (
          <SmokeLink
            textLabel={tab.label}
            background="light"
            goTo={`loja/${tab.link}`}
            onClick={onClickCloseSubtab}
            key={tab.label}
          />
        ))}
      </div>
    ),
    conteudo: (
      <div className="flex justify-between px-10 underline w-full">
        {SmokeSubTabConteudo.map((tab) => (
          <SmokeLink
            textLabel={tab.label}
            background="light"
            onClick={onClickCloseSubtab}
            goTo={`conteudo/${tab.link}`}
            key={tab.label}
          />
        ))}
      </div>
    ),
    jogos: (
      <div className="flex justify-between px-10 underline w-full">
        {SmokeSubTabJogos.map((tab) => (
          <SmokeLink
            textLabel={tab.label}
            background="light"
            onClick={onClickCloseSubtab}
            goTo={`/${tab.link}`}
            key={tab.label}
          />
        ))}
      </div>
    ),
  };

  return (
    <div ref={containerRef}>
      <nav className={cn("hidden lg:flex lg:justify-around", className)}>
        {tabs.map((tab) => (
          <SmokeButton
            key={tab.id}
            textLabel={tab.label}
            onClick={() => onTabChange(tab.id)}
            isActive={activeTab === tab.id}
            disabled={tab?.disabled}
            isMobile={isMobile}
          />
        ))}
      </nav>
      {activeTab && (
        <nav className="hidden lg:flex bg-slate-200/40 z-10">
          {tabContent[activeTab]}
        </nav>
      )}
    </div>
  );
};
