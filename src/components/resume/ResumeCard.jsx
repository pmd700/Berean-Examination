import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, X, BookOpen, Tag, MessageSquare,
  Shield, Image, Settings, Users, UserPlus, Ban, Megaphone, Network, MapPin, NotebookPen, Table2 } from
'lucide-react';
import { createPageUrl } from '@/utils';
import { useWorkspaceTabs } from '@/lib/WorkspaceTabs';
import { getLastActivity, buildActivityUrl } from '../utils/activityTracker';
import Card3DTilt from '@/components/shaders/Card3DTilt';
import { sameResumeDestination } from './resumeActivityModel';

const ICON_MAP = {
  study: BookOpen,
  keyword: Tag,
  social: MessageSquare,
  admin: Shield,
  chapter_art: Image,
  account: Settings,
  friends: Users,
  requests: UserPlus,
  blocked: Ban,
  updates: Megaphone,
  knowledge_web: Network,
  mind_note: NotebookPen,
  spreadsheet: Table2,
  note: NotebookPen,
  geography: MapPin,
  map: MapPin,
};

const PROMPT_BY_TYPE = {
  study_chapter: 'Want to get back to your Bible reading?',
  study_dashboard: 'Want to get back to your study?',
  keyword: 'Pick up where you left off in your keyword research?',
  social_chat: 'Want to get back to your conversation?',
  social_friends: 'Want to get back to your friends list?',
  social_requests: 'Want to review your friend requests?',
  social_blocked: 'Want to manage your blocked users?',
  knowledge_web: 'Want to get back to your knowledge web?',
  knowledge_web_private: 'Want to get back to working on your encrypted web?',
  mind_note: 'Want to get back to your note?',
  spreadsheet: 'Want to get back to your spreadsheet?',
  chapter_art: 'Want to get back to your chapter art?',
  admin_updates: 'Want to get back to that update push?',
  geography: 'Want to get back to your map workflow?',
};

function pickPrompt(activity) {
  if (!activity) return 'Pick up where you left off?';
  if (PROMPT_BY_TYPE[activity.type]) return PROMPT_BY_TYPE[activity.type];
  if (activity.title) return activity.title;
  return 'Pick up where you left off?';
}

function getIcon(activity) {
  if (!activity) return BookOpen;
  const hint = activity.icon || activity.type || '';
  for (const [key, Icon] of Object.entries(ICON_MAP)) {
    if (hint.includes(key)) return Icon;
  }
  return BookOpen;
}

const SESSION_DISMISS_KEY = 'resume-card-dismissed';

function isDismissedForSession() {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function markDismissedForSession() {
  try {
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
  } catch {/* ignore */}
}

export default function ResumeCard({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTab } = useWorkspaceTabs();
  const [visible, setVisible] = useState(false);
  const [activity, setActivity] = useState(null);
  // Remember the path the user was on when the card first appeared.
  // The first time they navigate away from it, the card is dismissed
  // for the rest of this browser-tab session.
  const initialPathRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    if (isDismissedForSession()) return;
    const act = getLastActivity(user);
    if (!act) return;

    // The workspace tab is the source of truth. On launch its restored path can
    // arrive after the browser URL, which is why checking window.location once
    // used to offer to resume the note that was already open on screen.
    const browserPath = `${location.pathname}${location.search}${location.hash}`;
    const workspacePath = activeTab?.path;
    const actUrl = buildActivityUrl(act, createPageUrl);
    if (
      actUrl
      && (
        sameResumeDestination(actUrl, workspacePath)
        || sameResumeDestination(actUrl, browserPath)
      )
    ) {
      setVisible(false);
      setActivity(null);
      markDismissedForSession();
      return;
    }

    // Don't show if activity is too old (> 7 days)
    if (act.timestamp) {
      const age = Date.now() - new Date(act.timestamp).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) return;
    }

    setActivity(act);
    initialPathRef.current = workspacePath || browserPath;
    const timer = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(timer);
  }, [user, activeTab?.path, location.pathname, location.search, location.hash]);

  // Auto-dismiss the card the first time the user navigates to a
  // different page after it appeared. Persisted in sessionStorage so
  // it stays gone if they navigate back, until they open a new tab.
  useEffect(() => {
    if (!activity) return;
    if (initialPathRef.current == null) return;
    const currentPath = activeTab?.path || `${location.pathname}${location.search}${location.hash}`;
    if (currentPath !== initialPathRef.current) {
      setVisible(false);
      markDismissedForSession();
    }
  }, [activeTab?.path, location.pathname, location.search, location.hash, activity]);

  if (!visible || !activity) return null;

  const Icon = getIcon(activity);
  const resumeUrl = buildActivityUrl(activity, createPageUrl);
  const prompt = pickPrompt(activity);

  const handleResume = () => {
    if (!resumeUrl) return;
    setVisible(false);
    markDismissedForSession();
    try {
      const u = new URL(resumeUrl, window.location.origin);
      navigate(u.pathname + u.search + u.hash);
    } catch {
      navigate(resumeUrl);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    markDismissedForSession();
  };

  return (
    <div
      className="fixed top-24 right-6 z-50 animate-in fade-in slide-in-from-top-2 duration-300"
      data-testid="resume-card"
    >
      <Card3DTilt
        className="max-w-sm"
        innerClassName="p-4"
        shaderIntensity={0.5}
        shaderHueShift={0.55}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-ink-soft" />
              <span className="text-sm text-ink" data-testid="text-resume-prompt">
                {prompt}
              </span>
            </div>
            {activity.subtitle && (
              <div
                className="text-slate-50 mb-3 text-base font-semibold"
                data-testid="text-resume-subtitle"
              >
                {activity.subtitle}
              </div>
            )}
            {!activity.subtitle && <div className="mb-1" />}
            <Button
              onClick={handleResume}
              size="sm"
              data-testid="button-resume"
              className="h-8 bg-gradient-to-r from-brand to-brand-strong hover:from-[#5A3E87] hover:to-[#5A3E87] text-white text-xs shadow-md"
            >
              Resume
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          <button
            onClick={handleDismiss}
            data-testid="button-resume-dismiss"
            className="text-ink-soft hover:text-ink transition-colors p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </Card3DTilt>
    </div>
  );
}
