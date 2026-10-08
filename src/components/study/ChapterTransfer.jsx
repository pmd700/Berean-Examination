import React, { useRef, useState } from 'react';
import { Download, Upload, FileDown, Loader2, Lock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { desktopClient } from '@/api/desktopClient';
import { toast } from 'sonner';
import { parsePreparedText } from '../utils/chapterParser';
import { buildStudyChapterMarkdown } from '@/lib/bibleStudyExport';
import {
  ESV_STUDY_EXPORT_BLOCK_MESSAGE,
  isStudyMaterialExportAllowed,
} from '@/lib/bibleStudyExportPolicy';

export default function ChapterTransfer({ currentChapter, annotations, onImportComplete }) {
  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const exportBlocked = !isStudyMaterialExportAllowed(currentChapter);

  const handleExport = () => {
    if (!currentChapter) return;
    if (exportBlocked) {
      toast.error(ESV_STUDY_EXPORT_BLOCK_MESSAGE);
      return;
    }
    
    try {
        const content = buildStudyChapterMarkdown({
          chapter: currentChapter,
          annotations,
        });

        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${currentChapter.book}_${currentChapter.chapter_number}.md`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("Exported successfully!");
    } catch (e) {
        console.error(e);
        toast.error("Failed to export.");
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        setIsProcessing(true);
        await parseAndImportContent(text);
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const parseAndImportContent = async (fileText) => {
    try {
        const sections = { Context: '', Application: '', Notes: '', Text: '' };
        let currentSection = null;
        let lines = fileText.split('\n');
        let rawTextLines = [];
        
        const parsedAnnotations = [];
        let currentVerseNumber = null;
        let currentAnnotation = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            const sectionMatch = line.match(/^\[(Context|Application|Notes|Text)\]/i);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                continue;
            }

            if (currentSection === 'Context') sections.Context += line + '\n';
            else if (currentSection === 'Application') sections.Application += line + '\n';
            else if (currentSection === 'Notes') sections.Notes += line + '\n';
            else if (currentSection === 'Text') {
                if (line.startsWith('### ')) {
                    rawTextLines.push(line);
                    currentAnnotation = null;
                } else if (line.match(/^~(\d+)\s/)) {
                    currentVerseNumber = parseInt(line.match(/^~(\d+)/)[1]);
                    rawTextLines.push(line);
                    currentAnnotation = null;
                } else if (line.startsWith('  | ')) {
                    currentAnnotation = {
                        start_verse: currentVerseNumber,
                        selected_text: line.substring(4).trim(),
                        content: ''
                    };
                    parsedAnnotations.push(currentAnnotation);
                } else if (line.startsWith('    ') && currentAnnotation) {
                    currentAnnotation.content += line.substring(4) + '\n';
                } else if (line.trim() === '') {
                    if (currentAnnotation) {
                        currentAnnotation.content += '\n';
                    } else {
                        rawTextLines.push(line);
                    }
                } else {
                    rawTextLines.push(line);
                }
            }
        }

        const newRawText = rawTextLines.join('\n').trim();

        await desktopClient.entities.StudyChapter.update(currentChapter.id, {
            context: sections.Context.trim(),
            application: sections.Application.trim(),
            notes: sections.Notes.trim(),
            raw_text: newRawText
        });

        // Delete existing annotations first to avoid duplicates
        for (const ann of annotations) {
            await desktopClient.entities.Annotation.delete(ann.id);
        }

        const blocks = parsePreparedText(newRawText);
        const tokenizeText = (text) => text.split(/(\s+)/);
        
        const allTokens = [];
        blocks.forEach(b => {
            if (b.type === 'verse') {
                const tokens = tokenizeText(b.text);
                tokens.forEach((t, i) => {
                    allTokens.push({
                        verse: b.verseNumber,
                        index: i,
                        text: t,
                        isWhitespace: /^\s+$/.test(t)
                    });
                });
            }
        });

        for (const ann of parsedAnnotations) {
            if (!ann.selected_text || !ann.start_verse) continue;
            
            const target = ann.selected_text.replace(/\s+/g, '').toLowerCase();
            let startToken = null;
            let endToken = null;

            const startIndex = allTokens.findIndex(t => t.verse === ann.start_verse);
            if (startIndex === -1) continue;

            for (let i = startIndex; i < allTokens.length; i++) {
                let current = '';
                let j = i;
                while (j < allTokens.length && current.length < target.length) {
                    if (!allTokens[j].isWhitespace) {
                        current += allTokens[j].text.toLowerCase();
                    }
                    j++;
                }
                if (current === target) {
                    startToken = allTokens[i];
                    endToken = allTokens[j - 1];
                    break;
                }
            }

            if (startToken && endToken) {
                await desktopClient.entities.Annotation.create({
                    book: currentChapter.book,
                    chapter_number: currentChapter.chapter_number,
                    version: currentChapter.version,
                    start_verse: startToken.verse,
                    start_token_index: startToken.index,
                    end_verse: endToken.verse,
                    end_token_index: endToken.index,
                    selected_text: ann.selected_text,
                    content: ann.content.trim()
                });
            }
        }

        toast.success("Imported successfully!");
        if (onImportComplete) {
            // Need to wait briefly to let DB settle
            setTimeout(() => {
                onImportComplete();
            }, 1000);
        }
    } catch (e) {
        console.error(e);
        toast.error("Failed to import. Check format.");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="dark:text-gray-300" disabled={isProcessing}>
            {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            Transfer
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={handleExport}
            disabled={exportBlocked}
            className={exportBlocked ? '' : 'cursor-pointer'}
            title={exportBlocked ? ESV_STUDY_EXPORT_BLOCK_MESSAGE : undefined}
          >
            {exportBlocked
              ? <Lock className="w-4 h-4 mr-2" />
              : <Download className="w-4 h-4 mr-2" />}
            {exportBlocked ? 'ESV export unavailable' : 'Export Chapter (.md)'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()} className="cursor-pointer">
            <Upload className="w-4 h-4 mr-2" />
            Import Chapter (.md)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input 
        type="file" 
        accept=".md,.txt" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
      />
    </>
  );
}
