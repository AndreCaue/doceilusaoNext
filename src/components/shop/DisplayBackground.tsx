"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Sparkles {
  x: number;
  y: number;
  rotate: number;
  animateY: number;
  animateRotate: number;
  duration: number;
  symbol: string;
}

function buildSparkles(): Sparkles[] {
  const width = typeof window !== "undefined" ? window.innerWidth : 0;
  const height = typeof window !== "undefined" ? window.innerHeight : 0;
  return [...Array(20)].map(() => ({
    x: Math.random() * width,
    y: Math.random() * height,
    rotate: Math.random() * 360,
    animateY: Math.random() * height,
    animateRotate: Math.random() * 360 + 360,
    duration: 20 + Math.random() * 10,
    symbol: ["♠", "♥", "♦", "♣"][Math.floor(Math.random() * 4)],
  }));
}

export const DisplayBackground = () => {
  const [sparkles, setSparkles] = useState<Sparkles[]>([]);

  useEffect(() => {
    setSparkles(buildSparkles());
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {sparkles.map((s, i) => (
        <motion.div
          key={i}
          className="absolute text-4xl opacity-10"
          initial={{
            x: s.x,
            y: s.y,
            rotate: s.rotate,
          }}
          animate={{
            y: [null, s.animateY],
            rotate: [null, s.animateRotate],
            opacity: [0.1, 0.05, 0.1],
          }}
          transition={{
            duration: s.duration,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          {s.symbol}
        </motion.div>
      ))}
    </div>
  );
};