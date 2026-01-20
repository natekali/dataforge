"use client";

import { useState, useEffect } from "react";
import { FileUpload } from "@/components/file-upload";
import { ModelSelector } from "@/components/model-selector";
import { DatasetPreview } from "@/components/dataset-preview";
import { ExportPanel } from "@/components/export-panel";
import { ConversationEditor } from "@/components/conversation-editor";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { EnhancementPanel } from "@/components/enhancement-panel";
import { ProjectSettings } from "@/components/project-settings";
import { QualityPanel } from "@/components/quality-panel";
import { SplitManager } from "@/components/split-manager";
import { Header } from "@/components/header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Database,
  Settings,
  Sparkles,
  PenLine,
  BarChart3,
  Plus,
  FolderOpen,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import {
  useProjects,
  useProject,
  useCreateProject,
  useExamples,
  useImportFile,
  useImportUrl,
  useGenerateFromDocument,
  useUpdateExample,
  useDeleteExample,
  useAddExamples,
} from "@/lib/hooks";
import type { Message, DatasetExample } from "@/lib/api";

export default function Home() {
  const {
    currentProjectId,
    setCurrentProjectId,
    targetModel,
    setTargetModel,
    currentStep,
    setCurrentStep,
    detectedFormat,
    setDetectedFormat,
  } = useAppStore();

  // Project management
  const { data: projects, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useProjects();
  const { data: currentProject, isLoading: projectLoading } = useProject(currentProjectId);
  const createProject = useCreateProject();

  // Dataset management
  const { data: examples, isLoading: examplesLoading, refetch: refetchExamples } = useExamples(
    currentProjectId,
    { limit: 1000 }
  );
  const importFile = useImportFile();
  const importUrl = useImportUrl();
  const generateFromDocument = useGenerateFromDocument();
  const updateExample = useUpdateExample();
  const deleteExample = useDeleteExample();
  const addExamples = useAddExamples();

  // Local state for new project dialog
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);

  // Normalize examples for UI components (they expect the old format)
  const normalizedExamples = (examples || []).map((ex) => ({
    id: ex.id,
    messages: ex.messages,
    metadata: ex.metadata,
    split: ex.split,
    quality_score: ex.quality_score,
    token_count: ex.token_count,
  }));

  // Handle file import
  const handleImport = async (data: any[], format: string, file?: File) => {
    if (!currentProjectId) {
      // No project selected - prompt to create one
      toast.error("Please create or select a project first");
      setNewProjectDialogOpen(true);
      return;
    }

    // If we have a file, use file import API
    if (file) {
      try {
        const result = await importFile.mutateAsync({
          projectId: currentProjectId,
          file,
        });

        if (result.success) {
          setDetectedFormat(result.detected_schema.format);
          setCurrentStep("edit");
          toast.success(`Imported ${result.imported} examples`);
          if (result.warnings.length > 0) {
            result.warnings.forEach((w) => toast.warning(w));
          }
        } else {
          toast.error(result.errors.join(", ") || "Import failed");
        }
      } catch (error) {
        toast.error(`Import failed: ${error}`);
      }
    } else if (data.length > 0) {
      // Handle paste import - add examples directly
      try {
        const examples = data.map((item) => ({
          messages: item.messages || [],
          metadata: item.metadata || {},
        }));
        await addExamples.mutateAsync({
          projectId: currentProjectId,
          examples,
        });
        setDetectedFormat(format || "auto");
        setCurrentStep("edit");
        toast.success(`Imported ${data.length} examples from paste`);
      } catch (error) {
        toast.error(`Import failed: ${error}`);
      }
    }
  };

  // Handle URL import (HuggingFace, direct URLs)
  const handleUrlImport = async (url: string) => {
    if (!currentProjectId) {
      toast.error("Please create or select a project first");
      setNewProjectDialogOpen(true);
      return;
    }

    try {
      const result = await importUrl.mutateAsync({
        projectId: currentProjectId,
        url,
      });

      if (result.success) {
        setDetectedFormat(result.detected_schema.format);
        setCurrentStep("edit");
        toast.success(`Imported ${result.imported} examples from URL`);
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((w) => toast.warning(w));
        }
      } else {
        toast.error(result.errors?.join(", ") || "URL import failed");
      }
    } catch (error) {
      toast.error(`URL import failed: ${error}`);
    }
  };

  // Handle document-to-Q&A generation
  const handleDocumentGenerate = async (file: File, config: { questions_per_chunk?: number; style?: string; provider?: string; model?: string; temperature?: number }) => {
    if (!currentProjectId) {
      toast.error("Please create or select a project first");
      setNewProjectDialogOpen(true);
      return;
    }

    try {
      toast.info("Generating Q&A pairs from document... This may take a moment.");
      const result = await generateFromDocument.mutateAsync({
        projectId: currentProjectId,
        file,
        config: config as any,
      });

      if (result.success) {
        setDetectedFormat("chatml");
        setCurrentStep("edit");
        toast.success(`Generated ${result.examples_generated} Q&A pairs from ${result.chunks_processed} chunks`);
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((w) => toast.warning(w));
        }
      } else {
        toast.error(result.errors?.join(", ") || "Document generation failed");
      }
    } catch (error) {
      toast.error(`Document generation failed: ${error}`);
    }
  };

  // Handle example update
  const handleUpdateExample = async (index: number, example: any) => {
    if (!currentProjectId) return;

    const exampleToUpdate = normalizedExamples[index];
    if (!exampleToUpdate) return;

    try {
      await updateExample.mutateAsync({
        projectId: currentProjectId,
        exampleId: exampleToUpdate.id,
        data: { messages: example.messages, metadata: example.metadata },
      });
      toast.success("Example updated");
    } catch (error) {
      toast.error(`Failed to update: ${error}`);
    }
  };

  // Handle example delete
  const handleDeleteExample = async (index: number) => {
    if (!currentProjectId) return;

    const exampleToDelete = normalizedExamples[index];
    if (!exampleToDelete) return;

    try {
      await deleteExample.mutateAsync({
        projectId: currentProjectId,
        exampleId: exampleToDelete.id,
      });
      toast.success("Example deleted");
    } catch (error) {
      toast.error(`Failed to delete: ${error}`);
    }
  };

  // Handle add example
  const handleAddExample = async (example: any) => {
    if (!currentProjectId) return;

    try {
      await addExamples.mutateAsync({
        projectId: currentProjectId,
        examples: [{ messages: example.messages, metadata: example.metadata || {} }],
      });
      toast.success("Example added");
    } catch (error) {
      toast.error(`Failed to add: ${error}`);
    }
  };

  // Handle create project
  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    try {
      const project = await createProject.mutateAsync({
        name: newProjectName.trim(),
        target_model: targetModel || undefined,
      });
      setCurrentProjectId(project.id);
      setNewProjectDialogOpen(false);
      setNewProjectName("");
      toast.success(`Project "${project.name}" created`);
    } catch (error) {
      toast.error(`Failed to create project: ${error}`);
    }
  };

  // Update target model when project changes
  useEffect(() => {
    if (currentProject?.target_model) {
      setTargetModel(currentProject.target_model);
    }
    if (currentProject?.source_format) {
      setDetectedFormat(currentProject.source_format);
    }
  }, [currentProject, setTargetModel, setDetectedFormat]);

  // Update step based on data
  useEffect(() => {
    if (normalizedExamples.length > 0 && currentStep === "import") {
      setCurrentStep("edit");
    }
  }, [normalizedExamples.length, currentStep, setCurrentStep]);

  const hasData = normalizedExamples.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        {/* Project Selector Bar */}
        <Card variant="glass" className="mb-8">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-primary" />
              </div>
              <Select
                value={currentProjectId || ""}
                onValueChange={(id) => {
                  setCurrentProjectId(id);
                  setCurrentStep("import");
                }}
              >
                <SelectTrigger className="w-[280px] bg-background/50">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projectsError ? (
                    <div className="p-3 text-sm">
                      <div className="flex items-center gap-2 text-destructive mb-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>Cannot connect to API</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          refetchProjects();
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : projects && projects.length > 0 ? (
                    projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          {p.name}
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                            {p.example_count}
                          </span>
                        </span>
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-muted-foreground">
                      No projects yet
                    </div>
                  )}
                </SelectContent>
              </Select>

              <Dialog open={newProjectDialogOpen} onOpenChange={setNewProjectDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline-glow" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    New Project
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create New Project</DialogTitle>
                    <DialogDescription>
                      A project contains your dataset and configuration.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Input
                      placeholder="Project name"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                      variant="glow"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setNewProjectDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="glow"
                      onClick={handleCreateProject}
                      disabled={createProject.isPending}
                    >
                      {createProject.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Create Project
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {currentProject && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <div className="status-dot status-dot-success" />
                  <span className="text-muted-foreground">
                    {currentProject.example_count} examples
                  </span>
                </div>
                {currentProject.source_format && (
                  <div className="px-2 py-1 rounded-md bg-muted/50 text-xs font-medium text-muted-foreground">
                    {currentProject.source_format}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* No Project Selected State */}
        {!currentProjectId && (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
            {/* API Error State */}
            {projectsError ? (
              <>
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-destructive/20 blur-3xl rounded-full" />
                  <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-destructive via-destructive to-red-600 flex items-center justify-center">
                    <AlertCircle className="w-12 h-12 text-destructive-foreground" />
                  </div>
                </div>
                <h2 className="text-3xl font-bold mb-3 text-balance text-center">
                  Cannot Connect to API
                </h2>
                <p className="text-muted-foreground mb-4 max-w-md text-center text-balance">
                  The backend API is not reachable. Please make sure the server is running.
                </p>
                <p className="text-sm text-muted-foreground mb-8 max-w-md text-center font-mono bg-muted/50 px-4 py-2 rounded-lg">
                  {projectsError instanceof Error ? projectsError.message : "Network error"}
                </p>
                <Button variant="outline" size="lg" onClick={() => refetchProjects()}>
                  <Loader2 className={`w-5 h-5 mr-2 ${projectsLoading ? 'animate-spin' : ''}`} />
                  Retry Connection
                </Button>
              </>
            ) : projectsLoading ? (
              <>
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                  <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary via-primary to-[hsl(262,83%,58%)] flex items-center justify-center shadow-glow">
                    <Loader2 className="w-12 h-12 text-primary-foreground animate-spin" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold mb-3 text-balance text-center">
                  Connecting to API...
                </h2>
                <p className="text-muted-foreground max-w-md text-center text-balance">
                  Please wait while we connect to the backend server.
                </p>
              </>
            ) : (
              <>
                <div className="relative mb-8">
                  <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                  <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary via-primary to-[hsl(262,83%,58%)] flex items-center justify-center shadow-glow">
                    <Database className="w-12 h-12 text-primary-foreground" />
                  </div>
                </div>
                <h2 className="text-3xl font-bold mb-3 text-balance text-center">
                  Welcome to DataForge Studio
                </h2>
                <p className="text-muted-foreground mb-8 max-w-md text-center text-balance">
                  The ultimate platform for building high-quality fine-tuning datasets.
                  Create a project to get started.
                </p>
                <Button variant="glow" size="lg" onClick={() => setNewProjectDialogOpen(true)}>
                  <Zap className="w-5 h-5 mr-2" />
                  Create Your First Project
                </Button>

                {/* Feature highlights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-16 max-w-3xl w-full">
                  <FeatureCard
                    icon={<Upload className="w-5 h-5" />}
                    title="Smart Import"
                    description="Auto-detect Alpaca, ShareGPT, ChatML formats"
                  />
                  <FeatureCard
                    icon={<Sparkles className="w-5 h-5" />}
                    title="AI Enhancement"
                    description="Generate and improve examples with AI"
                  />
                  <FeatureCard
                    icon={<ArrowRight className="w-5 h-5" />}
                    title="Easy Export"
                    description="Export to Axolotl, Unsloth, and more"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Project Selected - Show Workflow */}
        {currentProjectId && (
          <>
            {/* Progress Steps */}
            <div className="flex items-center justify-center gap-2 mb-8">
              <StepIndicator
                step={1}
                label="Import"
                active={currentStep === "import"}
                completed={hasData}
                onClick={() => setCurrentStep("import")}
              />
              <StepConnector completed={hasData} />
              <StepIndicator
                step={2}
                label="Edit & Configure"
                active={currentStep === "edit"}
                completed={currentStep === "export"}
                onClick={() => hasData && setCurrentStep("edit")}
                disabled={!hasData}
              />
              <StepConnector completed={currentStep === "export"} />
              <StepIndicator
                step={3}
                label="Export"
                active={currentStep === "export"}
                completed={false}
                onClick={() => hasData && setCurrentStep("export")}
                disabled={!hasData}
              />
            </div>

            {/* Main Content */}
            {currentStep === "import" && (
              <div className="max-w-4xl mx-auto animate-fade-in">
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold mb-3">Import Your Dataset</h1>
                  <p className="text-muted-foreground">
                    Drop files or paste data. We&apos;ll auto-detect the format.
                  </p>
                </div>
                <FileUpload
                  onImport={handleImport}
                  onUrlImport={handleUrlImport}
                  onDocumentGenerate={handleDocumentGenerate}
                  isLoading={importFile.isPending || importUrl.isPending || generateFromDocument.isPending}
                />
                {(importFile.isPending || importUrl.isPending || generateFromDocument.isPending) && (
                  <div className="flex items-center justify-center mt-6 text-primary">
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    <span className="font-medium">Importing dataset...</span>
                  </div>
                )}
              </div>
            )}

            {currentStep === "edit" && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold">Configure Dataset</h1>
                    <p className="text-muted-foreground">
                      {examplesLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </span>
                      ) : (
                        <>
                          {normalizedExamples.length} examples
                          {detectedFormat && ` • Detected: ${detectedFormat}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-3 items-center">
                    <ModelSelector value={targetModel} onChange={setTargetModel} />
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="glow"
                        onClick={() => setCurrentStep("export")}
                        disabled={normalizedExamples.length === 0}
                      >
                        Continue to Export
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                      {!targetModel && normalizedExamples.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Tip: Select a target model for optimized configs
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <Tabs defaultValue="preview" className="w-full">
                  <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="preview" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Database className="w-4 h-4 mr-2" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger value="edit" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <PenLine className="w-4 h-4 mr-2" />
                      Edit
                    </TabsTrigger>
                    <TabsTrigger value="enhance" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Enhance
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Analytics
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Settings className="w-4 h-4 mr-2" />
                      Settings
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="preview" className="mt-6">
                    {examplesLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : (
                      <DatasetPreview
                        data={normalizedExamples}
                        format={detectedFormat}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="edit" className="mt-6">
                    {examplesLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : (
                      <ConversationEditor
                        examples={normalizedExamples}
                        onUpdate={handleUpdateExample}
                        onDelete={handleDeleteExample}
                        onAdd={handleAddExample}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="enhance" className="mt-6">
                    <EnhancementPanel
                      projectId={currentProjectId}
                      exampleCount={normalizedExamples.length}
                    />
                  </TabsContent>

                  <TabsContent value="analytics" className="mt-6">
                    <Tabs defaultValue="quality" className="w-full">
                      <TabsList className="mb-4 bg-muted/50">
                        <TabsTrigger value="quality">Quality Analysis</TabsTrigger>
                        <TabsTrigger value="stats">Statistics</TabsTrigger>
                      </TabsList>
                      <TabsContent value="quality">
                        <QualityPanel
                          projectId={currentProjectId}
                          targetModel={targetModel}
                        />
                      </TabsContent>
                      <TabsContent value="stats">
                        <div className="space-y-6">
                          <SplitManager
                            projectId={currentProjectId}
                            onSplitComplete={() => refetchExamples()}
                          />
                          <AnalyticsDashboard
                            examples={normalizedExamples}
                            format={detectedFormat}
                          />
                        </div>
                      </TabsContent>
                    </Tabs>
                  </TabsContent>

                  <TabsContent value="settings" className="mt-6">
                    <ProjectSettings
                      projectId={currentProjectId}
                      onProjectDeleted={() => {
                        setCurrentProjectId(null);
                        setCurrentStep("import");
                      }}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {currentStep === "export" && (
              <div className="max-w-4xl mx-auto animate-fade-in">
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold mb-3">Export Dataset</h1>
                  <p className="text-muted-foreground">
                    Choose your training framework and download.
                  </p>
                </div>
                <ExportPanel
                  dataset={normalizedExamples}
                  targetModel={targetModel}
                  projectId={currentProjectId}
                  onBack={() => setCurrentStep("edit")}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card variant="outline" hover className="text-center p-6">
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4 text-primary">
        {icon}
      </div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

function StepConnector({ completed }: { completed: boolean }) {
  return (
    <div
      className={`w-12 h-0.5 transition-colors duration-300 ${
        completed ? "bg-primary" : "bg-border"
      }`}
    />
  );
}

function StepIndicator({
  step,
  label,
  active,
  completed,
  disabled,
  onClick,
}: {
  step: number;
  label: string;
  active: boolean;
  completed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300
        ${active
          ? "bg-primary text-primary-foreground shadow-glow-sm"
          : completed
          ? "bg-primary/10 text-primary hover:bg-primary/15"
          : disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }
      `}
    >
      <span
        className={`
          w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold
          transition-all duration-300
          ${active
            ? "bg-primary-foreground text-primary"
            : completed
            ? "bg-primary text-primary-foreground"
            : "bg-muted-foreground/20 text-muted-foreground"
          }
        `}
      >
        {completed ? <CheckCircle2 className="w-4 h-4" /> : step}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}
