import * as React from "react";
import { cn } from "@/lib/utils";
import { Eye, Truck } from "lucide-react";

interface InputProps extends React.ComponentProps<"input"> {
  icon?: React.ReactNode;
  setToggle?: React.Dispatch<React.SetStateAction<boolean>>;
  typeInput?: string;
  toggleEye?: boolean;
  background?: "light" | "dark";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      icon,
      setToggle,
      typeInput,
      toggleEye = false,
      background = "dark",
      ...props
    },
    ref,
  ) => {
    return (
      <div className="relative flex items-center">
        {icon && (
          <div
            className={cn(
              "absolute left-3 flex items-center pointer-events-none",
              background === "light" ? "text-black placeholder:text-black/50" : "text-white",
            )}
          >
            {icon}
          </div>
        )}

        <input
          type={toggleEye ? "text" : type}
          className={cn(
            "flex h-10 w-full lg:border border-b rounded bg-transparent px-3 py-1 placeholder:text-white/50 text-base shadow-sm transition-colors focus-visible:ring-0 focus-visible:outline-none lg:focus-visible:ring-1 lg:focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm disabled:bg-gray-300",
            icon ? "pl-20" : "",
            background === "light" ? "text-black placeholder:text-black/50" : "text-white",
            className,
          )}
          ref={ref}
          {...props}
        />

        {typeInput === "inputpass" && (
          <Eye
            className="absolute right-0 text-white hover:text-white/50 hover:cursor-pointer mx-2"
            onClick={() => setToggle?.((prev) => !prev)}
          />
        )}

        {typeInput === "frete" && (
          <button
            className="absolute mr-2 right-0 text-black hover:text-black/50 hover:cursor-pointer hover:scale-105"
            type="button"
          >
            <Truck />
          </button>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

export { Input };
