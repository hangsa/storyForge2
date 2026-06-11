import { Component, ReactNode } from "react";
import CircuitBreaker from "./CircuitBreaker";

interface Props {
  children: ReactNode;
  projectId?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class StageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <CircuitBreaker
          title="页面渲染异常"
          message={this.state.error?.message || "LLM 输出或数据格式异常导致渲染失败"}
          userOptions={[
            {
              label: "重试渲染",
              action: this.handleReset,
              variant: "primary",
            },
            {
              label: "回退",
              action: () => window.history.back(),
              variant: "default",
            },
          ]}
        />
      );
    }

    return this.props.children;
  }
}
