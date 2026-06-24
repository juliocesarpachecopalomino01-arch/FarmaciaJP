import { useState, useEffect } from 'react';
import { User, authApi } from '../api/auth';

const AUTH_STATE_CHANGED = 'auth-state-changed';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        authApi.getCurrentUser().then((freshUser) => {
          setUser(freshUser);
          localStorage.setItem('user', JSON.stringify(freshUser));
        }).catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        });
      } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);

    const syncAuthState = () => {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        setUser(null);
        return;
      }

      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      }
    };

    window.addEventListener(AUTH_STATE_CHANGED, syncAuthState);
    return () => window.removeEventListener(AUTH_STATE_CHANGED, syncAuthState);
  }, []);

  const login = async (username: string, password: string) => {
    const response = await authApi.login({ username, password });
    localStorage.setItem('token', response.token);
    localStorage.setItem('user', JSON.stringify(response.user));
    setUser(response.user);
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED));
    return response;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED));
  };

  return { user, loading, login, logout };
}
