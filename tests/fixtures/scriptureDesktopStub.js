// Isolated fixture data; no connection to the user's vault.
const lists = {
  KnowledgeWeb: [{ id: 1, title: 'First Debate' }, { id: 2, title: 'Components of Hebrews' }],
  MindNote: [{ id: 3, title: 'Conscience Masterclass' }, { id: 4, title: 'The Nazarenes' }],
  Timegraph: [{ id: 5, title: 'My Study Journey', events: [] }, { id: 6, title: 'Reformation', events: [] }],
};
export const desktopClient = {
  owner: { read: async () => ({}), updatePreferences: async () => ({}) },
  entities: new Proxy({}, { get: (_, name) => ({
    list: async () => lists[name] || [],
    filter: async () => [],
    get: async (id) => (lists[name] || []).find((item) => item.id === id),
  }) }),
};
