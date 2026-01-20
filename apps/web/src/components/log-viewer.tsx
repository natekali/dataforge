"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  RefreshCw,
  Trash2,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Clock,
  Server,
  Download,
  Upload,
  Zap,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Use relative URLs to go through Next.js rewrites
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  source: string;
  message: string;
  details: Record<string, unknown> | null;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  has_more: boolean;
}

interface LogStats {
  total_logs: number;
  max_logs: number;
  by_level: Record<string, number>;
  by_source: Record<string, number>;
}

const levelConfig = {
  debug: {
    icon: Bug,
    color: "text-slate-500",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/20",
  },
  info: {
    icon: Info,
    color: "text-sky-500",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/20",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
};

const sourceIcons: Record<string, typeof Server> = {
  api: Server,
  system: Activity,
  import: Download,
  export: Upload,
  enhancement: Zap,
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function LogEntryRow({
  log,
  expanded,
  onToggle,
}: {
  log: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = levelConfig[log.level];
  const Icon = config.icon;
  const SourceIcon = sourceIcons[log.source] || Server;
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <div
      className={`border-b border-border/50 last:border-0 transition-colors ${
        log.level === "error" ? "bg-red-500/5" : ""
      }`}
    >
      <div
        className={`flex items-start gap-3 p-3 ${hasDetails ? "cursor-pointer hover:bg-muted/30" : ""}`}
        onClick={hasDetails ? onToggle : undefined}
      >
        {/* Expand button */}
        <div className="w-4 h-4 mt-0.5 flex-shrink-0">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )
          ) : null}
        </div>

        {/* Level icon */}
        <div
          className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${config.bgColor}`}
        >
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>

        {/* Timestamp */}
        <div className="flex flex-col items-start flex-shrink-0 w-20">
          <span className="text-xs font-medium text-foreground">
            {formatTimestamp(log.timestamp)}
          </span>
          <span className="text-2xs text-muted-foreground">
            {formatDate(log.timestamp)}
          </span>
        </div>

        {/* Source badge */}
        <Badge
          variant="outline"
          size="sm"
          className="flex-shrink-0 gap-1 capitalize"
        >
          <SourceIcon className="w-3 h-3" />
          {log.source}
        </Badge>

        {/* Message */}
        <span className="text-sm text-foreground flex-1 font-mono break-all">
          {log.message}
        </span>
      </div>

      {/* Details panel */}
      {expanded && hasDetails && (
        <div className="px-3 pb-3 ml-14">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function LogViewer() {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch logs
  const {
    data: logsData,
    isLoading,
    refetch,
  } = useQuery<LogsResponse>({
    queryKey: ["logs", levelFilter, sourceFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("limit", "200");

      const res = await fetch(`${API_BASE_URL}/api/v1/logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Fetch stats
  const { data: stats } = useQuery<LogStats>({
    queryKey: ["logs-stats"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/logs/stats`);
      if (!res.ok) throw new Error("Failed to fetch log stats");
      return res.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const handleClearLogs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/logs`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to clear logs");
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      queryClient.invalidateQueries({ queryKey: ["logs-stats"] });
      toast.success("Logs cleared");
    } catch (error) {
      toast.error("Failed to clear logs");
    }
  };

  const toggleExpanded = useCallback((index: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const logs = logsData?.logs || [];
  const errorCount = stats?.by_level?.error || 0;
  const warningCount = stats?.by_level?.warning || 0;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            {stats?.total_logs || 0} / {stats?.max_logs || 1000} logs
          </span>
        </div>

        {errorCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="w-3 h-3" />
            {errorCount} errors
          </Badge>
        )}

        {warningCount > 0 && (
          <Badge variant="warning" className="gap-1">
            <AlertTriangle className="w-3 h-3" />
            {warningCount} warnings
          </Badge>
        )}

        <div className="flex-1" />

        <Button
          variant={autoRefresh ? "default" : "outline"}
          size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="gap-2"
        >
          <RefreshCw
            className={`w-4 h-4 ${autoRefresh ? "animate-spin" : ""}`}
          />
          {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
        </Button>
      </div>

      {/* Filters */}
      <Card variant="glass">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="import">Import</SelectItem>
                <SelectItem value="export">Export</SelectItem>
                <SelectItem value="enhancement">Enhancement</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearLogs}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Log entries */}
      <Card variant="elevated">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recent Logs
            {logsData?.total !== undefined && (
              <Badge variant="muted" size="sm">
                {logsData.total} total
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm">No logs found</p>
              <p className="text-xs">Logs will appear here as you use the app</p>
            </div>
          ) : (
            <div className="max-h-[calc(100vh-350px)] overflow-y-auto">
              {logs.map((log, index) => (
                <LogEntryRow
                  key={`${log.timestamp}-${index}`}
                  log={log}
                  expanded={expandedLogs.has(index)}
                  onToggle={() => toggleExpanded(index)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Help text */}
      <div className="text-xs text-muted-foreground text-center">
        Logs are stored in memory and will be cleared when the server restarts.
        Maximum {stats?.max_logs || 1000} entries are kept.
      </div>
    </div>
  );
}
