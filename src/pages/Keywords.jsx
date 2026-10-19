import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { desktopClient } from '@/api/desktopClient';
import { useAuth } from '@/lib/AuthContext';
import { platformEntities } from '@/lib/platform/entities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { 
  BookOpen, Plus, Trash2, Search,
  Calendar, Tag, SortAsc, Clock
} from 'lucide-react';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import BackToLibraryHomeButton, { useReturnToLibraryHome } from '@/components/navigation/BackToLibraryHomeButton';
import TEXT_EDITOR_MACHINERY from '../components/editor/TEXT_EDITOR_MACHINERY';
import SaveStatusIndicator from '../components/editor/SaveStatusIndicator';
import { useAutoSave } from '../components/editor/useAutoSave';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { getUserTimezone, formatInTz } from '../components/utils/timezoneUtils';
import { LoadingScreen } from '../components/ui/loading-screen';
import { useInfiniteScroll } from '../components/ui/useInfiniteScroll';
import UnsavedChangesDialog from '../components/editor/UnsavedChangesDialog';
import { trackActivity } from '../components/utils/activityTracker';

export default function Keywords() {
  const navigate = useNavigate();
  const returnToLibraryHome = useReturnToLibraryHome();
  // Background tabs stay mounted; only the visible one may redirect.
  const isActiveTab = useIsActiveTab();
  const { isAuthenticated, isLoadingAuth, user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [keywords, setKeywords] = useState([]);
  const [editingKeyword, setEditingKeyword] = useState(null);
  const [showForm, setShowForm] = useState(false);
  
  // Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [explanation, setExplanation] = useState('');
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [editorInstance, setEditorInstance] = useState(null);
  
  // Search and sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date'); // 'date' or 'alpha'

  // Unsaved changes dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Auto-save for form
  const { saveStatus, hasUnsavedChanges, resetSaveState } = useAutoSave({
    content: explanation,
    initialContent: editingKeyword?.explanation || '',
    onSave: async (content) => {
      // Only auto-save if editing and has title
      if (editingKeyword && title.trim()) {
        await platformEntities.Keyword.update(editingKeyword.id, {
          title: title.trim(),
          category: category.trim() || '',
          explanation: content.trim()
        });
      }
    },
    delay: 5000,
    enabled: showForm && !!editingKeyword
  });

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { if (isActiveTab) navigate('/'); return; }
    checkAuth();
  }, [isLoadingAuth, isAuthenticated]);

  const checkAuth = async () => {
    try {
      const currentUser = authUser || (await desktopClient.owner.read());
      setUser(currentUser);
      await loadKeywords();

      // Check if we should open a specific keyword from URL params
      const urlParams = new URLSearchParams(window.location.search);
      const kwId = urlParams.get('keyword_id');
      if (kwId) {
        const all = await platformEntities.Keyword.list('-updated_date');
        const target = all.find(k => String(k.id) === String(kwId));
        if (target) {
          setEditingKeyword(target);
          setTitle(target.title);
          setCategory(target.category || '');
          setExplanation(target.explanation);
          resetSaveState(target.explanation);
          setShowForm(true);
        }
      }
    } catch (e) {
      console.error('[Keywords] checkAuth error (non-fatal):', e);
    }
    setLoading(false);
  };

  const loadKeywords = async () => {
    const all = await platformEntities.Keyword.list('-updated_date');
    
    // DEBUG: Log what we loaded from DB
    all.forEach((kw, idx) => {
      if (kw.explanation.includes('img') || kw.explanation.includes('Image')) {
        console.log(`📖 LOADED FROM DB - Keyword #${idx} (${kw.title}):`, kw.explanation.substring(0, 200));
        console.log(`📖 Contains img tags:`, kw.explanation.includes('<img'));
      }
    });
    
    setKeywords(all);
  };

  const handleCreateNew = () => {
    setEditingKeyword(null);
    setTitle('');
    setCategory('');
    setExplanation('');
    resetSaveState(''); // Reset with empty content
    setShowForm(true);
  };

  const handleEdit = (keyword) => {
    // If we have unsaved changes in current form, show dialog
    if ((hasUnsavedChanges || saveStatus === 'saving') && showForm) {
      setPendingAction(() => () => {
        setEditingKeyword(keyword);
        setTitle(keyword.title);
        setCategory(keyword.category || '');
        setExplanation(keyword.explanation);
        resetSaveState(keyword.explanation);
        setShowForm(true);
      });
      setShowUnsavedDialog(true);
      return;
    }
    setEditingKeyword(keyword);
    setTitle(keyword.title);
    setCategory(keyword.category || '');
    setExplanation(keyword.explanation);
    resetSaveState(keyword.explanation);
    setShowForm(true);
    trackActivity({
      type: 'keyword_edit',
      page: 'Keywords',
      title: 'Continue explaining?',
      subtitle: keyword.title,
      icon: 'keyword',
      state: { keyword_id: keyword.id },
      url_params: `keyword_id=${keyword.id}`,
    });
  };

  const handleCancel = () => {
    if (hasUnsavedChanges || saveStatus === 'saving') {
      setPendingAction(() => () => {
        setShowForm(false);
        setEditingKeyword(null);
        setTitle('');
        setCategory('');
        setExplanation('');
        resetSaveState();
      });
      setShowUnsavedDialog(true);
      return;
    }
    setShowForm(false);
    setEditingKeyword(null);
    setTitle('');
    setCategory('');
    setExplanation('');
    resetSaveState();
  };

  const handleReturnToLibrary = () => {
    if ((hasUnsavedChanges || saveStatus === 'saving') && showForm) {
      setPendingAction(() => returnToLibraryHome);
      setShowUnsavedDialog(true);
      return;
    }
    returnToLibraryHome();
  };

  const handleSave = async () => {
    if (isUploadingImages) {
      toast.error('Please wait for images to finish uploading');
      return;
    }

    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    // Get the CURRENT content from the editor instance at save time
    let finalExplanation = explanation.trim();
    if (editorInstance) {
      // Check for any unfinalized images in the editor
      let hasUnfinalizedImages = false;
      editorInstance.state.doc.descendants((node) => {
        if (node.type.name === 'imageUpload') {
          if (node.attrs.uploading || node.attrs.error || !node.attrs.src) {
            hasUnfinalizedImages = true;
            return false;
          }
        }
      });

      if (hasUnfinalizedImages) {
        toast.error('Some images are still uploading or failed. Please wait or remove them.');
        return;
      }

      // Get the final HTML from the editor (Markdown doesn't reliably serialize images)
      finalExplanation = editorInstance.getHTML().trim();
      
      // DEBUG: Log what we're about to save
      console.log('💾 SAVING TO DB - Explanation content:', finalExplanation);
      console.log('💾 Content length:', finalExplanation.length);
      console.log('💾 Contains img tags:', finalExplanation.includes('<img'));
    }

    if (!finalExplanation) {
      toast.error('Explanation is required');
      return;
    }

    if (category && category.length > 25) {
      toast.error('Category must be 25 characters or less');
      return;
    }

    // Check for duplicate title+category (excluding current if editing)
    const duplicate = keywords.find(k => 
      k.title.toLowerCase() === title.trim().toLowerCase() &&
      (k.category || '') === (category.trim() || '') &&
      k.id !== editingKeyword?.id
    );

    if (duplicate) {
      toast.error('A keyword with this title and category already exists');
      return;
    }

    const payload = {
      title: title.trim(),
      category: category.trim() || '',
      explanation: finalExplanation
    };

    if (editingKeyword) {
      await platformEntities.Keyword.update(editingKeyword.id, payload);
      toast.success('Keyword updated');
    } else {
      await platformEntities.Keyword.create(payload);
      toast.success('Keyword created');
    }

    await loadKeywords();
    resetSaveState();
    setShowForm(false);
    setEditingKeyword(null);
    setTitle('');
    setCategory('');
    setExplanation('');
  };

  const handleDelete = async (keyword) => {
    const ok = await confirmDialog({
      title: `Delete keyword "${keyword.title}"?`,
      description: 'This permanently removes the keyword. This cannot be undone.',
      confirmText: 'Delete keyword',
      cancelText: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    
    await platformEntities.Keyword.delete(keyword.id);
    toast.success('Keyword deleted');
    await loadKeywords();
  };

  const filteredAndSortedKeywords = () => {
    let filtered = keywords;

    if (searchQuery) {
      filtered = filtered.filter(k => 
        k.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (k.category || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'alpha') {
        return a.title.localeCompare(b.title);
      } else {
        return new Date(b.updated_date) - new Date(a.updated_date);
      }
    });

    return sorted;
  };

  const { displayedItems, hasMore, observerTarget } = useInfiniteScroll(
    filteredAndSortedKeywords(),
    20
  );

  if (loading) {
    return <LoadingScreen message="Loading Keywords..." />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <main className="max-w-7xl mx-auto px-4 py-8">
        <BackToLibraryHomeButton className="mb-6" onClick={handleReturnToLibrary} />
        
        {showForm ? (
          <Card className="p-6 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {editingKeyword ? 'Edit Keyword' : 'Create New Keyword'}
              </h2>
              {editingKeyword && <SaveStatusIndicator status={saveStatus} />}
            </div>

            <div className="space-y-6">
              <div>
                <Label className="text-gray-700 dark:text-gray-300 mb-2">Title *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Justification, Sanctification"
                  className="dark:bg-gray-800 dark:border-gray-700"
                />
              </div>

              <div>
                <Label className="text-gray-700 dark:text-gray-300 mb-2">
                  Category <span className="text-xs text-gray-500">(optional, max 25 chars)</span>
                </Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value.slice(0, 25))}
                  placeholder="e.g., Theology, History, Greek"
                  className="dark:bg-gray-800 dark:border-gray-700"
                />
                <p className="text-xs text-gray-500 mt-1">{category.length}/25</p>
              </div>

              <div>
                <Label className="text-gray-700 dark:text-gray-300 mb-2">Explanation *</Label>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                  <TEXT_EDITOR_MACHINERY
                    content={explanation}
                    onChange={setExplanation}
                    onUploadingChange={setIsUploadingImages}
                    onEditorReady={setEditorInstance}
                    placeholder="Write your explanation..."
                    localFindShortcut
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={handleCancel} disabled={isUploadingImages}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isUploadingImages} className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {isUploadingImages ? 'Uploading images…' : editingKeyword ? 'Update Keyword' : 'Create Keyword'}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                My Keywords ({keywords.length})
              </h2>
              <Button onClick={handleCreateNew} className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                New Keyword
              </Button>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search keywords..."
                    className="pl-10 dark:bg-gray-800 dark:border-gray-700"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={sortBy === 'alpha' ? 'default' : 'outline'}
                    onClick={() => setSortBy('alpha')}
                    className={sortBy === 'alpha' ? 'bg-purple-600 hover:bg-purple-700' : ''}
                  >
                    <SortAsc className="w-4 h-4 mr-2" />
                    A-Z
                  </Button>
                  <Button
                    variant={sortBy === 'date' ? 'default' : 'outline'}
                    onClick={() => setSortBy('date')}
                    className={sortBy === 'date' ? 'bg-purple-600 hover:bg-purple-700' : ''}
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Date
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {displayedItems.map((keyword) => (
                  <motion.div
                    key={keyword.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 hover:border-purple-300 dark:hover:border-purple-700 transition-colors cursor-pointer"
                    onClick={() => handleEdit(keyword)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {keyword.title}
                          </h3>
                          {keyword.category && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                              <Tag className="w-3 h-3" />
                              {keyword.category}
                            </span>
                          )}
                        </div>
                        <div 
                          className="text-xs text-gray-500 dark:text-gray-500 mb-3 line-clamp-2 opacity-60 prose prose-xs dark:prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: keyword.explanation }}
                        />
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Calendar className="w-3 h-3" />
                          {keyword.updated_date !== keyword.created_date ? 'Last edited: ' : 'Created: '}
                          {formatInTz(keyword.updated_date, getUserTimezone(user))}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(keyword);
                          }}
                          className="h-8 w-8 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {displayedItems.length === 0 && (
                <div className="text-center py-12">
                  <BookOpen className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {searchQuery ? 'No keywords found' : 'No keywords yet. Create your first one!'}
                  </p>
                </div>
              )}

              {hasMore && (
                <div 
                  ref={observerTarget} 
                  className="py-8 text-center"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <div className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    Loading more keywords...
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onStay={() => {
          setShowUnsavedDialog(false);
          setPendingAction(null);
        }}
        onLeave={() => {
          setShowUnsavedDialog(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
        onSaveAndLeave={async () => {
          // Save first
          await handleSave();
          setShowUnsavedDialog(false);
          // Then execute pending action if it still exists
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
        isSaving={saveStatus === 'saving'}
      />
    </div>
  );
}
