export function isSidebarToggleShortcut(event) {
  const modifier = event?.metaKey || event?.ctrlKey;
  const backslash = event?.code === 'Backslash' || event?.key === '\\';
  return Boolean(modifier && backslash && !event?.shiftKey && !event?.altKey);
}
