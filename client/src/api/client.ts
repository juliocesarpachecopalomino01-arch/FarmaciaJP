import axios from 'axios';

const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API_BASE_URL = rawApiUrl
  ? `${rawApiUrl.replace(/\/$/, '')}/api`
  : '/api';

export const buildApiUrl = (path: string) =>
  `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
