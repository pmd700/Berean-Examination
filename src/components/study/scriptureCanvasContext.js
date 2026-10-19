import { createContext, useContext } from 'react';
export const ScriptureCanvasContext = createContext(null);
export const useScriptureCanvas = () => useContext(ScriptureCanvasContext);
