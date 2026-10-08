/**
 * Stub for tippy.js under jsdom.
 *
 * tippy positions itself with Popper, which needs a layout engine jsdom does not
 * have. The editor only uses it for the bubble menu's placement — nothing these
 * suites assert on — so it is replaced with an inert instance rather than left to
 * throw ("tippy is not a function") the moment the editor takes focus.
 *
 * If a suite ever needs to test bubble-menu behaviour, that suite should assert
 * on the menu's own DOM, not on tippy.
 */

function createInstance() {
  return {
    setProps() {},
    setContent() {},
    show() {},
    hide() {},
    enable() {},
    disable() {},
    destroy() {},
    state: { isEnabled: true, isVisible: false, isDestroyed: false, isMounted: false },
    popper: typeof document === 'undefined' ? null : document.createElement('div'),
  };
}

function tippy() {
  return createInstance();
}

tippy.setDefaultProps = () => {};
tippy.defaultProps = {};

export default tippy;
export { tippy, createInstance as createTippyInstance };
