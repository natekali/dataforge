"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Filter, ChevronLeft, ChevronRight, MessageSquare, User, Bot, Settings } from "lucide-react";
import { SplitBadge } from "@/components/split-manager";

interface DatasetPreviewProps {
  data: any[];
  format: string | null;
}

interface FilterOptions {
  qualityMin: number;
  qualityMax: number;
  minLength: number;
  maxLength: number;
  hasSystemMessage: boolean | null;
  split: string | null;
}

export function DatasetPreview({ data, format }: DatasetPreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FilterOptions>({
    qualityMin: 0,
    qualityMax: 100,
    minLength: 0,
    maxLength: 50000,
    hasSystemMessage: null,
    split: null,
  });

  // Filter and search examples
  const filteredExamples = useMemo(() => {
    return data.filter((example) => {
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const messagesText = example.messages
          ?.map((m: any) => m.content)
          .join(" ")
          .toLowerCase();
        
        if (!messagesText.includes(query)) {
          return false;
        }
      }

      // Quality score filter
      const qualityScore = example.quality_score ?? 70; // Default to 70 if not set
      if (
        qualityScore < filters.qualityMin ||
        qualityScore > filters.qualityMax
      ) {
        return false;
      }

      // Length filter
      const totalLength = example.messages
        ?.reduce((acc: number, m: any) => acc + (m.content?.length || 0), 0) ||
        0;
      if (totalLength < filters.minLength || totalLength > filters.maxLength) {
        return false;
      }

      // System message filter
      if (filters.hasSystemMessage !== null) {
        const hasSystem = example.messages?.some((m: any) => m.role === "system");
        if (hasSystem !== filters.hasSystemMessage) {
          return false;
        }
      }

      // Split filter
      if (filters.split !== null) {
        if (example.split !== filters.split) {
          return false;
        }
      }

      return true;
    });
  }, [data, searchQuery, filters]);

  // Adjust current index if it's out of bounds
  useEffect(() => {
    setCurrentIndex((prev) => Math.min(prev, Math.max(0, filteredExamples.length - 1)));
  }, [filteredExamples.length]);

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No examples to display
        </CardContent>
      </Card>
    );
  }

  const currentExample = filteredExamples[currentIndex];

  return (
    <div className="space-y-4">
      {/* Search and Filter Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search & Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search in messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Quality Score</label>
              <Select
                value={`${filters.qualityMin}-${filters.qualityMax}`}
                onValueChange={(value) => {
                  const [min, max] = value.split("-").map(Number);
                  setFilters({ ...filters, qualityMin: min, qualityMax: max });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0-100">All</SelectItem>
                  <SelectItem value="80-100">High (80-100)</SelectItem>
                  <SelectItem value="50-79">Medium (50-79)</SelectItem>
                  <SelectItem value="0-49">Low (0-49)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Max Length</label>
              <Select
                value={filters.maxLength.toString()}
                onValueChange={(value) =>
                  setFilters({ ...filters, maxLength: parseInt(value) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50000">Any Length</SelectItem>
                  <SelectItem value="2000">Under 2K chars</SelectItem>
                  <SelectItem value="5000">Under 5K chars</SelectItem>
                  <SelectItem value="10000">Under 10K chars</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">System Message</label>
              <Select
                value={
                  filters.hasSystemMessage === null
                    ? "any"
                    : filters.hasSystemMessage
                    ? "yes"
                    : "no"
                }
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    hasSystemMessage:
                      value === "any" ? null : value === "yes",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="yes">Has System</SelectItem>
                  <SelectItem value="no">No System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Split</label>
              <Select
                value={filters.split || "all"}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    split: value === "all" ? null : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Splits</SelectItem>
                  <SelectItem value="train">Train</SelectItem>
                  <SelectItem value="validation">Validation</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end min-w-[100px] pb-1">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setFilters({
                    qualityMin: 0,
                    qualityMax: 100,
                    minLength: 0,
                    maxLength: 50000,
                    hasSystemMessage: null,
                    split: null,
                  });
                }}
              >
                <Filter className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>

          {/* Results Info */}
          <div className="text-sm text-muted-foreground">
            Showing {filteredExamples.length} of {data.length} examples
          </div>
        </CardContent>
      </Card>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
        <div className="flex-1">
          <div className="text-2xl font-bold">{filteredExamples.length}</div>
          <div className="text-sm text-muted-foreground">Filtered Examples</div>
        </div>
        <div className="flex-1">
          <div className="text-2xl font-bold">{data.length}</div>
          <div className="text-sm text-muted-foreground">Total Examples</div>
        </div>
        <div className="flex-1">
          <div className="text-2xl font-bold">{format || "auto"}</div>
          <div className="text-sm text-muted-foreground">Detected Format</div>
        </div>
      </div>

      {/* Example Viewer */}
      {filteredExamples.length > 0 && currentExample && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Example Preview</CardTitle>
              <SplitBadge split={currentExample.split || "train"} />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setCurrentIndex(Math.max(0, currentIndex - 1))
                }
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                {currentIndex + 1} / {filteredExamples.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setCurrentIndex(
                    Math.min(filteredExamples.length - 1, currentIndex + 1)
                  )
                }
                disabled={currentIndex === filteredExamples.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">{renderExample(currentExample)}</div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {filteredExamples.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No examples match your search and filter criteria.
          </CardContent>
        </Card>
      )}

      {/* Table View */}
      {filteredExamples.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filtered Examples</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden max-h-[500px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium">#</th>
                    <th className="text-left p-3 text-sm font-medium">User Message</th>
                    <th className="text-left p-3 text-sm font-medium">
                      Assistant Response
                    </th>
                    <th className="text-left p-3 text-sm font-medium">Split</th>
                    <th className="text-left p-3 text-sm font-medium">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExamples.slice(0, 50).map((example, index) => (
                    <tr
                      key={example.id || index}
                      className={`cursor-pointer border-b hover:bg-muted/50 ${
                        index === currentIndex ? "bg-muted" : ""
                      }`}
                      onClick={() => setCurrentIndex(index)}
                    >
                      <td className="p-3 text-sm">{index + 1}</td>
                      <td className="p-3 text-sm max-w-[300px] truncate text-muted-foreground">
                        {getUserMessage(example)}
                      </td>
                      <td className="p-3 text-sm max-w-[300px] truncate text-muted-foreground">
                        {getAssistantMessage(example)}
                      </td>
                      <td className="p-3 text-sm">
                        <SplitBadge split={example.split || "train"} />
                      </td>
                      <td className="p-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            getQualityClass(example.quality_score)
                          }`}
                        >
                          {example.quality_score || "N/A"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredExamples.length > 50 && (
                <div className="p-3 text-center text-sm text-muted-foreground border-t">
                  Showing first 50 of {filteredExamples.length} results
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function renderExample(example: any) {
  const messages = example.messages || [];

  if (messages.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No messages in this example
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message: any, index: number) => (
        <div
          key={index}
          className={`flex gap-3 ${
            message.role === "system"
              ? "bg-muted/30"
              : message.role === "user"
              ? "bg-blue-50 dark:bg-blue-950/20"
              : "bg-green-50 dark:bg-green-950/20"
          } rounded-lg p-4`}
        >
          {message.role === "system" && (
            <Settings className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          )}
          {message.role === "user" && (
            <User className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
          )}
          {message.role === "assistant" && (
            <Bot className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-muted-foreground mb-1 capitalize">
              {message.role}
            </div>
            <div className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function getUserMessage(example: any): string {
  const userMessage = example.messages?.find((m: any) => m.role === "user");
  return userMessage?.content?.slice(0, 100) || "No user message";
}

function getAssistantMessage(example: any): string {
  const assistantMessage = example.messages?.find(
    (m: any) => m.role === "assistant"
  );
  return assistantMessage?.content?.slice(0, 100) || "No assistant response";
}

function getQualityClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "bg-muted text-muted-foreground";
  if (score >= 80) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (score >= 50) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}