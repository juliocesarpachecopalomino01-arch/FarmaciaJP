import api from './client';

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  full_name: string;
  role?: 'admin' | 'employee';
  permissions?: string[];
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

  changePassword: async (id: number, data: { current_password: string; new_password: string }): Promise<{ message: string }> => {
    const response = await api.put(`/users/${id}/password`, data);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },
};
