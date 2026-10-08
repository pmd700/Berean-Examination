import ResumeCard from './components/resume/ResumeCard';
import GlobalSearch from './components/search/GlobalSearch';
import { useAuth } from '@/lib/AuthContext';

// Pages that own their full viewport and must not have bottom padding
// injected beneath them (they use overflow-hidden / fixed canvases).
const FULL_SCREEN_PAGES = new Set(['KnowledgeWeb', 'ChapterArt']);

export default function Layout({ children, currentPageName, fullBleed = false }) {
  const { user } = useAuth();
  // `fullBleed` means the caller already fills the viewport exactly (the tab
  // shell does). Padding around it would push the document taller than the
  // screen, and the strip that scrolls into view is bare <body>.
  const isFullScreen = fullBleed || FULL_SCREEN_PAGES.has(currentPageName);

  // Sync the dark/light class to <html> so the browser's native background
  // (body, scrollbar gutter, overscroll area) matches the app theme.
  // Without this, body uses the :root CSS variables (light defaults) rather
  // than the .dark ones, producing a jarring flash of a different background
  // colour when the user scrolls past the bottom of the page.
  // The theme class on <html> is owned by ThemeProvider now — Layout forcing
  // 'dark' here was what made the toggle appear to do nothing.

  return (
    <div className="min-h-screen bg-app">
      <style>{`
        :root {
          /* Aliases onto the theme tokens, so everything reading these
             follows light/dark instead of being pinned to the dark palette. */
          --bg-primary: rgb(var(--app));
          --bg-surface: rgb(var(--surface));
          --bg-elevated: rgb(var(--elevated));
          --bg-card: rgb(var(--card));
          --border-subtle: rgb(var(--line));
          --border-accent: rgb(var(--line-strong));
          --text-primary: rgb(var(--ink));
          --text-secondary: rgb(var(--ink-muted));
          --text-muted: #5A6478;
          --accent-silver: #A8B2C1;
          --accent-gold: #C9A94E;
          --accent-violet: #6B4C9A;
          --accent-violet-light: #7C5CB7;
          --accent-violet-hover: #5A3E87;
          --success-green: #4A8F5C;
          --warning-gold: #C9A94E;
          --error-red: #C94040;
          --focus-violet: #6B4C9A;
          --focus-gold: #C9A94E;

        }

        /* Dark-only shadcn palette. In light mode these fall back to the
           light values in index.css instead of overriding them. */
        html.dark {
          --background: 222 20% 5%;
          --foreground: 216 15% 92%;
          --card: 222 18% 9%;
          --card-foreground: 216 15% 92%;
          --popover: 222 18% 9%;
          --popover-foreground: 216 15% 92%;
          --primary: 265 35% 45%;
          --primary-foreground: 0 0% 100%;
          --secondary: 222 16% 16%;
          --secondary-foreground: 216 15% 80%;
          --muted: 222 16% 14%;
          --muted-foreground: 222 12% 50%;
          --accent: 222 16% 16%;
          --accent-foreground: 216 15% 80%;
          --destructive: 0 55% 52%;
          --destructive-foreground: 0 0% 100%;
          --border: 222 16% 20%;
          --input: 222 16% 20%;
          --ring: 265 35% 45%;
          --radius: 0.375rem;

          --chart-1: 265 35% 55%;
          --chart-2: 45 50% 55%;
          --chart-3: 200 40% 55%;
          --chart-4: 140 40% 45%;
          --chart-5: 0 50% 55%;

          --sidebar-background: 222 20% 6%;
          --sidebar-foreground: 216 15% 80%;
          --sidebar-primary: 265 35% 45%;
          --sidebar-primary-foreground: 0 0% 100%;
          --sidebar-accent: 222 16% 14%;
          --sidebar-accent-foreground: 216 15% 85%;
          --sidebar-border: 222 16% 18%;
          --sidebar-ring: 265 35% 45%;
        }

        .dark {
          color-scheme: dark;
          --background: 222 20% 5%;
          --foreground: 216 15% 92%;
          --card: 222 18% 9%;
          --card-foreground: 216 15% 92%;
          --popover: 222 18% 9%;
          --popover-foreground: 216 15% 92%;
          --primary: 265 35% 45%;
          --primary-foreground: 0 0% 100%;
          --secondary: 222 16% 16%;
          --secondary-foreground: 216 15% 80%;
          --muted: 222 16% 14%;
          --muted-foreground: 222 12% 50%;
          --accent: 222 16% 16%;
          --accent-foreground: 216 15% 80%;
          --destructive: 0 55% 52%;
          --destructive-foreground: 0 0% 100%;
          --border: 222 16% 20%;
          --input: 222 16% 20%;
          --ring: 265 35% 45%;
        }

        body {
          font-family: var(--bex-app-font-family, serif);
          letter-spacing: normal;
          background: var(--bg-primary);
          color: var(--text-primary);
        }

        .font-serif {
          font-family: var(--bex-app-font-family, serif);
        }

        .font-signature {
          font-family: var(--bex-app-font-family, serif);
          letter-spacing: 0.04em;
        }

        h1, h2, h3, h4, h5, h6 {
          font-family: var(--bex-app-font-family, serif);
        }

        button, a, label, th, nav, [class*="uppercase"] {
          font-family: var(--bex-app-font-family, serif);
        }

        input, textarea, select, code, pre, .font-mono {
          font-family: var(--bex-app-font-family, serif);
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2A3040; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #343B4D; }

        /* Rich text editor */
        .ql-toolbar.ql-snow { border-radius: 6px 6px 0 0; border-color: var(--border-subtle); background: var(--bg-surface); }
        .ql-container.ql-snow { border-radius: 0 0 6px 6px; border-color: var(--border-subtle); background: var(--bg-surface); }

        /* Selection */
        ::selection {
          background-color: rgba(107, 76, 154, 0.35);
          color: inherit;
        }

        /* Verse content */
        .verse-content-container { user-select: text; -webkit-user-select: text; }
        .verse-number-badge { user-select: none; -webkit-user-select: none; }

        .markerSelection {
          background: rgba(107, 76, 154, 0.25);
          border-radius: 4px;
          padding: 1px 3px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }

        /* ─── Micro-Interaction System ─── */

        /* Button: lift + crisp shadow */
        .btn-metal {
          transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-metal:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(107,76,154,0.15);
        }
        .btn-metal:active {
          transform: translateY(0px);
          filter: brightness(0.92);
        }

        /* Card: edge highlight on hover */
        .card-metal {
          transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid var(--border-subtle);
          /* Solid surface so floating panels / menus / popups never show the
             canvas content through them. Elements that want a different fill
             can still override with a Tailwind bg-* utility. */
          background: var(--bg-card);
        }
        .card-metal:hover {
          border-color: var(--border-accent);
          box-shadow: 0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgb(var(--ink-muted) / 0.06);
        }

        /* Input: animated focus line */
        .input-metal {
          transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
        }
        .input-metal:focus {
          border-color: var(--accent-violet);
          box-shadow: 0 0 0 2px rgba(107,76,154,0.15);
        }

        .focus-line-wrapper { position: relative; }
        .focus-line {
          position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-gold), transparent);
          transform: scaleX(0); transform-origin: left;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
        }
        .focus-line-wrapper:focus-within .focus-line {
          transform: scaleX(1);
        }

        /* Icon hover */
        .icon-hover {
          transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .icon-hover:hover {
          transform: scale(1.05);
          color: var(--accent-violet-light);
        }

        /* Subtle scan line animation */
        @keyframes scanline {
          0% { transform: translateX(-100%); opacity: 0; }
          40% { opacity: 0.15; }
          100% { transform: translateX(200%); opacity: 0; }
        }
        .scan-shimmer::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgb(var(--ink-muted) / 0.08), transparent);
          animation: scanline 4s ease-in-out infinite;
          pointer-events: none;
        }

        /* Draw-in divider */
        @keyframes drawIn {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        .divider-draw {
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border-accent), transparent);
          animation: drawIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transform-origin: left;
        }

        /* Vertical split motif (echoing the scroll logo) */
        .motif-split {
          width: 1px;
          background: linear-gradient(180deg, transparent, var(--accent-gold) 30%, var(--accent-violet) 70%, transparent);
        }

        /* Cyber node background */
        .cyber-bg {
          position: relative;
        }
        .cyber-bg::before {
          content: '';
          position: absolute; inset: 0;
          background-image:
            radial-gradient(circle at 20% 30%, rgba(107,76,154,0.04) 1px, transparent 1px),
            radial-gradient(circle at 80% 60%, rgba(201,169,78,0.03) 1px, transparent 1px),
            radial-gradient(circle at 50% 80%, rgba(107,76,154,0.03) 1px, transparent 1px),
            radial-gradient(circle at 70% 20%, rgb(var(--ink-muted) / 0.02) 1px, transparent 1px);
          background-size: 200px 200px, 300px 300px, 250px 250px, 180px 180px;
          pointer-events: none;
          z-index: 0;
        }

        @keyframes nodePulse {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.07; }
        }
        .cyber-nodes {
          position: absolute; inset: 0; pointer-events: none; z-index: 0;
          background-image:
            radial-gradient(1px 1px at 15% 25%, rgba(107,76,154,0.3), transparent),
            radial-gradient(1px 1px at 85% 45%, rgba(201,169,78,0.2), transparent),
            radial-gradient(1px 1px at 45% 75%, rgb(var(--ink-muted) / 0.2), transparent),
            radial-gradient(1px 1px at 65% 15%, rgba(107,76,154,0.2), transparent),
            radial-gradient(1px 1px at 30% 55%, rgba(201,169,78,0.15), transparent),
            radial-gradient(1px 1px at 75% 85%, rgb(var(--ink-muted) / 0.15), transparent);
          animation: nodePulse 6s ease-in-out infinite;
        }

        /* Grid lines (subtle) */
        .grid-bg {
          background-image:
            linear-gradient(rgb(var(--line) / 0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgb(var(--line) / 0.3) 1px, transparent 1px);
          background-size: 60px 60px;
        }
      `}</style>
      {/* Full-screen canvas pages manage their own viewport — skip padding. */}
      {isFullScreen ? children : <div className="pb-24">{children}</div>}
      <GlobalSearch />
      <ResumeCard user={user} />
    </div>
  );
}
