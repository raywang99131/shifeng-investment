import type { ThemeConfig } from 'antd';

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1890ff',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f5f7fa',
    colorText: '#262626',
    colorTextSecondary: '#595959',
    borderRadius: 8,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#ffffff',
      bodyBg: '#f5f7fa',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#e6f7ff',
      itemSelectedColor: '#1890ff',
    },
    Card: {
      headerBg: '#ffffff',
    },
    Table: {
      headerBg: '#fafafa',
    },
  },
};

export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: '#177ddc',
    colorBgContainer: '#1f1f1f',
    colorBgLayout: '#141414',
    colorText: '#ffffff',
    colorTextSecondary: '#a6a6a6',
    borderRadius: 8,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  components: {
    Layout: {
      headerBg: '#1f1f1f',
      siderBg: '#1f1f1f',
      bodyBg: '#141414',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#177ddc26',
      itemSelectedColor: '#177ddc',
    },
    Card: {
      headerBg: '#262626',
    },
    Table: {
      headerBg: '#262626',
    },
  },
};

export type ThemeMode = 'light' | 'dark';

export interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  themeConfig: ThemeConfig;
}