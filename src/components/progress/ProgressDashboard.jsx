import React, { useMemo, useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { TrendingUp, BookOpen, MessageSquare, Lightbulb } from 'lucide-react';
import { subDays, parseISO } from 'date-fns';
import { desktopClient } from '@/api/desktopClient';
import ActivityChart from './ActivityChart';
import Card3DTilt from '@/components/shaders/Card3DTilt';

export default function ProgressDashboard({ chapters, annotations, dailyActivities, user, keywords }) {
  const [chartMode, setChartMode] = useState('line');
  const [timeframe, setTimeframe] = useState('30d');

  // Load persisted preferences
  useEffect(() => {
    if (user?.chart_mode) setChartMode(user.chart_mode);
    if (user?.chart_timeframe) setTimeframe(user.chart_timeframe);
  }, [user?.chart_mode, user?.chart_timeframe]);

  const handleChartModeChange = async (mode) => {
    setChartMode(mode);
    await desktopClient.owner.updatePreferences({ chart_mode: mode });
  };

  const handleTimeframeChange = async (tf) => {
    setTimeframe(tf);
    await desktopClient.owner.updatePreferences({ chart_timeframe: tf });
  };

  // Calculate stats
  const stats = useMemo(() => {
    const today = new Date();
    const twentyDaysAgo = subDays(today, 20);
    const safeDate = (str) => (str ? parseISO(str) : null);

    // Filter recent activities
    const recentActivities = dailyActivities.filter(act => {
      const actDate = safeDate(act.date);
      return actDate && actDate >= twentyDaysAgo;
    });

    const totalChapters = chapters.length;
    const totalAnnotations = annotations.length;
    const totalKeywords = keywords?.length || 0;
    
    const recentChapters = chapters.filter(ch => {
      const chDate = safeDate(ch.created_date || ch.created_at);
      return chDate && chDate >= twentyDaysAgo;
    }).length;

    const recentAnnotations = annotations.filter(ann => {
      const annDate = safeDate(ann.created_date || ann.created_at);
      return annDate && annDate >= twentyDaysAgo;
    }).length;

    const recentKeywords = keywords?.filter(kw => {
      const kwDate = safeDate(kw.created_date || kw.created_at);
      return kwDate && kwDate >= twentyDaysAgo;
    }).length || 0;

    // Calculate verses (approximate: average 25 verses per chapter)
    const estimatedVerses = totalChapters * 25;

    return {
      totalChapters,
      totalAnnotations,
      totalKeywords,
      estimatedVerses,
      recentChapters,
      recentAnnotations,
      recentKeywords,
      days: recentActivities.length || 20
    };
  }, [chapters, annotations, dailyActivities, keywords]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card3DTilt
          innerClassName="p-4 flex flex-col h-full"
          shaderIntensity={0.5}
          shaderHueShift={0.5}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">Chapters Studied</p>
              <div className="flex items-baseline gap-1">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalChapters}</p>
                <p className="text-lg text-gray-400 dark:text-gray-500">/</p>
                <p className="text-lg text-gray-500 dark:text-gray-400">1189</p>
              </div>
              {stats.recentChapters > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400">+{stats.recentChapters} recently</p>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="h-24 w-3.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-full transition-all duration-500"
                  style={{ height: `${Math.min(100, (stats.totalChapters / 1189) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                {((stats.totalChapters / 1189) * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        </Card3DTilt>

        <Card3DTilt
          innerClassName="p-4 flex flex-col h-full"
          shaderIntensity={0.5}
          shaderHueShift={0.6}
        >
          <div className="flex items-center gap-4 mb-3 flex-1">
            <div className="p-4 rounded-lg bg-elevated dark:bg-app/50">
              <Lightbulb className="w-8 h-8 text-gold dark:text-ink-faint" />
            </div>
            <div>
              <p className="text-base text-gray-500 dark:text-gray-400">Keywords</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-white">{stats.totalKeywords}</p>
              {stats.recentKeywords > 0 && (
                <p className="text-sm text-green-600 dark:text-green-400">+{stats.recentKeywords} recently</p>
              )}
            </div>
          </div>
        </Card3DTilt>

        <Card3DTilt
          innerClassName="p-4"
          shaderIntensity={0.5}
          shaderHueShift={0.7}
        >
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                <MessageSquare className="w-8 h-8 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-base text-gray-500 dark:text-gray-400">Annotations</p>
                <p className="text-4xl font-bold text-gray-900 dark:text-white">{stats.totalAnnotations}</p>
                {stats.recentAnnotations > 0 && (
                  <p className="text-sm text-green-600 dark:text-green-400">+{stats.recentAnnotations} recently</p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-lg bg-indigo-100 dark:bg-indigo-900/50">
                <TrendingUp className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-base text-gray-500 dark:text-gray-400">Est. Verses</p>
                <p className="text-4xl font-bold text-gray-900 dark:text-white">{stats.estimatedVerses}</p>
              </div>
            </div>
          </div>
        </Card3DTilt>
      </div>

      {/* Activity Chart */}
      <Card className="p-6 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <ActivityChart
          chapters={chapters}
          annotations={annotations}
          keywords={keywords}
          user={user}
          chartMode={chartMode}
          timeframe={timeframe}
          onChartModeChange={handleChartModeChange}
          onTimeframeChange={handleTimeframeChange}
        />
      </Card>
    </div>
  );
}
