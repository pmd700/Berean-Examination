// JavaScript for Automation, executed only on macOS by /usr/bin/osascript.
// AppKit shapes the bundled public Unicode list, not the owner's documents.
// No Apple Events, app control, network, or system setting changes are used.
ObjC.import('AppKit');

function run(argv) {
  const font = $.NSFont.fontWithNameSize('AppleColorEmoji', 64);
  const data = $.NSData.dataWithContentsOfFile(argv[0]);
  const sequences = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  return JSON.stringify(sequences.map((text) => {
    const storage = $.NSTextStorage.alloc.init;
    storage.mutableString.setString(text);
    storage.addAttributeValueRange($.NSFontAttributeName, font, $.NSMakeRange(0, text.length));
    const layout = $.NSLayoutManager.alloc.init;
    storage.addLayoutManager(layout);
    const container = $.NSTextContainer.alloc.initWithContainerSize($.NSMakeSize(10000, 1000));
    layout.addTextContainer(container);
    layout.ensureLayoutForTextContainer(container);
    const glyphs = [];
    for (let index = 0; index < layout.numberOfGlyphs; index += 1) {
      const glyph = layout.glyphAtIndex(index);
      if (glyph > 0 && glyph < 65535) glyphs.push(glyph);
    }
    return glyphs;
  }));
}
