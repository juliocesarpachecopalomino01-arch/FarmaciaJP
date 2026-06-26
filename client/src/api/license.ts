import api from './client';

export type LicensePayload = {
  customer: string;
  expiresAt: string;
  issuedAt?: string;
  machineId?: string;
  maxUsers?: number;
  features?: string[];
};

export type LicenseStatus = {
  valid: boolean;
  reason?: string;
  message?: string;
  payload?: LicensePayload;
  daysRemaining?: number;
  machineId: string;
};

export const licenseApi = {
  getStatus: async (): Promise<LicenseStatus> => {
    const response = await api.get<LicenseStatus>('/license/status');
    return response.data;
  },

  activate: async (licenseKey: string): Promise<{ message: string; status: LicenseStatus; machineId: string }> => {
    const response = await api.post('/license/activate', { licenseKey });
    return response.data;
  },
};
