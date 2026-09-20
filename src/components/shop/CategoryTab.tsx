"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Glasses, Star } from "lucide-react";
import { useMemo } from "react";
import { categoryStyles } from "./helper";
import type { CatalogCategory } from "@/lib/types/catalog";

type TCategoryTab = {
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  selectedCategory: string;
  category: CatalogCategory[];
};

export const CategoryTab = ({
  selectedCategory,
  setSelectedCategory,
  category,
}: TCategoryTab) => {
  const tabIcon: Record<string, React.JSX.Element> = {
    heart: (
      <span
        className={cn(
          "text-red-500",
          selectedCategory === "bicycle" && "text-white",
        )}
      >
        ♥
      </span>
    ),
    hatGlasses: <Glasses className="text-white" />,
    star: <Star className="fill-black" />,
    pokerHand: <span className="text-white">♠</span>,
  };

  const tabs = useMemo(() => {
    return category.map((cat) => {
      const style = categoryStyles[cat.name] || {
        icon: "default",
        color: "from-gray-600 to-gray-800",
        nameStyle: "",
        selectorColor: "text-white",
      };

      return {
        ...cat,
        icon: style.icon,
        color: style.color,
        nameStyle: style.nameStyle,
        selectorColor: style.selectorColor,
      };
    });
  }, [category]);

  return (
    <motion.div
      className="flex justify-center gap-4 mb-16 flex-wrap md:px-20"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
    >
      {tabs?.map((tab) => (
        <motion.button
          key={tab.id}
          onClick={() => setSelectedCategory(tab.name)}
          className={cn(
            "relative px-8 py-5 rounded-2xl font-bold text-lg transition-all",
            selectedCategory === tab.name
              ? "text-white shadow-2xl"
              : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 backdrop-blur-sm",
          )}
          whileHover={{ scale: 1.05, y: -5 }}
          whileTap={{ scale: 0.95 }}
        >
          {selectedCategory === tab.name && (
            <motion.div
              layoutId="tabBackground"
              className={cn(
                "absolute inset-0 bg-gradient-to-r rounded-2xl",
                tab.color,
              )}
              initial={false}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
          <span
            className={cn(
              "relative flex z-10 items-center gap-2",
              tab.nameStyle,
            )}
          >
            <span className="text-3xl">{tabIcon[tab.icon]}</span>
            {tab.name}
          </span>
          {selectedCategory === tab.name && (
            <motion.div
              className="absolute -top-8 left-1/2 -translate-x-1/2"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <div className={cn("text-2xl rotate-180", tab.selectorColor)}>
                ♠
              </div>
            </motion.div>
          )}
        </motion.button>
      ))}
    </motion.div>
  );
};
