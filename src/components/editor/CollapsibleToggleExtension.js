import { InputRule, findParentNode } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Details } from '@tiptap/extension-details';
import { DetailsSummary } from '@tiptap/extension-details-summary';
import { DetailsContent } from '@tiptap/extension-details-content';
import { findInEditorKey, isFindRevealed } from './findInEditor';
import { textOnlyToggleContext } from './toggleClipboard';

// Reusable Notion-style collapsible "toggle" block for the TipTap editor.
//
// Why this exists (the official @tiptap/extension-details trio was not enough):
//   1. The stock NodeView injects an unstyled <button> and toggles an
//      `.is-open` CLASS — it never sets the native [open] attribute, so any
//      CSS keyed on [open] (chevron rotation, etc.) silently never fires.
//   2. The stock DetailsContent NodeView shows/hides via the `hidden`
//      attribute (display:none), which can't be animated.
//   3. There is no input rule, so "> " produced a blockquote, not a toggle.
//   4. The injected button had no aria-expanded / label / keyboard wiring.
//
// This module fixes all four: a custom chevron button (aria-expanded,
// aria-controls, keyboard focus + Enter/Space), a smooth JS height/opacity
// animation on the body, and a high-priority "> " input rule that beats the
// StarterKit blockquote rule. Open state is persisted via the `open` attribute
// so it survives save/reload and read-only (native <details>) rendering.

const ANIM_MS = 220;

let bodyIdSeq = 0;

function chevronSvg() {
  // A solid disclosure triangle, not a thin V: ▶ closed, and CSS rotates it 90°
  // to ▼ when open. Filled rather than stroked so it reads as one shape at 11px,
  // where a 2.5px stroke turns into two grey smudges.
  return (
    '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">' +
    '<path d="M3.5 1.4 L9.6 6 L3.5 10.6 Z" fill="currentColor" /></svg>'
  );
}

/**
 * Whether a toggle actually holds anything.
 *
 * Drives the triangle's colour: dim while the toggle is empty, bright once there
 * is something inside, so you can tell at a glance which toggles are worth
 * opening. A single empty paragraph is the just-created state, not content — the
 * body always has one, so counting it would make every toggle look full.
 */
export function toggleHasContent(node) {
  const body = node?.lastChild;
  if (!body || body.childCount === 0) return false;
  if (body.childCount > 1) return true;
  const only = body.firstChild;
  return !(only?.isTextblock && only.content.size === 0);
}

// The collapsible body node — same schema/commands as the stock
// DetailsContent, but rendered as a plain animatable div (no `hidden` toggle).
export const ToggleContent = DetailsContent.extend({
  // TipTap's stock details body treats Enter on the final empty line as an
  // instruction to leave the dropdown. That is surprising in a writing app:
  // pressing Return should always keep writing inside the open dropdown, and
  // clicking elsewhere should be the only way to leave it.
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, empty } = selection;

        // Let the normal paragraph/list handlers process ordinary Enter keys.
        // We only replace the stock "escape on an empty final line" case.
        if (!empty || !$from.parent.isTextblock || $from.parent.content.size > 0) {
          return false;
        }

        let contentDepth = -1;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type === this.type) {
            contentDepth = depth;
            break;
          }
        }
        if (contentDepth === -1) return false;

        const body = $from.node(contentDepth);
        const isLastChild = $from.index(contentDepth) === body.childCount - 1;
        if (!isLastChild) return false;

        // Create another empty block inside the dropdown instead of moving the
        // caret outside it. Repeating Enter repeats this behavior indefinitely.
        return editor.commands.splitBlock();
      },
    };
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('div');
      dom.setAttribute('data-type', this.name);
      dom.classList.add('toggle-block__body');
      return {
        dom,
        contentDOM: dom,
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          return !dom.contains(mutation.target) || dom === mutation.target;
        },
      };
    };
  },
});

// Re-exported unchanged so callers import the whole set from one place.
export const ToggleSummary = DetailsSummary;

