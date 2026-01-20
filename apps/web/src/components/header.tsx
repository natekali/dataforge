"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Moon, Sun, Github, Database, BookOpen, ExternalLink, ScrollText, AlertCircle } from "lucide-react";
import { LogViewer } from "@/components/log-viewer";
import { useLogStats } from "@/lib/hooks";

export function Header() {
  const { theme, setTheme } = useTheme();
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const { data: logStats } = useLogStats();

  const errorCount = logStats?.by_level?.error || 0;
  const warningCount = logStats?.by_level?.warning || 0;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      {/* Subtle gradient line at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      <div className="container flex h-16 items-center gap-4">
        {/* Logo & Brand */}
        <Link href="/" className="flex items-center gap-3 mr-2 hover:opacity-90 transition-opacity">
          <div className="relative group">
            {/* Glow effect on hover */}
            <div className="absolute inset-0 rounded-xl bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary via-primary to-[hsl(262,83%,58%)] flex items-center justify-center shadow-lg shadow-primary/20">
              <Database className="w-5 h-5 text-primary-foreground" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-lg tracking-tight leading-none">
              DataForge
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Studio
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-1 ml-6">
          <NavLink href="/" active>
            Workspace
          </NavLink>
          <NavLink href="https://github.com/natekali/dataforge/README.md" external>
            <BookOpen className="w-3 h-3 mr-1.5" />
            Documentation
          </NavLink>
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-1 ml-auto">
          {/* Version badge */}
          <div className="hidden sm:flex items-center px-2.5 py-1 rounded-full bg-muted/50 border border-border/50 mr-2">
            <span className="text-2xs font-medium text-muted-foreground">v0.1.0</span>
          </div>

          {/* Log Viewer Button */}
          <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9 rounded-lg hover:bg-muted/80 transition-colors"
              >
                <ScrollText className="h-4 w-4" />
                {errorCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {errorCount > 9 ? "9+" : errorCount}
                  </span>
                )}
                <span className="sr-only">View Logs</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-6xl h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ScrollText className="w-5 h-5" />
                  System Logs
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {errorCount} {errorCount === 1 ? "error" : "errors"}
                    </Badge>
                  )}
                  {warningCount > 0 && (
                    <Badge variant="warning" className="ml-1">
                      {warningCount} {warningCount === 1 ? "warning" : "warnings"}
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-hidden -mx-6 px-6">
                <LogViewer />
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-lg hover:bg-muted/80 transition-colors"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg hover:bg-muted/80 transition-colors"
            asChild
          >
            <a
              href="https://github.com/natekali/dataforge"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
  active = false,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`
        relative flex items-center px-3 py-2 text-sm font-medium rounded-lg
        transition-all duration-200 ease-out
        ${
          active
            ? "text-foreground bg-muted/80"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }
      `}
    >
      {children}
      {external && <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />}
      {active && (
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
      )}
    </a>
  );
}
