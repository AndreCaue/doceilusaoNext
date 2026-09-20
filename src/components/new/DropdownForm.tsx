"use client";

import React, { useEffect, useRef, useState } from "react";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  FieldPath,
  FieldValues,
  UseControllerProps,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

export type IDropdownOption = {
  value: number;
  text: string;
};

function isTruthyOrZero(v: unknown): boolean {
  return v !== "" && v !== null && v !== undefined;
}

export type TOptionsSelectForm = IDropdownOption & {
  searchValue?: string;
};

type TSelectForm = {
  maxLength?: number;
  onChangeValue?: (value: number | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  options: TOptionsSelectForm[] | null;
  className?: string;
  autoSetUnique?: boolean;
  testId?: string;
  tooltip?: string | React.ReactNode;
  isSkeletonLoading?: boolean;
  inputClass?: string;
  placeholder?: string;
  ariaLabel?: string;
  searchAriaLabel?: string;
  bgTransparent?: boolean;
  hideCommand?: boolean;
  filter?: (value: string, search: string) => number;
};

const DropdownForm = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  name,
  control,
  options,
  ...props
}: TSelectForm & UseControllerProps<TFieldValues, TName>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <InternalSelectForm
          field={field}
          options={options}
          {...props}
        />
      )}
    />
  );
};

type TInternalSelectForm = {
  field: Record<string, unknown> & {
    value?: number | null;
    onChange: (...args: unknown[]) => void;
    onBlur?: () => void;
    ref: (el: unknown) => void;
  };
} & TSelectForm;

const InternalSelectForm: React.FC<TInternalSelectForm> = ({
  field,
  options,
  testId = "selectForm",
  tooltip,
  isSkeletonLoading,
  inputClass,
  placeholder = "Selecione...",
  ariaLabel,
  hideCommand = false,
  bgTransparent = false,
  searchAriaLabel = "Digite para filtrar os itens da lista",
  ...props
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [popoverResizeWidth, setPopoverResizeWidth] = useState("");
  const internalRef = useRef<HTMLButtonElement>(null);

  const isFetching = options === null;

  const handleOpenChange = (open: boolean) => {
    if (props.disabled || isFetching) return;
    setIsMenuOpen(open);
  };

  const handleClear = () => {
    field.onChange?.(null);
    props.onChangeValue?.(null);
  };

  const handleSelect = (value: number) => {
    field.onChange(value);
    props.onChangeValue?.(value);
    setIsMenuOpen(false);
  };

  useEffect(() => {
    const updatePopoverResize = () => {
      if (internalRef.current) {
        setPopoverResizeWidth(`${internalRef.current.offsetWidth}px`);
      }
    };
    updatePopoverResize();

    const handleResize = () => updatePopoverResize();
    window.addEventListener("resize", handleResize);

    const observer = new ResizeObserver(updatePopoverResize);
    if (internalRef.current) observer.observe(internalRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (internalRef.current) observer.unobserve(internalRef.current);
    };
  }, [options]);

  return (
    <FormItem className={props.className}>
      {isSkeletonLoading ? (
        <>
          <Skeleton className="h-[23px] w-1/2 max-w-full" />
          <Skeleton className="h-[40px] w-full max-w-full lg:h-[42px]" />
        </>
      ) : (
        <>
          <FormLabel>
            <>
              {props.label}
              {props.required && <span className="text-red-500">*</span>}
            </>
            {tooltip && (
              <Check className="ml-1 inline size-4 cursor-pointer text-primary" />
            )}
          </FormLabel>

          <div
            className={cn(
              "my-3 flex w-full flex-row items-start justify-between rounded border sm:items-center",
              inputClass,
              (props.disabled || isFetching) &&
                "cursor-not-allowed bg-slate-50/20 opacity-50",
            )}
          >
            <Popover
              open={isMenuOpen}
              onOpenChange={handleOpenChange}
              modal={true}
            >
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    data-testid={testId}
                    ref={(e) => {
                      field.ref(e);
                      internalRef.current = e as HTMLButtonElement;
                    }}
                    disabled={props.disabled || isFetching}
                    onBlur={field.onBlur}
                    variant="outline"
                    role="combobox"
                    aria-expanded={isMenuOpen}
                    className="flex min-h-10 w-full flex-row hover:text-white placeholder:text-white justify-between whitespace-normal text-wrap break-words border-none bg-transparent px-3 py-2.5 text-left ring-2 ring-transparent hover:bg-transparent hover:ring-gray-400 focus-visible:ring-offset-0"
                    aria-labelledby={ariaLabel ? "button-aria-label" : undefined}
                  >
                    {isTruthyOrZero(field.value) ? (
                      <span className="text-white">
                        {options?.find((opt) => opt.value === field.value)
                          ?.text ?? placeholder}
                      </span>
                    ) : (
                      <span
                        className="text-slate-500"
                        aria-hidden={Boolean(ariaLabel)}
                      >
                        {placeholder}
                      </span>
                    )}

                    <span className="flex items-center gap-2">
                      {isTruthyOrZero(field.value) && (
                        <span
                          role="button"
                          aria-label="Limpar seleção"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleClear();
                          }}
                        >
                          <X className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <span
                        className={cn(
                          "transition-transform",
                          isMenuOpen && "rotate-180",
                        )}
                      >
                        <Check className="size-4 -rotate-90 text-muted-foreground" />
                      </span>
                    </span>
                  </Button>
                </FormControl>
              </PopoverTrigger>

              {Boolean(ariaLabel) && (
                <span id="button-aria-label" className="sr-only">
                  {ariaLabel}
                </span>
              )}

              <PopoverContent
                className={cn(
                  "group max-w-full p-0",
                  bgTransparent && "bg-transparent text-white font-bold",
                )}
                style={{ width: popoverResizeWidth }}
                data-testid="triggerDropdown"
              >
                <Command
                  filter={props.filter}
                  className={cn(bgTransparent && "bg-transparent text-white")}
                >
                  {hideCommand ? null : (
                    <CommandInput
                      placeholder="Pesquisar"
                      data-testid="searchCommandInputBottom"
                      autoFocus
                      aria-label={searchAriaLabel}
                      role="search"
                    />
                  )}

                  <CommandList className="max-h-[150px] h-sm:max-h-[200px] h-md:max-h-[300px]">
                    <CommandEmpty>Nenhum resultado encontrado</CommandEmpty>

                    <CommandGroup>
                      {options?.map((option) => (
                        <CommandItem
                          value={
                            option.searchValue
                              ? option.text + option.searchValue
                              : option.text
                          }
                          key={option.value}
                          onSelect={() =>
                            handleSelect(option.value)
                          }
                          className={cn(
                            "py-2 text-lg border-b",
                            bgTransparent &&
                              "text-white data-[selected=true]:text-white data-[selected=true]:bg-black",
                          )}
                        >
                          <div
                            className={cn(
                              "ml-2 -mr-2 h-4 w-4 rotate-90 text-center",
                              option.value === field.value
                                ? "opacity-100"
                                : "opacity-0",
                              bgTransparent && "bg-transparent text-white",
                            )}
                          >
                            &spades;
                          </div>
                          {option.text}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <FormMessage />
        </>
      )}
    </FormItem>
  );
};

export { DropdownForm };
