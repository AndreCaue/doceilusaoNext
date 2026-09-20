"use client";

import React from "react";
import { useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";
import type { CatalogProduct } from "@/lib/types/catalog";

type TImages = {
  product: CatalogProduct;
};

/**
 * Product image gallery (STORE-02 / D-07).
 *
 * Product images are served as plain PUBLIC S3 bucket URLs
 * (https://{bucket}.s3.sa-east-1.amazonaws.com/products/{sku}/image_{n}.{ext})
 * and optimized via Next.js Image with remotePatterns pinned to the public
 * S3 host (next.config.ts — T-27-05-02). This is the left column on the
 * product detail page and is adapted from the Plan 27-03 port to `next/image`.
 */
export const Images = ({ product }: TImages) => {
  const images = product.image_urls || [];
  const [activeImage, setActiveImage] = useState(images[0]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-auto overflow-hidden rounded-3xl bg-gray-50 group">
        {activeImage ? (
          <Image
            src={activeImage}
            alt={product.name}
            width={800}
            height={800}
            priority
            className="h-[400px] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400">
            <Package className="w-16 h-16" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-black/5" />
      </div>

      {images.length > 1 && (
        <div className="flex gap-3 flex-wrap">
          {images.slice(0, 5).map((img, i) => {
            const isActive = img === activeImage;

            return (
              <button
                key={img ?? i}
                onClick={() => setActiveImage(img)}
                className={`
                  relative h-20 w-20 overflow-hidden rounded-xl
                  transition-all duration-300
                  ${
                    isActive
                      ? "ring-2 ring-black scale-[1.02]"
                      : "ring-1 ring-black/10 opacity-70 hover:opacity-100"
                  }
                `}
                type="button"
              >
                <Image
                  src={img}
                  alt={`${product.name} ${i + 1}`}
                  width={80}
                  height={80}
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
