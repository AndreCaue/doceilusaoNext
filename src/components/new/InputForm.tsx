"use client";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import type {
  FieldPath,
  FieldValues,
  UseControllerProps,
} from "react-hook-form";
import type React from "react";
import { cn } from "@/lib/utils";
import { useState } from "react";

type TInputForm = {
  required?: boolean;
  label?: string;
  restrictInput?: RegExp;
  onChangeValue?: (value: string) => void;
  isSkeletonLoading?: boolean;
  placeholder?: string;
  iconPlaceholder?: React.ReactElement;
  maxLength?: number;
  background?: "light" | "dark";
  onBlur?: () => void;
  className?: string;
  disabled?: boolean;
  type?: string;
};

const InputForm = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  className,
  label,
  control,
  name,
  required,
  type = "text",
  iconPlaceholder,
  onChangeValue,
  placeholder = "Digite ...",
  restrictInput,
  onBlur,
  maxLength,
  isSkeletonLoading,
  background = "light",
  disabled,
}: TInputForm & UseControllerProps<TFieldValues, TName>) => {
  const [toggleEye, setToggleEye] = useState(false);

  const isPassword = type === "password" ? "inputpass" : "";

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {isSkeletonLoading ? (
            <>
              <Skeleton className="h-[23px] w-1/2 max-w-full" />
              <Skeleton className="h-[40px] w-full max-w-full lg:h-[42px]" />
            </>
          ) : (
            <>
              <FormLabel
                className={cn(
                  background === "light"
                    ? "text-black placeholder:text-black"
                    : "text-white placeholder:text-white",
                )}
              >
                <>
                  {label}
                  {required && <span className="text-red-500">*</span>}
                </>
              </FormLabel>

              <FormControl>
                <Input
                  {...field}
                  placeholder={placeholder}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    if (restrictInput)
                      event.target.value = event.target.value.replace(
                        restrictInput,
                        "",
                      );

                    field.onChange(event);
                    onChangeValue?.(event.target.value);
                  }}
                  onBlur={onBlur}
                  background={background}
                  maxLength={maxLength}
                  type={type}
                  toggleEye={toggleEye}
                  setToggle={setToggleEye}
                  typeInput={isPassword}
                  icon={iconPlaceholder}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </>
          )}
        </FormItem>
      )}
    />
  );
};

InputForm.displayName = "InputForm";

export { InputForm };
