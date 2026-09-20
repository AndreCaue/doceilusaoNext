"use client";

import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";

type SearchResult = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  url?: string;
};

type SearchInputProps = {
  placeholder?: string;
  onSearch?: (query: string) => void;
  onResultSelect?: (result: SearchResult) => void;
  searchResults?: SearchResult[];
  isLoading?: boolean;
  background?: "light" | "dark";
  className?: string;
  disabled?: boolean;
  debounceMs?: number;
  showResults?: boolean;
  emptyMessage?: string;
};

/**
 * Inert search shell (D-08). Search is explicitly non-functional this phase: onSearch
 * defaults to a no-op and the input is usually rendered disabled. Ported from
 * Frontend/src/Topbar/Components/SearchInput.tsx (single-use debounce inlined to avoid
 * the use-debounce dependency).
 */
const SearchInput = ({
  placeholder = "Em desenvolvimento (bloqueado)...",
  onSearch,
  onResultSelect,
  searchResults = [],
  isLoading = false,
  background = "light",
  className,
  disabled = false,
  debounceMs = 300,
  showResults = true,
  emptyMessage = "Nenhum resultado encontrado",
}: SearchInputProps) => {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!query || !onSearch) return;
    const handle = setTimeout(() => onSearch(query), debounceMs);
    return () => clearTimeout(handle);
  }, [query, onSearch, debounceMs]);

  const handleClear = useCallback(() => {
    setQuery("");
    onSearch?.("");
  }, [onSearch]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onResultSelect?.(result);
      setQuery("");
      setIsFocused(false);
    },
    [onResultSelect],
  );

  const showResultsPanel =
    showResults &&
    isFocused &&
    query.length > 0 &&
    (searchResults.length > 0 || !isLoading);

  return (
    <div className={cn("relative w-full border ", className)}>
      <div className="relative">
        <Search
          className={cn(
            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
            background === "light" ? "text-gray-500" : "text-gray-400",
          )}
        />

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder={placeholder}
          background={background}
          disabled={disabled}
          className="pl-10 pr-10"
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
          )}

          {query && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(
                "hover:opacity-70 transition-opacity",
                background === "light" ? "text-gray-500" : "text-gray-400",
              )}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showResultsPanel && (
        <div
          className={cn(
            "absolute top-full left-0 right-0 mt-2 rounded-md border shadow-lg z-50 max-h-96 overflow-y-auto",
            background === "light"
              ? "bg-white border-gray-200"
              : "bg-gray-800 border-gray-700",
          )}
        >
          {searchResults.length > 0 ? (
            <div className="py-2">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleResultClick(result)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors",
                    background === "light"
                      ? "hover:bg-gray-100"
                      : "hover:bg-gray-700",
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "font-medium text-sm",
                          background === "light"
                            ? "text-gray-900"
                            : "text-white",
                        )}
                      >
                        {result.title}
                      </span>
                      {result.category && (
                        <span
                          className={cn(
                            "text-xs px-2 py-1 rounded",
                            background === "light"
                              ? "bg-gray-100 text-gray-600"
                              : "bg-gray-700 text-gray-300",
                          )}
                        >
                          {result.category}
                        </span>
                      )}
                    </div>
                    {result.description && (
                      <span
                        className={cn(
                          "text-xs line-clamp-1",
                          background === "light"
                            ? "text-gray-500"
                            : "text-gray-400",
                        )}
                      >
                        {result.description}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p
                className={cn(
                  "text-sm",
                  background === "light" ? "text-gray-500" : "text-gray-400",
                )}
              >
                {emptyMessage}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

SearchInput.displayName = "SearchInput";

export { SearchInput };
export type { SearchResult, SearchInputProps };
