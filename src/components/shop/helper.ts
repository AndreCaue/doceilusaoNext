// Shared shop-display variants + category styling — ported verbatim from
// Frontend/src/Pages/Shop/Display/helper/index.tsx (27-UI-SPEC animation contract).
// Values must match the SPA exactly.

export const categoryStyles: Record<
  string,
  {
    icon: string;
    color: string;
    nameStyle: string;
    selectorColor: string;
  }
> = {
  Bicycle: {
    icon: "heart",
    color: "from-red-600 to-red-800 cursor-pointer",
    nameStyle: "cursor-pointer",
    selectorColor: "text-black",
  },
  Gimmick: {
    icon: "hatGlasses",
    color: "from-black/50 to-black/80 cursor-pointer",
    nameStyle: "cursor-pointer",
    selectorColor: "text-red-500",
  },
  Coleção: {
    icon: "star",
    color: "from-red-600 to-red-800 cursor-pointer",
    nameStyle: "cursor-pointer",
    selectorColor: "text-black",
  },
  Cardistry: {
    icon: "pokerHand",
    color: "from-black/50 to-black/80",
    nameStyle: "",
    selectorColor: "",
  },
};

export const cardMotion = {
  rest: {
    y: 20,
    opacity: 0.4,
    scale: 0.94,
    rotateX: 8,
    transition: { duration: 0.9, ease: "easeOut" },
  },
  hover: {
    y: -16,
    opacity: 1,
    scale: 1.04,
    rotateX: 0,
    rotateY: 4,
    transition: { type: "spring", stiffness: 280, damping: 22 },
  },
} as const;

export const glowMotion = {
  rest: { opacity: 0 },
  hover: { opacity: 0.35, scale: 1.3, transition: { duration: 1.1 } },
};
