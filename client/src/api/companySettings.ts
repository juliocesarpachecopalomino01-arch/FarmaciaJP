import api from './client';

export interface CompanySettings {
  id?: number;
  business_name: string;
  trade_name?: string;
  tax_id?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_data_url?: string;
  receipt_title?: string;
  receipt_footer?: string;
  receipt_width_mm?: number;
  show_logo: number;
  show_qr: number;
  non_admin_history_days?: number;
  has_cash_reopen_password?: boolean;
  has_return_password?: boolean;
}

export type CompanySettingsPayload = Omit<Partial<CompanySettings>, 'show_logo' | 'show_qr'> & {
  show_logo?: boolean;
  show_qr?: boolean;
  cash_reopen_password?: string;
  return_password?: string;
};

export const companySettingsApi = {
  get: async (): Promise<CompanySettings> => {
    const response = await api.get<CompanySettings>('/company-settings');
    return response.data;
  },

  getPublic: async (): Promise<Pick<CompanySettings, 'business_name' | 'trade_name' | 'logo_data_url'>> => {
    const response = await api.get<Pick<CompanySettings, 'business_name' | 'trade_name' | 'logo_data_url'>>('/company-settings/public');
    return response.data;
  },

  update: async (settings: CompanySettingsPayload): Promise<{ message: string }> => {
    const response = await api.put('/company-settings', settings);
    return response.data;
  },
};
