import React from 'react';
import { Alert, Button } from 'antd';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <Alert
          type="error"
          message="页面加载失败"
          description={this.state.error?.message || '发生了未知错误'}
          showIcon
          action={
            <Button size="small" onClick={this.handleRetry}>
              重试
            </Button>
          }
          style={{ margin: 16 }}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
