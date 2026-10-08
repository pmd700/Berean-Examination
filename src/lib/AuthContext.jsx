import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readLocalOwner } from '@/lib/localOwner';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [authState, setAuthState] = useState({
    user: null,
    isAuthenticated: false,
    isLoadingAuth: true,
  });

  const checkAppState = useCallback(async () => {
    try {
      const owner = await readLocalOwner();
      setAuthState({
        user: owner,
        isAuthenticated: true,
        isLoadingAuth: false,
      });
      return true;
    } catch (error) {
      console.error('[AuthContext] Local owner check failed:', error);
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoadingAuth: false,
      });
      return false;
    }
  }, []);

  useEffect(() => {
    void checkAppState();
  }, [checkAppState]);

  const value = useMemo(() => ({
    ...authState,
    checkAppState,
  }), [authState, checkAppState]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
