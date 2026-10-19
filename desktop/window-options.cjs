'use strict';

// Keep the expanded desktop size. A smaller minimum lets macOS pair BEX
// with another app in native Split View, including smaller MacBook screens.
module.exports = Object.freeze({
  width: 1440,
  height: 900,
  minWidth: 480,
  minHeight: 480,
  resizable: true,
  maximizable: true,
  fullscreenable: true,
});
