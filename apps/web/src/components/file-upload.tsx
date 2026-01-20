"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileJson, FileSpreadsheet, File, Link, Clipboard, CheckCircle2, Loader2, Sparkles, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface DocumentGenerationConfig {
  questions_per_chunk?: number;
  style?: 'qa' | 'instruction' | 'summary';
  provider?: string;
  model?: string;
  temperature?: number;
}

interface FileUploadProps {
  onImport: (data: any[], format: string, file?: File) => void;
  onUrlImport?: (url: string) => void;
  onDocumentGenerate?: (file: File, config: DocumentGenerationConfig) => void;
  isLoading?: boolean;
}

export function FileUpload({ onImport, onUrlImport, onDocumentGenerate, isLoading = false }: FileUploadProps) {
  const [pasteContent, setPasteContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docConfig, setDocConfig] = useState<DocumentGenerationConfig>({
    questions_per_chunk: 3,
    style: 'qa',
    provider: 'ollama',
    model: 'llama3.2',
    temperature: 0.7,
  });

  const processFile = async (file: File) => {
    // Pass the file to the parent for API handling
    onImport([], "auto", file);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      // Pass the file to the parent for API handling
      onImport([], "auto", acceptedFiles[0]);
    }
  }, [onImport]);

  const onDocDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setDocFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/json": [".json", ".jsonl"],
      "text/csv": [".csv", ".tsv"],
      "application/x-parquet": [".parquet"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
    },
    maxFiles: 1,
    disabled: isLoading,
  });

  const { getRootProps: getDocRootProps, getInputProps: getDocInputProps, isDragActive: isDocDragActive } = useDropzone({
    onDrop: onDocDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "text/html": [".html"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
    },
    maxFiles: 1,
    disabled: isLoading,
  });

  const handlePaste = async () => {
    if (!pasteContent.trim()) {
      toast.error("Please paste some content first");
      return;
    }

    try {
      // Try to parse as JSON/JSONL
      let data: any[] = [];
      const lines = pasteContent.trim().split("\n");

      if (lines.length === 1 && pasteContent.trim().startsWith("[")) {
        // JSON array
        data = JSON.parse(pasteContent);
      } else {
        // JSONL
        data = lines
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      }

      onImport(data, "auto");
      setPasteContent("");
    } catch (error) {
      toast.error("Could not parse pasted content. Please use JSON or JSONL format.");
    }
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) {
      toast.error("Please enter a URL");
      return;
    }

    if (onUrlImport) {
      onUrlImport(urlInput.trim());
      setUrlInput("");
    } else {
      toast.error("URL import not configured");
    }
  };

  const handleDocumentGenerate = () => {
    if (!docFile) {
      toast.error("Please select a document first");
      return;
    }

    if (onDocumentGenerate) {
      onDocumentGenerate(docFile, docConfig);
      setDocFile(null);
    } else {
      toast.error("Document generation not configured");
    }
  };

  return (
    <Tabs defaultValue="file" className="w-full">
      <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1">
        <TabsTrigger value="file" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Upload className="w-4 h-4 mr-2" />
          File Upload
        </TabsTrigger>
        <TabsTrigger value="document" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Sparkles className="w-4 h-4 mr-2" />
          From Document
        </TabsTrigger>
        <TabsTrigger value="paste" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Clipboard className="w-4 h-4 mr-2" />
          Paste Data
        </TabsTrigger>
        <TabsTrigger value="url" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Link className="w-4 h-4 mr-2" />
          From URL
        </TabsTrigger>
      </TabsList>

      <TabsContent value="file" className="mt-6">
        <Card variant="elevated">
          <CardContent className="pt-6 pb-6">
            <div
              {...getRootProps()}
              className={`
                relative border-2 border-dashed rounded-xl p-16 text-center cursor-pointer
                transition-all duration-300
                ${isDragActive
                  ? "border-primary bg-primary/5 shadow-glow-sm"
                  : "border-border hover:border-primary/50"
                }
                ${isLoading
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-muted/30"
                }
              `}
            >
              <input {...getInputProps()} />

              {/* Background decorative elements */}
              <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                <div className="absolute top-0 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
                <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-[hsl(262,83%,58%)]/5 rounded-full blur-3xl" />
              </div>

              {isLoading ? (
                <div className="relative space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">Processing file...</p>
                    <p className="text-sm text-muted-foreground mt-1">Detecting format and validating data</p>
                  </div>
                  <div className="w-64 mx-auto h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-[hsl(262,83%,58%)] animate-shimmer"
                         style={{ backgroundSize: '200% 100%' }} />
                  </div>
                </div>
              ) : isDragActive ? (
                <div className="relative space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-primary flex items-center justify-center shadow-glow">
                    <Upload className="w-8 h-8 text-primary-foreground animate-bounce" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg text-primary">Drop your file here</p>
                    <p className="text-sm text-muted-foreground mt-1">Release to start import</p>
                  </div>
                </div>
              ) : (
                <div className="relative space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-muted/80 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">Drop your dataset here</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      or <span className="text-primary font-medium">click to browse</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Supported formats */}
            <div className="mt-8 grid grid-cols-3 gap-4">
              <FormatBadge icon={<FileJson className="w-4 h-4" />} label="JSONL, JSON" />
              <FormatBadge icon={<FileSpreadsheet className="w-4 h-4" />} label="CSV, TSV" />
              <FormatBadge icon={<File className="w-4 h-4" />} label="Parquet, TXT, MD" />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="document" className="mt-6">
        <Card variant="elevated">
          <CardContent className="pt-6 pb-6">
            <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-[hsl(262,83%,58%)]/10 border border-primary/20">
              <div className="flex items-center gap-2 text-primary font-medium mb-1">
                <Sparkles className="w-4 h-4" />
                AI-Powered Q&A Generation
              </div>
              <p className="text-sm text-muted-foreground">
                Upload a document and we&apos;ll use AI to automatically generate training Q&A pairs from its content.
              </p>
            </div>

            <div
              {...getDocRootProps()}
              className={`
                relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
                transition-all duration-300
                ${isDocDragActive
                  ? "border-primary bg-primary/5 shadow-glow-sm"
                  : "border-border hover:border-primary/50"
                }
                ${isLoading
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-muted/30"
                }
              `}
            >
              <input {...getDocInputProps()} />

              {docFile ? (
                <div className="relative space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
                    <FileText className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{docFile.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {(docFile.size / 1024).toFixed(1)} KB - Click to change
                    </p>
                  </div>
                </div>
              ) : isDocDragActive ? (
                <div className="relative space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-primary flex items-center justify-center shadow-glow">
                    <FileText className="w-7 h-7 text-primary-foreground animate-bounce" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg text-primary">Drop your document here</p>
                  </div>
                </div>
              ) : (
                <div className="relative space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-muted/80 flex items-center justify-center">
                    <FileText className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">Drop your document here</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      PDF, DOCX, PPTX, XLSX, HTML, TXT, MD
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Generation options */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Generation Style</label>
                <Select
                  value={docConfig.style}
                  onValueChange={(value) => setDocConfig({ ...docConfig, style: value as 'qa' | 'instruction' | 'summary' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qa">Q&A Pairs</SelectItem>
                    <SelectItem value="instruction">Instructions</SelectItem>
                    <SelectItem value="summary">Summaries</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Questions per Chunk</label>
                <Select
                  value={String(docConfig.questions_per_chunk)}
                  onValueChange={(value) => setDocConfig({ ...docConfig, questions_per_chunk: parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 question</SelectItem>
                    <SelectItem value="2">2 questions</SelectItem>
                    <SelectItem value="3">3 questions</SelectItem>
                    <SelectItem value="5">5 questions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="glow"
                onClick={handleDocumentGenerate}
                disabled={isLoading || !docFile}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Q&A Pairs
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="paste" className="mt-6">
        <Card variant="elevated">
          <CardContent className="pt-6 pb-6">
            <textarea
              className="w-full h-72 p-4 rounded-xl border border-border bg-background/50 backdrop-blur-sm font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
              placeholder={`Paste your JSONL or JSON data here...

Example JSONL:
{"messages": [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi!"}]}
{"messages": [{"role": "user", "content": "How are you?"}, {"role": "assistant", "content": "I am doing well!"}]}`}
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
            />
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {pasteContent.trim()
                  ? `${pasteContent.trim().split('\n').filter(l => l.trim()).length} lines detected`
                  : "Supports JSON and JSONL formats"
                }
              </p>
              <Button
                variant="glow"
                onClick={handlePaste}
                disabled={isLoading || !pasteContent.trim()}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Import Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="url" className="mt-6">
        <Card variant="elevated">
          <CardContent className="pt-6 pb-6">
            <div className="space-y-6">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Dataset URL
                </label>
                <input
                  type="url"
                  className="w-full h-11 px-4 rounded-xl border border-border bg-background/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                  placeholder="https://huggingface.co/datasets/..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <span className="text-amber-500 text-lg">🤗</span>
                </div>
                <div>
                  <p className="text-sm font-medium">HuggingFace Hub</p>
                  <p className="text-xs text-muted-foreground">
                    Import directly from HuggingFace datasets
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="glow"
                  onClick={handleUrlImport}
                  disabled={isLoading || !urlInput.trim()}
                >
                  <Link className="w-4 h-4 mr-2" />
                  Import from URL
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function FormatBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50 text-sm text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  );
}
