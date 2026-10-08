import React from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import SourceLicenseSection from '../components/licenses/SourceLicenseSection';
import { SOURCE_LICENSE_SECTIONS } from '../components/licenses/sourceLicensesData';

export default function SourcesLicenses() {
  const visibleSections = SOURCE_LICENSE_SECTIONS;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Button
          variant="ghost"
          onClick={() => window.history.back()}
          className="mb-6 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-elevated px-3 py-1 text-xs font-medium text-ink-faint dark:bg-app/40 dark:text-brand-strong">
                <BookOpen className="h-3.5 w-3.5" />
                Sources & Licenses
              </div>
              <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">Sources & Licenses</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                BEX bundles its approved Bible library for fully offline study. ESV remains reserved for a future approved Online Mode, while NLT and NASB remain removed. Open each source below for its attribution, license, and export rules.
                Third-party software and contributor notices are listed in their own section.
              </p>
            </div>

            <a href={createPageUrl('Study')} className="shrink-0">
              <Button variant="outline" className="dark:border-gray-700">
                <BookOpen className="mr-2 h-4 w-4" />
                Return to Bible Study
              </Button>
            </a>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {visibleSections.map((section) => (
            <SourceLicenseSection key={section.title} section={section} />
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
          Rights can differ by country. These notices describe BEX’s current release policy and do not replace advice from a qualified lawyer.
        </div>
      </div>
    </div>
  );
}
