import api from './client';

export interface Worker {
  id: number;
  document_type?: string;
  document_number?: string;
  full_name: string;
  email?: string;
  phone?: string;
  address?: string;
  position?: string;
  hire_date?: string;
  is_active: boolean | number;
  user_id?: number;
  username?: string;
  user_active?: boolean | number;
  created_at?: string;
}

export interface UserProfile {
  id: number;
  name: string;
  description?: string;
  role: 'admin' | 'employee';
  is_active: boolean | number;
  permissions?: UserPermissions;
}

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  worker_id?: number;
  worker_name?: string;
  profile_id?: number;
  profile_name?: string;
  document_number?: string;
  is_active: boolean | number;
  created_at: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  worker_id: number | string;
  profile_id: number | string;
  permissions?: UserPermissions;
}

export interface UserPermissions {
  [moduleKey: string]: boolean;
}

export const usersApi = {
  getAll: async (): Promise<User[]> => {
    const response = await api.get<User[]>('/users');
    return response.data;
  },

  getById: async (id: number): Promise<User> => {
    const response = await api.get<User>(`/users/${id}`);
    return response.data;
  },

  create: async (data: CreateUserRequest): Promise<{ id: number; message: string }> => {
    const response = await api.post('/users', data);
    return response.data;
  },

  update: async (id: number, user: Partial<User>): Promise<{ message: string }> => {
    const response = await api.put(`/users/${id}`, user);
    return response.data;
  },

  getPermissions: async (id: number): Promise<UserPermissions> => {
    const response = await api.get<UserPermissions>(`/users/${id}/permissions`);
    return response.data;
  },

  updatePermissions: async (id: number, permissions: UserPermissions): Promise<{ message: string }> => {
    const response = await api.put(`/users/${id}/permissions`, { permissions });
    return response.data;
  },

  changePassword: async (id: number, data: { current_password?: string; new_password: string }): Promise<{ message: string }> => {
    const response = await api.put(`/users/${id}/password`, data);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },

  getWorkers: async (): Promise<Worker[]> => {
    const response = await api.get<Worker[]>('/users/workers');
    return response.data;
  },

  createWorker: async (data: Partial<Worker>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/users/workers', data);
    return response.data;
  },

  updateWorker: async (id: number, data: Partial<Worker>): Promise<{ message: string }> => {
    const response = await api.put(`/users/workers/${id}`, data);
    return response.data;
  },

  deleteWorker: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/users/workers/${id}`);
    return response.data;
  },

  getProfiles: async (): Promise<UserProfile[]> => {
    const response = await api.get<UserProfile[]>('/users/profiles');
    return response.data;
  },

  createProfile: async (data: Partial<UserProfile>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/users/profiles', data);
    return response.data;
  },

  updateProfile: async (id: number, data: Partial<UserProfile>): Promise<{ message: string }> => {
    const response = await api.put(`/users/profiles/${id}`, data);
    return response.data;
  },

  deleteProfile: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/users/profiles/${id}`);
    return response.data;
  },
};
