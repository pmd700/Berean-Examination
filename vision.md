# Berean Examination — Product Vision

## Purpose

Berean Examination will become a private, downloadable desktop application for serious Bible study, visual knowledge development, personal research, and large video courses.

The application will be owned and controlled by David. It will not depend on Replit or an external database company to store user data or course content. David will be able to distribute it directly as a macOS `.dmg` and, eventually, a Windows `.exe`.

The central motivation for this migration is ownership and predictable cost. Video courses may be roughly 20 GB total, so the product must store large media libraries locally without cloud database or storage fees.

## Product Priorities

Dev priorities, in order, are:

1. Knowledge Web
2. Video Courses
3. Second Brain
4. Bible Study
5. Downloadable macOS and Windows releases

Every architectural decision should protect these priorities. Features that distract from them should not be preserved merely because they exist in the current web application.

## Non-Negotiable Principles

### Local-first and independently owned

- Every installation has its own independent local database.
- There will be no Neon, Replit database, Supabase database, or other hosted database dependency.
- The finished application must remain usable when the Internet is unavailable.
- User data, course progress, Knowledge Webs, Second Brain material, Bible Study information, settings, and media references remain on the user's computer.
- Large videos are stored as local files rather than as database blobs or cloud objects.
- No subscription infrastructure should be required to keep the application functioning.
- A future optional **Online Mode** may enable approved external APIs, but it is disabled by default and the local application must remain fully usable without it.
- Turning Online Mode off must prevent optional external integrations from running; activation, local storage, courses, and core study workflows never depend on it.

### Cross-platform distribution

- macOS is the first release target.
- Windows support follows after the macOS version is stable.
- The product will ultimately be distributed as ordinary installable software: `.dmg` for macOS and `.exe` for Windows.
- Every delivered copy unlocks the full application. Licensing will not be used to create course tiers, feature tiers, or separate entitlements.

### Private by design

- The local database, private user material, backups, and protected course media should be encrypted at rest.
- Course videos should not be left as casually copyable, unprotected files when encryption is practical.
- Private Knowledge Web content must remain private.
- A local password or PIN is optional for the user. Activation and local privacy are separate concepts.
- No secret capable of generating valid product licenses may be embedded in the distributed application or committed to the shared project repository.

## Local Data Model

The target application uses an embedded local database, with SQLite as the current preferred direction. The user does not install or administer a separate database server.

On first launch, the user chooses a Berean Library folder. The application owns and organizes its local material inside that location. The intended conceptual structure is:

```text
Berean Library/
├── Database/
├── Courses/
├── Media/
├── Imports/
├── Exports/
└── Backups/
```

The precise internal names may change during implementation, but the user-facing behavior must remain simple: choose a location once and let the application manage it.

### Persistence and autosave

- Work is saved locally after every meaningful change.
- The application also performs a safe save/backup operation when it closes normally.
- Large unchanged video files must not be duplicated on every edit or close.
- The user can designate the folder used for automatic exports and backups, similar to choosing an output folder in OBS Studio.
- A `.berean` file is the supported import format for bringing existing user material into the new desktop application.
- Existing cloud-era accounts, access keys, and live cloud data do not need to be migrated as a system. David already has the material he intends to preserve and will import it through the application's import function.

## Course Content

Video Courses are a core product area, not a secondary attachment.

- The architecture must comfortably support courses of approximately 20 GB each.
- Videos live in the local library, not inside a hosted database.
- Course metadata, lesson order, progress, notes, and relationships to the Knowledge Web or Second Brain live in the local database.
- Persistent course content shipped to users must work without an Internet connection.
- Course media should be encrypted when practical so it is not casually reusable outside an activated copy of Berean Examination.
- Packaging and delivery details for individual course releases remain an implementation decision; they must not compromise local ownership or force cloud storage.

## Product Activation

The current in-app invitation/access-key system will be removed. It is not the future licensing system.

Berean Examination will instead use a completely separate offline, machine-bound activation mechanism.

### Intended activation experience

1. A recipient installs Berean Examination.
2. The application displays a machine-specific request code.
3. The recipient sends that request code to David.
4. David uses a private license-generator tool to create a signed activation code.
5. David sends the activation code to the recipient.
6. The recipient enters it and the full application unlocks.

The activation code is valid only for the intended computer. No external licensing database or activation server is required.

### Replacement activations

- David can issue a replacement activation when a user replaces or repairs a computer.
- Replacement issuance remains under David's control.
- The license-generator's private signing key must remain on David's Mac in protected system storage, such as macOS Keychain, and must never be distributed with the app.
- The application contains only the public verification key needed to confirm that an activation was genuinely issued by David.

This licensing system is intended to stop ordinary unauthorized duplication without creating a cloud dependency. It is a practical protection mechanism, not a claim that determined reverse engineering or screen recording can be made impossible.

