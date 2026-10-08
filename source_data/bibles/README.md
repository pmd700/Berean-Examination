# Local Bible source library

Run `npm run bibles:import` from the project root after replacing or adding an approved source file. The importer writes deterministic, chapter-indexed app assets to `attached_assets/bibles`, records SHA-256 checksums, and stops if a complete edition does not contain the expected chapters and verses.

The current sources were downloaded from Bible Hub's official downloads page and its linked official text sites. Do not replace a source with scraped webpage text.

- General downloads: https://biblehub.com/downloads.htm
- Berean Bible terms: https://berean.bible/terms.htm
- World English Bible status and trademark guidance: https://worldenglish.bible/
- Public-domain source catalog: https://ebible.org/Scriptures/copyright.php

`JPS` is the source file's combined JPS Tanakh 1917 Old Testament and Weymouth New Testament, not a JPS New Testament. `BGB` and `BIB` are New Testament-only Word sources. Their embedded full-text software/app licensing notice and attribution must remain represented on BEX's Sources & Licenses page.
