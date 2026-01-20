"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  Loader2,
  Save,
  Trash2,
  BarChart3,
  Clock,
  FileText,
  MessageSquare,
  Hash,
  Settings2,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { ModelSelector } from "@/components/model-selector";
import { LogViewer } from "@/components/log-viewer";
import {
  useProject,
  useProjectStats,
  useUpdateProject,
  useDeleteProject,
} from "@/lib/hooks";

interface ProjectSettingsProps {
  projectId: string;
  onProjectDeleted: () => void;
}

export function ProjectSettings({ projectId, onProjectDeleted }: ProjectSettingsProps) {
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: stats, isLoading: statsLoading } = useProjectStats(projectId);
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetModel, setTargetModel] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Initialize form with project data
  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || "");
      setTargetModel(project.target_model);
    }
  }, [project]);

  const hasChanges =
    project &&
    (name !== project.name ||
      description !== (project.description || "") ||
      targetModel !== project.target_model);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Project name is required");
      return;
    }

    try {
      await updateProject.mutateAsync({
        id: projectId,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          target_model: targetModel || undefined,
        },
      });
      toast.success("Project updated successfully");
    } catch (error) {
      toast.error(`Failed to update project: ${error}`);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== project?.name) {
      toast.error("Please type the project name to confirm deletion");
      return;
    }

    try {
      await deleteProject.mutateAsync(projectId);
      toast.success("Project deleted");
      setDeleteDialogOpen(false);
      onProjectDeleted();
    } catch (error) {
      toast.error(`Failed to delete project: ${error}`);
    }
  };

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="project" className="space-y-6">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="project" className="gap-2">
          <Settings2 className="w-4 h-4" />
          Project Settings
        </TabsTrigger>
        <TabsTrigger value="logs" className="gap-2">
          <ScrollText className="w-4 h-4" />
          System Logs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="project" className="space-y-6 mt-0">
      {/* Project Details */}
      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
          <CardDescription>
            Update your project name, description, and target model
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Fine-tuning Dataset"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of your dataset..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Target Model</Label>
            <div className="mt-1">
              <ModelSelector value={targetModel} onChange={setTargetModel} />
            </div>
            <p className="text-xs text-muted-foreground">
              Select the model you&apos;re preparing this dataset for
            </p>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="text-sm text-muted-foreground">
              {hasChanges && "You have unsaved changes"}
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateProject.isPending}
            >
              {updateProject.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Project Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Statistics
          </CardTitle>
          <CardDescription>
            Overview of your dataset
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="w-4 h-4" />
                  <span className="text-xs font-medium">Examples</span>
                </div>
                <div className="text-2xl font-bold">{stats.total_examples}</div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-xs font-medium">Messages</span>
                </div>
                <div className="text-2xl font-bold">{stats.total_messages}</div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Hash className="w-4 h-4" />
                  <span className="text-xs font-medium">Avg Tokens</span>
                </div>
                <div className="text-2xl font-bold">
                  {stats.avg_tokens?.toFixed(0) || "N/A"}
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Avg User Message
                </div>
                <div className="text-lg font-bold">
                  {stats.avg_user_length.toFixed(0)} chars
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Avg Assistant Message
                </div>
                <div className="text-lg font-bold">
                  {stats.avg_assistant_length.toFixed(0)} chars
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/50">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Avg Quality Score
                </div>
                <div className="text-lg font-bold">
                  {stats.avg_quality?.toFixed(2) || "N/A"}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No statistics available
            </p>
          )}
        </CardContent>
      </Card>

      {/* Project Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Project ID:</span>
              <p className="font-mono text-xs mt-1">{project.id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Source Format:</span>
              <p className="mt-1">
                {project.source_format ? (
                  <Badge variant="secondary">{project.source_format}</Badge>
                ) : (
                  "Not set"
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>
              <p className="mt-1">
                {new Date(project.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Updated:</span>
              <p className="mt-1">
                {new Date(project.updated_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions that affect your project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div>
              <div className="font-medium">Delete this project</div>
              <div className="text-sm text-muted-foreground">
                Permanently delete this project and all its data
              </div>
            </div>
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Project
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Project</DialogTitle>
                  <DialogDescription>
                    This action cannot be undone. This will permanently delete the
                    project <strong>{project.name}</strong> and all {project.example_count} examples.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>
                      Type <strong>{project.name}</strong> to confirm:
                    </Label>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={project.name}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleteDialogOpen(false);
                      setDeleteConfirmText("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteConfirmText !== project.name || deleteProject.isPending}
                  >
                    {deleteProject.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Delete Project
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="logs" className="mt-0">
        <LogViewer />
      </TabsContent>
    </Tabs>
  );
}