## Features to Remove

The following systems should be removed rather than migrated:

- Social features
- Friends and friend requests
- Direct and group messaging
- Video and audio calling
- Typing indicators and social notifications
- User reports and blocking
- Auth0 authentication
- Replit authentication
- The current invitation/access-key system
- Automatic or required external API calls while Online Mode is off
- Provider secrets embedded in the app or exposed to its interface
- Replit-specific runtime assumptions and deployment configuration
- Dormant Base44 cloud functions and no-op compatibility features that do not serve the product priorities

Removal should be complete: routes, interfaces, database structures, dependencies, configuration, and dead compatibility code should not remain indefinitely once the desktop replacement is verified.

## Second Brain Local Core and Dormant AI Spine

The Second Brain remains a priority. Its manual local system must work independently while the existing AI Spine stays dormant for possible future Online Mode use.

- Sources, cards, connections, search, organization, retrieval, and manual workflows remain valuable without an AI provider.
- OpenAI-dependent processing and conversational generation are disabled for the initial desktop product, not required for any core workflow, and must not run while Online Mode is off.
- Preserve the AI Spine as dormant source code rather than deleting it during the offline migration.
- A future user-controlled Online Mode may expose approved external API features. It must start off, clearly disclose when information will leave the computer, and fail without interrupting local work.
- External-provider credentials must use a protected desktop boundary or another approved secure method; they must never be committed to the repository or exposed directly to the React interface.
- The architecture should also remain open to a future local-AI feature, but no local model is required for the first offline release.
- MCP support may remain only if it has a clear local use and introduces no cloud dependency.

## Development and AI Collaboration

The project must be model-agnostic and locally owned.

- Codex and Fable 5 work from the same Agnostic Project Files folder on David's Mac.
- Neither development model should need access to unrelated areas of David's computer.
- All non-secret source code, project documentation, design decisions, schemas, assets needed for development, and handoff notes belong inside the project folder.
- Secrets and private signing keys are the exception: they must stay in protected system storage and never be committed to the repository.
- Git is the shared history and safety mechanism.
- Parallel work should use separate branches or worktrees so the two models do not overwrite each other's changes.
- Project documentation should use neutral names and instructions rather than depending on one AI vendor's private memory format.

## Preliminary Technical Direction

This section records the current safest direction, not an irreversible commitment.

- Desktop shell: Electron, because the current application already uses React, Node.js, Express, and JavaScript/TypeScript.
- User interface: preserve and adapt the existing React application.
- Database: embedded SQLite, with encryption appropriate for private local data.
- File storage: user-designated local Berean Library folder.
- Authentication: no Auth0; activation unlocks the installed product, with an optional local password/PIN for privacy.
- Licensing: offline machine request plus David-signed activation response.
- AI: the existing AI Spine is retained but dormant; future approved external integrations are available only through an explicit, off-by-default Online Mode.
- Media: encrypted local course files where practical; never hosted in an external database.
- Import: `.berean` files.
- Backups: automatic local persistence after meaningful changes plus safe backup behavior when the app closes.

## Definition of Success

The migration succeeds when:

- Berean Examination installs and launches as a normal macOS desktop application.
- A Windows installer can be produced from the same maintained codebase afterward.
- The application starts and its core features work with Wi-Fi disabled.
- No external database account is needed.
- No Auth0, Replit, Base44, OpenAI, or social-service account is needed for activation or any core offline workflow.
- Online Mode is off by default, and disabling it leaves the core product functional without external API traffic.
- Every installation owns an independent encrypted local database and local media library.
- A user can import a `.berean` backup.
- Knowledge Web, Video Courses, Second Brain, and Bible Study operate locally.
- Work autosaves reliably and is backed up to the user's designated location.
- A machine-bound activation issued by David unlocks the full application.
- A replacement activation can be issued without relying on a cloud licensing service.
- Course libraries around 20 GB per course do not generate recurring storage bills.
- Codex and Fable 5 can safely continue development from the same self-contained project repository.

## Scope Discipline

The first objective is not to redesign every screen or add every planned course feature. The first objective is to establish a trustworthy local foundation:

1. Preserve the valuable existing interface and core domain behavior.
2. Remove cloud identity, cloud database, required cloud AI, and social dependencies while preserving the dormant AI Spine behind the future Online Mode boundary.
3. Establish local encrypted storage and reliable `.berean` import.
4. Establish offline activation.
5. Package and verify the macOS application.
6. Build Video Courses on that stable local foundation.
7. Add Windows packaging after the macOS path is proven.

Future work must be evaluated against this document. If a proposal introduces required cloud storage, a hosted database, subscription infrastructure, unnecessary user accounts, or distractions from the product priorities, it conflicts with the product vision unless David explicitly revises this document.
