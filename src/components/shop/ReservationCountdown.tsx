"use client";

// Live countdown timer for order reservation (CHECKOUT-03).
// Displays remaining time from reservation_expires_at (6h window per plan).
// When countdown reaches zero, signals expiry to parent via onExpired callback.
//
// Props are serialized ISO strings from the Server Component — no Date objects
// cross the client boundary.

import { useEffect, useState, useCallback } from "react";

// `expiresAt` receives the serialized `reservation_expires_at` ISO string from
// the order (the page passes order.reservation_expires_at as this prop).
type ReservationCountdownProps = {
  expiresAt: string | null;
  expired: boolean;
  onExpired?: () => void;
};

function formatCountdown(ms: number): { hours: number; minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

const ReservationCountdown = ({
  expiresAt,
  expired: initialExpired,
  onExpired,
}: ReservationCountdownProps) => {
  const [isExpired, setIsExpired] = useState(initialExpired);

  const computeRemaining = useCallback((): number => {
    if (!expiresAt || initialExpired) return 0;
    const target = new Date(expiresAt).getTime();
    return Math.max(0, target - Date.now());
  }, [expiresAt, initialExpired]);

  const [remaining, setRemaining] = useState(() => computeRemaining());

  useEffect(() => {
    // If already expired on mount, signal immediately
    if (remaining <= 0 && !isExpired) {
      setIsExpired(true);
      onExpired?.();
      return;
    }

    const interval = setInterval(() => {
      const left = computeRemaining();
      setRemaining(left);

      if (left <= 0) {
        clearInterval(interval);
        setIsExpired(true);
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [computeRemaining, isExpired, onExpired]);

  // Parent handles expired state (destructive banner + CTA)
  if (isExpired || remaining <= 0) {
    return null;
  }

  const { hours, minutes, seconds } = formatCountdown(remaining);

  return (
    <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4 text-center">
      <p className="text-sm text-muted-foreground">
        Reserve seu pedido por mais{" "}
        <span className="font-semibold text-slate-200">
          {hours}h {minutes}m {seconds}s
        </span>
      </p>
    </div>
  );
};

export { ReservationCountdown };
