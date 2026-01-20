"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Database,
  MessageSquare,
  FileText,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Users,
  Bot,
  Settings,
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

interface AnalyticsDashboardProps {
  examples: Example[];
  format?: string | null;
}

export function AnalyticsDashboard({ examples, format }: AnalyticsDashboardProps) {
  // Calculate all statistics
  const stats = useMemo(() => {
    if (!examples.length) {
      return null;
    }

    let totalMessages = 0;
    let totalChars = 0;
    const roleCounts = { system: 0, user: 0, assistant: 0, tool: 0 };
    const lengthBuckets = { short: 0, medium: 0, long: 0, veryLong: 0 };
    const qualityScores: number[] = [];
    const tokenCounts: number[] = [];
    const wordFrequency: Record<string, number> = {};

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
      "at", "by", "from", "as", "into", "through", "during", "before", "after",
      "this", "that", "these", "those", "what", "which", "who", "and", "but",
      "if", "or", "because", "so", "than", "too", "very", "just", "how", "why",
      "when", "where", "all", "each", "few", "more", "most", "other", "some",
      "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
      "her", "it", "its", "they", "them", "their", "about", "any", "also",
    ]);

    for (const example of examples) {
      const messages = example.messages || [];
      let exampleChars = 0;

      for (const msg of messages) {
        totalMessages++;
        const content = msg.content || "";
        const charCount = content.length;
        totalChars += charCount;
        exampleChars += charCount;

        // Role distribution
        if (msg.role in roleCounts) {
          roleCounts[msg.role as keyof typeof roleCounts]++;
        }

        // Length distribution
        if (charCount < 100) {
          lengthBuckets.short++;
        } else if (charCount < 500) {
          lengthBuckets.medium++;
        } else if (charCount < 2000) {
          lengthBuckets.long++;
        } else {
          lengthBuckets.veryLong++;
        }

        // Word frequency for user messages
        if (msg.role === "user") {
          const words = content.toLowerCase().split(/\s+/);
          for (const word of words) {
            const cleanWord = word.replace(/[^a-z]/g, "");
            if (cleanWord.length > 3 && !stopWords.has(cleanWord)) {
              wordFrequency[cleanWord] = (wordFrequency[cleanWord] || 0) + 1;
            }
          }
        }
      }

      // Token count estimate
      tokenCounts.push(Math.round(exampleChars / 4));

      // Quality score from metadata
      if (example.metadata?.quality_score) {
        qualityScores.push(example.metadata.quality_score);
      }
    }

    // Calculate quality distribution
    const qualityDist = {
      excellent: qualityScores.filter((s) => s > 0.9).length,
      good: qualityScores.filter((s) => s >= 0.7 && s <= 0.9).length,
      fair: qualityScores.filter((s) => s >= 0.5 && s < 0.7).length,
      poor: qualityScores.filter((s) => s < 0.5).length,
    };

    // Top topics
    const topTopics = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word, count]) => ({ word, count }));

    // Token histogram
    const minTokens = Math.min(...tokenCounts);
    const maxTokens = Math.max(...tokenCounts);
    const bucketSize = Math.max(1, Math.floor((maxTokens - minTokens) / 8));
    const tokenBuckets: { range: string; count: number }[] = [];

    for (let i = 0; i < 8; i++) {
      const low = minTokens + i * bucketSize;
      const high = low + bucketSize;
      const count = tokenCounts.filter((t) => t >= low && t < high).length;
      tokenBuckets.push({ range: `${low}-${high}`, count });
    }

    return {
      totalExamples: examples.length,
      totalMessages,
      totalTokens: Math.round(totalChars / 4),
      avgMessagesPerExample: totalMessages / examples.length,
      avgTokensPerExample: totalChars / 4 / examples.length,
      roleCounts,
      lengthBuckets,
      qualityScores,
      qualityDist,
      avgQuality: qualityScores.length
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : null,
      topTopics,
      tokenBuckets,
      minTokens,
      maxTokens,
    };
  }, [examples]);

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No data to analyze</p>
        </CardContent>
      </Card>
    );
  }

  const maxTopicCount = Math.max(...stats.topTopics.map((t) => t.count), 1);
  const maxBucketCount = Math.max(...stats.tokenBuckets.map((b) => b.count), 1);

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Database className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalExamples.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Examples</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <MessageSquare className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalMessages.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Messages</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <FileText className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">~{stats.totalTokens.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Est. Tokens</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.avgTokensPerExample.toFixed(0)}</p>
                <p className="text-sm text-muted-foreground">Avg Tokens/Ex</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Role Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5" />
              Role Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Settings className="w-4 h-4 text-amber-500" />
                <span className="w-20 text-sm">System</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-amber-500"
                    style={{
                      width: `${(stats.roleCounts.system / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.roleCounts.system}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="w-20 text-sm">User</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{
                      width: `${(stats.roleCounts.user / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.roleCounts.user}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Bot className="w-4 h-4 text-green-500" />
                <span className="w-20 text-sm">Assistant</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{
                      width: `${(stats.roleCounts.assistant / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.roleCounts.assistant}
                </span>
              </div>

              {stats.roleCounts.tool > 0 && (
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-purple-500" />
                  <span className="w-20 text-sm">Tool</span>
                  <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-purple-500"
                      style={{
                        width: `${(stats.roleCounts.tool / stats.totalMessages) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 text-sm text-right">
                    {stats.roleCounts.tool}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Message Length Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Message Length
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">Short (&lt;100)</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${(stats.lengthBuckets.short / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.lengthBuckets.short}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">Medium</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-sky-500"
                    style={{
                      width: `${(stats.lengthBuckets.medium / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.lengthBuckets.medium}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">Long</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-violet-500"
                    style={{
                      width: `${(stats.lengthBuckets.long / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.lengthBuckets.long}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">Very Long</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-rose-500"
                    style={{
                      width: `${(stats.lengthBuckets.veryLong / stats.totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-sm text-right">
                  {stats.lengthBuckets.veryLong}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quality Distribution */}
        {stats.qualityScores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Quality Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Average Score</span>
                  <span className="text-2xl font-bold">
                    {((stats.avgQuality || 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <Progress value={(stats.avgQuality || 0) * 100} className="h-2" />
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-green-500/10">
                  <p className="text-lg font-bold text-green-500">
                    {stats.qualityDist.excellent}
                  </p>
                  <p className="text-xs text-muted-foreground">Excellent</p>
                </div>
                <div className="p-2 rounded bg-blue-500/10">
                  <p className="text-lg font-bold text-blue-500">
                    {stats.qualityDist.good}
                  </p>
                  <p className="text-xs text-muted-foreground">Good</p>
                </div>
                <div className="p-2 rounded bg-amber-500/10">
                  <p className="text-lg font-bold text-amber-500">
                    {stats.qualityDist.fair}
                  </p>
                  <p className="text-xs text-muted-foreground">Fair</p>
                </div>
                <div className="p-2 rounded bg-red-500/10">
                  <p className="text-lg font-bold text-red-500">
                    {stats.qualityDist.poor}
                  </p>
                  <p className="text-xs text-muted-foreground">Poor</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Topics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Top Topics
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topTopics.length > 0 ? (
              <div className="space-y-3">
                {stats.topTopics.map(({ word, count }) => (
                  <div key={word} className="flex items-center gap-3">
                    <span className="w-24 text-sm font-medium truncate">{word}</span>
                    <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full bg-primary/60"
                        style={{
                          width: `${(count / maxTopicCount) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-10 text-sm text-right text-muted-foreground">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Not enough data for topic analysis
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Token Distribution Histogram */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Token Distribution per Example
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-32">
            {stats.tokenBuckets.map((bucket, index) => (
              <div key={index} className="flex-1 flex flex-col items-center">
                <div
                  className="w-full bg-primary/60 rounded-t transition-all"
                  style={{
                    height: `${(bucket.count / maxBucketCount) * 100}%`,
                    minHeight: bucket.count > 0 ? "4px" : "0",
                  }}
                />
                <span className="text-xs text-muted-foreground mt-2 rotate-45 origin-left">
                  {bucket.range.split("-")[0]}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-6">
            <span>Min: {stats.minTokens} tokens</span>
            <span>Max: {stats.maxTokens} tokens</span>
          </div>
        </CardContent>
      </Card>

      {/* Format Info */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline">{format || "Auto-detected"}</Badge>
              <span className="text-sm text-muted-foreground">
                {stats.avgMessagesPerExample.toFixed(1)} messages per example on average
              </span>
            </div>
            <div className="flex gap-2">
              {stats.totalMessages > 1000 && (
                <Badge variant="success">Large Dataset</Badge>
              )}
              {stats.avgTokensPerExample > 500 && (
                <Badge variant="info">Detailed Responses</Badge>
              )}
              {stats.roleCounts.system > 0 && (
                <Badge variant="warning">Has System Prompts</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
