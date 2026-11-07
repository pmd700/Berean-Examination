import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('workspace navigation', () => {
  test('a new tab opens the four-column local library home', () => {
    const tabs = read('src/lib/WorkspaceTabs.jsx');
    const bar = read('src/components/tabs/TabBar.jsx');
    const home = read('src/pages/LibraryHome.jsx');
    const pages = read('src/pages.config.js');

    assert.match(tabs, /HOME: 'home'/);
    assert.match(tabs, /NEW_TAB_PATH = createPageUrl\('LibraryHome'\)/);
    assert.match(bar, /openTab\(TAB_KINDS\.HOME, \{ path: NEW_TAB_PATH, title: 'New tab' \}\)/);
    assert.match(pages, /mainPage: "LibraryHome"/);

    for (const category of ['web', 'note', 'timeline', 'spreadsheet']) {
      assert.match(home, new RegExp(`library-create-\\$\\{category\\}`));
    }
    assert.match(home, /shortcut: 'W'/);
    assert.match(home, /shortcut: 'N'/);
    assert.match(home, /shortcut: 'T'/);
    assert.match(home, /shortcut: 'S'/);
    assert.doesNotMatch(home, /shortcut: 'B'/);
    assert.match(home, /xl:grid-cols-4/);
    assert.match(home, /<ScriptureSearch/);
    assert.match(home, /Create with \{config\.shortcut\}/);
    assert.match(home, /CATEGORY_BY_SHORTCUT\[event\.key\.toLowerCase\(\)\]/);
    assert.match(home, /window\.addEventListener\('keydown', handleCreateShortcut\)/);
    assert.match(home, /isEditableTarget\(event\.target\)/);
    assert.doesNotMatch(home, /ArrowUpRight/);
    assert.doesNotMatch(home, /\{config\.short\}/);
    assert.doesNotMatch(tabs.split('const DEFAULT_TITLES')[0], /label: 'Bible Study'/);
    assert.match(tabs, /\[TAB_KINDS\.STUDY\]: 'Bible Study'/);
  });

  test('the home reuses real create, folder, export and privacy flows', () => {
    const home = read('src/pages/LibraryHome.jsx');
    const study = read('src/pages/Study.jsx');
    const store = read('desktop/local-entity-store.cjs');

    assert.match(home, /library\.createWeb\('Untitled Web'\)/);
    assert.match(home, /library\.createNote\(\)/);
    assert.match(home, /createTimegraph\(\{ title: '' \}\)/);
    assert.doesNotMatch(home, /new=1/);
    assert.match(study, /currentWorkspaceTab\?\.path\?\.split\('\?'\)\[1\]/);
    assert.doesNotMatch(study, /Select Chapter|stage === 'select'/);
    assert.match(home, /library\.createFolder\(name, folderRequest\?\.category \|\| 'web'\)/);
    assert.match(home, /buildBereanKnowledgeWebPayload/);
    assert.doesNotMatch(home, /buildStudyChapterMarkdown/);
    assert.match(home, /<CreatePrivateWebModal/);

    assert.match(store, /StudyChapter: Object\.freeze\(\{[^}]*containerField: 'folder_id'[^}]*table: 'local_study_chapters'/s);
    assert.match(store, /Timegraph: Object\.freeze\(\{[^}]*containerField: 'folder_id'[^}]*table: 'local_timegraphs'/s);
  });

  test('the library home uses the shared 3D tilt and one working page scroller', () => {
    const home = read('src/pages/LibraryHome.jsx');
    const tilt = read('src/components/shaders/Card3DTilt.jsx');

    assert.match(home, /import Card3DTilt from '@\/components\/shaders\/Card3DTilt'/);
    assert.match(home, /<Card3DTilt[\s\S]*appearance="transparent"[\s\S]*glowColor=\{config\.glow\}/);
    assert.match(home, /glowSize=\{220\}/);
    assert.match(home, /glowFalloff=\{56\}/);
    assert.doesNotMatch(home, /-right-12 -top-12 h-40 w-40/);
    assert.match(home, /<main className="[^"]*overflow-y-auto[^"]*overscroll-contain/);
    assert.doesNotMatch(home, /xl:overflow-hidden/);
    assert.match(tilt, /appearance = 'holographic'/);
    assert.match(tilt, /glowColor = 'rgb\(var\(--ink-muted\) \/ 0\.10\)'/);
    assert.match(tilt, /glowSize = 360/);
    assert.match(tilt, /glowFalloff = 68/);
    assert.match(tilt, /const hostRef = useRef\(null\)/);
    assert.match(tilt, /const rect = host\.getBoundingClientRect\(\)/);
    assert.match(tilt, /const glowOffset = glowSize \/ 2/);
    assert.match(tilt, /translate3d\(\$\{localX - glowOffset\}px, \$\{localY - glowOffset\}px, 0\)/);
    assert.match(tilt, /pointer-events-none absolute left-0 top-0/);
  });

  test('library rows stay minimal and folders begin collapsed', () => {
    const home = read('src/pages/LibraryHome.jsx');
    const libraryHook = read('src/components/knowledgeweb/useWebLibrary.js');
    const columnDnd = read('src/components/library/LibraryColumnDnd.jsx');
    const folderCategory = read('src/lib/libraryFolderCategory.js');

    assert.doesNotMatch(home, /const Icon = config\.icon/);
    assert.doesNotMatch(home, /: 'Open'/);
    assert.doesNotMatch(home, /aria-label="Export"/);
    assert.doesNotMatch(home, /aria-label="Move to folder"/);
    assert.doesNotMatch(home, /const moveItem = async/);
    assert.match(home, /const exportItem = async/);
    assert.match(home, /data-testid="library-item-context-menu"/);
    assert.match(home, /data-testid="library-inline-rename"/);
    assert.match(home, /data-testid="library-inline-rename-input"/);
    assert.doesNotMatch(home, /ItemRenameDialog/);
    assert.doesNotMatch(home, /library-rename-dialog/);
    assert.match(home, /inputRef\.current\?\.select\(\)/);
    assert.match(home, /if \(event\.key !== 'Escape'\) return/);
    assert.match(home, /data-testid=\{`library-sortable-\$\{props\.category\}-\$\{item\.id\}`\}/);

    // Reordering used to be the only thing a drag could do, because each list
    // owned its own DndContext and a folder was not part of the drag at all.
    // One context now spans the whole column, and it lives in its own module.
    assert.doesNotMatch(home, /DndContext/);
    assert.match(home, /data-testid=\{`library-dropzone-\$\{category\}-\$\{folder\.id\}`\}/);
    assert.match(home, /useLibraryFolderDropzone\(folder\.id\)/);
    assert.match(columnDnd, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 6 \} \}\)/);
    assert.match(columnDnd, /useDroppable\(\{ id: LIBRARY_ROOT_CONTAINER \}\)/);
    assert.match(columnDnd, /useDroppable\(\{ id: containerId \}\)/);
    assert.match(columnDnd, /onReorder\(plan\.scope, plan\.orderedIds\)/);
    assert.match(columnDnd, /onReorder\(plan\.fromScope, plan\.fromOrderedIds\);\s*\n\s*onReorder\(plan\.toScope, plan\.toOrderedIds\)/);
    assert.match(columnDnd, /onMoveItem\(category, plan\.item, plan\.folderId\)/);
    // Nearest-centre always answers, so a release out in the empty page below
    // the column would file the row into whichever folder was closest.
    assert.doesNotMatch(columnDnd, /closestCenter/);
    assert.match(home, /LIBRARY_ITEM_ORDER_KEY = 'bex\.library-home\.item-order\.v1'/);
    assert.match(home, /window\.localStorage\.setItem\(LIBRARY_ITEM_ORDER_KEY, JSON\.stringify\(next\)\)/);
    assert.match(home, /itemOrderScope\(category, folder\.id\)/);
    assert.match(home, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*data-testid="library-inline-rename"/);
    assert.match(home, /data-testid="library-mass-actions"/);
    assert.match(home, /data-testid="library-export-complete"/);
    assert.match(home, /data-testid=\{`library-select-\$\{category\}-\$\{item\.id\}`\}/);
    assert.match(home, /await import\('jszip'\)/);
    assert.match(home, /clearExportedSelections\(records\)/);
    assert.match(home, /successfulRecords\.push\(record\)/);
    assert.match(home, /clearExportedSelections\(successfulRecords\)/);
    assert.match(home, /announceExportComplete\(/);
    assert.match(home, /Delete \$\{records\.length\} selected items/);
    assert.match(home, /py-2 pl-3 pr-2 text-left/);
    assert.match(home, /const initializedFolderKeys = React\.useRef\(new Set\(\)\)/);
    assert.match(home, /if \(initializedFolderKeys\.current\.has\(key\)\) return;[\s\S]*next\.add\(key\)/);
    assert.match(home, /folders=\{libraryFoldersForCategory\(library\.folders, category\)\}/);
    assert.match(home, /item\.folder_id == null \|\| !folderIds\.has\(String\(item\.folder_id\)\)/);
    assert.match(libraryHook, /createFolder = useCallback\(async \(name, category = 'web'\)/);
    assert.match(libraryHook, /category: normalizeLibraryFolderCategory\(category\)/);
    assert.match(folderCategory, /return LIBRARY_FOLDER_CATEGORY_SET\.has\(normalized\) \? normalized : 'web'/);
    assert.match(folderCategory, /folders\.filter\(\(folder\) => libraryFolderCategory\(folder\) === normalizedCategory\)/);
  });

  test('right-click and selection actions use the real local records', () => {
    const home = read('src/pages/LibraryHome.jsx');
    const libraryHook = read('src/components/knowledgeweb/useWebLibrary.js');
    const timelines = read('src/pages/Timelines.jsx');

    assert.match(home, /onContextMenu=\{\(event\) => \{/);
    assert.match(home, /library\.renameWeb\(item\.id, name\)/);
    assert.match(home, /library\.renameNote\(item\.id, name\)/);
    assert.match(home, /renameTimegraph\(item\.id, name\)/);
    assert.doesNotMatch(home, /StudyChapter\.update\(item\.id, \{ title: name \}\)/);
    assert.match(home, /library\.deleteWeb\(item\.id\)/);
    assert.match(home, /library\.deleteNote\(item\.id\)/);
    assert.match(home, /deleteTimegraph\(item\.id\)/);
    assert.doesNotMatch(home, /StudyChapter\.delete\(item\.id\)/);
    assert.match(home, /tabs\.filter\(\(tab\) => tabMatchesLibraryItem/);
    assert.match(libraryHook, /throw new Error\('Unlock this private Knowledge Web before renaming it\.'\)/);
    assert.doesNotMatch(timelines, /data-testid="timelines-library"/);
  });

  test('duplicate tabs are created only through the two intentional tab actions', () => {
    const tabs = read('src/lib/WorkspaceTabs.jsx');
    const bar = read('src/components/tabs/TabBar.jsx');
    const home = read('src/pages/LibraryHome.jsx');

    // A duplicate keeps the workspace target but receives a fresh ID and sits
    // beside its source rather than replacing or redirecting to it.
    assert.match(tabs, /const duplicateTab = React\.useCallback/);
    assert.match(tabs, /const \{ id: sourceId, \.\.\.sourceWithoutId \} = source/);
    assert.match(tabs, /const duplicate = makeTab\(source\.kind, sourceWithoutId\)/);
    assert.match(tabs, /tabs\.splice\(index \+ 1, 0, duplicate\)/);
    assert.match(tabs, /activeId: duplicate\.id/);

    // Right-clicking a tab exposes the explicit Duplicate command.
    assert.match(bar, /onContextMenu=\{\(event\) => openTabContextMenu\(event, tab\)\}/);
    assert.match(bar, /data-testid="workspace-tab-context-menu"/);
    assert.match(bar, /data-testid="workspace-tab-duplicate"/);
    assert.match(bar, /duplicateTab\(tabId\)/);

    // Choosing an item from New tab is the other explicit duplicate path.
    assert.match(home, /\{ allowDuplicate = false \} = \{\}/);
    assert.match(home, /if \(!allowDuplicate\)/);
    assert.equal((home.match(/\{ allowDuplicate: true \}/g) || []).length, 4);
  });

  test('the old library sidebar is disconnected while import and export remain available', () => {
    const knowledgeWeb = read('src/pages/KnowledgeWeb.jsx');
    const mindView = read('src/pages/MindView.jsx');

    assert.doesNotMatch(knowledgeWeb, /<WebListSidebar/);
    assert.doesNotMatch(mindView, /<WebListSidebar/);
    assert.doesNotMatch(mindView, /button-toggle-sidebar/);
    assert.equal(fs.existsSync(path.join(root, 'src/components/knowledgeweb/WebListSidebar.jsx')), false);
    assert.match(knowledgeWeb, /data-testid="button-import-export"/);
    assert.match(knowledgeWeb, /handleMassImport=\{handleMassImport\}/);
  });

  test('Courses, Stats, and AI Second Brain are full tab options', () => {
    const tabs = read('src/lib/WorkspaceTabs.jsx');
    const bar = read('src/components/tabs/TabBar.jsx');
    const pages = read('src/pages.config.js');

    assert.match(tabs, /COURSES: 'courses'/);
    assert.match(tabs, /STATS: 'stats'/);
    assert.match(tabs, /AI_SECOND_BRAIN: 'ai-second-brain'/);
    assert.match(tabs, /label: 'Courses'/);
    assert.match(tabs, /path: createPageUrl\('Courses'\)/);
    assert.match(tabs, /label: 'Stats'/);
    assert.match(tabs, /path: createPageUrl\('Stats'\)/);
    assert.match(tabs, /label: 'AI Second Brain'/);
    assert.match(tabs, /path: createPageUrl\('BrainChat'\)/);
    assert.match(bar, /\[TAB_KINDS\.COURSES\]: GraduationCap/);
    assert.match(bar, /\[TAB_KINDS\.STATS\]: BarChart3/);
    assert.match(bar, /\[TAB_KINDS\.AI_SECOND_BRAIN\]: Brain/);
    assert.match(pages, /const Courses = deferredPage\(\(\) => import\('\.\/pages\/Courses'\)\)/);
    assert.match(pages, /"Courses": Courses/);
    assert.match(pages, /const Stats = deferredPage\(\(\) => import\('\.\/pages\/Stats'\)\)/);
    assert.match(pages, /"Stats": Stats/);
  });

  test('utility pages return the current workspace tab to the New tab library', () => {
    const backButton = read('src/components/navigation/BackToLibraryHomeButton.jsx');
    const courses = read('src/pages/Courses.jsx');
    const stats = read('src/pages/Stats.jsx');
    const brain = read('src/pages/BrainChat.jsx');
    const keywords = read('src/pages/Keywords.jsx');

    assert.match(backButton, /updateTab\(currentTab\.id, \{[\s\S]*kind: TAB_KINDS\.HOME,[\s\S]*path: NEW_TAB_PATH,[\s\S]*title: 'New tab'/);
    assert.match(courses, /<BackToLibraryHomeButton/);
    assert.match(stats, /<BackToLibraryHomeButton/);
    assert.match(brain, /<BackToLibraryHomeButton/);
    assert.doesNotMatch(brain, /navigate\(-1\)/);
    assert.match(keywords, /<BackToLibraryHomeButton[\s\S]*onClick=\{handleReturnToLibrary\}/);
    assert.doesNotMatch(keywords, /Keywords Library/);
    assert.doesNotMatch(keywords, /<Breadcrumbs/);
    assert.doesNotMatch(keywords, /toggleTheme/);
  });

  test('Bible Study stats live in their own clean workspace', () => {
    const stats = read('src/pages/Stats.jsx');
    const study = read('src/pages/Study.jsx');
    const dashboard = read('src/components/progress/ProgressDashboard.jsx');

    assert.match(stats, /<ProgressDashboard/);
    assert.doesNotMatch(study, /ProgressDashboard/);
    assert.doesNotMatch(dashboard, /Start Bible Study/);
    assert.doesNotMatch(dashboard, /Create New Keyword/);
    assert.doesNotMatch(dashboard, /useNavigate/);
    assert.doesNotMatch(dashboard, /<Button/);
  });

  test('the obsolete floating launcher is completely disconnected and removed', () => {
    const layout = read('src/Layout.jsx');
    assert.doesNotMatch(layout, /GlobalNav/);
    assert.equal(fs.existsSync(path.join(root, 'src/components/navigation/GlobalNav.jsx')), false);
    assert.equal(fs.existsSync(path.join(root, 'src/components/navigation/RadialMenuCluster.jsx')), false);
  });
});
