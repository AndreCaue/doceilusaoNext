"use client";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, File, CheckCircle, X, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import type {
  FieldPath,
  FieldValues,
  UseControllerProps,
} from "react-hook-form";

interface UploadedFile {
  name: string;
  url: string;
  file: File;
}

type TUploadImage = {
  required?: boolean;
  label?: string;
  maxFiles?: number;
  isSkeletonLoading?: boolean;
  className?: string;
};

export const UploadImage = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  className,
  label,
  control,
  name,
  required,
  maxFiles = 5,
  isSkeletonLoading,
  ...props
}: TUploadImage & UseControllerProps<TFieldValues, TName>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const currentUploadedFiles = (field.value || []) as UploadedFile[];
        const [isUploading, setIsUploading] = useState<boolean>(false);

        const onDrop = useCallback(
          (acceptedFiles: File[]) => {
            setIsUploading(true);

            const newFiles = acceptedFiles
              .slice(0, maxFiles - currentUploadedFiles.length)
              .map((file: File) => ({
                name: file.name,
                url: URL.createObjectURL(file),
                file: file,
              }));

            const updatedFiles = [...currentUploadedFiles, ...newFiles];
            field.onChange(updatedFiles);

            setIsUploading(false);
          },
          [currentUploadedFiles, maxFiles, field.onChange],
        );

        const { getRootProps, getInputProps, isDragActive } = useDropzone({
          onDrop,
          accept: { "image/*": [] },
          maxFiles,
          multiple: true,
        });

        const removeFile = (indexToRemove: number) => {
          URL.revokeObjectURL(currentUploadedFiles[indexToRemove].url);

          const updatedFiles = currentUploadedFiles.filter(
            (_, index: number) => index !== indexToRemove,
          );
          field.onChange(updatedFiles);
        };

        const currentCount = currentUploadedFiles.length;
        const isFull = currentCount >= maxFiles;

        return (
          <FormItem className={className}>
            {isSkeletonLoading ? (
              <>
                <Skeleton className="h-[23px] w-1/2 max-w-full" />
                <Skeleton className="h-[200px] w-full max-w-full" />
              </>
            ) : (
              <>
                <FormLabel className="text-white">
                  {label}
                  {required && <span className="text-red-500">*</span>}
                </FormLabel>

                <FormControl>
                  <div {...props}>
                    {currentCount > 0 ? (
                      <div className="flex flex-col space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                          {currentUploadedFiles.map(
                            (uploadedFile: UploadedFile, index: number) => (
                              <div
                                key={index}
                                className="relative flex flex-col items-center p-2 border border-gray-600 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
                              >
                                <File className="w-8 h-8 text-gray-400 mb-2" />
                                <p className="text-white text-sm text-center truncate max-w-[120px]">
                                  {uploadedFile.name}
                                </p>
                                <button
                                  onClick={() => removeFile(index)}
                                  className="absolute top-1 right-1 p-1 text-gray-400 hover:text-red-400 transition-colors rounded-full bg-gray-900/50"
                                  type="button"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ),
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-green-400">
                          <CheckCircle />
                          <p className="font-medium shrink-0">
                            {currentCount} de {maxFiles} arquivo(s) carregado(s)
                            com sucesso!
                          </p>
                        </div>
                        {!isFull && (
                          <div
                            {...getRootProps()}
                            className="dropzone relative flex flex-col items-center justify-center border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer 
                                   bg-gradient-to-br from-gray-800 via-gray-900 to-black hover:from-gray-700 hover:to-gray-800 
                                   transition-all duration-300 shadow-lg hover:shadow-xl"
                          >
                            <input
                              {...getInputProps()}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <Upload className="w-8 h-8 text-gray-400 mb-2" />
                            <p className="text-white text-sm">
                              Adicionar mais (até {maxFiles})
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        {...getRootProps()}
                        className="dropzone relative flex flex-col items-center justify-center border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer 
                               bg-gradient-to-br from-gray-800 via-gray-900 to-black hover:from-gray-700 hover:to-gray-800 
                               transition-all duration-300 shadow-lg hover:shadow-xl min-h-[100px]"
                      >
                        <input
                          {...getInputProps()}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />

                        <div className="flex flex-col items-center space-y-4">
                          {isUploading ? (
                            <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
                          ) : (
                            <Upload className="w-12 h-12 text-gray-400 hover:text-blue-400 transition-colors duration-300" />
                          )}

                          {isDragActive ? (
                            <div className="space-y-1">
                              <p className="text-white font-medium">
                                Solte as imagens aqui...
                              </p>
                              <p className="text-gray-400 text-sm">
                                Até {maxFiles} arquivos
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-white font-medium">
                                Arraste imagens aqui ou clique para selecionar
                              </p>
                              <p className="text-gray-400 text-sm">
                                Suporte para JPG, PNG e GIF (máx. 5MB cada)
                              </p>
                            </div>
                          )}
                        </div>

                        {isUploading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                            <p className="text-white">Processando...</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </>
            )}
          </FormItem>
        );
      }}
    />
  );
};

UploadImage.displayName = "UploadImage";
