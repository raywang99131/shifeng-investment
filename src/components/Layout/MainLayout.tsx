import React, { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Switch, Typography, Space, Button } from 'antd';
import {
  FundOutlined,
  LineChartOutlined,
  FileTextOutlined,
  PieChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SunOutlined,
  MoonOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  FileProtectOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const menuItems = [
    {
      key: '/news',
      icon: <FileProtectOutlined />,
      label: '新闻资讯',
    },
    {
      key: '/market',
      icon: <LineChartOutlined />,
      label: '行情监控',
    },
    {
      key: '/research',
      icon: <FileTextOutlined />,
      label: '投资研究',
    },
    {
      key: '/portfolio',
      icon: <PieChartOutlined />,
      label: '投资组合',
    },
    {
      key: '/alternative',
      icon: <FundOutlined />,
      label: '另类数据',
    },
  ];

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
    },
  ];

  const handleMenuClick = (key: string) => {
    navigate(key);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={220}
        style={{
          background: theme === 'dark' ? '#1f1f1f' : '#ffffff',
          borderRight: theme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: theme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
          }}
        >
          {collapsed ? (
            <Button type="text" onClick={() => navigate('/')} style={{ fontSize: 18, color: '#ff4d4f', height: 'auto', padding: 0 }}>
              <Text strong style={{ fontSize: 18, color: '#ff4d4f' }}>SF</Text>
            </Button>
          ) : (
            <Button type="text" onClick={() => navigate('/')} style={{ fontSize: 20, color: '#ff4d4f', height: 'auto', padding: 0 }}>
              <Text strong style={{ fontSize: 20, color: '#ff4d4f' }}>石锋资产</Text>
            </Button>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => handleMenuClick(key)}
          style={{
            borderRight: 0,
            marginTop: 8,
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: theme === 'dark' ? '#1f1f1f' : '#ffffff',
            borderBottom: theme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <Space size={16}>
            <Space size={8}>
              <SunOutlined style={{ color: theme === 'light' ? '#faad14' : '#666' }} />
              <Switch
                size="small"
                checked={theme === 'dark'}
                onChange={() => toggleTheme()}
              />
              <MoonOutlined style={{ color: theme === 'dark' ? '#177ddc' : '#666' }} />
            </Space>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Avatar icon={<UserOutlined />} style={{ cursor: 'pointer' }} />
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: theme === 'dark' ? '#141414' : '#f5f7fa',
            borderRadius: 8,
            minHeight: 280,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;