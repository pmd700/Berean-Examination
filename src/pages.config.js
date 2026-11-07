/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AssetLibrary from './pages/AssetLibrary';
import BrainChat from './pages/BrainChat';
import BrainInbox from './pages/BrainInbox';
import BrainSearch from './pages/BrainSearch';
import ChapterArt from './pages/ChapterArt';
import ContactFeedback from './pages/ContactFeedback';
import Courses from './pages/Courses';
import Keywords from './pages/Keywords';
import KnowledgeWeb from './pages/KnowledgeWeb';
import LibraryHome from './pages/LibraryHome';
import MindView from './pages/MindView';
import SourcesLicenses from './pages/SourcesLicenses';
import Stats from './pages/Stats';
import Study from './pages/Study';
import Timelines from './pages/Timelines';
import Spreadsheets from './pages/Spreadsheets';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AssetLibrary": AssetLibrary,
    "BrainChat": BrainChat,
    "BrainInbox": BrainInbox,
    "BrainSearch": BrainSearch,
    "ChapterArt": ChapterArt,
    "ContactFeedback": ContactFeedback,
    "Courses": Courses,
    "Keywords": Keywords,
    "KnowledgeWeb": KnowledgeWeb,
    "LibraryHome": LibraryHome,
    "MindView": MindView,
    "SourcesLicenses": SourcesLicenses,
    "Stats": Stats,
    "Study": Study,
    "Timelines": Timelines,
    "Spreadsheets": Spreadsheets,
}

export const pagesConfig = {
    mainPage: "LibraryHome",
    Pages: PAGES,
    Layout: __Layout,
};
