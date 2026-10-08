import React from 'react';

/**
 * App-wide light/dark theme.
 *
 * The class on <html> is the single switch: every colour in the app resolves
 * through the variables in styles/theme.css, so flipping `dark`/`light` there
 * retones the whole interface at once — no per-page wiring, no page that gets
 * left behind on the old tone.
 *
 * The preference is stored locally so the choice survives a restart even
 * before the desktop bridge is ready, and mirrored into owner preferences on
 * desktop so it travels with the library.
 */

const STORAGE_KEY = 'bex_theme';
const ANIMATION_CLASS = 'bex-theme-animating';
const ANIMATION_MS = 460;   // a shade longer than the CSS transition

const ThemeContext = React.createContext(null);

export function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage unavailable — fall through to the default */ }
  return 'dark';   // the app's original look is the default
}

/**
 * Put the theme on <html>.
 *
 * `animate` adds a short-lived class that transitions colours, so the switch
 * eases from one tone to the other. It is removed afterwards so the whole page
 * isn't carrying a transition rule during normal use.
 */
export function applyTheme(theme, { animate = false } = {}) {
  const html = document.documentElement;
  if (animate) html.classList.add(ANIMATION_CLASS);
  html.classList.toggle('dark', theme === 'dark');
  html.classList.toggle('light', theme !== 'dark');
  if (animate) {
    window.clearTimeout(applyTheme._timer);
    applyTheme._timer = window.setTimeout(
      () => html.classList.remove(ANIMATION_CLASS),
      ANIMATION_MS,
    );
  }
}

export function useTheme() {
  const value = React.useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = React.useState(readStoredTheme);

  // No animation on first paint — only on a deliberate switch.
  React.useEffect(() => { applyTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up the stored preference from the library once the bridge is ready,
  // without clobbering a choice the user just made in this session.
  const touched = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const desktop = typeof window !== 'undefined' ? window.bexDesktop : null;
        if (!desktop?.isDesktop) return;
        const { readLocalOwner } = await import('@/lib/localOwner');
        const owner = await readLocalOwner();
        const stored = owner?.theme === 'light' ? 'light' : owner?.theme === 'dark' ? 'dark' : null;
        if (!cancelled && stored && !touched.current && stored !== theme) {
          setThemeState(stored);
          applyTheme(stored);
        }
      } catch { /* not signed in yet, or not on desktop — local storage wins */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = React.useCallback((next) => {
    touched.current = true;
    setThemeState(next);
    applyTheme(next, { animate: true });
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* non-fatal */ }
    (async () => {
      try {
        const desktop = typeof window !== 'undefined' ? window.bexDesktop : null;
        if (!desktop?.isDesktop) return;
        const { desktopClient } = await import('@/api/desktopClient');
        await desktopClient.owner.updatePreferences({ theme: next });
      } catch { /* preference is still applied and stored locally */ }
    })();
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme, isDark: theme === 'dark' }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
