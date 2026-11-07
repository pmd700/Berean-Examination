import React from 'react';
import __Layout from './Layout.jsx';

// This registry is maintained alongside the tab router. Importing the app shell
// must not initialize every feature: course/video and all other routes remain
// registered, but their modules load when a pane first opens that route.
// Stable lazy components keep each loaded pane mounted across tab switches.
const deferredPage = load => React.lazy(load);

const AssetLibrary = deferredPage(() => import('./pages/AssetLibrary'));
const BrainChat = deferredPage(() => import('./pages/BrainChat'));
const BrainInbox = deferredPage(() => import('./pages/BrainInbox'));
const BrainSearch = deferredPage(() => import('./pages/BrainSearch'));
const ChapterArt = deferredPage(() => import('./pages/ChapterArt'));
const ContactFeedback = deferredPage(() => import('./pages/ContactFeedback'));
const Courses = deferredPage(() => import('./pages/Courses'));
const Keywords = deferredPage(() => import('./pages/Keywords'));
const KnowledgeWeb = deferredPage(() => import('./pages/KnowledgeWeb'));
const LibraryHome = deferredPage(() => import('./pages/LibraryHome'));
const MindView = deferredPage(() => import('./pages/MindView'));
const SourcesLicenses = deferredPage(() => import('./pages/SourcesLicenses'));
const Stats = deferredPage(() => import('./pages/Stats'));
const Study = deferredPage(() => import('./pages/Study'));
const Timelines = deferredPage(() => import('./pages/Timelines'));
const Spreadsheets = deferredPage(() => import('./pages/Spreadsheets'));



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