export const CollapsibleToggle = Details.extend({
  // Run our input rules before StarterKit's blockquote rule so "> " makes a
  // toggle instead of a quote.
  priority: 200,

  // Always persist the open/closed state regardless of the `persist` option.
  addAttributes() {
    return {
      open: {
        // Collapsed on creation, like Notion. Documents saved earlier keep their
        // state: an open toggle serialises `open=""` and still parses back as
        // open, and one without the attribute was already closed.
        default: false,
        parseHTML: (element) => element.hasAttribute('open'),
        renderHTML: ({ open }) => (open ? { open: '' } : {}),
      },
    };
  },

  // Turning an existing block into a toggle puts its words on the TITLE line.
  //
  // The stock command drops them into the collapsed body instead and leaves the
  // title blank, which — now that toggles are created closed — looks exactly
  // like the conversion deleted the text. Notion reads the same way: turn a
  // heading into a toggle and the heading's words become the toggle's label.
  addCommands() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      setDetails: () => ({ state, chain }) => {
        const { schema, selection } = state;
        const { $from, $to } = selection;
        const range = $from.blockRange($to);
        if (!range) return false;

        const slice = state.doc.slice(range.start, range.end);
        const blocks = [];
        slice.content.forEach((node) => blocks.push(node));

        // Anything that is not a run of text — an image, an embed — has no
        // inline content to become a title, so it keeps the stock behavior of
        // going into the body.
        const [first] = blocks;
        if (!first?.isTextblock) return parent.setDetails?.()({ state, chain }) ?? false;

        const title = first.content.toJSON() || [];
        const body = blocks.slice(1).map((node) => node.toJSON());
        if (!schema.nodes.detailsContent.contentMatch.matchFragment(slice.content.cut(first.nodeSize))) {
          return parent.setDetails?.()({ state, chain }) ?? false;
        }

        return chain()
          .insertContentAt({ from: range.start, to: range.end }, {
            type: this.name,
            // Opened only when converting something that leaves content behind,
            // so a conversion can never hide words inside a closed toggle.
            attrs: { open: body.length > 0 },
            content: [
              { type: 'detailsSummary', ...(title.length ? { content: title } : {}) },
              { type: 'detailsContent', content: body.length ? body : [{ type: 'paragraph' }] },
            ],
          })
          // End of the title, where the caret was conceptually left.
          .setTextSelection(range.start + 2 + first.content.size)
          .run();
      },

      // Converting a toggle back into anything else used to leave a stray empty
      // line behind: the body always carries one empty paragraph, and the stock
      // command merges the body out whole, placeholder and all.
      unsetDetails: () => (props) => {
        const { state, chain } = props;
        const details = findParentNode((node) => node.type === this.type)(state.selection);
        if (!details || toggleHasContent(details.node)) {
          return parent.unsetDetails?.()(props) ?? false;
        }

        const summary = details.node.firstChild;
        const from = details.pos;
        const to = from + details.node.nodeSize;
        const defaultType = state.doc.resolve(from).parent.type.contentMatch.defaultType;
        if (!summary || !defaultType) return parent.unsetDetails?.()(props) ?? false;

        return chain()
          .insertContentAt({ from, to }, defaultType.create(null, summary.content).toJSON())
          .setTextSelection(from + 1)
          .run();
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // Start of a block, ">" then a space.
        find: /^>\s$/,
        handler: ({ chain, range }) => {
          // Don't hijack typing inside a toggle's title line.
          if (this.editor.isActive('detailsSummary')) return;
          chain().deleteRange(range).setDetails().run();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    // Replace the stock Details selection guard, rather than inheriting it.
    // appendTransaction runs BEFORE the view renders the new document. Looking
    // up a post-paste position in the old DOM can hit an unrelated hidden body
    // and incorrectly send the caret (and scroll position) back to the title.
    // Check persisted state plus Find's temporary reveals in the NEW state.
    // A search-opened body is editable even though its saved open flag is false.
    return [new Plugin({
      key: new PluginKey('detailsSelection'),
      props: {
        transformCopied: (slice, view) => textOnlyToggleContext(slice, view.state.schema),
      },
      appendTransaction: (transactions, oldState, newState) => {
        const { selection } = newState;
        if (!(selection instanceof TextSelection) || !selection.empty) return;
        if (!transactions.some((tr) => tr.selectionSet || tr.docChanged || tr.getMeta(findInEditorKey))) return;

        const { $from } = selection;
        // Start outside and work in: an open child inside a closed parent's
        // body is still hidden. A closed toggle's own title remains editable.
        for (let depth = 1; depth < $from.depth; depth += 1) {
          const node = $from.node(depth);
          if (node.type !== this.type || node.attrs.open
            || isFindRevealed(newState, $from.before(depth))) continue;
          if ($from.node(depth + 1).type !== newState.schema.nodes.detailsContent) continue;

          const summary = node.firstChild;
          if (summary?.type !== newState.schema.nodes.detailsSummary) return;
          const summaryStart = $from.start(depth) + 1;
          const movingForward = oldState.selection.from < selection.from;
          const position = summaryStart + (movingForward ? 0 : summary.content.size);
          return newState.tr.setSelection(TextSelection.create(newState.doc, position));
        }
      },
    })];
  },

  // Make Backspace behave the way people intuitively expect inside a toggle:
  //
  //   • In the body, at the very start of the first line, Backspace jumps the
  //     caret up into the title (merging that line's text into the title), just
  //     like joining two normal paragraphs.
  //   • In the title, at the very start, Backspace removes the toggle wrapper
  //     (its text + body content are kept as normal paragraphs — nothing lost).
  //
  // Everywhere else we return false so the editor's default character-by-
  // character deletion still runs.
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      Backspace: () => {
        const { editor } = this;
        const { state } = editor;
        const { selection, schema } = state;
        const { empty, $from } = selection;
        if (!empty) return false;

        const summaryType = schema.nodes.detailsSummary;
        const contentType = schema.nodes.detailsContent;

        // ── Case 1: caret is in the title (summary) ───────────────────────
        if ($from.parent.type === summaryType) {
          if ($from.parentOffset === 0) {
            // Start of the title → unwrap the whole toggle (keep its content).
            return editor.commands.unsetDetails();
          }
          return false; // delete a character normally
        }

        // ── Case 2: caret is in the body (detailsContent) ─────────────────
        // Find the detailsContent ancestor.
        let contentDepth = -1;
        for (let d = $from.depth; d > 0; d -= 1) {
          if ($from.node(d).type === contentType) {
            contentDepth = d;
            break;
          }
        }
        if (contentDepth === -1) return false; // not inside a toggle body

        const blockDepth = contentDepth + 1;
        // Only handle a caret sitting directly in the body's first child block,
        // right at its start. Deeper nesting (lists, nested toggles) falls
        // through to the default behavior.
        if ($from.depth !== blockDepth) return false;
        if ($from.parentOffset !== 0) return false;
        if ($from.index(contentDepth) !== 0) return false;

        const block = $from.parent;
        if (!block.isTextblock) return false;

        // End of the title's text = just before the body node.
        const posBeforeContent = $from.before(contentDepth);
        const summaryEnd = posBeforeContent - 1;

        const blockBefore = $from.before(blockDepth);
        const blockAfter = $from.after(blockDepth);
        const blockStart = $from.start(blockDepth);
        const blockEnd = $from.end(blockDepth);
        const onlyChild = $from.node(contentDepth).childCount === 1;
        const blockEmpty = block.content.size === 0;

        const tr = state.tr;
        // Body comes after the title, so editing the body never shifts
        // summaryEnd — we can delete first, then insert at summaryEnd.
        if (blockEmpty) {
          // Nothing to merge; drop the empty line unless it's the body's last
          // remaining block, then move the caret up into the title.
          if (!onlyChild) tr.delete(blockBefore, blockAfter);
        } else if (onlyChild) {
          // Keep the (now empty) body block, move its text into the title.
          tr.delete(blockStart, blockEnd);
          tr.insert(summaryEnd, block.content);
        } else {
          // Remove the whole first line and move its text into the title.
          tr.delete(blockBefore, blockAfter);
          tr.insert(summaryEnd, block.content);
        }
        tr.setSelection(TextSelection.create(tr.doc, summaryEnd));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },

  addNodeView() {
    return ({ editor, node, getPos, decorations = [] }) => {
      let currentNode = node;
      const initialReveal = decorations.find(decoration => decoration.spec.findReveal)?.spec;
      let findRevealed = initialReveal?.findReveal;
      let dismissFindReveal = !!initialReveal?.findDismissed;
      const isOpen = () => !!currentNode.attrs.open || (!!findRevealed && !dismissFindReveal);

      const dom = document.createElement('div');
      dom.classList.add('toggle-block');
      const startOpen = isOpen();
      dom.classList.toggle('is-open', startOpen);
      dom.classList.toggle('has-content', toggleHasContent(currentNode));

      const bodyId = `toggle-body-${++bodyIdSeq}`;

      const chevron = document.createElement('button');
      chevron.type = 'button';
      chevron.className = 'toggle-block__chevron';
      chevron.contentEditable = 'false';
      chevron.setAttribute('aria-label', 'Toggle section');
      chevron.setAttribute('aria-expanded', String(startOpen));
      chevron.setAttribute('aria-controls', bodyId);
      chevron.style.transform = startOpen ? 'rotate(90deg)' : 'rotate(0deg)';
      chevron.innerHTML = chevronSvg();

      const host = document.createElement('div');
      host.className = 'toggle-block__host';

      dom.append(chevron, host);

      const getBody = () => host.querySelector('[data-type="detailsContent"]');

      let animTimer = null;

      const applyOpen = (open, animate) => {
        dom.classList.toggle('is-open', open);
        chevron.setAttribute('aria-expanded', String(open));
        // Rotated here rather than left to a descendant CSS rule. The node view
        // already holds the authoritative open state, so setting it directly
        // cannot fall out of step with the class, and it removes any dependence
        // on selector specificity against the surrounding editor styles.
        chevron.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';

        const body = getBody();
        if (!body) return;
        if (!body.id) body.id = bodyId;

        if (animTimer) {
          clearTimeout(animTimer);
          animTimer = null;
        }

        if (open) {
          body.hidden = false;
          if (!animate) {
            body.style.height = '';
            body.style.opacity = '';
            return;
          }
          body.style.height = '0px';
          body.style.opacity = '0';
          // Force reflow so the transition starts from height 0.
          void body.offsetHeight;
          body.style.height = `${body.scrollHeight}px`;
          body.style.opacity = '1';
          animTimer = setTimeout(() => {
            // Release to auto so the body can grow as it's edited.
            body.style.height = '';
            body.style.opacity = '';
            animTimer = null;
          }, ANIM_MS);
        } else {
          if (!animate) {
            body.style.height = '0px';
            body.style.opacity = '0';
            body.hidden = true;
            return;
          }
          body.style.height = `${body.scrollHeight}px`;
          body.style.opacity = '1';
          void body.offsetHeight;
          body.style.height = '0px';
          body.style.opacity = '0';
          animTimer = setTimeout(() => {
            body.hidden = true; // remove from a11y tree once collapsed
            animTimer = null;
          }, ANIM_MS);
        }
      };

      // Children render right after the NodeView is created; set the initial
      // (un-animated) state on the next frame.
      const initialFrame = requestAnimationFrame(() => applyOpen(isOpen(), false));

      const toggle = (e) => {
        if (e) e.preventDefault();
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (pos == null) return;
        const next = !isOpen();
        // Manual control wins until the next explicit search navigation.
        dismissFindReveal = true;
        applyOpen(next, true);
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(pos, 'open', next);
            if (findRevealed) tr.setMeta(findInEditorKey, { dismissReveal: pos });
            return true;
          })
          .run();
      };

      chevron.addEventListener('mousedown', (e) => e.preventDefault());
      chevron.addEventListener('click', toggle);
      chevron.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          toggle();
        }
      });

      return {
        dom,
        contentDOM: host,
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          if (chevron.contains(mutation.target)) return true;
          return !host.contains(mutation.target) || host === mutation.target;
        },
        update: (updatedNode, decorations = []) => {
          if (updatedNode.type !== currentNode.type) return false;
          const wasOpen = dom.classList.contains('is-open');
          const reveal = decorations.find(decoration => decoration.spec.findReveal)?.spec;
          const nextReveal = reveal?.findReveal;
          const revealChanged = nextReveal !== findRevealed;
          dismissFindReveal = !!reveal?.findDismissed;
          findRevealed = nextReveal;
          currentNode = updatedNode;
          const willOpen = isOpen();
          // Reveal immediately so Find measures the fully expanded layout.
          // Search uses decorations only, preserving saved state and undo.
          if (wasOpen !== willOpen || revealChanged) applyOpen(willOpen, !revealChanged);
          // The triangle brightens as soon as the toggle holds something, so the
          // state has to be re-read on every update, not just at creation.
          dom.classList.toggle('has-content', toggleHasContent(updatedNode));
          return true;
        },
        destroy: () => {
          cancelAnimationFrame(initialFrame);
          if (animTimer) clearTimeout(animTimer);
        },
      };
    };
  },
});
