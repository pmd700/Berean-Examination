// This offline visual fixture never reads or writes the user's library.
export const desktopClient = { entities: { Keyword: { list: async () => [] } } };
