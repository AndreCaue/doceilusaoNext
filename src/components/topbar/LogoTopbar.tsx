import { cn } from "@/lib/utils";

type TLogoTopbar = {
  className?: string;
};

export const LogoTopbar = ({ className }: TLogoTopbar) => {
  return (
    <div className={cn("max-w-fit flex justify-center", className)}>
      <div>
        <span
          style={{
            fontFamily: "'Road Rage', sans-serif",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: "30px",
          }}
        >
          D
        </span>
        oce
      </div>
      <div>
        <span
          style={{
            fontFamily: "'Road Rage', sans-serif",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: "30px",
          }}
        >
          I
        </span>
        lusão
      </div>
    </div>
  );
};
