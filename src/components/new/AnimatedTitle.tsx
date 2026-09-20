"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface AnimatedTitleProps {
  text: string | undefined;
  level?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  size?: "small" | "medium" | "large";
  align?: "left" | "center" | "right";
  className?: string;
  style?: React.CSSProperties;
}

const sizeMap = {
  small: "1.2rem",
  medium: "2rem",
  large: "3rem",
} as const;

// Ported from Frontend/src/components/new/AnimatedTitle.tsx. The SPA used
// styled-components; here we inline the same gradient text animation with no
// extra dependency.
const AnimatedTitle: React.FC<AnimatedTitleProps> = ({
  text,
  level = "h1",
  size = "medium",
  align = "left",
  className = "",
  style = {},
}) => {
  const Tag = level;
  const gradientTextStyle: React.CSSProperties = {
    margin: 0,
    fontFamily: '"Arial", sans-serif',
    fontWeight: "bold",
    fontSize: sizeMap[size],
    textAlign: align,
    background:
      "linear-gradient(45deg, #f9f6ec, #88a1a8, #502940, #790614, #0d0c0c)",
    backgroundSize: "200% 200%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation: "doceilusao-gradientAnimation 8s ease-in-out infinite",
  };

  return (
    <>
      <style>{`
        @keyframes doceilusao-gradientAnimation {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
      <Tag className={cn(className)} style={{ ...gradientTextStyle, ...style }}>
        {text}
      </Tag>
    </>
  );
};

export default AnimatedTitle;
