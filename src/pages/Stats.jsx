import React from 'react';
import { BarChart3 } from 'lucide-react';
import BackToLibraryHomeButton from '@/components/navigation/BackToLibraryHomeButton';
import ProgressDashboard from '@/components/progress/ProgressDashboard';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { readLocalOwner } from '@/lib/localOwner';
import { platformEntities } from '@/lib/platform/entities';
import { useTabTitle } from '@/lib/WorkspaceTabs';

const EMPTY_STATS = {
  user: null,
  chapters: [],
  annotations: [],
  dailyActivities: [],
  keywords: [],
};

export default function Stats() {
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState(EMPTY_STATS);
  useTabTitle('Stats');

  React.useEffect(() => {
    let active = true;

    const loadStats = async () => {
      try {
        const [user, chapters, annotations, dailyActivities, keywords] = await Promise.all([
          readLocalOwner(),
          platformEntities.StudyChapter.list('-updated_date'),
          platformEntities.Annotation.list('-created_date'),
          platformEntities.DailyActivity.list('-date'),
          platformEntities.Keyword.list('-created_date'),
        ]);

        if (active) {
          setStats({ user, chapters, annotations, dailyActivities, keywords });
        }
      } catch (error) {
        console.error('Failed to load statistics:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadStats();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <LoadingScreen message="Loading stats..." fullScreen={false} />;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-app">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-7 flex items-center gap-3">
          <BackToLibraryHomeButton />
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/[0.06]">
            <BarChart3 className="h-5 w-5 text-sky-300" />
          </div>
          <h1 className="text-2xl font-semibold text-ink">Stats</h1>
        </header>

        <ProgressDashboard
          chapters={stats.chapters}
          annotations={stats.annotations}
          dailyActivities={stats.dailyActivities}
          user={stats.user}
          keywords={stats.keywords}
        />
      </main>
    </div>
  );
}
