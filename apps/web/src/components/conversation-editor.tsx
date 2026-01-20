"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Copy,
  Flag,
  CheckCircle,
  User,
  Bot,
  Settings,
  GripVertical,
  Sparkles,
} from "lucide-react";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface Example {
  id?: string;
  messages: Message[];
  metadata?: Record<string, any>;
}

interface ConversationEditorProps {
  examples: Example[];
  onUpdate: (index: number, example: Example) => void;
  onDelete?: (index: number) => void;
  onAdd?: (example: Example) => void;
  projectId?: string;
}

const ROLE_CONFIG = {
  system: {
    icon: Settings,
    label: "System",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
    iconClass: "text-amber-500",
  },
  user: {
    icon: User,
    label: "User",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
    iconClass: "text-blue-500",
  },
  assistant: {
    icon: Bot,
    label: "Assistant",
    bgClass: "bg-green-500/10",
    borderClass: "border-green-500/20",
    iconClass: "text-green-500",
  },
  tool: {
    icon: Settings,
    label: "Tool",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/20",
    iconClass: "text-purple-500",
  },
};

export function ConversationEditor({
  examples,
  onUpdate,
  onDelete,
  onAdd,
}: ConversationEditorProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editedExample, setEditedExample] = useState<Example | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());

  // Initialize edited example when index changes
  useEffect(() => {
    if (examples[currentIndex]) {
      setEditedExample(JSON.parse(JSON.stringify(examples[currentIndex])));
      setHasChanges(false);
    }
  }, [currentIndex, examples]);

  const handleMessageChange = useCallback(
    (messageIndex: number, field: "role" | "content", value: string) => {
      if (!editedExample) return;

      const newMessages = [...editedExample.messages];
      newMessages[messageIndex] = {
        ...newMessages[messageIndex],
        [field]: value,
      };

      setEditedExample({ ...editedExample, messages: newMessages });
      setHasChanges(true);
    },
    [editedExample]
  );

  const handleAddMessage = useCallback(
    (role: Message["role"] = "user") => {
      if (!editedExample) return;

      const newMessages = [
        ...editedExample.messages,
        { role, content: "" },
      ];

      setEditedExample({ ...editedExample, messages: newMessages });
      setHasChanges(true);
    },
    [editedExample]
  );

  const handleDeleteMessage = useCallback(
    (messageIndex: number) => {
      if (!editedExample || editedExample.messages.length <= 1) return;

      const newMessages = editedExample.messages.filter(
        (_, i) => i !== messageIndex
      );

      setEditedExample({ ...editedExample, messages: newMessages });
      setHasChanges(true);
    },
    [editedExample]
  );

  const handleMoveMessage = useCallback(
    (messageIndex: number, direction: "up" | "down") => {
      if (!editedExample) return;

      const newMessages = [...editedExample.messages];
      const targetIndex =
        direction === "up" ? messageIndex - 1 : messageIndex + 1;

      if (targetIndex < 0 || targetIndex >= newMessages.length) return;

      [newMessages[messageIndex], newMessages[targetIndex]] = [
        newMessages[targetIndex],
        newMessages[messageIndex],
      ];

      setEditedExample({ ...editedExample, messages: newMessages });
      setHasChanges(true);
    },
    [editedExample]
  );

  const handleSave = useCallback(() => {
    if (!editedExample || !hasChanges) return;
    onUpdate(currentIndex, editedExample);
    setHasChanges(false);
  }, [editedExample, hasChanges, currentIndex, onUpdate]);

  const handleRevert = useCallback(() => {
    if (examples[currentIndex]) {
      setEditedExample(JSON.parse(JSON.stringify(examples[currentIndex])));
      setHasChanges(false);
    }
  }, [currentIndex, examples]);

  const handleDuplicate = useCallback(() => {
    if (!editedExample || !onAdd) return;
    onAdd(JSON.parse(JSON.stringify(editedExample)));
  }, [editedExample, onAdd]);

  const handleDeleteExample = useCallback(() => {
    if (!onDelete) return;
    onDelete(currentIndex);
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, onDelete]);

  const toggleFlag = useCallback(() => {
    setFlagged((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(currentIndex)) {
        newSet.delete(currentIndex);
      } else {
        newSet.add(currentIndex);
      }
      return newSet;
    });
  }, [currentIndex]);

  const toggleReviewed = useCallback(() => {
    setReviewed((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(currentIndex)) {
        newSet.delete(currentIndex);
      } else {
        newSet.add(currentIndex);
      }
      return newSet;
    });
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex < examples.length - 1) {
      if (hasChanges) {
        handleSave();
      }
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, examples.length, hasChanges, handleSave]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      if (hasChanges) {
        handleSave();
      }
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, hasChanges, handleSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFlag();
      } else if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleReviewed();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrevious, handleSave, toggleFlag, toggleReviewed]);

  if (examples.length === 0 || !editedExample) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>No examples to edit</p>
          {onAdd && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() =>
                onAdd({
                  messages: [
                    { role: "user", content: "" },
                    { role: "assistant", content: "" },
                  ],
                })
              }
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Example
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const estimatedTokens = Math.round(
    JSON.stringify(editedExample).length / 4
  );

  return (
    <div className="space-y-4">
      {/* Navigation Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={goToPrevious}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 px-3">
                <span className="font-medium">
                  {currentIndex + 1} / {examples.length}
                </span>
                {flagged.has(currentIndex) && (
                  <Badge variant="warning">Flagged</Badge>
                )}
                {reviewed.has(currentIndex) && (
                  <Badge variant="success">Reviewed</Badge>
                )}
                {hasChanges && <Badge variant="info">Unsaved</Badge>}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={goToNext}
                disabled={currentIndex === examples.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>~{estimatedTokens} tokens</span>
              <span>•</span>
              <span>{editedExample.messages.length} messages</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFlag}
                className={flagged.has(currentIndex) ? "text-amber-500" : ""}
              >
                <Flag className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleReviewed}
                className={reviewed.has(currentIndex) ? "text-green-500" : ""}
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-border" />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDuplicate}
                disabled={!onAdd}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRevert}
                disabled={!hasChanges}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messages Editor */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Conversation</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddMessage("system")}
              >
                <Plus className="h-4 w-4 mr-1" />
                System
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddMessage("user")}
              >
                <Plus className="h-4 w-4 mr-1" />
                User
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddMessage("assistant")}
              >
                <Plus className="h-4 w-4 mr-1" />
                Assistant
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {editedExample.messages.map((message, index) => {
              const config = ROLE_CONFIG[message.role] || ROLE_CONFIG.user;
              const Icon = config.icon;

              return (
                <div
                  key={index}
                  className={`rounded-lg border ${config.bgClass} ${config.borderClass} overflow-hidden`}
                >
                  {/* Message Header */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-inherit bg-background/50">
                    <div className="flex items-center gap-3">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <Icon className={`h-4 w-4 ${config.iconClass}`} />
                      <Select
                        value={message.role}
                        onValueChange={(value) =>
                          handleMessageChange(
                            index,
                            "role",
                            value as Message["role"]
                          )
                        }
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">System</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="assistant">Assistant</SelectItem>
                          <SelectItem value="tool">Tool</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {message.content.length} chars
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleMoveMessage(index, "up")}
                        disabled={index === 0}
                      >
                        <ChevronLeft className="h-4 w-4 rotate-90" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleMoveMessage(index, "down")}
                        disabled={index === editedExample.messages.length - 1}
                      >
                        <ChevronRight className="h-4 w-4 rotate-90" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteMessage(index)}
                        disabled={editedExample.messages.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Message Content */}
                  <div className="p-4">
                    <Textarea
                      value={message.content}
                      onChange={(e) =>
                        handleMessageChange(index, "content", e.target.value)
                      }
                      placeholder={`Enter ${message.role} message...`}
                      className="min-h-[100px] bg-background/50 border-0 focus-visible:ring-1"
                      rows={Math.max(
                        4,
                        Math.min(20, message.content.split("\n").length + 1)
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <kbd className="px-2 py-1 bg-muted rounded text-xs">
                ← →
              </kbd>{" "}
              Navigate{" "}
              <kbd className="px-2 py-1 bg-muted rounded text-xs ml-2">
                Ctrl+S
              </kbd>{" "}
              Save{" "}
              <kbd className="px-2 py-1 bg-muted rounded text-xs ml-2">F</kbd>{" "}
              Flag{" "}
              <kbd className="px-2 py-1 bg-muted rounded text-xs ml-2">R</kbd>{" "}
              Mark Reviewed
            </div>
            {onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteExample}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Example
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Example List Sidebar could go here in future */}
    </div>
  );
}
