import React, { useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ExternalLink, FileText, Lock } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { getRemovedTranslationMessage } from '@shared/removedTranslations';
import ExternalWebLink from '@/components/navigation/ExternalWebLink';

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function AnimatedDisclosure({ open, panelId, labelledBy, children }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          id={panelId}
          role="region"
          aria-labelledby={labelledBy}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.22, ease: 'easeOut' },
          }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DocumentDisclosure({ doc }) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const panelId = `doc-panel-${reactId}`;
  const buttonId = `doc-toggle-${reactId}`;
  const slug = slugify(doc.title);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/50 overflow-hidden">
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-medium text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong"
        data-testid={`button-toggle-doc-${slug}`}
      >
        <FileText className="w-4 h-4" />
        <span className="flex-1">{doc.label}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatedDisclosure open={open} panelId={panelId} labelledBy={buttonId}>
        <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4">
          <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{doc.title}</h4>
          <div className="max-h-96 overflow-y-auto rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
            {doc.format === 'markdown' ? (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-3 prose-p:my-2 prose-li:my-1">
                <ReactMarkdown>{doc.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                {doc.content}
              </pre>
            )}
          </div>
        </div>
      </AnimatedDisclosure>
    </div>
  );
}

function ItemDisclosure({ item }) {
  const [open, setOpen] = useState(false);
  const reactId = useId();
  const panelId = `src-panel-${reactId}`;
  const buttonId = `src-toggle-${reactId}`;
  const slug = slugify(item.name);
  const removed = !!item.legallyRemoved;
  const exportPolicyClasses = {
    allowed: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200',
    conditional: 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-100',
    regional: 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-100',
    blocked: 'border-rose-500/30 bg-rose-500/5 text-rose-900 dark:text-rose-100',
  };
  return (
    <div
      className={`group rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden transition-shadow duration-300 ${
        open ? 'shadow-sm' : ''
      } ${removed ? 'opacity-60' : ''}`}
      data-testid={removed ? `source-removed-${slug}` : undefined}
    >
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
        data-testid={`button-toggle-source-${slug}`}
      >
        <div className="flex-1 min-w-0">
          <h3
            className={`flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white ${
              removed ? 'line-through decoration-gray-400 dark:decoration-gray-600' : ''
            }`}
          >
            {removed && <Lock className="w-3.5 h-3.5 shrink-0 no-underline" />}
            {item.name}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {removed ? getRemovedTranslationMessage(item.code) : item.usage}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            removed
              ? 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
              : 'bg-elevated text-ink-faint dark:bg-elevated/80 dark:text-ink-soft'
          }`}
        >
          {removed ? 'Removed' : item.license}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-300 ease-out ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatedDisclosure open={open} panelId={panelId} labelledBy={buttonId}>
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4">
          {removed && (
            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300">
              <Lock className="w-4 h-4 shrink-0" />
              {getRemovedTranslationMessage(item.code)}
            </p>
          )}
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{item.attribution}</p>

          {item.exportPolicy && (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                exportPolicyClasses[item.exportStatus] || 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300'
              }`}
              data-testid={`export-policy-${slug}`}
            >
              <span className="font-semibold">Export: </span>
              {item.exportPolicy}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {item.sourceUrl && (
              <ExternalWebLink
                href={item.sourceUrl}
                className="inline-flex items-center gap-1.5 text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong"
                data-testid={`link-source-${slug}`}
              >
                <ExternalLink className="w-4 h-4" /> Source
              </ExternalWebLink>
            )}
            {item.licenseUrl && (
              <ExternalWebLink
                href={item.licenseUrl}
                className="inline-flex items-center gap-1.5 text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong"
                data-testid={`link-license-${slug}`}
              >
                <FileText className="w-4 h-4" /> License / permissions
              </ExternalWebLink>
            )}
          </div>

          {item.documents?.length > 0 && (
            <div className="mt-5 space-y-3">
              {item.documents.map((doc) => (
                <DocumentDisclosure key={doc.title} doc={doc} />
              ))}
            </div>
          )}
        </div>
      </AnimatedDisclosure>
    </div>
  );
}

export default function SourceLicenseSection({ section }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{section.title}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{section.description}</p>
      </div>

      <div className="space-y-3">
        {section.items.map((item) => (
          <ItemDisclosure key={item.name} item={item} />
        ))}
      </div>
    </section>
  );
}
