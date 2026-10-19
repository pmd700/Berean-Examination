import { SBLGNT_DOCUMENTS } from './sblgntDocs';
import { KATEX_DOCUMENTS } from './katexDocs';
import { RAJDHANI_DOCUMENTS } from './rajdhaniDocs';
import emojiLicense from '@/styles/fonts/OFL.txt?raw';
import { getRemovedTranslationMessage, isTranslationRemovedFromPlan } from '@shared/removedTranslations';

export const SOURCE_LICENSE_SECTIONS = [
  {
    title: 'Bible Text Sources',
    description: 'Texts bundled with BEX, future Online Mode sources, and translations removed from distribution.',
    items: [
      {
        name: 'SBL Greek New Testament (SBLGNT)',
        license: 'CC BY 4.0',
        usage: 'Used as the verse-level Greek source layer for Interlinear Mode.',
        attribution: 'SBL Greek New Testament, edited by Michael W. Holmes. Copyright © 2010 Logos Bible Software and the Society of Biblical Literature. Licensed under Creative Commons Attribution 4.0 International. BEX changed formatting only for verse-level querying and display; no endorsement is implied.',
        sourceUrl: 'https://sblgnt.com/',
        licenseUrl: 'https://www.sblgnt.com/license/',
        documents: SBLGNT_DOCUMENTS
      },
      {
        name: 'Unicode/XML Leningrad Codex (UXLC)',
        license: 'Biblical Hebrew text — unrestricted copying',
        usage: 'Used as the verse-level Hebrew source layer for Old Testament interlinear display.',
        attribution: 'Unicode/XML Leningrad Codex (UXLC 2.4), Build 27.5, dated October 13, 2025; source: Tanach.us Inc. Tanach.us permits its biblical Hebrew text, in any format, to be viewed or copied without restriction. BEX normalized formatting and markup for querying and display.',
        sourceUrl: 'https://tanach.us/Tanach.xml',
        licenseUrl: 'https://tanach.us/License.html'
      },
      {
        name: 'Miqra According to the Masorah (MAM)',
        license: 'CC BY-SA 4.0',
        usage: 'Bundled as the local Hebrew source for Old Testament Interlinear Mode.',
        attribution: 'Miqra According to the Masorah (MAM), sourced from Hebrew Wikisource and distributed under Creative Commons Attribution-ShareAlike 4.0 International. BEX reads the bundled parsed JSON and changes display formatting only.',
        sourceUrl: 'https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
      },
      {
        name: 'English Standard Version (ESV)',
        license: 'Not licensed — disabled',
        usage: 'Future Online Mode only, and only after written commercial permission. No ESV text is bundled.',
        attribution: 'The ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. ESV Text Edition: 2025. All rights reserved. Crossway informed David that complete local ESV storage requires an eligible formal organization or ministry; BEX is an individual-owned product and will not store or distribute the complete ESV.',
        exportStatus: 'blocked',
        exportPolicy: 'Blocked for BEX’s current ownership structure. Do not enable local storage, built-in copying, ESV-linked exports, or commercial API access unless Crossway later issues written permission expressly covering that use.',
        sourceUrl: 'https://api.esv.org/',
        licenseUrl: 'https://www.crossway.org/permissions/'
      },
      {
        name: 'Berean Standard Bible (BSB)',
        code: 'BSB',
        license: 'Public domain',
        usage: 'Bundled locally. May be read and exported for personal or commercial use.',
        attribution: 'The Berean Bible and Majority Bible texts were officially dedicated to the public domain on April 30, 2023. All uses are freely permitted. Credit to the Berean Bible Translation Committee and its partners is appreciated but not required.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. The complete text and BSB-linked study material may be shared for free or commercially. BEX includes credit even though the public-domain dedication does not require it.',
        sourceUrl: 'https://berean.bible/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: 'American King James Version (AKJV)',
        code: 'AKJV',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'American King James Version, produced by Michael Peter (Stone) Engelbrite and placed into the public domain on November 8, 1999. Copying, modification, and commercial use are permitted; do not falsely claim original authorship.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Preserve this source credit so users can identify the edition accurately.',
        sourceUrl: 'https://biblehub.com/akjv/genesis/1.htm',
        licenseUrl: 'https://www.stepbible.org/version.jsp?version=AKJV'
      },
      {
        name: 'American Standard Version (ASV)',
        code: 'ASV',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'American Standard Version (1901). Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'Berean Annotated Bible (BAB)',
        code: 'BAB',
        license: 'Public domain',
        usage: 'Bundled locally. This source identifies itself as an early draft that may be updated.',
        attribution: 'Berean Annotated Bible, produced with Bible Hub, Discovery Bible, unfoldingWord, Bible Aquifer, OpenBible.com, and the Berean Bible Translation Committee. The Berean Bible texts were dedicated to the public domain on April 30, 2023. BEX preserves the edition name and draft status.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. If the wording is changed, do not present the result as the official Berean Annotated Bible.',
        sourceUrl: 'https://annotatedbible.com/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: 'Berean Greek Bible (BGB)',
        code: 'BGB',
        license: 'Berean text dedicated to the public domain; source grants full-text app use',
        usage: 'Bundled locally as a New Testament-only Greek edition.',
        attribution: 'The Holy Bible, Berean Greek Bible (BGB), © 2016 by Bible Hub. The supplied source states that free licensing is available for use of the full text in software, apps, and websites. The Berean Bible texts were later dedicated to the public domain on April 30, 2023. BEX preserves the source attribution and changes formatting only.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed with the edition credit. If the text is revised, do not use the Berean name for the derivative edition.',
        sourceUrl: 'https://greekbible.org/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: 'Berean Interlinear Bible (BIB)',
        code: 'BIB',
        license: 'Berean text dedicated to the public domain; source grants full-text app use',
        usage: 'Bundled locally as a New Testament-only Greek/English interlinear edition.',
        attribution: 'The Holy Bible, Berean Interlinear Bible (BIB), © 2016 by Bible Hub. The supplied source states that free licensing is available for use of the full text in software, apps, and websites. The Berean Bible texts were later dedicated to the public domain on April 30, 2023. BEX preserves the source attribution and changes formatting only.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed with the edition credit. If the text or interlinear data is revised, do not use the Berean name for the derivative edition.',
        sourceUrl: 'https://interlinearbible.com/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: 'Berean Literal Bible (BLB)',
        code: 'BLB',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Berean Literal Bible, produced with Bible Hub and the Berean Bible Translation Committee. The Berean Bible texts were dedicated to the public domain on April 30, 2023. Attribution is appreciated but not required.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. If the wording is changed, do not present the result as the official Berean Literal Bible.',
        sourceUrl: 'https://literalbible.com/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: "Berean Reader's Bible (BRB)",
        code: 'BRB',
        license: 'Public domain under the current Berean Bible terms',
        usage: 'Bundled locally with its reader-edition section headings.',
        attribution: 'Berean Reader’s Bible, originally published by Bible Hub with a 2020 copyright and free software/app licensing notice. The current Berean Bible terms dedicate the Berean Bible texts to the public domain. BEX preserves the edition identity and section headings.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. If the wording is changed, do not present the result as the official Berean Reader’s Bible.',
        sourceUrl: 'https://readersbible.com/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: 'Catholic Public Domain Version (CPDV)',
        code: 'CPDV',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Catholic Public Domain Version, translated by Ronald L. Conte Jr. The translator placed the translation into the public domain in perpetuity, without legal restriction.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name and translator credit with exported Scripture.',
        sourceUrl: 'https://biblehub.com/cpdv/genesis/1.htm',
        licenseUrl: 'https://www.stepbible.org/version.jsp?version=CPDV'
      },
      {
        name: 'Darby Bible Translation (DBT)',
        code: 'DBT',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Darby Bible Translation, by John Nelson Darby. Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'Douay-Rheims Bible (DRB)',
        code: 'DRB',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Douay-Rheims Bible, historic English Catholic translation. Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'English Revised Version (ERV)',
        code: 'ERV',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'English Revised Version (1885). Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'JPS Tanakh 1917 / Weymouth New Testament',
        code: 'JPS',
        license: 'Public domain',
        usage: 'Bundled locally as the supplied combined edition: JPS 1917 Old Testament and Weymouth New Testament.',
        attribution: 'Old Testament: The Holy Scriptures According to the Masoretic Text, Jewish Publication Society, 1917. New Testament: Weymouth New Testament. Both component texts are public domain. BEX labels the combined source explicitly so it is not mistaken for a JPS New Testament.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep both component edition names with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'Majority Standard Bible (MSB)',
        code: 'MSB',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Majority Standard Bible, produced with Bible Hub and the Berean Bible Translation Committee. The Berean Bible and Majority Bible texts were dedicated to the public domain on April 30, 2023.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. If the wording is changed, do not present the result as the official Majority Standard Bible.',
        sourceUrl: 'https://majoritybible.com/',
        licenseUrl: 'https://berean.bible/terms.htm'
      },
      {
        name: "Smith's Literal Translation (SLT)",
        code: 'SLT',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Smith’s Literal Translation, by Julia E. Smith (1876). Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: "Webster's Bible Translation (WBT)",
        code: 'WBT',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Webster’s Bible Translation, by Noah Webster (1833). Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'World English Bible (WEB)',
        code: 'WEB',
        license: 'Public domain text; translation name is a trademark',
        usage: 'Bundled locally as an unmodified text edition for fully offline reading and study.',
        attribution: 'World English Bible Scripture text is public domain. “World English Bible” is a trademark used to identify faithful copies. BEX changes storage and display formatting only, not the Scripture wording.',
        exportStatus: 'conditional',
        exportPolicy: 'Export allowed. If the Scripture wording is changed, do not identify the derivative text as the World English Bible.',
        sourceUrl: 'https://worldenglish.bible/',
        licenseUrl: 'https://ebible.org/engwebp/copyright.htm'
      },
      {
        name: "Young's Literal Translation (YLT)",
        code: 'YLT',
        license: 'Public domain',
        usage: 'Bundled locally for fully offline reading and study.',
        attribution: 'Young’s Literal Translation, by Robert Young. Public domain. BEX obtained its plain-text edition through Bible Hub’s official downloads page.',
        exportStatus: 'allowed',
        exportPolicy: 'Export allowed. Keep the translation name with exported Scripture.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://ebible.org/Scriptures/copyright.php'
      },
      {
        name: 'New Living Translation (NLT)',
        code: 'NLT',
        license: isTranslationRemovedFromPlan('NLT') ? getRemovedTranslationMessage('NLT') : 'API.Bible access',
        usage: isTranslationRemovedFromPlan('NLT') ? getRemovedTranslationMessage('NLT') : 'Available on demand through the configured API.Bible edition.',
        attribution: 'The Holy Bible, New Living Translation is copyrighted © 1996, 2004, 2015 by Tyndale House Foundation. BEX does not bundle NLT text.',
        sourceUrl: 'https://www.tyndale.com/',
        licenseUrl: 'https://www.tyndale.com/permissions',
        legallyRemoved: isTranslationRemovedFromPlan('NLT')
      },
      {
        name: 'Literal Standard Version (LSV)',
        code: 'LSV',
        license: 'CC BY-SA 4.0',
        usage: 'May be read and exported when its attribution and license travel with it.',
        attribution: 'Literal Standard Version (LSV), © 2020 Covenant Press and the Covenant Christian Coalition. Licensed under Creative Commons Attribution-ShareAlike 4.0 International. BEX preserves the English wording and changes only parsing and display formatting. Covenant Press and the Covenant Christian Coalition do not endorse BEX.',
        exportStatus: 'conditional',
        exportPolicy: 'Export allowed with conditions. Keep the full LSV credit, source link, and CC BY-SA 4.0 link. Identify changes; license adaptations under the same or a compatible license; and do not apply DRM, legal terms, or technological restrictions to the LSV Scripture portion. BEX must keep its shipped LSV source copy accessible without the private-library key. Separate user notes remain the user’s work when kept distinct from Scripture.',
        sourceUrl: 'https://www.lsvbible.com/p/get-lsv.html',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
      },
      {
        name: 'King James Version (KJV)',
        code: 'KJV',
        license: 'Public domain in the U.S.',
        usage: 'Bundled locally for offline reading. United Kingdom rights differ.',
        attribution: 'The King James Version is public domain in the United States and most countries. In the United Kingdom, rights in the Authorized Version are vested in the Crown and administered by Cambridge University Press.',
        exportStatus: 'regional',
        exportPolicy: 'Export allowed for the United States release. Do not describe the KJV as unrestricted worldwide: electronic reproduction or distribution in the United Kingdom requires a separate Cambridge rights policy or permission.',
        sourceUrl: 'https://biblehub.com/downloads.htm',
        licenseUrl: 'https://www.gov.uk/government/publications/copyright-notice-duration-of-copyright-term/copyright-notice-duration-of-copyright-term'
      },
      {
        name: 'Nueva Biblia de las Américas (NBLA)',
        code: 'NBLA',
        license: 'API.Bible access',
        usage: 'Spanish Scripture retrieved on demand through the configured API.Bible edition. Publisher notes and attribution are preserved.',
        attribution: 'The API response supplies the edition-specific copyright notice from The Lockman Foundation, displayed below the Scripture text.',
        sourceUrl: 'https://www.nuevabiblia.com/',
        licenseUrl: 'https://api.bible/terms-and-conditions',
      },
      {
        name: 'New American Standard Bible 1995 (NASB 1995)',
        license: 'API.Bible access',
        usage: 'Available through API.Bible when the configured key has access to the NASB 1995 edition. Scripture is fetched on demand; personal annotations remain local.',
        attribution: 'New American Standard Bible® 1995. Copyright © 1960, 1962, 1963, 1968, 1971, 1972, 1973, 1975, 1977, 1995 by The Lockman Foundation. All rights reserved. The reader displays the copyright supplied by API.Bible.',
        sourceUrl: 'https://www.lockman.org/',
        licenseUrl: 'https://api.bible/terms-and-conditions',
      },
      {
        name: 'New American Standard Bible 2020 (NASB 2020)',
        license: 'API.Bible access',
        usage: 'Available as NASB through the configured API.Bible edition. The retired downloaded source is not selectable.',
        attribution: 'NASB® 2020 is copyrighted © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. The reader displays the copyright supplied by API.Bible.',
        sourceUrl: 'https://www.lockman.org/nasb-2020/',
        licenseUrl: 'https://api.bible/terms-and-conditions',
      }
    ]
  },
  {
    title: 'Software & Contributors',
    description: 'Open-source software included in BEX and the notices that accompany it.',
    items: [
      {
        name: 'Noto Color Emoji',
        license: 'SIL OFL 1.1',
        usage: 'Bundled locally to render emoji in text, editors, and canvas labels offline.',
        attribution: 'Noto Color Emoji by Google and contributors. BEX distributes the unmodified COLRv1 font under the SIL Open Font License, Version 1.1.',
        sourceUrl: 'https://github.com/googlefonts/noto-emoji',
        licenseUrl: 'https://openfontlicense.org/open-font-license-official-text/',
        documents: [{ label: 'Read the full Noto Color Emoji license', title: 'SIL Open Font License 1.1', format: 'text', content: emojiLicense }]
      },
      {
        name: 'KaTeX 0.18.1',
        license: 'MIT',
        usage: 'Bundled locally to typeset logic and mathematical expressions without Internet access.',
        attribution: 'KaTeX software copyright © 2013–2020 Khan Academy and other contributors. KaTeX font files copyright © 2018 Khan Academy. Both are distributed under the MIT License. BEX includes their full notices below.',
        sourceUrl: 'https://github.com/KaTeX/KaTeX/tree/v0.18.1',
        licenseUrl: 'https://github.com/KaTeX/KaTeX/blob/v0.18.1/LICENSE',
        documents: KATEX_DOCUMENTS
      },
      {
        name: 'Rajdhani',
        license: 'SIL OFL 1.1',
        usage: 'Bundled locally as a licensed legacy option. BEX now uses one centrally configured system-serif interface stack.',
        attribution: 'Rajdhani copyright © 2014 Indian Type Foundry (info@indiantypefoundry.com). Distributed under the SIL Open Font License, Version 1.1. BEX ships the unmodified font files locally and includes the complete license below.',
        sourceUrl: 'https://github.com/google/fonts/tree/main/ofl/rajdhani',
        licenseUrl: 'https://openfontlicense.org/open-font-license-official-text/',
        documents: RAJDHANI_DOCUMENTS
      }
    ]
  }
];
