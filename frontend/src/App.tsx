import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatModal from "@/components/ChatModal";
import BottomTerminal from "@/components/BottomTerminal";
import { useState, useEffect } from "react";
import { CurrentReferenceProvider } from "@/contexts/current-reference";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Flashcards from "@/pages/Flashcards";
import Terminal from "@/pages/Terminal";
import CkadSim from "@/pages/CkadSim";
import E2ESim from "@/pages/E2ESim";
import BookChapterOnePage from "@/pages/BookChapterOne";
import BookChapterTwoPage from "@/pages/BookChapterTwo";
import BookChapterThreePage from "@/pages/BookChapterThree";
import BookChapterFourPage from "@/pages/BookChapterFour";
import BookChapterFivePage from "@/pages/BookChapterFive";
import BookChapterSixPage from "@/pages/BookChapterSix";
import academyLogo from "../imgs/logo.png";
import {
  LayoutDashboard,
  Layers,
  TerminalSquare,
  GraduationCap,
  Layers3,
  Sun,
  Moon,
  ChevronRight,
} from "lucide-react";

function PanelCollapseIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="2" y="2" width="4" height="12" rx="1" fill="currentColor" fillOpacity="0.18" />
      {direction === "left"
        ? <path d="M10 5.5L7.5 8L10 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M7 5.5L9.5 8L7 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      }
    </svg>
  );
}
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = 224;
const SIDEBAR_COLLAPSED_WIDTH = 72;

// ── Theme Provider ─────────────────────────────────────────────────────────
function ThemeProvider({
  children,
  dark,
}: {
  children: React.ReactNode;
  dark: boolean;
}) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return <>{children}</>;
}

// ── Nav items ──────────────────────────────────────────────────────────────
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/terminal", label: "Terminal", icon: TerminalSquare },
  { href: "/ckad", label: "CKAD Sim", icon: GraduationCap },
  { href: "/e2e", label: "E2E Sim", icon: Layers3 },
];

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({
  collapsed,
  onToggle,
  dark,
  onToggleTheme,
}: {
  collapsed: boolean;
  onToggle: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const [loc] = useLocation();

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200 ease-in-out dark:bg-[#313335]",
        collapsed ? "w-[72px]" : "w-56",
      )}
    >
      <div className={cn(
        "flex items-center border-b border-border whitespace-nowrap",
        collapsed ? "justify-center px-0 py-5" : "gap-0 px-5 py-5",
      )}>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelCollapseIcon direction="right" />
          </button>
        ) : (
          <>
            <img src={academyLogo} alt="" className="h-7 w-8 shrink-0 object-contain" />
            <span className="ml-0.5 font-brand text-sm font-semibold tracking-tight text-foreground">
              ACCADEMY
            </span>
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelCollapseIcon direction="left" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 py-4 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? loc === "/" : loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              data-testid={`link-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                "group flex items-center gap-2.5 rounded-sm border border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-border bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-label={label}
              title={label}
            >
              <Icon
                size={15}
                className={cn(
                  "shrink-0 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className={cn(
                "truncate transition-opacity duration-200",
                collapsed ? "opacity-0" : "opacity-100",
              )}>{label}</span>
              {active && !collapsed && (
                <ChevronRight size={12} className="ml-auto text-primary/80" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className={cn(
        "border-t border-border py-4 whitespace-nowrap",
        collapsed ? "px-0" : "px-5",
      )}>
        <button
          data-testid="button-theme-toggle"
          onClick={onToggleTheme}
          className={cn(
            "flex items-center text-xs text-muted-foreground transition-colors hover:text-foreground",
            collapsed ? "mx-auto h-8 w-8 justify-center" : "mb-3 gap-2",
          )}
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
          {!collapsed && <span>{dark ? "Light mode" : "Dark mode"}</span>}
        </button>
        {!collapsed && (
          <>
            <p className="text-xs text-muted-foreground/60">Dev account</p>
            <p className="mt-0.5 truncate text-xs font-mono text-muted-foreground">localhost:5005</p>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────
function Layout({
  children,
  sidebarCollapsed,
  onToggleSidebar,
  dark,
  onToggleTheme,
}: {
  children: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const [loc] = useLocation();
  const showTerminal =
    loc.startsWith("/flashcards");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        dark={dark}
        onToggle={onToggleSidebar}
        onToggleTheme={onToggleTheme}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
        {showTerminal && <BottomTerminal />}
      </div>
    </div>
  );
}

// ── Router ─────────────────────────────────────────────────────────────────
function AppRouter({
  sidebarCollapsed,
  onToggleSidebar,
  dark,
  onToggleTheme,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <Layout
      sidebarCollapsed={sidebarCollapsed}
      dark={dark}
      onToggleSidebar={onToggleSidebar}
      onToggleTheme={onToggleTheme}
    >
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/flashcards" component={Flashcards} />
        <Route path="/flashcards/:deckId" component={Flashcards} />
        <Route path="/terminal" component={Terminal} />
        <Route path="/terminal/:exerciseId" component={Terminal} />
        <Route path="/ckad" component={CkadSim} />
        <Route path="/e2e" component={E2ESim} />
        <Route path="/e2e/:exerciseId" component={E2ESim} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function RootRouter({
  sidebarCollapsed,
  onToggleSidebar,
  dark,
  onToggleTheme,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const [loc] = useLocation();
  const isBookChapterOneRoute =
    loc === "/book/chapter-1" || loc === "/book/chapter-1/";
  const isBookChapterTwoRoute =
    loc === "/book/chapter-2" || loc === "/book/chapter-2/";
  const isBookChapterThreeRoute =
    loc === "/book/chapter-3" || loc === "/book/chapter-3/";
  const isBookChapterFourRoute =
    loc === "/book/chapter-4" || loc === "/book/chapter-4/";
  const isBookChapterFiveRoute =
    loc === "/book/chapter-5" || loc === "/book/chapter-5/";
  const isBookChapterSixRoute =
    loc === "/book/chapter-6" || loc === "/book/chapter-6/";

  if (isBookChapterOneRoute) {
    return <BookChapterOnePage />;
  }

  if (isBookChapterTwoRoute) {
    return <BookChapterTwoPage />;
  }

  if (isBookChapterThreeRoute) {
    return <BookChapterThreePage />;
  }

  if (isBookChapterFourRoute) {
    return <BookChapterFourPage />;
  }

  if (isBookChapterFiveRoute) {
    return <BookChapterFivePage />;
  }

  if (isBookChapterSixRoute) {
    return <BookChapterSixPage />;
  }

  if (loc.startsWith("/book/")) {
    return <NotFound />;
  }

  return (
    <>
      <AppRouter
        sidebarCollapsed={sidebarCollapsed}
        dark={dark}
        onToggleSidebar={onToggleSidebar}
        onToggleTheme={onToggleTheme}
      />
      <ChatModal />
    </>
  );
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dark, setDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <ThemeProvider dark={dark}>
            <CurrentReferenceProvider>
              <RootRouter
                sidebarCollapsed={sidebarCollapsed}
                dark={dark}
                onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
                onToggleTheme={() => setDark((current) => !current)}
              />
            </CurrentReferenceProvider>
          </ThemeProvider>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
